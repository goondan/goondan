/**
 * JSON 기본 타입 정의
 * @see /docs/specs/resources.md - 7. 공통 타입 정의
 */

/**
 * JSON 원시 타입
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON 값
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * JSON 객체
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * JSON 배열
 */
export type JsonArray = JsonValue[];
