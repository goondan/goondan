/**
 * 유틸리티 함수 정의
 * @see /docs/specs/resources.md - 7. 공통 타입 정의
 */

import type { Resource, KnownKind } from './resource.js';
import type { ObjectRef, ObjectRefLike } from './object-ref.js';
import type { RefOrSelector, SelectorWithOverrides } from './selector.js';
import type { ValueSource } from './value-source.js';

/**
 * ValueSource 해석 컨텍스트
 */
export interface ValueSourceContext {
  /** 환경 변수 */
  env: Record<string, string | undefined>;
  /** Secret 저장소 (secretName -> key -> value) */
  secrets: Record<string, Record<string, string>>;
}

/**
 * 리소스 타입 가드
 * @param value 확인할 값
 * @returns Resource 타입 여부
 */
export function isResource(value: unknown): value is Resource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'apiVersion' in value &&
    'kind' in value &&
    'metadata' in value &&
    'spec' in value
  );
}

/**
 * Kind별 리소스 타입 가드
 * @param value 확인할 값
 * @param kind 확인할 Kind
 * @returns 지정된 Kind의 Resource 여부
 */
export function isResourceOfKind<K extends KnownKind>(
  value: unknown,
  kind: K
): value is Resource {
  return isResource(value) && value.kind === kind;
}

/**
 * ObjectRef 판별
 * @param value 확인할 값
 * @returns ObjectRef 타입 여부
 */
export function isObjectRef(value: unknown): value is ObjectRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    'name' in value
  );
}

/**
 * Selector 판별
 * @param value 확인할 값
 * @returns SelectorWithOverrides 타입 여부
 */
export function isSelectorWithOverrides(
  value: unknown
): value is SelectorWithOverrides {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selector' in value
  );
}

/**
 * ObjectRefLike 판별 (문자열 "Kind/name" 또는 ObjectRef)
 * @param value 확인할 값
 * @returns ObjectRefLike 타입 여부
 */
export function isObjectRefLike(value: unknown): value is ObjectRefLike {
  if (typeof value === 'string') {
    const slashIndex = value.indexOf('/');
    return slashIndex > 0 && slashIndex < value.length - 1;
  }
  return isObjectRef(value);
}

/**
 * RefOrSelector 판별 (ObjectRefLike 또는 SelectorWithOverrides)
 * @param value 확인할 값
 * @returns RefOrSelector 타입 여부
 */
export function isRefOrSelector(value: unknown): value is RefOrSelector {
  return isObjectRefLike(value) || isSelectorWithOverrides(value);
}

/**
 * Resource의 spec을 Record<string, unknown>으로 안전하게 추출
 *
 * Resource<unknown>의 spec은 unknown이므로, 검증/해석 함수에서
 * 프로퍼티에 접근하기 위해 이 헬퍼를 사용합니다.
 *
 * @param resource Resource (spec: unknown)
 * @returns Record<string, unknown>으로의 spec 참조
 */
export function getSpec(resource: Resource): Record<string, unknown> {
  const spec = resource.spec;
  if (typeof spec === 'object' && spec !== null && !Array.isArray(spec)) {
    return spec as Record<string, unknown>;
  }
  return {};
}

/**
 * ObjectRef를 정규화하는 함수
 *
 * @param ref ObjectRefLike (문자열 또는 ObjectRef)
 * @returns 정규화된 ObjectRef
 * @throws 잘못된 문자열 형식인 경우
 *
 * @example
 * normalizeObjectRef('Tool/fileRead') // => { kind: 'Tool', name: 'fileRead' }
 * normalizeObjectRef({ kind: 'Tool', name: 'fileRead' }) // => { kind: 'Tool', name: 'fileRead' }
 */
