/**
 * OAuthApp Spec 타입 정의
 * @see /docs/specs/resources.md - 6.7 OAuthApp
 */

import type { Resource } from '../resource.js';
import type { ValueSource } from '../value-source.js';

/**
 * OAuthApp 리소스 스펙
 */
export interface OAuthAppSpec {
  /** OAuth 제공자 식별자 */
  provider: string;
  /** OAuth 플로우 타입 */
  flow: 'authorizationCode' | 'deviceCode';
  /** Subject 모드 */
  subjectMode: 'global' | 'user';
  /** 클라이언트 자격 증명 */
  client: OAuthClient;
  /** OAuth 엔드포인트 */
  endpoints: OAuthEndpoints;
  /** 요청할 스코프 목록 */
  scopes: string[];
  /** 리다이렉트 설정 */
  redirect: OAuthRedirect;
  /** 제공자별 옵션 */
  options?: Record<string, unknown>;
}

/**
 * OAuth 클라이언트 자격 증명
 */
export interface OAuthClient {
  /** 클라이언트 ID */
  clientId: ValueSource;
  /** 클라이언트 시크릿 */
  clientSecret: ValueSource;
}

/**
 * OAuth 엔드포인트
 */
export interface OAuthEndpoints {
  /** 인가 URL */
  authorizationUrl?: string;
  /** 토큰 URL */
  tokenUrl: string;
  /** 토큰 취소 URL (선택) */
  revokeUrl?: string;
  /** 사용자 정보 URL (선택) */
  userInfoUrl?: string;
}

/**
 * OAuth 리다이렉트 설정
 */
export interface OAuthRedirect {
  /** 콜백 경로 */
  callbackPath: string;
}

/**
 * OAuthApp 리소스 타입
 */
export type OAuthAppResource = Resource<OAuthAppSpec>;
