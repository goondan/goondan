/**
 * Subject 결정 로직 테스트
 * @see /docs/specs/oauth.md - 4. Subject 결정 로직
 */
import { describe, it, expect } from 'vitest';
import { resolveSubject } from '../../src/oauth/subject.js';
import type { OAuthAppSpec } from '../../src/types/specs/oauth-app.js';
import type { TurnAuth } from '../../src/oauth/types.js';

describe('Subject 결정 로직', () => {
  const createOAuthAppSpec = (subjectMode: 'global' | 'user'): OAuthAppSpec => ({
    provider: 'slack',
    flow: 'authorizationCode',
    subjectMode,
    client: {
      clientId: { value: 'client-id' },
      clientSecret: { value: 'client-secret' },
    },
    endpoints: {
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
    },
    scopes: ['chat:write'],
    redirect: {
      callbackPath: '/oauth/callback/slack-bot',
    },
  });

  describe('resolveSubject', () => {
    describe('subjectMode=global', () => {
      it('turn.auth.subjects.global을 반환한다', () => {
        const oauthApp = createOAuthAppSpec('global');
        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
          subjects: {
            global: 'slack:team:T111',
            user: 'slack:user:T111:U234567',
          },
        };

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBe('slack:team:T111');
      });

      it('subjects.global이 없으면 null을 반환한다', () => {
        const oauthApp = createOAuthAppSpec('global');
        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
          subjects: {
            user: 'slack:user:T111:U234567',
          },
        };

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBeNull();
      });

      it('subjects가 없으면 null을 반환한다', () => {
        const oauthApp = createOAuthAppSpec('global');
        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
        };

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBeNull();
      });
    });

    describe('subjectMode=user', () => {
      it('turn.auth.subjects.user를 반환한다', () => {
        const oauthApp = createOAuthAppSpec('user');
        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
          subjects: {
            global: 'slack:team:T111',
            user: 'slack:user:T111:U234567',
          },
        };

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBe('slack:user:T111:U234567');
      });

      it('subjects.user가 없으면 null을 반환한다', () => {
        const oauthApp = createOAuthAppSpec('user');
        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
          subjects: {
            global: 'slack:team:T111',
          },
        };

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBeNull();
      });

      it('subjects가 없으면 null을 반환한다', () => {
        const oauthApp = createOAuthAppSpec('user');
        const turnAuth: TurnAuth = {
          actor: { type: 'user', id: 'slack:U234567' },
        };

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('빈 TurnAuth 객체에서 null을 반환한다', () => {
        const oauthApp = createOAuthAppSpec('global');
        const turnAuth: TurnAuth = {};

        const subject = resolveSubject(oauthApp, turnAuth);
        expect(subject).toBeNull();
      });
    });
  });
});
