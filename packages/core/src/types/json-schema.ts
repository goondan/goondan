/**
 * JSON Schema 타입 정의
 * @see /docs/specs/resources.md - 6.2 Tool (JsonSchema)
 */

/**
 * JSON Schema 타입 (간략화)
 */
export interface JsonSchema {
  /** 스키마 타입 */
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  /** 객체 속성 정의 */
  properties?: Record<string, JsonSchema>;
  /** 배열 요소 스키마 */
  items?: JsonSchema;
  /** 필수 속성 목록 */
  required?: string[];
  /** 속성 설명 */
  description?: string;
  /** 추가 속성 허용 여부 */
  additionalProperties?: boolean | JsonSchema;
  /** 허용된 값 목록 */
  enum?: unknown[];
  /** 기본값 */
  default?: unknown;
}
