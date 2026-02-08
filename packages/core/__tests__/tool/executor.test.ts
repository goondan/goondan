/**
 * ToolExecutor 테스트
 * @see /docs/specs/tool.md - 5. Tool 실행 흐름, 6. Tool 결과 처리, 7. Tool 오류 처리
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor } from '../../src/tool/executor.js';
import { ToolRegistry } from '../../src/tool/registry.js';
import { ToolCatalog } from '../../src/tool/catalog.js';
import type {
  ToolHandler,
  ToolCall,
  ToolContext,
  ToolResult,
} from '../../src/tool/types.js';
import type { Resource } from '../../src/types/resource.js';
import type { ToolSpec } from '../../src/types/specs/tool.js';

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let registry: ToolRegistry;
  let catalog: ToolCatalog;
  let mockContext: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    catalog = new ToolCatalog();
    executor = new ToolExecutor(registry);

    // Mock context
    mockContext = {
      instance: {} as ToolContext['instance'],
      swarm: {} as ToolContext['swarm'],
      agent: {} as ToolContext['agent'],
      turn: {
        id: 'turn_123',
        instanceId: 'instance_123',
        agentName: 'test-agent',
        messages: [],
        toolResults: new Map(),
      },
      step: {
        id: 'step_1',
        index: 0,
        turnId: 'turn_123',
      },
      toolCatalog: [],
      swarmBundle: {} as ToolContext['swarmBundle'],
      oauth: {} as ToolContext['oauth'],
      events: {} as ToolContext['events'],
      logger: console,
    };
  });

  describe('execute()', () => {
    it('등록된 Tool을 실행하고 성공 결과를 반환한다', async () => {
      const handler: ToolHandler = async (_ctx, input) => {
        const a = input.a as number;
        const b = input.b as number;
        return { result: a + b };
      };

      registry.register({
        name: 'calc.add',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_123',
        name: 'calc.add',
        args: { a: 5, b: 3 },
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.toolCallId).toBe('call_123');
      expect(result.toolName).toBe('calc.add');
      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ result: 8 });
    });

    it('동기 핸들러도 실행할 수 있다', async () => {
      const handler: ToolHandler = (_ctx, input) => {
        const a = input.a as number;
        const b = input.b as number;
        return { result: a * b };
      };

      registry.register({
        name: 'calc.multiply',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_456',
        name: 'calc.multiply',
        args: { a: 6, b: 7 },
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ result: 42 });
    });

    it('등록되지 않은 Tool 호출 시 error 결과를 반환한다', async () => {
      const toolCall: ToolCall = {
        id: 'call_789',
        name: 'non.existent',
        args: {},
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.status).toBe('error');
      expect(result.error?.message).toContain('non.existent');
      expect(result.error?.name).toBe('ToolNotFoundError');
    });

    it('Catalog 밖 Tool 호출 시 구조화된 거부 결과를 반환한다', async () => {
      const handler: ToolHandler = vi.fn().mockResolvedValue({ ok: true });
      registry.register({
        name: 'hidden.tool',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_hidden',
        name: 'hidden.tool',
        args: {},
      };

      // 빈 catalog를 전달하면 hidden.tool은 허용되지 않아야 함
      const result = await executor.execute(toolCall, mockContext, catalog);

      expect(result.status).toBe('error');
      expect(result.error?.name).toBe('ToolNotInCatalogError');
      expect(result.error?.code).toBe('E_TOOL_NOT_IN_CATALOG');
      expect(result.error?.suggestion).toContain('step.tools');
      expect(handler).not.toHaveBeenCalled();
    });

    it('핸들러 예외 시 error 결과를 반환한다', async () => {
      const handler: ToolHandler = async () => {
        throw new Error('Something went wrong');
      };

      registry.register({
        name: 'failing.tool',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_error',
        name: 'failing.tool',
        args: {},
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('Something went wrong');
    });

    it('pending 결과를 처리할 수 있다', async () => {
      const handler: ToolHandler = async () => {
        return {
          __async: true,
          handle: 'build-12345',
          message: '빌드가 시작되었습니다',
        };
      };

      registry.register({
        name: 'build.start',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_async',
        name: 'build.start',
        args: { project: 'my-project' },
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.status).toBe('pending');
      expect(result.handle).toBe('build-12345');
      expect(result.output).toEqual({
        __async: true,
        handle: 'build-12345',
        message: '빌드가 시작되었습니다',
      });
    });
  });

  describe('errorMessageLimit 적용', () => {
    it('에러 메시지가 기본 1000자로 제한된다', async () => {
      const longMessage = 'x'.repeat(1500);
      const handler: ToolHandler = async () => {
        throw new Error(longMessage);
      };

      registry.register({
        name: 'long.error',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_long',
        name: 'long.error',
        args: {},
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.status).toBe('error');
      expect(result.error?.message.length).toBeLessThanOrEqual(1000);
      expect(result.error?.message).toContain('... (truncated)');
    });

    it('Tool 리소스의 errorMessageLimit을 적용한다', async () => {
      const longMessage = 'x'.repeat(500);
      const handler: ToolHandler = async () => {
        throw new Error(longMessage);
      };

      const toolResource: Resource<ToolSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'limited-tool' },
        spec: {
          runtime: 'node',
          entry: './index.js',
          errorMessageLimit: 200, // 200자 제한
          exports: [
            {
              name: 'limited.tool',
              description: 'Test',
              parameters: { type: 'object' },
            },
          ],
        },
      };

      registry.register({
        name: 'limited.tool',
        handler,
      });

      catalog.addFromToolResource(toolResource);

      const toolCall: ToolCall = {
        id: 'call_limited',
        name: 'limited.tool',
        args: {},
      };

      // catalog에서 tool 정보를 가져와서 실행
      const result = await executor.execute(toolCall, mockContext, catalog);

      expect(result.status).toBe('error');
      expect(result.error?.message.length).toBeLessThanOrEqual(200);
    });

    it('짧은 에러 메시지는 truncate하지 않는다', async () => {
      const shortMessage = 'Short error';
      const handler: ToolHandler = async () => {
        throw new Error(shortMessage);
      };

      registry.register({
        name: 'short.error',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_short',
        name: 'short.error',
        args: {},
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('Short error');
      expect(result.error?.message).not.toContain('truncated');
    });
  });

  describe('에러 정보 보존', () => {
    it('Error.name을 ToolError.name에 보존한다', async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const handler: ToolHandler = async () => {
        throw new CustomError('Custom error occurred');
      };

      registry.register({
        name: 'custom.error',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_custom',
        name: 'custom.error',
        args: {},
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.error?.name).toBe('CustomError');
    });

    it('Error에 code 속성이 있으면 ToolError.code에 보존한다', async () => {
      const handler: ToolHandler = async () => {
        const error = new Error('API error');
        (error as Error & { code: string }).code = 'E_API_FAILED';
        throw error;
      };

      registry.register({
        name: 'coded.error',
        handler,
      });

      const toolCall: ToolCall = {
        id: 'call_coded',
        name: 'coded.error',
        args: {},
      };

      const result = await executor.execute(toolCall, mockContext);

      expect(result.error?.code).toBe('E_API_FAILED');
    });
  });

  describe('executeAll()', () => {
    it('여러 Tool을 병렬로 실행한다', async () => {
      const delays: number[] = [];

      const handler1: ToolHandler = async () => {
        const start = Date.now();
        await new Promise((r) => setTimeout(r, 50));
        delays.push(Date.now() - start);
        return { tool: 1 };
      };

      const handler2: ToolHandler = async () => {
        const start = Date.now();
        await new Promise((r) => setTimeout(r, 50));
        delays.push(Date.now() - start);
        return { tool: 2 };
      };

      registry.register({ name: 'tool1', handler: handler1 });
      registry.register({ name: 'tool2', handler: handler2 });

      const toolCalls: ToolCall[] = [
        { id: 'call_1', name: 'tool1', args: {} },
        { id: 'call_2', name: 'tool2', args: {} },
      ];

      const startTime = Date.now();
      const results = await executor.executeAll(toolCalls, mockContext);
      const totalTime = Date.now() - startTime;

      expect(results).toHaveLength(2);
      expect(results[0].output).toEqual({ tool: 1 });
      expect(results[1].output).toEqual({ tool: 2 });

      // 병렬 실행이므로 총 시간이 100ms 미만이어야 함
      expect(totalTime).toBeLessThan(100);
    });

    it('일부 Tool이 실패해도 다른 결과는 반환한다', async () => {
      const handler1: ToolHandler = async () => {
        return { success: true };
      };

      const handler2: ToolHandler = async () => {
        throw new Error('Failed');
      };

      registry.register({ name: 'success.tool', handler: handler1 });
      registry.register({ name: 'failing.tool', handler: handler2 });

      const toolCalls: ToolCall[] = [
        { id: 'call_1', name: 'success.tool', args: {} },
        { id: 'call_2', name: 'failing.tool', args: {} },
      ];

      const results = await executor.executeAll(toolCalls, mockContext);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('ok');
      expect(results[1].status).toBe('error');
    });
  });
});
