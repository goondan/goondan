/**
 * OAuth 타입 테스트
 * @see /docs/specs/oauth.md
 */
import { describe, it, expect } from 'vitest';
import type {
  OAuthApi,
  OAuthTokenRequest,
  OAuthTokenResult,
  OAuthTokenReady,
  OAuthTokenAuthorizationRequired,
  OAuthTokenError,
  TurnAuth,
  TurnAuthActor,
  TurnAuthSubjects,
  EncryptedValue,
  OAuthGrantRecord,
  AuthSessionRecord,
  AuthSessionFlow,
  ResumeInfo,
  PKCEChallenge,
  StatePayload,
} from '../../src/oauth/types.js';

describe('OAuth 타입', () => {
  describe('OAuthTokenRequest', () => {
    it('oauthAppRef는 필수이다', () => {
      const request: OAuthTokenRequest = {
        oauthAppRef: 'OAuthApp/slack-bot',
      };
      expect(request.oauthAppRef).toBe('OAuthApp/slack-bot');
    });

    it('oauthAppRef는 ObjectRef 형태로도 지정할 수 있다', () => {
      const request: OAuthTokenRequest = {
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      };
      expect(request.oauthAppRef).toEqual({ kind: 'OAuthApp', name: 'slack-bot' });
    });

    it('scopes는 선택이다', () => {
      const request: OAuthTokenRequest = {
        oauthAppRef: 'OAuthApp/slack-bot',
        scopes: ['chat:write', 'channels:read'],
      };
      expect(request.scopes).toEqual(['chat:write', 'channels:read']);
    });

    it('minTtlSeconds는 선택이다', () => {
      const request: OAuthTokenRequest = {
        oauthAppRef: 'OAuthApp/slack-bot',
        minTtlSeconds: 600,
      };
      expect(request.minTtlSeconds).toBe(600);
    });
  });

  describe('OAuthTokenResult', () => {
    describe('OAuthTokenReady', () => {
      it('status가 ready이면 토큰이 준비됨', () => {
        const result: OAuthTokenReady = {
          status: 'ready',
          accessToken: 'xoxb-123-456-abc',
          tokenType: 'bearer',
          expiresAt: '2026-02-05T12:00:00Z',
          scopes: ['chat:write', 'channels:read'],
        };
        expect(result.status).toBe('ready');
        expect(result.accessToken).toBe('xoxb-123-456-abc');
        expect(result.tokenType).toBe('bearer');
        expect(result.scopes).toEqual(['chat:write', 'channels:read']);
      });

      it('expiresAt가 없으면 무기한이다', () => {
        const result: OAuthTokenReady = {
          status: 'ready',
          accessToken: 'xoxb-123-456-abc',
          tokenType: 'bearer',
          scopes: ['chat:write'],
        };
        expect(result.expiresAt).toBeUndefined();
      });
    });

    describe('OAuthTokenAuthorizationRequired', () => {
      it('status가 authorization_required이면 사용자 승인 필요', () => {
        const result: OAuthTokenAuthorizationRequired = {
          status: 'authorization_required',
          authSessionId: 'as-4f2c9a',
          authorizationUrl: 'https://slack.com/oauth/v2/authorize?...',
          expiresAt: '2026-02-05T12:10:00Z',
          message: '외부 서비스 연결이 필요합니다.',
        };
        expect(result.status).toBe('authorization_required');
        expect(result.authSessionId).toBe('as-4f2c9a');
        expect(result.authorizationUrl).toContain('slack.com');
      });

      it('deviceCode는 Device Code 플로우 전용이다', () => {
        const result: OAuthTokenAuthorizationRequired = {
          status: 'authorization_required',
          authSessionId: 'as-xyz',
          authorizationUrl: 'https://github.com/login/device',
          expiresAt: '2026-02-05T12:10:00Z',
          message: '아래 코드를 입력하세요.',
          deviceCode: {
            verificationUri: 'https://github.com/login/device',
            userCode: 'ABCD-1234',
            interval: 5,
          },
        };
        expect(result.deviceCode?.userCode).toBe('ABCD-1234');
        expect(result.deviceCode?.interval).toBe(5);
      });
    });

    describe('OAuthTokenError', () => {
      it('status가 error이면 오류 발생', () => {
        const result: OAuthTokenError = {
          status: 'error',
          error: {
            code: 'oauthAppNotFound',
            message: 'OAuthApp not found',
          },
        };
        expect(result.status).toBe('error');
        expect(result.error.code).toBe('oauthAppNotFound');
      });
    });

    it('OAuthTokenResult는 세 가지 상태 중 하나이다', () => {
      const ready: OAuthTokenResult = {
        status: 'ready',
        accessToken: 'token',
        tokenType: 'bearer',
        scopes: [],
      };

      const authRequired: OAuthTokenResult = {
        status: 'authorization_required',
        authSessionId: 'as-123',
        authorizationUrl: 'https://example.com/oauth',
        expiresAt: '2026-02-05T12:00:00Z',
        message: 'Auth required',
      };

      const error: OAuthTokenResult = {
        status: 'error',
        error: { code: 'test', message: 'Test error' },
      };

      expect(ready.status).toBe('ready');
      expect(authRequired.status).toBe('authorization_required');
      expect(error.status).toBe('error');
    });
  });

  describe('TurnAuth', () => {
    it('actor와 subjects를 포함한다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'user',
          id: 'slack:U234567',
          display: 'John Doe',
        },
        subjects: {
          global: 'slack:team:T111',
          user: 'slack:user:T111:U234567',
        },
      };
      expect(auth.actor?.type).toBe('user');
      expect(auth.subjects?.global).toBe('slack:team:T111');
      expect(auth.subjects?.user).toBe('slack:user:T111:U234567');
    });

    it('actor.type은 user, service, system 중 하나이다', () => {
      const userActor: TurnAuthActor = { type: 'user', id: 'u1' };
      const serviceActor: TurnAuthActor = { type: 'service', id: 's1' };
      const systemActor: TurnAuthActor = { type: 'system', id: 'sys1' };

      expect(userActor.type).toBe('user');
      expect(serviceActor.type).toBe('service');
      expect(systemActor.type).toBe('system');
    });

    it('subjects는 global과 user를 포함할 수 있다', () => {
      const subjects: TurnAuthSubjects = {
        global: 'slack:team:T111',
        user: 'slack:user:T111:U234567',
      };
      expect(subjects.global).toBe('slack:team:T111');
      expect(subjects.user).toBe('slack:user:T111:U234567');
    });
  });

  describe('EncryptedValue', () => {
    it('AES-256-GCM 알고리즘을 사용한다', () => {
      const encrypted: EncryptedValue = {
        algorithm: 'aes-256-gcm',
        iv: 'base64-iv',
        ciphertext: 'base64-ciphertext',
        tag: 'base64-tag',
      };
      expect(encrypted.algorithm).toBe('aes-256-gcm');
    });

    it('keyId는 키 로테이션용 선택 필드이다', () => {
      const encrypted: EncryptedValue = {
        algorithm: 'aes-256-gcm',
        iv: 'iv',
        ciphertext: 'ct',
        tag: 'tag',
        keyId: 'key-2026-01',
      };
      expect(encrypted.keyId).toBe('key-2026-01');
    });
  });

  describe('OAuthGrantRecord', () => {
    it('Grant 레코드의 필수 필드를 포함한다', () => {
      const grant: OAuthGrantRecord = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'OAuthGrantRecord',
        metadata: {
          name: 'grant-a1b2c3d4e5f6',
        },
        spec: {
          provider: 'slack',
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          subject: 'slack:team:T111',
          flow: 'authorization_code',
          scopesGranted: ['chat:write', 'channels:read'],
          token: {
            tokenType: 'bearer',
            accessToken: {
              algorithm: 'aes-256-gcm',
              iv: 'iv',
              ciphertext: 'ct',
              tag: 'tag',
            },
            issuedAt: '2026-01-31T09:10:01Z',
          },
          createdAt: '2026-01-31T09:10:01Z',
          updatedAt: '2026-01-31T09:10:01Z',
          revoked: false,
        },
      };
      expect(grant.kind).toBe('OAuthGrantRecord');
      expect(grant.spec.provider).toBe('slack');
      expect(grant.spec.revoked).toBe(false);
    });

    it('refreshToken과 expiresAt은 선택이다', () => {
      const grant: OAuthGrantRecord = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'OAuthGrantRecord',
        metadata: { name: 'grant-xyz' },
        spec: {
          provider: 'github',
          oauthAppRef: { kind: 'OAuthApp', name: 'github-app' },
          subject: 'github:user:123',
          flow: 'authorization_code',
          scopesGranted: ['repo'],
          token: {
            tokenType: 'bearer',
            accessToken: {
              algorithm: 'aes-256-gcm',
              iv: 'iv',
              ciphertext: 'ct',
              tag: 'tag',
            },
            refreshToken: {
              algorithm: 'aes-256-gcm',
              iv: 'iv2',
              ciphertext: 'ct2',
              tag: 'tag2',
            },
            expiresAt: '2026-02-01T10:00:00Z',
            issuedAt: '2026-01-31T09:10:01Z',
          },
          createdAt: '2026-01-31T09:10:01Z',
          updatedAt: '2026-01-31T09:10:01Z',
          revoked: false,
        },
      };
      expect(grant.spec.token.refreshToken).toBeDefined();
      expect(grant.spec.token.expiresAt).toBe('2026-02-01T10:00:00Z');
    });
  });

  describe('AuthSessionRecord', () => {
    it('인증 세션 레코드의 필수 필드를 포함한다', () => {
      const session: AuthSessionRecord = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'AuthSessionRecord',
        metadata: { name: 'as-4f2c9a' },
        spec: {
          provider: 'slack',
          oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          subjectMode: 'global',
          subject: 'slack:team:T111',
          requestedScopes: ['chat:write', 'channels:read'],
          flow: {
            type: 'authorization_code',
            pkce: {
              method: 'S256',
              codeVerifier: {
                algorithm: 'aes-256-gcm',
                iv: 'iv',
                ciphertext: 'ct',
                tag: 'tag',
              },
              codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
            },
            state: {
              algorithm: 'aes-256-gcm',
              iv: 'iv2',
              ciphertext: 'ct2',
              tag: 'tag2',
            },
          },
          status: 'pending',
          createdAt: '2026-01-31T09:10:01Z',
          expiresAt: '2026-01-31T09:20:01Z',
          resume: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKey: '1700000000.000100',
            agentName: 'planner',
            origin: { connector: 'slack-main', channel: 'C123' },
            auth: {
              actor: { type: 'user', id: 'slack:U234567' },
              subjects: { global: 'slack:team:T111' },
            },
          },
        },
      };
      expect(session.kind).toBe('AuthSessionRecord');
      expect(session.spec.status).toBe('pending');
      expect(session.spec.flow.pkce?.method).toBe('S256');
    });

    it('status는 pending, completed, failed, expired 중 하나이다', () => {
      const statuses: AuthSessionRecord['spec']['status'][] = [
        'pending',
        'completed',
        'failed',
        'expired',
      ];
      statuses.forEach((status) => {
        expect(['pending', 'completed', 'failed', 'expired']).toContain(status);
      });
    });
  });

  describe('PKCEChallenge', () => {
    it('PKCE 챌린지는 S256 방식만 지원한다', () => {
      const pkce: PKCEChallenge = {
        codeVerifier: 'random-43-char-string-here-abcdefghij12345',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
      };
      expect(pkce.codeChallengeMethod).toBe('S256');
    });
  });

  describe('StatePayload', () => {
    it('state 페이로드는 sessionId, nonce, timestamp를 포함한다', () => {
      const state: StatePayload = {
        sessionId: 'as-4f2c9a',
        nonce: 'random-hex-string',
        timestamp: Date.now(),
      };
      expect(state.sessionId).toBe('as-4f2c9a');
      expect(typeof state.timestamp).toBe('number');
    });
  });

  describe('ResumeInfo', () => {
    it('재개 정보는 swarmRef, instanceKey, agentName, origin, auth를 포함한다', () => {
      const resume: ResumeInfo = {
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: '1700000000.000100',
        agentName: 'planner',
        origin: { connector: 'slack-main', channel: 'C123', threadTs: '1700000000.000100' },
        auth: {
          actor: { type: 'user', id: 'slack:U234567' },
          subjects: { global: 'slack:team:T111', user: 'slack:user:T111:U234567' },
        },
      };
      expect(resume.swarmRef.name).toBe('default');
      expect(resume.agentName).toBe('planner');
    });
  });

  describe('OAuthApi 인터페이스', () => {
    it('getAccessToken 메서드를 포함한다', () => {
      // 인터페이스 컴파일 테스트
      const mockApi: OAuthApi = {
        getAccessToken: async (request: OAuthTokenRequest): Promise<OAuthTokenResult> => {
          return {
            status: 'ready',
            accessToken: 'test-token',
            tokenType: 'bearer',
            scopes: [],
          };
        },
      };
      expect(typeof mockApi.getAccessToken).toBe('function');
    });
  });
});