export function normalizeObjectRef(ref: ObjectRefLike): ObjectRef {
  if (typeof ref === 'string') {
    // "Kind/name" 형식 파싱 (첫 번째 슬래시만 분리)
    const slashIndex = ref.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(`Invalid ObjectRef string: ${ref}`);
    }

    const kind = ref.substring(0, slashIndex);
    const name = ref.substring(slashIndex + 1);

    if (!kind || !name) {
      throw new Error(`Invalid ObjectRef string: ${ref}`);
    }

    return { kind, name };
  }

  return ref;
}

/**
 * 깊은 병합 함수
 *
 * 병합 규칙:
 * - 객체: 재귀적으로 병합
 * - 스칼라: 덮어쓰기
 * - 배열: 전체 교체 (요소 병합 아님)
 * - undefined: 무시
 *
 * @param base 기본 객체
 * @param override 덮어쓸 값
 * @returns 병합된 새 객체
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result = { ...base };

  for (const key in override) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) {
      continue;
    }

    const baseVal = base[key];
    const overrideVal = override[key];

    // undefined는 무시
    if (overrideVal === undefined) {
      continue;
    }

    // 둘 다 객체이고 배열이 아닌 경우 재귀 병합
    if (
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      // 제네릭 T에 동적 키 할당을 위한 구조적 한계 (TypeScript generic limitation)
      const baseRecord: Record<string, unknown> = Object.fromEntries(Object.entries(baseVal));
      const overrideRecord: Record<string, unknown> = Object.fromEntries(Object.entries(overrideVal));
      const merged = deepMerge(baseRecord, overrideRecord);
      Object.defineProperty(result, key, {
        value: merged,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      // 스칼라 또는 배열: 덮어쓰기
      Object.defineProperty(result, key, {
        value: overrideVal,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }

  return result;
}

/**
 * ValueSource 해석 함수
 *
 * @param source ValueSource (직접 값 또는 외부 소스)
 * @param ctx 해석 컨텍스트 (환경 변수, Secret 저장소)
 * @returns 해석된 문자열 값
 * @throws 환경 변수나 Secret을 찾을 수 없는 경우
 *
 * @example
 * // 직접 값
 * resolveValueSource({ value: 'my-value' }, ctx) // => 'my-value'
 *
 * // 환경 변수
 * resolveValueSource({ valueFrom: { env: 'MY_VAR' } }, ctx) // => process.env.MY_VAR
 *
 * // Secret 참조
 * resolveValueSource({
 *   valueFrom: { secretRef: { ref: 'Secret/my-secret', key: 'api_key' } }
 * }, ctx) // => secrets['my-secret']['api_key']
 */
export function resolveValueSource(
  source: ValueSource,
  ctx: ValueSourceContext
): string {
  // 직접 값인 경우
  if ('value' in source && source.value !== undefined) {
    return source.value;
  }

  // 외부 소스인 경우
  if ('valueFrom' in source && source.valueFrom !== undefined) {
    const { valueFrom } = source;

    // 환경 변수에서 읽기
    if ('env' in valueFrom && valueFrom.env !== undefined) {
      const envValue = ctx.env[valueFrom.env];
      if (envValue === undefined) {
        throw new Error(`Environment variable not found: ${valueFrom.env}`);
      }
      return envValue;
    }

    // Secret 참조에서 읽기
    if ('secretRef' in valueFrom && valueFrom.secretRef !== undefined) {
      const { ref, key } = valueFrom.secretRef;

      // "Secret/name" 형식 파싱
      const match = /^Secret\/(.+)$/.exec(ref);
      if (!match || !match[1]) {
        throw new Error(`Invalid secretRef format: ${ref}`);
      }

      const secretName = match[1];
      const secret = ctx.secrets[secretName];
      if (!secret) {
        throw new Error(`Secret not found: ${secretName}`);
      }

      const secretValue = secret[key];
      if (secretValue === undefined) {
        throw new Error(`Secret key not found: ${key} in ${secretName}`);
      }

      return secretValue;
    }
  }

  throw new Error('Invalid ValueSource: neither value nor valueFrom provided');
}
