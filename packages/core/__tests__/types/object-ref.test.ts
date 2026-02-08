/**
 * ObjectRef 타입 테스트
 * @see /docs/specs/resources.md - 3. ObjectRef 참조 문법
 */
import { describe, it, expect } from 'vitest';
import type { ObjectRef, ObjectRefLike } from '../../src/types/object-ref.js';
import { normalizeObjectRef, isObjectRef } from '../../src/types/utils.js';

describe('ObjectRef 타입', () => {
  describe('ObjectRef 인터페이스', () => {
    it('kind와 name은 필수이다', () => {
      const ref: ObjectRef = {
        kind: 'Tool',
        name: 'fileRead',
      };

      expect(ref.kind).toBe('Tool');
      expect(ref.name).toBe('fileRead');
    });

    it('apiVersion은 선택이다', () => {
      const ref: ObjectRef = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        name: 'fileRead',
      };

      expect(ref.apiVersion).toBe('agents.example.io/v1alpha1');
    });

    it('package는 선택이다 (Bundle Package 간 참조)', () => {
      const ref: ObjectRef = {
        kind: 'Tool',
        name: 'fileRead',
        package: 'core-tools',
      };

      expect(ref.package).toBe('core-tools');
    });
  });

  describe('ObjectRefLike 유니온 타입', () => {
    it('문자열 축약 형식을 허용해야 한다', () => {
      const ref: ObjectRefLike = 'Tool/fileRead';
      expect(typeof ref).toBe('string');
    });

    it('객체형 참조를 허용해야 한다', () => {
      const ref: ObjectRefLike = { kind: 'Tool', name: 'fileRead' };
      expect(typeof ref).toBe('object');
    });
  });

  describe('normalizeObjectRef', () => {
    it('문자열 "Kind/name" 형식을 ObjectRef로 변환해야 한다', () => {
      const result = normalizeObjectRef('Tool/fileRead');

      expect(result).toEqual({
        kind: 'Tool',
        name: 'fileRead',
      });
    });

    it('문자열에 apiVersion이 포함되지 않아야 한다', () => {
      const result = normalizeObjectRef('Model/openai-gpt-5');

      expect(result.apiVersion).toBeUndefined();
      expect(result.kind).toBe('Model');
      expect(result.name).toBe('openai-gpt-5');
    });

    it('ObjectRef 객체는 그대로 반환해야 한다', () => {
      const input: ObjectRef = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        name: 'fileRead',
      };

      const result = normalizeObjectRef(input);

      expect(result).toEqual(input);
    });

    it('슬래시가 없는 문자열에 대해 오류를 던져야 한다', () => {
      expect(() => normalizeObjectRef('invalid')).toThrow(
        'Invalid ObjectRef string: invalid'
      );
    });

    it('빈 kind에 대해 오류를 던져야 한다', () => {
      expect(() => normalizeObjectRef('/name')).toThrow(
        'Invalid ObjectRef string: /name'
      );
    });

    it('빈 name에 대해 오류를 던져야 한다', () => {
      expect(() => normalizeObjectRef('Kind/')).toThrow(
        'Invalid ObjectRef string: Kind/'
      );
    });

    it('name에 슬래시가 포함된 경우를 처리해야 한다', () => {
      // 첫 번째 슬래시만 분리하므로 "Kind/path/to/name"은
      // kind: "Kind", name: "path/to/name"이 되어야 한다
      const result = normalizeObjectRef('Kind/path/to/name');

      expect(result.kind).toBe('Kind');
      expect(result.name).toBe('path/to/name');
    });
  });

  describe('isObjectRef 타입 가드', () => {
    it('유효한 ObjectRef에 대해 true를 반환해야 한다', () => {
      const ref = { kind: 'Tool', name: 'fileRead' };
      expect(isObjectRef(ref)).toBe(true);
    });

    it('apiVersion이 포함된 ObjectRef에 대해 true를 반환해야 한다', () => {
      const ref = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        name: 'fileRead',
      };
      expect(isObjectRef(ref)).toBe(true);
    });

    it('kind가 없으면 false를 반환해야 한다', () => {
      const invalid = { name: 'fileRead' };
      expect(isObjectRef(invalid)).toBe(false);
    });

    it('name이 없으면 false를 반환해야 한다', () => {
      const invalid = { kind: 'Tool' };
      expect(isObjectRef(invalid)).toBe(false);
    });

    it('null에 대해 false를 반환해야 한다', () => {
      expect(isObjectRef(null)).toBe(false);
    });

    it('undefined에 대해 false를 반환해야 한다', () => {
      expect(isObjectRef(undefined)).toBe(false);
    });

    it('문자열에 대해 false를 반환해야 한다', () => {
      expect(isObjectRef('Tool/fileRead')).toBe(false);
    });

    it('배열에 대해 false를 반환해야 한다', () => {
      expect(isObjectRef(['Tool', 'fileRead'])).toBe(false);
    });
  });
});
