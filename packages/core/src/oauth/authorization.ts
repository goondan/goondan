/**
 * Authorization Code 플로우
 * @see /docs/specs/oauth.md - 8. Authorization Code + PKCE(S256) 플로우
 */

import { randomBytes } from 'crypto';
import type { OAuthAppSpec } from '../types/specs/oauth-app.js';
import type { PKCEChallenge, StatePayload } from './types.js';

/**
 * State 생성
 * sessionId, nonce, timestamp를 포함한 Base64URL 인코딩 문자열
 */
export function generateState(sessionId: string): string {
  const payload: StatePayload = {
    sessionId,
    nonce: randomBytes(16).toString('hex'),
    timestamp: Date.now(),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * State 파싱
 * Base64URL 디코딩 후 JSON 파싱
 */
export function parseState(state: string): StatePayload | null {
  if (!state) {
    return null;
  }

  try {
    const json = Buffer.from(state, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as unknown;

    // 타입 검증
    if (!isStatePayload(payload)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * StatePayload 타입 가드
 */
function isStatePayload(value: unknown): value is StatePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.sessionId === 'string' &&
    typeof obj.nonce === 'string' &&
    typeof obj.timestamp === 'number'
  );
}

/**
 * Authorization URL 생성
 */
export function buildAuthorizationUrl(
  oauthApp: OAuthAppSpec,
  state: string,
  pkce: PKCEChallenge,
  callbackUrl: string,
  scopes?: string[]
): string {
  const authorizationUrl = oauthApp.endpoints.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error('authorizationUrl is required for authorization code flow');
  }

  const url = new URL(authorizationUrl);

  // 클라이언트 ID 추출
  const clientId = resolveClientId(oauthApp);

  // 필수 파라미터
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);

  // PKCE 파라미터
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);

  // 스코프 (공백 구분)
  const scopeList = scopes ?? oauthApp.scopes;
  if (scopeList.length > 0) {
    url.searchParams.set('scope', scopeList.join(' '));
  }

  // 공급자별 추가 옵션
  if (oauthApp.options) {
    for (const [key, value] of Object.entries(oauthApp.options)) {
      if (typeof value === 'string') {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}

/**
 * 클라이언트 ID 추출 (ValueSource에서)
 */
function resolveClientId(oauthApp: OAuthAppSpec): string {
  const clientIdSource = oauthApp.client.clientId;

  if ('value' in clientIdSource && clientIdSource.value !== undefined) {
    return clientIdSource.value;
  }

  // valueFrom의 경우 런타임에서 해결해야 함
  throw new Error('clientId must be resolved before building authorization URL');
}

/**
 * 스코프 검증
 * 요청 스코프가 허용 스코프의 부분집합인지 확인
 */
export function validateScopes(
  requestedScopes: string[],
  allowedScopes: string[]
): boolean {
  const allowedSet = new Set(allowedScopes);

  for (const scope of requestedScopes) {
    if (!allowedSet.has(scope)) {
      return false;
    }
  }

  return true;
}
