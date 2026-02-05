/**
 * ToolRegistry 테스트
 * @see /docs/specs/extension.md - 6. Tool 등록 API
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/extension/tool-registry.js';
import type { DynamicToolDefinition, ToolContext } from '../../src/extension/types.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('Tool을 등록할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'test.tool',
        description: 'Test tool',
        handler: async () => ({ result: 'ok' }),
      };

      expect(() => {
        registry.register(toolDef);
      }).not.toThrow();
    });

    it('파라미터가 있는 Tool을 등록할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'search.tool',
        description: 'Search tool',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
        handler: async (ctx, input) => {
          return { results: [], total: 0 };
        },
      };

      registry.register(toolDef);
      const tool = registry.get('search.tool');

      expect(tool).toBeDefined();
      expect(tool?.parameters?.properties?.query).toEqual({
        type: 'string',
        description: 'Search query',
      });
    });

    it('메타데이터가 있는 Tool을 등록할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'metadata.tool',
        description: 'Tool with metadata',
        handler: async () => ({ result: 'ok' }),
        metadata: {
          source: 'test-extension',
          version: '1.0.0',
          custom: 'value',
        },
      };

      registry.register(toolDef);
      const tool = registry.get('metadata.tool');

      expect(tool?.metadata?.source).toBe('test-extension');
      expect(tool?.metadata?.version).toBe('1.0.0');
    });

    it('동일 이름의 Tool을 다시 등록하면 덮어쓴다', () => {
      registry.register({
        name: 'test.tool',
        description: 'Original',
        handler: async () => ({ result: 'original' }),
      });

      registry.register({
        name: 'test.tool',
        description: 'Updated',
        handler: async () => ({ result: 'updated' }),
      });

      const tool = registry.get('test.tool');
      expect(tool?.description).toBe('Updated');
    });
  });

  describe('unregister', () => {
    it('등록된 Tool을 제거할 수 있다', () => {
      registry.register({
        name: 'test.tool',
        description: 'Test tool',
        handler: async () => ({ result: 'ok' }),
      });

      registry.unregister('test.tool');

      expect(registry.get('test.tool')).toBeUndefined();
    });

    it('존재하지 않는 Tool을 제거해도 오류가 발생하지 않는다', () => {
      expect(() => {
        registry.unregister('non-existent');
      }).not.toThrow();
    });
  });

  describe('get', () => {
    it('등록된 Tool을 조회할 수 있다', () => {
      registry.register({
        name: 'test.tool',
        description: 'Test tool',
        handler: async () => ({ result: 'ok' }),
      });

      const tool = registry.get('test.tool');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('test.tool');
      expect(tool?.description).toBe('Test tool');
    });

    it('등록되지 않은 Tool은 undefined를 반환한다', () => {
      const tool = registry.get('non-existent');

      expect(tool).toBeUndefined();
    });
  });

  describe('list', () => {
    it('모든 등록된 Tool을 반환한다', () => {
      registry.register({
        name: 'tool1',
        description: 'Tool 1',
        handler: async () => ({ result: '1' }),
      });
      registry.register({
        name: 'tool2',
        description: 'Tool 2',
        handler: async () => ({ result: '2' }),
      });
      registry.register({
        name: 'tool3',
        description: 'Tool 3',
        handler: async () => ({ result: '3' }),
      });

      const tools = registry.list();

      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name).sort()).toEqual(['tool1', 'tool2', 'tool3']);
    });

    it('등록된 Tool이 없으면 빈 배열을 반환한다', () => {
      const tools = registry.list();

      expect(tools).toEqual([]);
    });
  });

  describe('has', () => {
    it('Tool이 등록되어 있으면 true를 반환한다', () => {
      registry.register({
        name: 'test.tool',
        description: 'Test tool',
        handler: async () => ({ result: 'ok' }),
      });

      expect(registry.has('test.tool')).toBe(true);
    });

    it('Tool이 등록되어 있지 않으면 false를 반환한다', () => {
      expect(registry.has('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('모든 등록된 Tool을 제거한다', () => {
      registry.register({
        name: 'tool1',
        description: 'Tool 1',
        handler: async () => ({ result: '1' }),
      });
      registry.register({
        name: 'tool2',
        description: 'Tool 2',
        handler: async () => ({ result: '2' }),
      });

      registry.clear();

      expect(registry.list()).toHaveLength(0);
    });
  });

  describe('invoke', () => {
    it('Tool 핸들러를 실행할 수 있다', async () => {
      registry.register({
        name: 'echo.tool',
        description: 'Echo tool',
        handler: async (ctx, input) => {
          return { echoed: input.message };
        },
      });

      const ctx = {} as ToolContext;
      const result = await registry.invoke('echo.tool', ctx, { message: 'hello' });

      expect(result).toEqual({ echoed: 'hello' });
    });

    it('존재하지 않는 Tool을 호출하면 오류가 발생한다', async () => {
      const ctx = {} as ToolContext;

      await expect(
        registry.invoke('non-existent', ctx, {})
      ).rejects.toThrow('Tool not found: non-existent');
    });

    it('Tool 핸들러 오류가 전파된다', async () => {
      registry.register({
        name: 'error.tool',
        description: 'Error tool',
        handler: async () => {
          throw new Error('Tool error');
        },
      });

      const ctx = {} as ToolContext;

      await expect(
        registry.invoke('error.tool', ctx, {})
      ).rejects.toThrow('Tool error');
    });

    it('동기 핸들러도 지원한다', async () => {
      registry.register({
        name: 'sync.tool',
        description: 'Sync tool',
        handler: (ctx, input) => {
          return { value: input.num };
        },
      });

      const ctx = {} as ToolContext;
      const result = await registry.invoke('sync.tool', ctx, { num: 42 });

      expect(result).toEqual({ value: 42 });
    });
  });
});
