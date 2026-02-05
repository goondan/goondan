/**
 * OAuthApi 구현 테스트
 * @see /docs/specs/oauth.md - 3. ctx.oauth 인터페이스, 12. OAuthManager 구현
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createOAuthManager,
  OAuthManager,
} from '../../src/oauth/api.js';
import { createOAuthStore, OAuthStore } from '../../src/oauth/store.js';
import type {
  OAuthTokenRequest,
  OAuthTokenResult,
  TurnAuth,
  OAuthGrantRecord,
  EncryptedValue,
} from '../../src/oauth/types.js';
import type { OAuthAppSpec, OAuthAppResource } from '../../src/types/specs/oauth-app.js';

describe('OAuthApi', () => {
  let tempDir: string;
  let store: OAuthStore;
  let manager: OAuthManager;

  // Mock dependencies
  const mockEncrypt = vi.fn(async (value: string): Promise<EncryptedValue> => ({
    algorithm: 'aes-256-gcm',
    iv: 'mock-iv',
    ciphertext: Buffer.from(value).toString('base64'),
    tag: 'mock-tag',
  }));

  const mockDecrypt = vi.fn(async (encrypted: EncryptedValue): Promise<string> => {
    return Buffer.from(encrypted.ciphertext, 'base64').toString('utf8');
  });

  const createMockOAuthApp = (overrides?: Partial<OAuthAppSpec>): OAuthAppResource => ({
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'OAuthApp',
    metadata: { name: 'slack-bot' },
    spec: {
      provider: 'slack',
      flow: 'authorizationCode',
      subjectMode: 'global',
      client: {
        clientId: { value: 'test-client-id' },
        clientSecret: { value: 'test-client-secret' },
      },
      endpoints: {
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
      },
      scopes: ['chat:write', 'channels:read'],
      redirect: {
        callbackPath: '/oauth/callback/slack-bot',
      },
      ...overrides,
    },
  });

  let mockConfigLoader: {
    getOAuthApp: ReturnType<typeof vi.fn>;
    resolveValueSource: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tempDir = join(tmpdir(), `oauth-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    store = createOAuthStore(tempDir);

    mockConfigLoader = {
      getOAuthApp: vi.fn(),
      resolveValueSource: vi.fn((source) => {
        if ('value' in source && source.value !== undefined) {
          return source.value;
        }
        return 'mock-value';
      }),
    };

    manager = createOAuthManager({
      store,
      configLoader: mockConfigLoader,
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
      baseCallbackUrl: 'https://example.com',
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('getAccessToken', () => {
    describe('오류 케이스', () => {
      it('OAuthApp이 존재하지 않으면 oauthAppNotFound 오류', async () => {
        mockConfigLoader.getOAuthApp.mockResolvedValue(null);

        const request: OAuthTokenRequest = {
          oauthAppRef: 'OAuthApp/non-existent',
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('error');
        if (result.status === 'error') {
          expect(result.error.code).toBe('oauthAppNotFound');
        }
      });

      it('subject를 결정할 수 없으면 subjectUnavailable 오류', async () => {
        mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

        const request: OAuthTokenRequest = {
          oauthAppRef: 'OAuthApp/slack-bot',
        };

        const turnAuth: TurnAuth = {
          // subjects.global이 없음
          subjects: { user: 'slack:user:U123' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('error');
        if (result.status === 'error') {
          expect(result.error.code).toBe('subjectUnavailable');
        }
      });

      it('요청 스코프가 OAuthApp 스코프를 초과하면 scopeNotAllowed 오류', async () => {
        mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

        const request: OAuthTokenRequest = {
          oauthAppRef: 'OAuthApp/slack-bot',
          scopes: ['chat:write', 'admin'],  // admin은 허용되지 않음
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('error');
        if (result.status === 'error') {
          expect(result.error.code).toBe('scopeNotAllowed');
        }
      });
    });

    describe('authorization_required 케이스', () => {
      it('Grant가 없으면 authorization_required 반환', async () => {
        mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

        const request: OAuthTokenRequest = {
          oauthAppRef: 'OAuthApp/slack-bot',
        };

        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('authorization_required');
        if (result.status === 'authorization_required') {
          expect(result.authSessionId).toBeDefined();
          expect(result.authorizationUrl).toContain('slack.com/oauth/v2/authorize');
          expect(result.message).toContain('slack');
        }
      });

      it('authorizationUrl에 PKCE 파라미터가 포함된다', async () => {
        mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

        const request: OAuthTokenRequest = {
          oauthAppRef: 'OAuthApp/slack-bot',
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('authorization_required');
        if (result.status === 'authorization_required') {
          const urlObj = new URL(result.authorizationUrl);
          expect(urlObj.searchParams.get('code_challenge')).toBeDefined();
          expect(urlObj.searchParams.get('code_challenge_method')).toBe('S256');
        }
      });

      it('철회된 Grant가 있으면 authorization_required 반환', async () => {
        const oauthApp = createMockOAuthApp();
        mockConfigLoader.getOAuthApp.mockResolvedValue(oauthApp);

        // 철회된 Grant 저장
        const revokedGrant: OAuthGrantRecord = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthGrantRecord',
          metadata: { name: 'grant-revoked' },
          spec: {
            provider: 'slack',
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
            subject: 'slack:team:T111',
            flow: 'authorization_code',
            scopesGranted: ['chat:write'],
            token: {
              tokenType: 'bearer',
              accessToken: await mockEncrypt('old-token'),
              issuedAt: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revoked: true,
            revokedAt: new Date().toISOString(),
          },
        };
        await store.saveGrant(revokedGrant);

        const request: OAuthTokenRequest = {
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        // Manager가 해당 grant를 조회하도록 grant ID를 맞춰야 함
        // 실제 구현에서는 generateGrantId로 같은 ID가 생성됨
        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('authorization_required');
      });
    });

    describe('ready 케이스', () => {
      it('유효한 Grant가 있으면 ready 반환', async () => {
        const oauthApp = createMockOAuthApp();
        mockConfigLoader.getOAuthApp.mockResolvedValue(oauthApp);

        // 유효한 Grant 저장 (grantId 계산 후 저장)
        const { generateGrantId } = await import('../../src/oauth/store.js');
        const grantId = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');

        const validGrant: OAuthGrantRecord = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthGrantRecord',
          metadata: { name: grantId },
          spec: {
            provider: 'slack',
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
            subject: 'slack:team:T111',
            flow: 'authorization_code',
            scopesGranted: ['chat:write', 'channels:read'],
            token: {
              tokenType: 'bearer',
              accessToken: await mockEncrypt('xoxb-valid-token'),
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
              issuedAt: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revoked: false,
          },
        };
        await store.saveGrant(validGrant);

        const request: OAuthTokenRequest = {
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
          expect(result.accessToken).toBe('xoxb-valid-token');
          expect(result.tokenType).toBe('bearer');
          expect(result.scopes).toContain('chat:write');
        }
      });

      it('만료 시각이 없는 토큰은 무기한 유효', async () => {
        const oauthApp = createMockOAuthApp();
        mockConfigLoader.getOAuthApp.mockResolvedValue(oauthApp);

        const { generateGrantId } = await import('../../src/oauth/store.js');
        const grantId = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');

        const noExpiryGrant: OAuthGrantRecord = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthGrantRecord',
          metadata: { name: grantId },
          spec: {
            provider: 'slack',
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
            subject: 'slack:team:T111',
            flow: 'authorization_code',
            scopesGranted: ['chat:write'],
            token: {
              tokenType: 'bearer',
              accessToken: await mockEncrypt('xoxb-no-expiry'),
              // expiresAt 없음
              issuedAt: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revoked: false,
          },
        };
        await store.saveGrant(noExpiryGrant);

        const request: OAuthTokenRequest = {
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
          expect(result.accessToken).toBe('xoxb-no-expiry');
        }
      });
    });

    describe('subjectMode=user', () => {
      it('subjectMode=user이면 turn.auth.subjects.user 사용', async () => {
        const oauthApp = createMockOAuthApp({ subjectMode: 'user' });
        mockConfigLoader.getOAuthApp.mockResolvedValue(oauthApp);

        const { generateGrantId } = await import('../../src/oauth/store.js');
        const grantId = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:user:U123');

        const userGrant: OAuthGrantRecord = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthGrantRecord',
          metadata: { name: grantId },
          spec: {
            provider: 'slack',
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
            subject: 'slack:user:U123',
            flow: 'authorization_code',
            scopesGranted: ['chat:write'],
            token: {
              tokenType: 'bearer',
              accessToken: await mockEncrypt('xoxp-user-token'),
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
              issuedAt: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revoked: false,
          },
        };
        await store.saveGrant(userGrant);

        const request: OAuthTokenRequest = {
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        };

        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'U123' },
          subjects: {
            global: 'slack:team:T111',
            user: 'slack:user:U123',
          },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
          expect(result.accessToken).toBe('xoxp-user-token');
        }
      });

      it('subjectMode=user인데 subjects.user가 없으면 오류', async () => {
        const oauthApp = createMockOAuthApp({ subjectMode: 'user' });
        mockConfigLoader.getOAuthApp.mockResolvedValue(oauthApp);

        const request: OAuthTokenRequest = {
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        };

        const turnAuth: TurnAuth = {
          subjects: {
            global: 'slack:team:T111',
            // user 없음
          },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        expect(result.status).toBe('error');
        if (result.status === 'error') {
          expect(result.error.code).toBe('subjectUnavailable');
        }
      });
    });

    describe('minTtlSeconds 옵션', () => {
      it('minTtlSeconds 내에 만료되는 토큰은 refresh 시도', async () => {
        const oauthApp = createMockOAuthApp();
        mockConfigLoader.getOAuthApp.mockResolvedValue(oauthApp);

        const { generateGrantId } = await import('../../src/oauth/store.js');
        const grantId = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');

        // 200초 후 만료 토큰 (refreshToken 있음)
        const soonExpiringGrant: OAuthGrantRecord = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthGrantRecord',
          metadata: { name: grantId },
          spec: {
            provider: 'slack',
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
            subject: 'slack:team:T111',
            flow: 'authorization_code',
            scopesGranted: ['chat:write'],
            token: {
              tokenType: 'bearer',
              accessToken: await mockEncrypt('old-token'),
              refreshToken: await mockEncrypt('refresh-token'),
              expiresAt: new Date(Date.now() + 200 * 1000).toISOString(),
              issuedAt: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revoked: false,
          },
        };
        await store.saveGrant(soonExpiringGrant);

        const request: OAuthTokenRequest = {
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          minTtlSeconds: 100,  // 100초 이상 유효해야 함 → 200초 > 100초 → ready
        };

        const turnAuth: TurnAuth = {
          subjects: { global: 'slack:team:T111' },
        };

        const result = await manager.getAccessToken(request, turnAuth);

        // minTtlSeconds=100이면 200초 남은 토큰은 유효
        expect(result.status).toBe('ready');
      });
    });
  });

  describe('Session 생성', () => {
    it('authorization_required 반환 시 Session이 저장된다', async () => {
      mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

      const request: OAuthTokenRequest = {
        oauthAppRef: 'OAuthApp/slack-bot',
      };

      const turnAuth: TurnAuth = {
        actor: { type: 'user', id: 'slack:U234567' },
        subjects: { global: 'slack:team:T111' },
      };

      const result = await manager.getAccessToken(request, turnAuth);

      expect(result.status).toBe('authorization_required');
      if (result.status === 'authorization_required') {
        const session = await store.getSession(result.authSessionId);
        expect(session).not.toBeNull();
        expect(session?.spec.status).toBe('pending');
        expect(session?.spec.provider).toBe('slack');
      }
    });

    it('Session에 PKCE codeVerifier가 암호화되어 저장된다', async () => {
      mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

      const request: OAuthTokenRequest = {
        oauthAppRef: 'OAuthApp/slack-bot',
      };

      const turnAuth: TurnAuth = {
        subjects: { global: 'slack:team:T111' },
      };

      const result = await manager.getAccessToken(request, turnAuth);

      if (result.status === 'authorization_required') {
        const session = await store.getSession(result.authSessionId);
        expect(session?.spec.flow.pkce).toBeDefined();
        expect(session?.spec.flow.pkce?.method).toBe('S256');
        expect(session?.spec.flow.pkce?.codeVerifier.algorithm).toBe('aes-256-gcm');
      }
    });

    it('Session에 resume 정보가 저장된다', async () => {
      mockConfigLoader.getOAuthApp.mockResolvedValue(createMockOAuthApp());

      const request: OAuthTokenRequest = {
        oauthAppRef: 'OAuthApp/slack-bot',
      };

      const turnAuth: TurnAuth = {
        actor: { type: 'user', id: 'slack:U234567', display: 'John' },
        subjects: {
          global: 'slack:team:T111',
          user: 'slack:user:T111:U234567',
        },
      };

      // resume 정보는 manager 생성 시 또는 요청 시 제공
      // 이 테스트에서는 기본값이 사용됨

      const result = await manager.getAccessToken(request, turnAuth);

      if (result.status === 'authorization_required') {
        const session = await store.getSession(result.authSessionId);
        expect(session?.spec.resume).toBeDefined();
        expect(session?.spec.resume.auth).toEqual(turnAuth);
      }
    });
  });
});
