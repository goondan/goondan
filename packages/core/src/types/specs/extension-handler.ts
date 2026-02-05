/**
 * ExtensionHandler Spec 타입 정의
 * @see /docs/specs/resources.md - 6.9 ExtensionHandler
 */

import type { Resource } from '../resource.js';

/**
 * ExtensionHandler 리소스 스펙
 */
export interface ExtensionHandlerSpec {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 */
  entry: string;
  /** export하는 함수 목록 */
  exports: ExtensionHandlerExport[];
}

/**
 * ExtensionHandler가 export하는 함수 타입
 */
export type ExtensionHandlerExport = 'validate' | 'default' | 'materialize';

/**
 * ExtensionHandler 리소스 타입
 */
export type ExtensionHandlerResource = Resource<ExtensionHandlerSpec>;
