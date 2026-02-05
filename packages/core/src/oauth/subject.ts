/**
 * Subject 결정 로직
 * @see /docs/specs/oauth.md - 4. Subject 결정 로직
 */

import type { OAuthAppSpec } from '../types/specs/oauth-app.js';
import type { TurnAuth } from './types.js';

/**
 * OAuthApp의 subjectMode와 TurnAuth를 기반으로 subject를 결정한다.
 *
 * - subjectMode=global: turn.auth.subjects.global 사용
 * - subjectMode=user: turn.auth.subjects.user 사용
 *
 * @returns subject 문자열 또는 null (결정 불가 시)
 */
export function resolveSubject(
  oauthApp: OAuthAppSpec,
  turnAuth: TurnAuth
): string | null {
  const { subjectMode } = oauthApp;
  const subjects = turnAuth.subjects;

  if (!subjects) {
    return null;
  }

  if (subjectMode === 'global') {
    return subjects.global ?? null;
  }

  if (subjectMode === 'user') {
    return subjects.user ?? null;
  }

  return null;
}
