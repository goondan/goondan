/**
 * JSON Query Tool - JSON 데이터 쿼리/변환
 *
 * 간단한 JSONPath 기반 데이터 추출과 변환 기능을 제공합니다.
 * 외부 라이브러리 없이 기본적인 JSONPath 표현식을 지원합니다.
 *
 * @see /docs/specs/tool.md
 */

import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

/**
 * unknown 값을 재귀적으로 JsonValue로 변환
 * JSON.parse 결과를 타입 단언 없이 JsonValue로 변환하기 위한 타입 가드
 */
function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === 'object' && value !== null) {
    const result: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = toJsonValue(v);
    }
    return result;
  }
  return null;
}

/**
 * JSON 문자열을 안전하게 파싱
 */
function safeJsonParse(text: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(text);
    return toJsonValue(parsed);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`유효하지 않은 JSON: ${e.message}`);
    }
    throw e;
  }
}

/**
 * JsonValue가 JsonObject인지 타입 가드
 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 간단한 JSONPath 쿼리 실행
 *
 * 지원하는 표현식:
 * - $.field - 루트의 field 접근
 * - $.parent.child - 중첩 접근
 * - $.array[0] - 배열 인덱스 접근
 * - $.array[*] - 배열 전체 요소
 * - $.array[*].field - 배열 전체 요소의 특정 필드
 */
function queryJsonPath(data: JsonValue, path: string): JsonValue {
  if (!path.startsWith('$')) {
    throw new Error('JSONPath는 $로 시작해야 합니다.');
  }

  // $ 제거 후 토큰 분리
  const tokens = tokenizePath(path.slice(1));

  let current: JsonValue = data;

  for (const token of tokens) {
    if (current === null || current === undefined) {
      return null;
    }

    if (token === '[*]') {
      // 배열 전체 요소
      if (!Array.isArray(current)) {
        throw new Error(`[*] 연산자는 배열에만 사용할 수 있습니다.`);
      }
      // 나머지 토큰이 있으면 각 요소에 적용
      const remainingTokens = tokens.slice(tokens.indexOf(token) + 1);
      if (remainingTokens.length === 0) {
        return current;
      }
      const remainingPath = '$' + remainingTokens.join('');
      const results: JsonValue[] = [];
      for (const item of current) {
        results.push(queryJsonPath(item, remainingPath));
      }
      return results;
    }

    // 배열 인덱스 접근: [N]
    const indexMatch = /^\[(\d+)]$/.exec(token);
    if (indexMatch !== null) {
      if (!Array.isArray(current)) {
        throw new Error(`배열 인덱스는 배열에만 사용할 수 있습니다.`);
      }
      const index = Number(indexMatch[1]);
      const item: JsonValue | undefined = current[index];
      if (item === undefined) {
        return null;
      }
      current = item;
      continue;
    }

    // 필드 접근: .field
    const fieldMatch = /^\.(.+)$/.exec(token);
    if (fieldMatch !== null) {
      const fieldName = fieldMatch[1] ?? '';
      if (!isJsonObject(current)) {
        throw new Error(`필드 '${fieldName}'에 접근할 수 없습니다. 객체가 아닙니다.`);
      }
      const value: JsonValue | undefined = current[fieldName];
      if (value === undefined) {
        return null;
      }
      current = value;
      continue;
    }

    throw new Error(`지원하지 않는 JSONPath 토큰: ${token}`);
  }

  return current;
}

/**
 * JSONPath를 토큰으로 분리
 */
function tokenizePath(path: string): string[] {
  if (path === '') {
    return [];
  }

  const tokens: string[] = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === '.') {
      // 필드 접근
      let end = i + 1;
      while (end < path.length && path[end] !== '.' && path[end] !== '[') {
        end++;
      }
      tokens.push(path.slice(i, end));
      i = end;
    } else if (path[i] === '[') {
      // 배열 접근
      const end = path.indexOf(']', i);
      if (end === -1) {
        throw new Error('닫히지 않은 대괄호');
      }
      tokens.push(path.slice(i, end + 1));
      i = end + 1;
    } else {
      throw new Error(`예상하지 못한 문자: ${path[i]}`);
    }
  }

  return tokens;
}

/** transform 작업 타입 */
type TransformOperation = 'pick' | 'omit' | 'flatten' | 'keys' | 'values' | 'entries' | 'merge';

