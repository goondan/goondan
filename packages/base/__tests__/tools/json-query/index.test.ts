/**
 * JSON Query Tool 테스트
 *
 * @see /packages/base/src/tools/json-query/AGENTS.md
 */

import { describe, it, expect, vi } from 'vitest';
import { handlers } from '../../../src/tools/json-query/index.js';
import type { ToolContext, JsonValue, JsonObject } from '@goondan/core';

/**
 * json.query 결과 타입 가드
 */
interface QueryResult {
  result: JsonValue;
  path: string;
  success: boolean;
}

function isQueryResult(value: JsonValue): value is QueryResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    'result' in value &&
    typeof value['path'] === 'string' &&
    typeof value['success'] === 'boolean'
  );
}

/**
 * json.transform 결과 타입 가드
 */
interface TransformResult {
  result: JsonValue;
  operation: string;
  success: boolean;
}

function isTransformResult(value: JsonValue): value is TransformResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    'result' in value &&
    typeof value['operation'] === 'string' &&
    typeof value['success'] === 'boolean'
  );
}

/**
 * Mock ToolContext
 */
function createMockContext(): ToolContext {
  return {
    instance: { id: 'test-instance', swarmName: 'test-swarm', status: 'running' },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { agents: [], entrypoint: '' },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: { id: 'test-turn', messages: [], toolResults: [] },
    step: { id: 'test-step', index: 0 },
    toolCatalog: [],
    swarmBundle: {
      openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test' }),
      commitChangeset: vi.fn().mockResolvedValue({ success: true }),
    },
    oauth: {
      getAccessToken: vi.fn().mockResolvedValue({ status: 'error', error: { code: 'not_configured', message: 'Not configured' } }),
    },
    events: {},
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      assert: vi.fn(),
      clear: vi.fn(),
      count: vi.fn(),
      countReset: vi.fn(),
      dir: vi.fn(),
      dirxml: vi.fn(),
      group: vi.fn(),
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      table: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(),
      timeLog: vi.fn(),
      trace: vi.fn(),
      profile: vi.fn(),
      profileEnd: vi.fn(),
      timeStamp: vi.fn(),
      Console: vi.fn(),
    },
  };
}

