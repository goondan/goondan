/**
 * Token 관리 (유효성 판단, Refresh)
 * @see /docs/specs/oauth.md - 6.3 토큰 유효성 판단, 9. Token Refresh 로직
 */

import type { OAuthGrantRecord } from './types.js';

/**
 * 기본 minTtlSeconds (5분)
 */
const DEFAULT_MIN_TTL_SECONDS = 300;

/**
 * 토큰 유효성 판단
 *
 * 유효하지 않은 경우:
 * 1. 철회된 토큰
 * 2. 만료된 토큰
 * 3. minTtlSeconds 내에 만료되는 토큰
 */
export function isTokenValid(
  grant: OAuthGrantRecord,
  minTtlSeconds: number = DEFAULT_MIN_TTL_SECONDS
): boolean {
  // 철회된 토큰은 유효하지 않음
  if (grant.spec.revoked) {
    return false;
  }

  const expiresAt = grant.spec.token.expiresAt;

  // 만료 시각이 없으면 무기한 유효
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  const nowMs = Date.now();
  const minTtlMs = minTtlSeconds * 1000;

  // 만료 임박 판단: 남은 시간이 minTtl보다 커야 유효
  return expiresAtMs - nowMs > minTtlMs;
}

/**
 * Refresh 필요 여부 판단
 *
 * Refresh가 필요한 경우:
 * 1. refreshToken이 존재함
 * 2. 토큰이 유효하지 않음 (만료됨 또는 만료 임박)
 * 3. 철회되지 않음
 */
export function needsRefresh(
  grant: OAuthGrantRecord,
  minTtlSeconds: number = DEFAULT_MIN_TTL_SECONDS
): boolean {
  // 철회된 토큰은 refresh 불가
  if (grant.spec.revoked) {
    return false;
  }

  // refreshToken이 없으면 refresh 불가
  if (!grant.spec.token.refreshToken) {
    return false;
  }

  // 토큰이 아직 유효하면 refresh 불필요
  if (isTokenValid(grant, minTtlSeconds)) {
    return false;
  }

  return true;
}

/**
 * RefreshManager 인터페이스
 */
export interface RefreshManager {
  refresh(grantId: string): Promise<OAuthGrantRecord>;
}

/**
 * Refresh 함수 타입
 */
export type RefreshFn = (grantId: string) => Promise<OAuthGrantRecord>;

/**
 * Single-flight 패턴을 적용한 RefreshManager 생성
 *
 * 동시에 같은 grantId에 대한 refresh 요청이 여러 개 들어오면
 * 하나의 요청만 실행하고 나머지는 그 결과를 공유
 */
export function createRefreshManager(refreshFn: RefreshFn): RefreshManager {
  const inflight = new Map<string, Promise<OAuthGrantRecord>>();

  return {
    async refresh(grantId: string): Promise<OAuthGrantRecord> {
      // 이미 진행 중인 refresh가 있으면 그 결과를 기다림
      const existing = inflight.get(grantId);
      if (existing) {
        return existing;
      }

      // 새 refresh 시작
      const promise = refreshFn(grantId);
      inflight.set(grantId, promise);

      try {
        return await promise;
      } finally {
        inflight.delete(grantId);
      }
    },
  };
}
