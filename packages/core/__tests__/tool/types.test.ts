/**
 * Tool 시스템 타입 테스트
 * @see /docs/specs/tool.md
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  ToolHandler,
  ToolContext,
  ToolResult,
  ToolError,
  ToolCall,
  ToolCatalogItem,
  ToolSource,
  DynamicToolDefinition,
  ToolRegistryApi,
} from '../../src/tool/types.js';
import type { JsonValue, JsonObject } from '../../src/types/json.js';
import type { Resource } from '../../src/types/resource.js';
import type { ToolSpec, ToolExport } from '../../src/types/specs/tool.js';

describe('Tool 시스템 타입', () => {
  describe('ToolHandler 타입', () => {
    it('동기 핸들러를 정의할 수 있다', () => {
      const handler: ToolHandler = (_ctx, input) => {
        return { result: input };
      };

      const mockCtx = {} as ToolContext;
      const result = handler(mockCtx, { value: 42 });
      expect(result).toEqual({ result: { value: 42 } });
    });

    it('비동기 핸들러를 정의할 수 있다', async () => {
      const handler: ToolHandler = async (_ctx, input) => {
        return Promise.resolve({ result: input });
      };

      const mockCtx = {} as ToolContext;
      const result = await handler(mockCtx, { value: 42 });
      expect(result).toEqual({ result: { value: 42 } });
    });
  });

  describe('ToolResult 타입', () => {
    it('ok 상태를 정의할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_123',
        toolName: 'calc.add',
        status: 'ok',
        output: { sum: 42 },
      };

      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ sum: 42 });
    });

    it('error 상태를 정의할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_123',
        toolName: 'api.call',
        status: 'error',
        error: {
          name: 'ApiError',
          message: 'Request failed',
          code: 'E_REQUEST_FAILED',
        },
      };

      expect(result.status).toBe('error');
      expect(result.error?.name).toBe('ApiError');
      expect(result.error?.message).toBe('Request failed');
      expect(result.error?.code).toBe('E_REQUEST_FAILED');
    });

    it('pending 상태를 정의할 수 있다', () => {
      const result: ToolResult = {
        toolCallId: 'call_123',
        toolName: 'build.start',
        status: 'pending',
        handle: 'build-12345',
        output: { message: '빌드가 시작되었습니다' },
      };

      expect(result.status).toBe('pending');
      expect(result.handle).toBe('build-12345');
    });
  });

  describe('ToolError 타입', () => {
    it('message는 필수이다', () => {
      const error: ToolError = {
        message: '오류가 발생했습니다',
      };

      expect(error.message).toBe('오류가 발생했습니다');
    });

    it('name과 code는 선택이다', () => {
      const error: ToolError = {
        message: '오류가 발생했습니다',
        name: 'ValidationError',
        code: 'E_VALIDATION',
      };

      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe('E_VALIDATION');
    });

    it('suggestion과 helpUrl을 포함할 수 있다', () => {
      const error: ToolError = {
        message: '인증이 필요합니다',
        name: 'AuthError',
        code: 'E_AUTH_REQUIRED',
        suggestion: 'OAuth 인증을 먼저 수행하세요',
        helpUrl: 'https://docs.example.com/auth',
      };

      expect(error.suggestion).toBe('OAuth 인증을 먼저 수행하세요');
      expect(error.helpUrl).toBe('https://docs.example.com/auth');
    });
  });

  describe('ToolCall 타입', () => {
    it('id, name, args는 필수이다', () => {
      const toolCall: ToolCall = {
        id: 'call_abc123',
        name: 'calc.multiply',
        args: { a: 6, b: 7 },
      };

      expect(toolCall.id).toBe('call_abc123');
      expect(toolCall.name).toBe('calc.multiply');
      expect(toolCall.args).toEqual({ a: 6, b: 7 });
    });
  });

  describe('ToolCatalogItem 타입', () => {
    it('Config에서 로드된 Tool을 정의할 수 있다', () => {
      const mockToolResource: Resource<ToolSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'slackToolkit' },
        spec: {
          runtime: 'node',
          entry: './tools/slack/index.js',
          exports: [
            {
              name: 'slack.postMessage',
              description: '채널에 메시지 전송',
              parameters: { type: 'object' },
            },
          ],
        },
      };

      const item: ToolCatalogItem = {
        name: 'slack.postMessage',
        description: '채널에 메시지 전송',
        parameters: { type: 'object' },
        tool: mockToolResource,
        export: mockToolResource.spec.exports[0],
        source: { type: 'config', name: 'slackToolkit' },
      };

      expect(item.name).toBe('slack.postMessage');
      expect(item.tool?.metadata.name).toBe('slackToolkit');
      expect(item.source?.type).toBe('config');
    });

    it('Extension에서 동적 등록된 Tool을 정의할 수 있다', () => {
      const item: ToolCatalogItem = {
        name: 'weather.get',
        description: '날씨 조회',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
        tool: null,
        export: null,
        source: { type: 'extension', name: 'weather-extension' },
      };

      expect(item.tool).toBeNull();
      expect(item.export).toBeNull();
      expect(item.source?.type).toBe('extension');
    });

    it('MCP Extension에서 노출된 Tool을 정의할 수 있다', () => {
      const source: ToolSource = {
        type: 'mcp',
        name: 'mcp-github',
        mcp: {
          extensionName: 'mcp-github',
          serverName: 'github-server',
        },
      };

      const item: ToolCatalogItem = {
        name: 'github.createIssue',
        description: 'GitHub 이슈 생성',
        source,
      };

      expect(item.source?.type).toBe('mcp');
      expect(item.source?.mcp?.extensionName).toBe('mcp-github');
    });
  });

  describe('DynamicToolDefinition 타입', () => {
    it('동적 Tool을 정의할 수 있다', () => {
      const handler: ToolHandler = async (_ctx, input) => {
        return { city: input.city, temp: 20 };
      };

      const def: DynamicToolDefinition = {
        name: 'weather.get',
        description: '날씨 조회',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '도시명' },
          },
          required: ['city'],
        },
        handler,
      };

      expect(def.name).toBe('weather.get');
      expect(def.handler).toBe(handler);
    });
  });

  describe('ToolRegistryApi 타입', () => {
    it('ToolRegistryApi 인터페이스를 정의할 수 있다', () => {
      const mockHandler: ToolHandler = () => ({ ok: true });

      // Mock implementation
      const registry: ToolRegistryApi = {
        register: vi.fn(),
        unregister: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
      };

      // register test
      const toolDef: DynamicToolDefinition = {
        name: 'test.tool',
        handler: mockHandler,
      };
      registry.register(toolDef);
      expect(registry.register).toHaveBeenCalledWith(toolDef);

      // unregister test
      registry.unregister('test.tool');
      expect(registry.unregister).toHaveBeenCalledWith('test.tool');

      // get test
      registry.get('test.tool');
      expect(registry.get).toHaveBeenCalledWith('test.tool');

      // list test
      registry.list();
      expect(registry.list).toHaveBeenCalled();
    });
  });
});
