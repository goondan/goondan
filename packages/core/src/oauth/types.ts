/**
 * OAuth 타입 정의
 * @see /docs/specs/oauth.md
 */

import type { ObjectRef, ObjectRefLike } from '../types/object-ref.js';
import type { JsonObject } from '../types/json.js';

// ============================================================================
// OAuthApi 인터페이스
// ============================================================================

/**
 * OAuth API 인터페이스
 * Tool/Connector가 토큰을 요청할 때 사용
 */
export interface OAuthApi {
  getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
}

/**
 * 토큰 요청 파라미터
 */
export interface OAuthTokenRequest {
  /** OAuthApp 리소스 참조 */
  oauthAppRef: ObjectRefLike;
  /** 선택: 요청 스코프 (OAuthApp.spec.scopes의 부분집합만 허용) */
  scopes?: string[];
  /** 선택: 만료 임박 판단 기준 (초 단위, 기본 300) */
  minTtlSeconds?: number;
}

// ============================================================================
// OAuthTokenResult variants
// ============================================================================

/**
 * 토큰 요청 결과 (유니온 타입)
 */
export type OAuthTokenResult =
  | OAuthTokenReady
  | OAuthTokenAuthorizationRequired
  | OAuthTokenError;

/**
 * 토큰이 준비된 경우
 */
export interface OAuthTokenReady {
  status: 'ready';
  accessToken: string;
  tokenType: string;
  expiresAt?: string;
  scopes: string[];
}

/**
 * 사용자 승인이 필요한 경우
 */
export interface OAuthTokenAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
  message: string;
  /** Device Code 플로우 전용 (선택) */
  deviceCode?: {
    verificationUri: string;
    userCode: string;
    interval: number;
  };
}

/**
 * 오류 발생
 */
export interface OAuthTokenError {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

// ============================================================================
// TurnAuth
// ============================================================================

/**
 * Turn 인증 정보
 */
export interface TurnAuth {
  actor?: TurnAuthActor;
  subjects?: TurnAuthSubjects;
}

/**
 * 행위자 정보
 */
export interface TurnAuthActor {
  type: 'user' | 'service' | 'system';
  id: string;
  display?: string;
}

/**
 * Subject 정보
 */
export interface TurnAuthSubjects {
  global?: string;
  user?: string;
}

// ============================================================================
// Encryption
// ============================================================================

/**
 * 암호화된 값
 */
export interface EncryptedValue {
  algorithm: 'aes-256-gcm';
  iv: string;
  ciphertext: string;
  tag: string;
  keyId?: string;
}

/**
 * 암호화 서비스 인터페이스
 */
export interface EncryptionService {
  encrypt(plaintext: string): Promise<EncryptedValue>;
  decrypt(encrypted: EncryptedValue): Promise<string>;
}

// ============================================================================
// OAuthGrantRecord
// ============================================================================

/**
 * OAuth Grant 레코드
 */
export interface OAuthGrantRecord {
  apiVersion: string;
  kind: 'OAuthGrantRecord';
  metadata: {
    name: string;
  };
  spec: OAuthGrantSpec;
}

/**
 * Grant 스펙
 */
export interface OAuthGrantSpec {
  provider: string;
  oauthAppRef: ObjectRef;
  subject: string;
  flow: 'authorization_code' | 'device_code';
  scopesGranted: string[];
  token: OAuthGrantToken;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revoked: boolean;
  providerData?: JsonObject;
}

/**
 * Grant 토큰 정보
 */
export interface OAuthGrantToken {
  tokenType: string;
  accessToken: EncryptedValue;
  refreshToken?: EncryptedValue;
  expiresAt?: string;
  issuedAt: string;
}

// ============================================================================
// AuthSessionRecord
// ============================================================================

/**
 * 인증 세션 레코드
 */
export interface AuthSessionRecord {
  apiVersion: string;
  kind: 'AuthSessionRecord';
  metadata: {
    name: string;
  };
  spec: AuthSessionSpec;
}

/**
 * 세션 스펙
 */
export interface AuthSessionSpec {
  provider: string;
  oauthAppRef: ObjectRef;
  subjectMode: 'global' | 'user';
  subject: string;
  requestedScopes: string[];
  flow: AuthSessionFlow;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  statusReason?: string;
  createdAt: string;
  expiresAt: string;
  resume: ResumeInfo;
}

/**
 * 세션 플로우 정보
 */
export interface AuthSessionFlow {
  type: 'authorization_code' | 'device_code';
  pkce?: {
    method: 'S256';
    codeVerifier: EncryptedValue;
    codeChallenge: string;
  };
  state: EncryptedValue;
  /** Device Code 전용 */
  deviceCode?: {
    deviceCode: EncryptedValue;
    verificationUri: string;
    userCode: string;
    interval: number;
    expiresAt: string;
  };
}

/**
 * 재개 정보
 */
export interface ResumeInfo {
  swarmRef: ObjectRef;
  instanceKey: string;
  agentName: string;
  origin: JsonObject;
  auth: TurnAuth;
}

// ============================================================================
// PKCE
// ============================================================================

/**
 * PKCE 챌린지
 */
export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

// ============================================================================
// State
// ============================================================================

/**
 * State 페이로드
 */
export interface StatePayload {
  sessionId: string;
  nonce: string;
  timestamp: number;
}

// ============================================================================
// OAuth Callback
// ============================================================================

/**
 * OAuth 콜백 파라미터
 */
export interface CallbackParams {
  code: string;
  state: string;
  error?: string;
  error_description?: string;
}

/**
 * 토큰 응답 (OAuth 표준)
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

// ============================================================================
// OAuth Error Codes
// ============================================================================

/**
 * OAuth 오류 코드
 */
export type OAuthErrorCode =
  | 'oauthAppNotFound'
  | 'subjectUnavailable'
  | 'scopeNotAllowed'
  | 'tokenRevoked'
  | 'refreshFailed'
  | 'deviceCodeUnsupported'
  | 'configurationError'
  | 'invalid_state'
  | 'session_not_found'
  | 'session_already_used'
  | 'session_expired'
  | 'subject_mismatch'
  | 'token_exchange_failed';

// ============================================================================
// Re-exports
// ============================================================================

export type { ObjectRef, ObjectRefLike };
