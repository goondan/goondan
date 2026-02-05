/**
 * Token 관리 테스트
 * @see /docs/specs/oauth.md - 6.3 토큰 유효성 판단, 9. Token Refresh 로직
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTokenValid,
  needsRefresh,
  createRefreshManager,
  RefreshManager,
} from '../../src/oauth/token.js';
import type { OAuthGrantRecord, EncryptedValue } from '../../src/oauth/types.js';

describe('Token 관리', () => {
  const mockEncryptedToken: EncryptedValue = {
    algorithm: 'aes-256-gcm',
    iv: 'test-iv',
    ciphertext: 'test-ciphertext',
    tag: 'test-tag',
  };

  const createTestGrant = (overrides?: Partial<OAuthGrantRecord['spec']>): OAuthGrantRecord => ({
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'OAuthGrantRecord',
    metadata: { name: 'grant-test' },
    spec: {
      provider: 'slack',
      oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      subject: 'slack:team:T111',
      flow: 'authorization_code',
      scopesGranted: ['chat:write'],
      token: {
        tokenType: 'bearer',
        accessToken: mockEncryptedToken,
        issuedAt: new Date().toISOString(),
        ...overrides?.token,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revoked: false,
      ...overrides,
    },
  });

  describe('isTokenValid', () => {
    it('철회된 토큰은 유효하지 않다', () => {
      const grant = createTestGrant({ revoked: true });
      expect(isTokenValid(grant)).toBe(false);
    });

    it('만료 시각이 없는 토큰은 무기한 유효하다', () => {
      const grant = createTestGrant();
      // expiresAt이 없음
      expect(isTokenValid(grant)).toBe(true);
    });

    it('만료되지 않은 토큰은 유효하다', () => {
      const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          expiresAt: futureExpiry,
          issuedAt: new Date().toISOString(),
        },
      });
      expect(isTokenValid(grant)).toBe(true);
    });

    it('만료된 토큰은 유효하지 않다', () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          expiresAt: pastExpiry,
          issuedAt: new Date().toISOString(),
        },
      });
      expect(isTokenValid(grant)).toBe(false);
    });

    it('기본 minTtlSeconds(300초) 내에 만료되는 토큰은 유효하지 않다', () => {
      // 200초 후 만료 (기본 300초 이내)
      const soonExpiry = new Date(Date.now() + 200 * 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          expiresAt: soonExpiry,
          issuedAt: new Date().toISOString(),
        },
      });
      expect(isTokenValid(grant)).toBe(false);
    });

    it('minTtlSeconds를 지정하면 해당 값으로 판단한다', () => {
      // 200초 후 만료
      const soonExpiry = new Date(Date.now() + 200 * 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          expiresAt: soonExpiry,
          issuedAt: new Date().toISOString(),
        },
      });

      // minTtl 100초: 200초 > 100초 → 유효
      expect(isTokenValid(grant, 100)).toBe(true);
      // minTtl 300초: 200초 < 300초 → 유효하지 않음
      expect(isTokenValid(grant, 300)).toBe(false);
    });
  });

  describe('needsRefresh', () => {
    it('철회된 토큰은 refresh 불가', () => {
      const grant = createTestGrant({ revoked: true });
      expect(needsRefresh(grant)).toBe(false);
    });

    it('refreshToken이 없는 토큰은 refresh 불가', () => {
      const grant = createTestGrant();
      expect(needsRefresh(grant)).toBe(false);
    });

    it('유효한 토큰은 refresh 불필요', () => {
      const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          refreshToken: mockEncryptedToken,
          expiresAt: futureExpiry,
          issuedAt: new Date().toISOString(),
        },
      });
      expect(needsRefresh(grant)).toBe(false);
    });

    it('만료 임박 토큰은 refresh 필요', () => {
      const soonExpiry = new Date(Date.now() + 200 * 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          refreshToken: mockEncryptedToken,
          expiresAt: soonExpiry,
          issuedAt: new Date().toISOString(),
        },
      });
      expect(needsRefresh(grant)).toBe(true);
    });

    it('만료된 토큰은 refresh 필요', () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const grant = createTestGrant({
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          refreshToken: mockEncryptedToken,
          expiresAt: pastExpiry,
          issuedAt: new Date().toISOString(),
        },
      });
      expect(needsRefresh(grant)).toBe(true);
    });
  });

  describe('RefreshManager', () => {
    let refreshManager: RefreshManager;
    let mockRefreshFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockRefreshFn = vi.fn();
      refreshManager = createRefreshManager(mockRefreshFn);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('refresh 함수를 호출한다', async () => {
      const expectedGrant = createTestGrant();
      mockRefreshFn.mockResolvedValue(expectedGrant);

      const result = await refreshManager.refresh('grant-123');

      expect(mockRefreshFn).toHaveBeenCalledWith('grant-123');
      expect(result).toBe(expectedGrant);
    });

    it('동시 refresh 요청은 단일 요청으로 병합된다 (single-flight)', async () => {
      let resolveRefresh: (value: OAuthGrantRecord) => void;
      const refreshPromise = new Promise<OAuthGrantRecord>((resolve) => {
        resolveRefresh = resolve;
      });

      mockRefreshFn.mockReturnValue(refreshPromise);

      // 동시에 여러 요청
      const promise1 = refreshManager.refresh('grant-123');
      const promise2 = refreshManager.refresh('grant-123');
      const promise3 = refreshManager.refresh('grant-123');

      // refresh 함수는 한 번만 호출됨
      expect(mockRefreshFn).toHaveBeenCalledTimes(1);

      // 결과 반환
      const expectedGrant = createTestGrant();
      resolveRefresh!(expectedGrant);

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      expect(result1).toBe(expectedGrant);
      expect(result2).toBe(expectedGrant);
      expect(result3).toBe(expectedGrant);
    });

    it('다른 grantId는 별도 요청으로 처리된다', async () => {
      mockRefreshFn.mockImplementation(async (grantId: string) => {
        return createTestGrant({ provider: grantId });
      });

      const promise1 = refreshManager.refresh('grant-1');
      const promise2 = refreshManager.refresh('grant-2');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(mockRefreshFn).toHaveBeenCalledTimes(2);
      expect(result1.spec.provider).toBe('grant-1');
      expect(result2.spec.provider).toBe('grant-2');
    });

    it('완료 후 같은 grantId로 다시 요청하면 새 요청으로 처리된다', async () => {
      mockRefreshFn.mockResolvedValue(createTestGrant());

      await refreshManager.refresh('grant-123');
      await refreshManager.refresh('grant-123');

      expect(mockRefreshFn).toHaveBeenCalledTimes(2);
    });

    it('오류 발생 시에도 진행 중 요청 정리됨', async () => {
      mockRefreshFn.mockRejectedValueOnce(new Error('Refresh failed'));
      mockRefreshFn.mockResolvedValueOnce(createTestGrant());

      await expect(refreshManager.refresh('grant-123')).rejects.toThrow('Refresh failed');

      // 오류 후 다시 요청하면 새 요청으로 처리됨
      const result = await refreshManager.refresh('grant-123');
      expect(result).toBeDefined();
      expect(mockRefreshFn).toHaveBeenCalledTimes(2);
    });
  });
});
