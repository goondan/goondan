/**
 * Tool Spec 타입 정의
 * @see /docs/specs/resources.md - 6.2 Tool
 */

import type { Resource } from '../resource.js';
import type { ObjectRef } from '../object-ref.js';
import type { JsonSchema } from '../json-schema.js';

/**
 * Tool 리소스 스펙
 */
export interface ToolSpec {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (Bundle Root 기준) */
  entry: string;
  /** 에러 메시지 최대 길이 (기본값: 1000) */
  errorMessageLimit?: number;
  /** OAuth 인증 설정 (선택) */
  auth?: ToolAuth;
  /** 내보내는 함수 목록 */
  exports: ToolExport[];
}

/**
 * Tool 수준 인증 설정
 */
export interface ToolAuth {
  /** 참조할 OAuthApp */
  oauthAppRef?: ObjectRef;
  /** 필요한 스코프 (OAuthApp.spec.scopes의 부분집합) */
  scopes?: string[];
}

/**
 * Tool이 내보내는 함수 정의
 */
export interface ToolExport {
  /** 함수 이름 (예: "slack.postMessage") */
  name: string;
  /** 함수 설명 (LLM에 제공) */
  description: string;
  /** JSON Schema 형식의 파라미터 정의 */
  parameters: JsonSchema;
  /** export 수준 인증 설정 (선택, Tool 수준보다 좁게만 가능) */
  auth?: {
    scopes?: string[];
  };
}

/**
 * Tool 리소스 타입
 */
export type ToolResource = Resource<ToolSpec>;

// Re-export JsonSchema for convenience
export type { JsonSchema } from '../json-schema.js';
