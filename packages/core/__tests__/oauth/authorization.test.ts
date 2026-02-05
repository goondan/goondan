/**
 * Authorization Code 플로우 테스트
 * @see /docs/specs/oauth.md - 8. Authorization Code + PKCE(S256) 플로우
 */
import { describe, it, expect } from 'vitest';
import {
  generateState,
  parseState,
  buildAuthorizationUrl,
  validateScopes,
} from '../../src/oauth/authorization.js';
import type { OAuthAppSpec } from '../../src/types/specs/oauth-app.js';
import type { AuthSessionRecord, PKCEChallenge } from '../../src/oauth/types.js';

describe('Authorization Code 플로우', () => {
  describe('generateState', () => {
    it('sessionId를 포함한 state를 생성한다', () => {
      const state = generateState('as-4f2c9a');
      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThan(0);
    });

    it('생성된 state는 Base64URL 인코딩이다', () => {
      const state = generateState('as-test');
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('매번 다른 state를 생성한다 (nonce 포함)', () => {
      const state1 = generateState('as-same');
      const state2 = generateState('as-same');
      expect(state1).not.toBe(state2);
    });
  });

  describe('parseState', () => {
    it('유효한 state에서 sessionId를 추출한다', () => {
      const state = generateState('as-4f2c9a');
      const payload = parseState(state);

      expect(payload).not.toBeNull();
      expect(payload?.sessionId).toBe('as-4f2c9a');
    });

    it('nonce와 timestamp를 포함한다', () => {
      const state = generateState('as-test');
      const payload = parseState(state);

      expect(payload?.nonce).toBeDefined();
      expect(typeof payload?.nonce).toBe('string');
      expect(payload?.timestamp).toBeDefined();
      expect(typeof payload?.timestamp).toBe('number');
    });

    it('잘못된 state는 null을 반환한다', () => {
      const payload = parseState('invalid-state');
      expect(payload).toBeNull();
    });

    it('빈 문자열은 null을 반환한다', () => {
      const payload = parseState('');
      expect(payload).toBeNull();
    });

    it('유효하지 않은 JSON은 null을 반환한다', () => {
      // Base64로 인코딩되었지만 JSON이 아닌 경우
      const notJson = Buffer.from('not json').toString('base64url');
      const payload = parseState(notJson);
      expect(payload).toBeNull();
    });
  });

  describe('buildAuthorizationUrl', () => {
    const createOAuthApp = (): OAuthAppSpec => ({
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
    });

    const createSession = (): AuthSessionRecord => ({
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'AuthSessionRecord',
      metadata: { name: 'as-test' },
      spec: {
        provider: 'slack',
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        subjectMode: 'global',
        subject: 'slack:team:T111',
        requestedScopes: ['chat:write', 'channels:read'],
        flow: {
          type: 'authorization_code',
          state: {
            algorithm: 'aes-256-gcm',
            iv: 'iv',
            ciphertext: 'ct',
            tag: 'tag',
          },
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        resume: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKey: '1',
          agentName: 'test',
          origin: {},
          auth: {},
        },
      },
    });

    const createPKCE = (): PKCEChallenge => ({
      codeVerifier: 'test-verifier-12345678901234567890123456789012345',
      codeChallenge: 'test-challenge',
      codeChallengeMethod: 'S256',
    });

    it('Authorization URL을 생성한다', () => {
      const oauthApp = createOAuthApp();
      const pkce = createPKCE();
      const state = 'encoded-state';
      const callbackUrl = 'https://example.com/oauth/callback/slack-bot';

      const url = buildAuthorizationUrl(oauthApp, state, pkce, callbackUrl);

      expect(url).toContain('https://slack.com/oauth/v2/authorize');
    });

    it('필수 파라미터를 포함한다', () => {
      const oauthApp = createOAuthApp();
      const pkce = createPKCE();
      const state = 'encoded-state';
      const callbackUrl = 'https://example.com/oauth/callback/slack-bot';

      const url = buildAuthorizationUrl(oauthApp, state, pkce, callbackUrl);
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get('response_type')).toBe('code');
      expect(urlObj.searchParams.get('client_id')).toBe('test-client-id');
      expect(urlObj.searchParams.get('redirect_uri')).toBe(callbackUrl);
      expect(urlObj.searchParams.get('state')).toBe(state);
    });

    it('PKCE 파라미터를 포함한다', () => {
      const oauthApp = createOAuthApp();
      const pkce = createPKCE();
      const state = 'encoded-state';
      const callbackUrl = 'https://example.com/oauth/callback/slack-bot';

      const url = buildAuthorizationUrl(oauthApp, state, pkce, callbackUrl);
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get('code_challenge')).toBe(pkce.codeChallenge);
      expect(urlObj.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('scopes를 공백으로 구분하여 포함한다', () => {
      const oauthApp = createOAuthApp();
      const pkce = createPKCE();
      const state = 'encoded-state';
      const callbackUrl = 'https://example.com/oauth/callback/slack-bot';
      const scopes = ['chat:write', 'channels:read'];

      const url = buildAuthorizationUrl(oauthApp, state, pkce, callbackUrl, scopes);
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get('scope')).toBe('chat:write channels:read');
    });

    it('options의 추가 파라미터를 포함한다', () => {
      const oauthApp: OAuthAppSpec = {
        ...createOAuthApp(),
        options: {
          team: 'T111',
          user_scope: 'identify',
        },
      };
      const pkce = createPKCE();
      const state = 'encoded-state';
      const callbackUrl = 'https://example.com/oauth/callback/slack-bot';

      const url = buildAuthorizationUrl(oauthApp, state, pkce, callbackUrl);
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get('team')).toBe('T111');
      expect(urlObj.searchParams.get('user_scope')).toBe('identify');
    });
  });

  describe('validateScopes', () => {
    it('요청 스코프가 허용 스코프의 부분집합이면 true', () => {
      const allowedScopes = ['chat:write', 'channels:read', 'users:read'];
      const requestedScopes = ['chat:write', 'channels:read'];

      expect(validateScopes(requestedScopes, allowedScopes)).toBe(true);
    });

    it('요청 스코프가 허용 스코프와 동일하면 true', () => {
      const allowedScopes = ['chat:write', 'channels:read'];
      const requestedScopes = ['chat:write', 'channels:read'];

      expect(validateScopes(requestedScopes, allowedScopes)).toBe(true);
    });

    it('요청 스코프가 허용 스코프를 초과하면 false', () => {
      const allowedScopes = ['chat:write', 'channels:read'];
      const requestedScopes = ['chat:write', 'channels:read', 'admin'];

      expect(validateScopes(requestedScopes, allowedScopes)).toBe(false);
    });

    it('빈 요청 스코프는 true', () => {
      const allowedScopes = ['chat:write', 'channels:read'];
      const requestedScopes: string[] = [];

      expect(validateScopes(requestedScopes, allowedScopes)).toBe(true);
    });

    it('빈 허용 스코프에서 요청 스코프가 있으면 false', () => {
      const allowedScopes: string[] = [];
      const requestedScopes = ['chat:write'];

      expect(validateScopes(requestedScopes, allowedScopes)).toBe(false);
    });
  });
});
