/**
 * Extension Spec 타입 정의
 * @see /docs/specs/resources.md - 6.3 Extension
 */

import type { Resource } from '../resource.js';

/**
 * Extension 리소스 스펙
 */
export interface ExtensionSpec {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (Bundle Root 기준) */
  entry: string;
  /** Extension별 설정 (선택) */
  config?: Record<string, unknown>;
}

/**
 * MCP 연동 Extension의 config 구조
 */
export interface McpExtensionConfig {
  /** MCP 서버 연결 방식 */
  transport: McpTransport;
  /** 연결 유지 방식 */
  attach: McpAttach;
  /** 노출할 기능 */
  expose: McpExpose;
}

/**
 * MCP 서버 연결 방식
 */
export interface McpTransport {
  /** stdio 또는 http */
  type: 'stdio' | 'http';
  /** stdio 모드에서 실행할 명령어 */
  command?: string[];
  /** http 모드에서 연결할 URL */
  url?: string;
}

/**
 * MCP 연결 유지 방식
 */
export interface McpAttach {
  /** stateful (연결 유지) 또는 stateless (요청마다 연결) */
  mode: 'stateful' | 'stateless';
  /** 연결 범위 */
  scope: 'instance' | 'agent';
}

/**
 * MCP 노출 기능 설정
 */
export interface McpExpose {
  /** MCP 도구 노출 여부 */
  tools?: boolean;
  /** MCP 리소스 노출 여부 */
  resources?: boolean;
  /** MCP 프롬프트 노출 여부 */
  prompts?: boolean;
}

/**
 * Extension 리소스 타입
 */
export type ExtensionResource = Resource<ExtensionSpec>;
