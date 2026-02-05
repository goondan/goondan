/**
 * ToolRegistry 테스트
 * @see /docs/specs/tool.md - 1.1 Tool Registry
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tool/registry.js';
import type { DynamicToolDefinition, ToolHandler } from '../../src/tool/types.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  const mockHandler: ToolHandler = async (_ctx, input) => ({ result: input });

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register()', () => {
    it('동적 Tool을 등록할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'calc.add',
        description: '두 수를 더합니다',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        handler: mockHandler,
      };

      registry.register(toolDef);

      const registered = registry.get('calc.add');
      expect(registered).toBeDefined();
      expect(registered?.name).toBe('calc.add');
      expect(registered?.description).toBe('두 수를 더합니다');
    });

    it('같은 이름으로 재등록하면 덮어쓴다 (last-wins)', () => {
      const toolDef1: DynamicToolDefinition = {
        name: 'calc.add',
        description: '버전 1',
        handler: mockHandler,
      };

      const toolDef2: DynamicToolDefinition = {
        name: 'calc.add',
        description: '버전 2',
        handler: mockHandler,
      };

      registry.register(toolDef1);
      registry.register(toolDef2);

      const registered = registry.get('calc.add');
      expect(registered?.description).toBe('버전 2');
    });

    it('description과 parameters는 선택이다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'simple.tool',
        handler: mockHandler,
      };

      registry.register(toolDef);

      const registered = registry.get('simple.tool');
      expect(registered).toBeDefined();
      expect(registered?.description).toBeUndefined();
      expect(registered?.parameters).toBeUndefined();
    });
  });

  describe('unregister()', () => {
    it('등록된 Tool을 제거할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'calc.add',
        handler: mockHandler,
      };

      registry.register(toolDef);
      expect(registry.get('calc.add')).toBeDefined();

      registry.unregister('calc.add');
      expect(registry.get('calc.add')).toBeUndefined();
    });

    it('존재하지 않는 Tool을 제거해도 오류가 발생하지 않는다', () => {
      expect(() => registry.unregister('non.existent')).not.toThrow();
    });
  });

  describe('get()', () => {
    it('등록된 Tool을 조회할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'calc.add',
        description: '두 수를 더합니다',
        handler: mockHandler,
      };

      registry.register(toolDef);

      const result = registry.get('calc.add');
      expect(result).toBeDefined();
      expect(result?.name).toBe('calc.add');
    });

    it('등록되지 않은 Tool은 undefined를 반환한다', () => {
      const result = registry.get('non.existent');
      expect(result).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('등록된 모든 Tool 목록을 반환한다', () => {
      const toolDef1: DynamicToolDefinition = {
        name: 'calc.add',
        handler: mockHandler,
      };

      const toolDef2: DynamicToolDefinition = {
        name: 'calc.multiply',
        handler: mockHandler,
      };

      registry.register(toolDef1);
      registry.register(toolDef2);

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((t) => t.name)).toContain('calc.add');
      expect(list.map((t) => t.name)).toContain('calc.multiply');
    });

    it('빈 레지스트리는 빈 배열을 반환한다', () => {
      const list = registry.list();
      expect(list).toEqual([]);
    });

    it('반환된 배열은 원본을 수정해도 영향을 주지 않는다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'calc.add',
        handler: mockHandler,
      };

      registry.register(toolDef);

      const list = registry.list();
      list.pop();

      expect(registry.list()).toHaveLength(1);
    });
  });

  describe('has()', () => {
    it('등록된 Tool이 있으면 true를 반환한다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'calc.add',
        handler: mockHandler,
      };

      registry.register(toolDef);

      expect(registry.has('calc.add')).toBe(true);
    });

    it('등록되지 않은 Tool은 false를 반환한다', () => {
      expect(registry.has('non.existent')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('모든 Tool을 제거한다', () => {
      registry.register({ name: 'tool1', handler: mockHandler });
      registry.register({ name: 'tool2', handler: mockHandler });

      expect(registry.list()).toHaveLength(2);

      registry.clear();

      expect(registry.list()).toHaveLength(0);
    });
  });
});