const VALID_OPERATIONS_SET = new Set<string>(['pick', 'omit', 'flatten', 'keys', 'values', 'entries', 'merge']);

/**
 * 값이 유효한 TransformOperation인지 확인
 */
function isValidOperation(value: string): value is TransformOperation {
  return VALID_OPERATIONS_SET.has(value);
}

/**
 * JSON 변환 실행
 */
function transformJson(
  data: JsonValue,
  operation: TransformOperation,
  fields?: string[],
  mergeData?: JsonValue,
): JsonValue {
  switch (operation) {
    case 'pick': {
      if (!fields || fields.length === 0) {
        throw new Error('pick 작업에는 fields가 필요합니다.');
      }
      if (!isJsonObject(data)) {
        throw new Error('pick은 객체에만 사용할 수 있습니다.');
      }
      const pickResult: JsonObject = {};
      for (const field of fields) {
        const value: JsonValue | undefined = data[field];
        if (value !== undefined) {
          pickResult[field] = value;
        }
      }
      return pickResult;
    }

    case 'omit': {
      if (!fields || fields.length === 0) {
        throw new Error('omit 작업에는 fields가 필요합니다.');
      }
      if (!isJsonObject(data)) {
        throw new Error('omit은 객체에만 사용할 수 있습니다.');
      }
      const omitResult: JsonObject = {};
      const omitSet = new Set(fields);
      for (const [key, value] of Object.entries(data)) {
        if (!omitSet.has(key)) {
          omitResult[key] = value;
        }
      }
      return omitResult;
    }

    case 'flatten': {
      if (!Array.isArray(data)) {
        throw new Error('flatten은 배열에만 사용할 수 있습니다.');
      }
      const result: JsonValue[] = [];
      for (const item of data) {
        if (Array.isArray(item)) {
          result.push(...item);
        } else {
          result.push(item);
        }
      }
      return result;
    }

    case 'keys': {
      if (!isJsonObject(data)) {
        throw new Error('keys는 객체에만 사용할 수 있습니다.');
      }
      return Object.keys(data);
    }

    case 'values': {
      if (!isJsonObject(data)) {
        throw new Error('values는 객체에만 사용할 수 있습니다.');
      }
      return Object.values(data);
    }

    case 'entries': {
      if (!isJsonObject(data)) {
        throw new Error('entries는 객체에만 사용할 수 있습니다.');
      }
      return Object.entries(data).map(([k, v]): JsonValue => [k, v]);
    }

    case 'merge': {
      if (!isJsonObject(data)) {
        throw new Error('merge는 객체에만 사용할 수 있습니다.');
      }
      if (mergeData === undefined || !isJsonObject(mergeData)) {
        throw new Error('mergeData는 객체여야 합니다.');
      }
      return { ...data, ...mergeData };
    }
  }
}

/**
 * string[] 배열을 안전하게 파싱
 */
function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      result.push(item);
    }
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Tool handlers
 */
export const handlers: Record<string, ToolHandler> = {
  /**
   * json.query - JSONPath 기반 데이터 추출
   */
  'json.query': async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const dataStr = input['data'];
    const path = input['path'];

    if (typeof dataStr !== 'string') {
      throw new Error('data는 JSON 문자열이어야 합니다.');
    }
    if (typeof path !== 'string') {
      throw new Error('path는 문자열이어야 합니다.');
    }

    const data = safeJsonParse(dataStr);
    const result = queryJsonPath(data, path);

    return {
      result,
      path,
      success: true,
    };
  },

  /**
   * json.transform - JSON 데이터 변환
   */
  'json.transform': async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const dataStr = input['data'];
    const operation = input['operation'];

    if (typeof dataStr !== 'string') {
      throw new Error('data는 JSON 문자열이어야 합니다.');
    }
    if (typeof operation !== 'string' || !isValidOperation(operation)) {
      throw new Error(`operation은 ${[...VALID_OPERATIONS_SET].join(', ')} 중 하나여야 합니다.`);
    }

    const data = safeJsonParse(dataStr);
    const fields = parseStringArray(input['fields']);

    let mergeData: JsonValue | undefined;
    const mergeDataStr = input['mergeData'];
    if (typeof mergeDataStr === 'string') {
      mergeData = safeJsonParse(mergeDataStr);
    }

    const result = transformJson(data, operation, fields, mergeData);

    return {
      result,
      operation,
      success: true,
    };
  },
};
