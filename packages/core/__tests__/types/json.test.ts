/**
 * JSON 기본 타입 테스트
 * @see /docs/specs/resources.md - 7. 공통 타입 정의
 */
import { describe, it, expect } from 'vitest';
import type { JsonPrimitive, JsonValue, JsonObject, JsonArray } from '../../src/types/json.js';

describe('JSON 기본 타입', () => {
  describe('JsonPrimitive', () => {
    it('string 타입을 허용해야 한다', () => {
      const value: JsonPrimitive = 'hello';
      expect(typeof value).toBe('string');
    });

    it('number 타입을 허용해야 한다', () => {
      const value: JsonPrimitive = 42;
      expect(typeof value).toBe('number');
    });

    it('boolean 타입을 허용해야 한다', () => {
      const value: JsonPrimitive = true;
      expect(typeof value).toBe('boolean');
    });

    it('null 타입을 허용해야 한다', () => {
      const value: JsonPrimitive = null;
      expect(value).toBeNull();
    });
  });

  describe('JsonValue', () => {
    it('JsonPrimitive 값을 허용해야 한다', () => {
      const str: JsonValue = 'hello';
      const num: JsonValue = 42;
      const bool: JsonValue = true;
      const nil: JsonValue = null;

      expect(str).toBe('hello');
      expect(num).toBe(42);
      expect(bool).toBe(true);
      expect(nil).toBeNull();
    });

    it('JsonObject 값을 허용해야 한다', () => {
      const obj: JsonValue = { key: 'value', nested: { a: 1 } };
      expect(obj).toEqual({ key: 'value', nested: { a: 1 } });
    });

    it('JsonArray 값을 허용해야 한다', () => {
      const arr: JsonValue = [1, 'two', true, null, { nested: true }];
      expect(arr).toEqual([1, 'two', true, null, { nested: true }]);
    });
  });

  describe('JsonObject', () => {
    it('string 키와 JsonValue 값을 가진 객체를 허용해야 한다', () => {
      const obj: JsonObject = {
        string: 'hello',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { deep: 'value' },
      };

      expect(obj.string).toBe('hello');
      expect(obj.number).toBe(42);
      expect(obj.boolean).toBe(true);
      expect(obj.null).toBeNull();
      expect(obj.array).toEqual([1, 2, 3]);
      expect(obj.nested).toEqual({ deep: 'value' });
    });

    it('빈 객체를 허용해야 한다', () => {
      const obj: JsonObject = {};
      expect(obj).toEqual({});
    });
  });

  describe('JsonArray', () => {
    it('JsonValue 요소들의 배열을 허용해야 한다', () => {
      const arr: JsonArray = ['string', 42, true, null, { obj: true }, [1, 2]];
      expect(arr.length).toBe(6);
    });

    it('빈 배열을 허용해야 한다', () => {
      const arr: JsonArray = [];
      expect(arr).toEqual([]);
    });

    it('중첩된 배열을 허용해야 한다', () => {
      const arr: JsonArray = [[1, 2], [3, [4, 5]]];
      expect(arr).toEqual([[1, 2], [3, [4, 5]]]);
    });
  });
});
