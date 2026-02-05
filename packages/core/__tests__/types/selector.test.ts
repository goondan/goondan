/**
 * Selector 타입 테스트
 * @see /docs/specs/resources.md - 4. Selector + Overrides 조립 문법
 */
import { describe, it, expect } from 'vitest';
import type {
  Selector,
  SelectorWithOverrides,
  RefOrSelector,
} from '../../src/types/selector.js';
import { isSelectorWithOverrides, deepMerge } from '../../src/types/utils.js';

describe('Selector 타입', () => {
  describe('Selector 인터페이스', () => {
    it('모든 필드가 선택이다', () => {
      const selector: Selector = {};
      expect(selector).toEqual({});
    });

    it('kind로 리소스 종류를 선택할 수 있다', () => {
      const selector: Selector = { kind: 'Tool' };
      expect(selector.kind).toBe('Tool');
    });

    it('name으로 특정 리소스를 선택할 수 있다', () => {
      const selector: Selector = { kind: 'Tool', name: 'fileRead' };
      expect(selector.name).toBe('fileRead');
    });

    it('matchLabels로 라벨 기반 선택을 할 수 있다', () => {
      const selector: Selector = {
        kind: 'Tool',
        matchLabels: {
          tier: 'base',
          env: 'production',
        },
      };
      expect(selector.matchLabels).toEqual({
        tier: 'base',
        env: 'production',
      });
    });
  });

  describe('SelectorWithOverrides 인터페이스', () => {
    it('selector 필드는 필수이다', () => {
      const swo: SelectorWithOverrides = {
        selector: { kind: 'Tool' },
      };
      expect(swo.selector).toEqual({ kind: 'Tool' });
    });

    it('overrides.spec으로 spec을 덮어쓸 수 있다', () => {
      const swo: SelectorWithOverrides = {
        selector: { kind: 'Tool', matchLabels: { tier: 'base' } },
        overrides: {
          spec: { errorMessageLimit: 2000 },
        },
      };
      expect(swo.overrides?.spec).toEqual({ errorMessageLimit: 2000 });
    });

    it('overrides.metadata로 metadata를 덮어쓸 수 있다', () => {
      const swo: SelectorWithOverrides = {
        selector: { kind: 'Extension' },
        overrides: {
          metadata: { labels: { override: 'true' } },
        },
      };
      expect(swo.overrides?.metadata?.labels).toEqual({ override: 'true' });
    });
  });

  describe('RefOrSelector 유니온 타입', () => {
    it('문자열 ObjectRefLike를 허용해야 한다', () => {
      const ref: RefOrSelector = 'Tool/fileRead';
      expect(typeof ref).toBe('string');
    });

    it('ObjectRef를 허용해야 한다', () => {
      const ref: RefOrSelector = { kind: 'Tool', name: 'fileRead' };
      expect(ref).toEqual({ kind: 'Tool', name: 'fileRead' });
    });

    it('SelectorWithOverrides를 허용해야 한다', () => {
      const ref: RefOrSelector = {
        selector: { kind: 'Tool', matchLabels: { tier: 'base' } },
        overrides: { spec: { errorMessageLimit: 2000 } },
      };
      expect('selector' in ref).toBe(true);
    });
  });

  describe('isSelectorWithOverrides 타입 가드', () => {
    it('selector 필드가 있으면 true를 반환해야 한다', () => {
      const swo = {
        selector: { kind: 'Tool' },
      };
      expect(isSelectorWithOverrides(swo)).toBe(true);
    });

    it('selector 필드가 없으면 false를 반환해야 한다', () => {
      const ref = { kind: 'Tool', name: 'fileRead' };
      expect(isSelectorWithOverrides(ref)).toBe(false);
    });

    it('문자열에 대해 false를 반환해야 한다', () => {
      expect(isSelectorWithOverrides('Tool/fileRead')).toBe(false);
    });

    it('null에 대해 false를 반환해야 한다', () => {
      expect(isSelectorWithOverrides(null)).toBe(false);
    });
  });

  describe('deepMerge', () => {
    it('스칼라 값은 덮어써야 한다', () => {
      const base = { a: 1, b: 'hello' };
      const override = { a: 2 };

      const result = deepMerge(base, override);

      expect(result).toEqual({ a: 2, b: 'hello' });
    });

    it('중첩된 객체는 재귀적으로 병합해야 한다', () => {
      const base = {
        nested: { a: 1, b: 2 },
        other: 'value',
      };
      const override = {
        nested: { b: 3, c: 4 },
      };

      const result = deepMerge(base, override);

      expect(result).toEqual({
        nested: { a: 1, b: 3, c: 4 },
        other: 'value',
      });
    });

    it('배열은 전체 교체해야 한다 (요소 병합 아님)', () => {
      const base = {
        arr: [1, 2, 3],
        other: 'value',
      };
      const override = {
        arr: [4, 5],
      };

      const result = deepMerge(base, override);

      expect(result).toEqual({
        arr: [4, 5],
        other: 'value',
      });
    });

    it('undefined 값은 무시해야 한다', () => {
      const base = { a: 1, b: 2 };
      const override = { a: undefined, b: 3 };

      const result = deepMerge(base, override);

      expect(result).toEqual({ a: 1, b: 3 });
    });

    it('null 값은 덮어써야 한다', () => {
      const base = { a: 1, b: 2 };
      const override = { a: null };

      const result = deepMerge(base, override);

      expect(result).toEqual({ a: null, b: 2 });
    });

    it('깊이 중첩된 객체도 병합해야 한다', () => {
      const base = {
        level1: {
          level2: {
            level3: { a: 1, b: 2 },
          },
        },
      };
      const override = {
        level1: {
          level2: {
            level3: { b: 3, c: 4 },
          },
        },
      };

      const result = deepMerge(base, override);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: { a: 1, b: 3, c: 4 },
          },
        },
      });
    });

    it('원본 객체를 변경하지 않아야 한다', () => {
      const base = { a: 1, nested: { b: 2 } };
      const override = { a: 2, nested: { c: 3 } };

      const result = deepMerge(base, override);

      expect(base).toEqual({ a: 1, nested: { b: 2 } });
      expect(result).not.toBe(base);
    });

    it('빈 객체 override는 원본을 그대로 반환해야 한다', () => {
      const base = { a: 1, b: 2 };
      const override = {};

      const result = deepMerge(base, override);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('객체가 아닌 값 위에 객체를 덮어쓸 수 있어야 한다', () => {
      const base = { a: 1 };
      const override = { a: { nested: true } };

      const result = deepMerge(base, override);

      expect(result).toEqual({ a: { nested: true } });
    });

    it('객체 위에 객체가 아닌 값을 덮어쓸 수 있어야 한다', () => {
      const base = { a: { nested: true } };
      const override = { a: 1 };

      const result = deepMerge(base, override);

      expect(result).toEqual({ a: 1 });
    });
  });
});
