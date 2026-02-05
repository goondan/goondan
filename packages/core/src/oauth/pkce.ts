/**
 * PKCE 생성/검증
 * @see /docs/specs/oauth.md - 8.2 PKCE 생성
 */

import { randomBytes, createHash } from 'crypto';
import type { PKCEChallenge } from './types.js';

/**
 * PKCE challenge 생성
 * RFC 7636 준수
 */
export function generatePKCE(): PKCEChallenge {
  // 43-128자의 URL-safe random string
  // 32 bytes → base64url → 43자
  const codeVerifier = randomBytes(32).toString('base64url');

  // SHA256(code_verifier) → Base64URL
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * PKCE 검증
 * code_verifier로부터 code_challenge를 계산하여 비교
 */
export function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const computedChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return computedChallenge === codeChallenge;
}
