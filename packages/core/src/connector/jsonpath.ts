/**
 * JSONPath 표현식 해석
 * @see /docs/specs/connector.md - 4.3 JSONPath 해석 규칙
 */

import { JSONPath } from 'jsonpath-plus';
import type { JsonObject, JsonValue } from '../types/index.js';

/**
 * JSONPath 표현식을 해석하여 값을 추출한다.
 *
 * @param payload - 검색 대상 JSON 객체
 * @param expr - JSONPath 표현식 (예: "$.event.text")
 * @returns 추출된 값 또는 undefined
 *
 * @example
 * ```ts
 * const payload = { event: { text: 'hello' } };
 * readJsonPath(payload, '$.event.text'); // => 'hello'
 * ```
 */
export function readJsonPath(payload: JsonObject, expr: string): JsonValue | undefined {
  // 빈 표현식
  if (!expr) {
    return undefined;
  }

  // $ 로 시작하지 않으면 유효하지 않음
  if (!expr.startsWith('$')) {
    return undefined;
  }

  // $ 만 있으면 전체 객체 반환
  if (expr === '$') {
    return payload;
  }

  // $. 로 시작해야 유효한 경로
  if (!expr.startsWith('$.')) {
    return undefined;
  }

  try {
    // wrap: true로 항상 배열을 받아 처리
    const results = JSONPath({
      path: expr,
      json: payload,
      wrap: true,
    });

    // 결과가 없으면 undefined
    if (!Array.isArray(results) || results.length === 0) {
      return undefined;
    }

    // 단일 결과인 경우
    if (results.length === 1) {
      return results[0] as JsonValue;
    }

    // 복수 결과인 경우 배열 반환
    return results as JsonValue;
  } catch {
    // 파싱 오류 시 undefined 반환
    return undefined;
  }
}

/**
 * JSONPath 표현식의 유효성을 검사한다.
 *
 * @param expr - 검사할 표현식
 * @returns 유효 여부
 */
export function isValidJsonPath(expr: unknown): expr is string {
  if (typeof expr !== 'string') {
    return false;
  }

  if (!expr) {
    return false;
  }

  // $ 로 시작해야 함
  if (!expr.startsWith('$')) {
    return false;
  }

  return true;
}

/**
 * 간단한 dot notation 경로를 해석한다.
 * jsonpath-plus 없이 사용할 수 있는 경량 버전.
 *
 * @param payload - 검색 대상 JSON 객체
 * @param expr - JSONPath 표현식 (예: "$.event.text")
 * @returns 추출된 값 또는 undefined
 *
 * @example
 * ```ts
 * const payload = { event: { text: 'hello' } };
 * readSimplePath(payload, '$.event.text'); // => 'hello'
 * ```
 */
export function readSimplePath(payload: JsonObject, expr: string): unknown {
  if (!expr || !expr.startsWith('$.')) {
    return undefined;
  }

  // $만 있으면 전체 반환
  if (expr === '$') {
    return payload;
  }

  // $. 제거 후 경로 분리
  const path = expr.slice(2);
  if (!path) {
    return payload;
  }

  // 배열 인덱스와 dot notation 처리
  // "event.users[0].name" -> ["event", "users", "0", "name"]
  const segments = path.split(/\.|\[|\]/).filter(Boolean);

  let current: unknown = payload;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    // 배열 인덱스인 경우
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index)) {
        return undefined;
      }
      current = current[index];
    } else {
      // 객체 키인 경우
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}
