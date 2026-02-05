/**
 * OAuthApp Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.7 OAuthApp
 */
import { describe, it, expect } from 'vitest';
import type {
  OAuthAppSpec,
  OAuthClient,
  OAuthEndpoints,
  OAuthRedirect,
  OAuthAppResource,
} from '../../../src/types/specs/oauth-app.js';

describe('OAuthAppSpec 타입', () => {
  describe('OAuthAppSpec 인터페이스', () => {
    it('provider, flow, subjectMode, client, endpoints, scopes, redirect는 필수이다', () => {
      const spec: OAuthAppSpec = {
        provider: 'slack',
        flow: 'authorizationCode',
        subjectMode: 'global',
        client: {
          clientId: { value: 'my-client-id' },
          clientSecret: { valueFrom: { env: 'SLACK_CLIENT_SECRET' } },
        },
        endpoints: {
          authorizationUrl: 'https://slack.com/oauth/v2/authorize',
          tokenUrl: 'https://slack.com/api/oauth.v2.access',
        },
        scopes: ['chat:write', 'channels:read'],
        redirect: {
          callbackPath: '/oauth/callback/slack-bot',
        },
      };

      expect(spec.provider).toBe('slack');
      expect(spec.flow).toBe('authorizationCode');
      expect(spec.subjectMode).toBe('global');
      expect(spec.scopes.length).toBe(2);
    });

    it('flow는 authorizationCode 또는 deviceCode이다', () => {
      const authCodeSpec: OAuthAppSpec = {
        provider: 'github',
        flow: 'authorizationCode',
        subjectMode: 'user',
        client: {
          clientId: { value: 'id' },
          clientSecret: { value: 'secret' },
        },
        endpoints: {
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
        },
        scopes: ['repo'],
        redirect: { callbackPath: '/oauth/callback/github' },
      };

      const deviceCodeSpec: OAuthAppSpec = {
        provider: 'github',
        flow: 'deviceCode',
        subjectMode: 'user',
        client: {
          clientId: { value: 'id' },
          clientSecret: { value: 'secret' },
        },
        endpoints: {
          tokenUrl: 'https://github.com/login/device/code',
        },
        scopes: ['repo'],
        redirect: { callbackPath: '' },
      };

      expect(authCodeSpec.flow).toBe('authorizationCode');
      expect(deviceCodeSpec.flow).toBe('deviceCode');
    });

    it('subjectMode는 global 또는 user이다', () => {
      const globalSpec: OAuthAppSpec = {
        provider: 'slack',
        flow: 'authorizationCode',
        subjectMode: 'global',
        client: {
          clientId: { value: 'id' },
          clientSecret: { value: 'secret' },
        },
        endpoints: {
          authorizationUrl: 'https://slack.com/oauth/v2/authorize',
          tokenUrl: 'https://slack.com/api/oauth.v2.access',
        },
        scopes: ['chat:write'],
        redirect: { callbackPath: '/oauth/callback' },
      };

      const userSpec: OAuthAppSpec = {
        provider: 'github',
        flow: 'authorizationCode',
        subjectMode: 'user',
        client: {
          clientId: { value: 'id' },
          clientSecret: { value: 'secret' },
        },
        endpoints: {
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
        },
        scopes: ['repo'],
        redirect: { callbackPath: '/oauth/callback' },
      };

      expect(globalSpec.subjectMode).toBe('global');
      expect(userSpec.subjectMode).toBe('user');
    });
  });

  describe('OAuthClient', () => {
    it('clientId와 clientSecret은 ValueSource 타입이다', () => {
      const client: OAuthClient = {
        clientId: { valueFrom: { env: 'SLACK_CLIENT_ID' } },
        clientSecret: {
          valueFrom: {
            secretRef: {
              ref: 'Secret/slack-oauth',
              key: 'client_secret',
            },
          },
        },
      };

      expect(client.clientId.valueFrom?.env).toBe('SLACK_CLIENT_ID');
      expect(client.clientSecret.valueFrom?.secretRef?.ref).toBe(
        'Secret/slack-oauth'
      );
    });
  });

  describe('OAuthEndpoints', () => {
    it('authorizationUrl과 tokenUrl을 지정할 수 있다', () => {
      const endpoints: OAuthEndpoints = {
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
      };

      expect(endpoints.authorizationUrl).toBe(
        'https://slack.com/oauth/v2/authorize'
      );
      expect(endpoints.tokenUrl).toBe('https://slack.com/api/oauth.v2.access');
    });

    it('revokeUrl과 userInfoUrl은 선택이다', () => {
      const endpoints: OAuthEndpoints = {
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        revokeUrl: 'https://slack.com/api/auth.revoke',
        userInfoUrl: 'https://slack.com/api/users.info',
      };

      expect(endpoints.revokeUrl).toBe('https://slack.com/api/auth.revoke');
      expect(endpoints.userInfoUrl).toBe('https://slack.com/api/users.info');
    });
  });

  describe('OAuthRedirect', () => {
    it('callbackPath를 지정할 수 있다', () => {
      const redirect: OAuthRedirect = {
        callbackPath: '/oauth/callback/slack-bot',
      };

      expect(redirect.callbackPath).toBe('/oauth/callback/slack-bot');
    });
  });

  describe('OAuthAppResource 타입', () => {
    it('완전한 OAuthApp 리소스를 정의할 수 있다', () => {
      const resource: OAuthAppResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'OAuthApp',
        metadata: {
          name: 'slack-bot',
          labels: {
            provider: 'slack',
          },
        },
        spec: {
          provider: 'slack',
          flow: 'authorizationCode',
          subjectMode: 'global',
          client: {
            clientId: { valueFrom: { env: 'SLACK_CLIENT_ID' } },
            clientSecret: {
              valueFrom: {
                secretRef: {
                  ref: 'Secret/slack-oauth',
                  key: 'client_secret',
                },
              },
            },
          },
          endpoints: {
            authorizationUrl: 'https://slack.com/oauth/v2/authorize',
            tokenUrl: 'https://slack.com/api/oauth.v2.access',
            revokeUrl: 'https://slack.com/api/auth.revoke',
          },
          scopes: ['chat:write', 'channels:read', 'users:read'],
          redirect: {
            callbackPath: '/oauth/callback/slack-bot',
          },
          options: {
            slack: {
              tokenMode: 'bot',
            },
          },
        },
      };

      expect(resource.kind).toBe('OAuthApp');
      expect(resource.spec.provider).toBe('slack');
      expect(resource.spec.scopes.length).toBe(3);
      expect(resource.spec.options?.slack).toEqual({ tokenMode: 'bot' });
    });
  });
});