describe('json-query Tool', () => {
  describe('json.query handler', () => {
    const handler = handlers['json.query'];

    it('핸들러가 정의되어 있어야 한다', () => {
      expect(handler).toBeDefined();
    });

    // =====================================================
    // 입력 유효성 검사
    // =====================================================

    it('data가 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { path: '$.name' })).rejects.toThrow('data는 JSON 문자열이어야 합니다.');
    });

    it('data가 문자열이 아니면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { data: 123, path: '$.name' })).rejects.toThrow('data는 JSON 문자열이어야 합니다.');
    });

    it('path가 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { data: '{}' })).rejects.toThrow('path는 문자열이어야 합니다.');
    });

    it('path가 문자열이 아니면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { data: '{}', path: 123 })).rejects.toThrow('path는 문자열이어야 합니다.');
    });

    it('유효하지 않은 JSON이면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { data: 'not json', path: '$' })).rejects.toThrow('유효하지 않은 JSON');
    });

    it('$로 시작하지 않는 경로는 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"name":"test"}', path: 'name' })
      ).rejects.toThrow('JSONPath는 $로 시작해야 합니다.');
    });

    // =====================================================
    // 기본 쿼리
    // =====================================================

    it('루트 객체를 반환해야 한다 ($)', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"name":"test","value":42}',
        path: '$',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.success).toBe(true);
        const obj = result.result;
        if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
          expect(obj['name']).toBe('test');
          expect(obj['value']).toBe(42);
        }
      }
    });

    it('필드 접근 ($.name)', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"name":"hello"}',
        path: '$.name',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBe('hello');
      }
    });

    it('중첩 필드 접근 ($.parent.child)', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"parent":{"child":"deep"}}',
        path: '$.parent.child',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBe('deep');
      }
    });

    it('깊은 중첩 접근 ($.a.b.c.d)', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":{"b":{"c":{"d":"deepest"}}}}',
        path: '$.a.b.c.d',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBe('deepest');
      }
    });

    it('존재하지 않는 필드는 null을 반환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"name":"test"}',
        path: '$.nonExistent',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBeNull();
      }
    });

    it('중간 경로가 null이면 null을 반환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"parent":null}',
        path: '$.parent.child',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBeNull();
      }
    });

    // =====================================================
    // 배열 쿼리
    // =====================================================

    it('배열 인덱스 접근 ($.items[0])', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"items":["a","b","c"]}',
        path: '$.items[0]',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBe('a');
      }
    });

    it('범위 밖 배열 인덱스는 null을 반환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"items":["a","b"]}',
        path: '$.items[99]',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBeNull();
      }
    });

    it('배열 전체 요소 ($.items[*])', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"items":[1,2,3]}',
        path: '$.items[*]',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(Array.isArray(result.result)).toBe(true);
        expect(result.result).toEqual([1, 2, 3]);
      }
    });

    it('배열 요소의 특정 필드 ($.items[*].name)', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"items":[{"name":"a"},{"name":"b"},{"name":"c"}]}',
        path: '$.items[*].name',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toEqual(['a', 'b', 'c']);
      }
    });

    it('[*]를 비배열에 사용하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"items":"not-array"}', path: '$.items[*]' })
      ).rejects.toThrow('배열에만 사용할 수 있습니다');
    });

    it('배열 인덱스를 비배열에 사용하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"items":"string"}', path: '$.items[0]' })
      ).rejects.toThrow('배열에만 사용할 수 있습니다');
    });

    // =====================================================
    // 비객체 필드 접근
    // =====================================================

    it('숫자에서 필드 접근하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"value":42}', path: '$.value.field' })
      ).rejects.toThrow('객체가 아닙니다');
    });

    it('문자열에서 필드 접근하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"value":"text"}', path: '$.value.field' })
      ).rejects.toThrow('객체가 아닙니다');
    });

    // =====================================================
    // 특수 JSON 값
    // =====================================================

    it('null 값을 쿼리해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"value":null}',
        path: '$.value',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBeNull();
      }
    });

    it('boolean 값을 쿼리해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"active":true}',
        path: '$.active',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBe(true);
      }
    });

    it('숫자 값을 쿼리해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"count":0}',
        path: '$.count',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toBe(0);
      }
    });

    it('빈 객체를 쿼리해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{}',
        path: '$',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toEqual({});
      }
    });

    it('빈 배열을 쿼리해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"items":[]}',
        path: '$.items',
      });

      expect(isQueryResult(result)).toBe(true);
      if (isQueryResult(result)) {
        expect(result.result).toEqual([]);
      }
    });

    // =====================================================
    // 토큰 파싱 에러
    // =====================================================

    it('닫히지 않은 대괄호는 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"items":[1]}', path: '$.items[0' })
      ).rejects.toThrow('닫히지 않은 대괄호');
    });
  });

  describe('json.transform handler', () => {
    const handler = handlers['json.transform'];

    it('핸들러가 정의되어 있어야 한다', () => {
      expect(handler).toBeDefined();
    });

    // =====================================================
    // 입력 유효성 검사
    // =====================================================

    it('data가 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { operation: 'keys' })).rejects.toThrow('data는 JSON 문자열이어야 합니다.');
    });

    it('operation이 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { data: '{}' })).rejects.toThrow('operation은');
    });

    it('유효하지 않은 operation은 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{}', operation: 'invalid' })
      ).rejects.toThrow('operation은');
    });

    // =====================================================
    // pick 변환
    // =====================================================

    it('pick: 지정된 필드만 선택해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":2,"c":3}',
        operation: 'pick',
        fields: ['a', 'c'],
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual({ a: 1, c: 3 });
      }
    });

    it('pick: 존재하지 않는 필드는 무시해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1}',
        operation: 'pick',
        fields: ['a', 'nonexistent'],
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual({ a: 1 });
      }
    });

    it('pick: fields가 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"a":1}', operation: 'pick' })
      ).rejects.toThrow('fields가 필요합니다');
    });

    it('pick: 비객체에 사용하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '[1,2,3]', operation: 'pick', fields: ['a'] })
      ).rejects.toThrow('객체에만 사용할 수 있습니다');
    });

    // =====================================================
    // omit 변환
    // =====================================================

    it('omit: 지정된 필드를 제외해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":2,"c":3}',
        operation: 'omit',
        fields: ['b'],
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual({ a: 1, c: 3 });
      }
    });

    it('omit: 존재하지 않는 필드를 제외해도 에러가 없어야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1}',
        operation: 'omit',
        fields: ['nonexistent'],
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual({ a: 1 });
      }
    });

    it('omit: fields가 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"a":1}', operation: 'omit' })
      ).rejects.toThrow('fields가 필요합니다');
    });

    // =====================================================
    // flatten 변환
    // =====================================================

    it('flatten: 중첩 배열을 평탄화해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '[[1,2],[3,4],[5]]',
        operation: 'flatten',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual([1, 2, 3, 4, 5]);
      }
    });

    it('flatten: 비배열 요소는 그대로 유지해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '[1,[2,3],4]',
        operation: 'flatten',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual([1, 2, 3, 4]);
      }
    });

    it('flatten: 비배열 데이터에 사용하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"a":1}', operation: 'flatten' })
      ).rejects.toThrow('배열에만 사용할 수 있습니다');
    });

    it('flatten: 빈 배열을 처리해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '[]',
        operation: 'flatten',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual([]);
      }
    });

    // =====================================================
    // keys 변환
    // =====================================================

    it('keys: 객체의 키들을 반환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":2,"c":3}',
        operation: 'keys',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual(['a', 'b', 'c']);
      }
    });

    it('keys: 빈 객체는 빈 배열을 반환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{}',
        operation: 'keys',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual([]);
      }
    });

    it('keys: 비객체에 사용하면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '"string"', operation: 'keys' })
      ).rejects.toThrow('객체에만 사용할 수 있습니다');
    });

    // =====================================================
    // values 변환
    // =====================================================

    it('values: 객체의 값들을 반환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":"two","c":true}',
        operation: 'values',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual([1, 'two', true]);
      }
    });

    // =====================================================
    // entries 변환
    // =====================================================

    it('entries: 객체를 [key, value] 쌍 배열로 변환해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":2}',
        operation: 'entries',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual([['a', 1], ['b', 2]]);
      }
    });

    // =====================================================
    // merge 변환
    // =====================================================

    it('merge: 두 객체를 병합해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":2}',
        operation: 'merge',
        mergeData: '{"c":3,"d":4}',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        expect(result.result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
      }
    });

    it('merge: 겹치는 키는 mergeData가 우선해야 한다', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"a":1,"b":2}',
        operation: 'merge',
        mergeData: '{"b":99,"c":3}',
      });

      expect(isTransformResult(result)).toBe(true);
      if (isTransformResult(result)) {
        const resultObj = result.result;
        if (typeof resultObj === 'object' && resultObj !== null && !Array.isArray(resultObj)) {
          expect(resultObj['b']).toBe(99);
        }
      }
    });

    it('merge: mergeData가 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"a":1}', operation: 'merge' })
      ).rejects.toThrow('mergeData는 객체여야 합니다');
    });

    it('merge: mergeData가 배열이면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"a":1}', operation: 'merge', mergeData: '[1,2]' })
      ).rejects.toThrow('mergeData는 객체여야 합니다');
    });
  });
});
