/**
 * ToolCatalog 테스트
 * @see /docs/specs/tool.md - 1.1 Tool Catalog
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCatalog } from '../../src/tool/catalog.js';
import type { ToolCatalogItem } from '../../src/tool/types.js';
import type { Resource } from '../../src/types/resource.js';
import type { ToolSpec } from '../../src/types/specs/tool.js';

describe('ToolCatalog', () => {
  let catalog: ToolCatalog;

  const mockToolResource: Resource<ToolSpec> = {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Tool',
    metadata: { name: 'calcToolkit' },
    spec: {
      runtime: 'node',
      entry: './tools/calc/index.js',
      exports: [
        {
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
        },
        {
          name: 'calc.multiply',
          description: '두 수를 곱합니다',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        },
      ],
    },
  };

  beforeEach(() => {
    catalog = new ToolCatalog();
  });

  describe('add()', () => {
    it('ToolCatalogItem을 추가할 수 있다', () => {
      const item: ToolCatalogItem = {
        name: 'calc.add',
        description: '두 수를 더합니다',
        parameters: { type: 'object' },
        tool: mockToolResource,
        export: mockToolResource.spec.exports[0],
        source: { type: 'config', name: 'calcToolkit' },
      };

      catalog.add(item);

      expect(catalog.get('calc.add')).toBeDefined();
    });

    it('같은 이름으로 재추가하면 덮어쓴다', () => {
      const item1: ToolCatalogItem = {
        name: 'calc.add',
        description: '버전 1',
        source: { type: 'config', name: 'v1' },
      };

      const item2: ToolCatalogItem = {
        name: 'calc.add',
        description: '버전 2',
        source: { type: 'config', name: 'v2' },
      };

      catalog.add(item1);
      catalog.add(item2);

      expect(catalog.get('calc.add')?.description).toBe('버전 2');
    });
  });

  describe('addFromToolResource()', () => {
    it('Tool 리소스에서 모든 export를 추가한다', () => {
      catalog.addFromToolResource(mockToolResource);

      expect(catalog.list()).toHaveLength(2);
      expect(catalog.get('calc.add')).toBeDefined();
      expect(catalog.get('calc.multiply')).toBeDefined();
    });

    it('source.type은 config로 설정된다', () => {
      catalog.addFromToolResource(mockToolResource);

      const item = catalog.get('calc.add');
      expect(item?.source?.type).toBe('config');
      expect(item?.source?.name).toBe('calcToolkit');
    });

    it('tool과 export 참조가 포함된다', () => {
      catalog.addFromToolResource(mockToolResource);

      const item = catalog.get('calc.add');
      expect(item?.tool).toBe(mockToolResource);
      expect(item?.export?.name).toBe('calc.add');
    });
  });

  describe('remove()', () => {
    it('항목을 제거할 수 있다', () => {
      const item: ToolCatalogItem = {
        name: 'calc.add',
        description: '두 수를 더합니다',
      };

      catalog.add(item);
      expect(catalog.get('calc.add')).toBeDefined();

      catalog.remove('calc.add');
      expect(catalog.get('calc.add')).toBeUndefined();
    });
  });

  describe('get()', () => {
    it('존재하는 항목을 조회한다', () => {
      const item: ToolCatalogItem = {
        name: 'calc.add',
        description: '두 수를 더합니다',
      };

      catalog.add(item);

      const result = catalog.get('calc.add');
      expect(result?.name).toBe('calc.add');
    });

    it('존재하지 않는 항목은 undefined를 반환한다', () => {
      expect(catalog.get('non.existent')).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('모든 항목 목록을 반환한다', () => {
      catalog.add({ name: 'tool1' });
      catalog.add({ name: 'tool2' });
      catalog.add({ name: 'tool3' });

      expect(catalog.list()).toHaveLength(3);
    });

    it('빈 카탈로그는 빈 배열을 반환한다', () => {
      expect(catalog.list()).toEqual([]);
    });
  });

  describe('has()', () => {
    it('존재하는 항목에 대해 true를 반환한다', () => {
      catalog.add({ name: 'calc.add' });
      expect(catalog.has('calc.add')).toBe(true);
    });

    it('존재하지 않는 항목에 대해 false를 반환한다', () => {
      expect(catalog.has('non.existent')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('모든 항목을 제거한다', () => {
      catalog.add({ name: 'tool1' });
      catalog.add({ name: 'tool2' });

      catalog.clear();

      expect(catalog.list()).toHaveLength(0);
    });
  });

  describe('toLlmTools()', () => {
    it('LLM에 전달할 형식으로 변환한다', () => {
      catalog.add({
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
      });

      const llmTools = catalog.toLlmTools();

      expect(llmTools).toHaveLength(1);
      expect(llmTools[0]).toEqual({
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
      });
    });

    it('description이 없으면 빈 문자열로 설정한다', () => {
      catalog.add({ name: 'simple.tool' });

      const llmTools = catalog.toLlmTools();

      expect(llmTools[0].description).toBe('');
    });

    it('parameters가 없으면 빈 object 스키마로 설정한다', () => {
      catalog.add({ name: 'simple.tool' });

      const llmTools = catalog.toLlmTools();

      expect(llmTools[0].parameters).toEqual({ type: 'object', properties: {} });
    });
  });

  describe('clone()', () => {
    it('카탈로그의 복사본을 생성한다', () => {
      catalog.add({ name: 'tool1', description: 'desc1' });
      catalog.add({ name: 'tool2', description: 'desc2' });

      const cloned = catalog.clone();

      expect(cloned.list()).toHaveLength(2);
      expect(cloned.get('tool1')?.description).toBe('desc1');
    });

    it('복사본 수정이 원본에 영향을 주지 않는다', () => {
      catalog.add({ name: 'tool1', description: 'original' });

      const cloned = catalog.clone();
      cloned.add({ name: 'tool1', description: 'modified' });

      expect(catalog.get('tool1')?.description).toBe('original');
      expect(cloned.get('tool1')?.description).toBe('modified');
    });
  });
});
