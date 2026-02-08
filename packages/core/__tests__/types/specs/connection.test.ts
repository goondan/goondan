/**
 * Connection Spec 타입 테스트 (v1.0)
 * @see /docs/specs/connection.md
 * @see /docs/specs/resources.md - 6.10 Connection
 */
import { describe, it, expect } from 'vitest';
import type {
  ConnectionSpec,
  ConnectorAuth,
  ConnectionVerify,
  IngressConfig,
  IngressRule,
  IngressMatch,
  IngressRoute,
  ConnectionResource,
} from '../../../src/types/specs/connection.js';

describe('ConnectionSpec (v1.0)', () => {
  it('connectorRef는 필수이다', () => {
    const spec: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'cli' },
    };

    expect(spec.connectorRef).toEqual({ kind: 'Connector', name: 'cli' });
  });

  it('connectorRef는 문자열 축약 형식을 지원한다', () => {
    const spec: ConnectionSpec = {
      connectorRef: 'Connector/cli',
    };

    expect(spec.connectorRef).toBe('Connector/cli');
  });

  describe('ConnectorAuth', () => {
    it('oauthAppRef로 OAuth 인증을 설정할 수 있다', () => {
      const auth: ConnectorAuth = {
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      };

      expect(auth.oauthAppRef?.kind).toBe('OAuthApp');
      expect(auth.oauthAppRef?.name).toBe('slack-bot');
    });

    it('staticToken으로 정적 토큰을 설정할 수 있다', () => {
      const auth: ConnectorAuth = {
        staticToken: {
          valueFrom: { env: 'TELEGRAM_BOT_TOKEN' },
        },
      };

      expect(auth.staticToken?.valueFrom?.env).toBe('TELEGRAM_BOT_TOKEN');
    });

    it('staticToken에 secretRef를 사용할 수 있다', () => {
      const auth: ConnectorAuth = {
        staticToken: {
          valueFrom: {
            secretRef: {
              ref: 'Secret/slack-bot-token',
              key: 'bot_token',
            },
          },
        },
      };

      expect(auth.staticToken?.valueFrom?.secretRef?.ref).toBe(
        'Secret/slack-bot-token'
      );
    });
  });

  describe('ConnectionVerify', () => {
    it('webhook 서명 검증 시크릿을 설정할 수 있다', () => {
      const verify: ConnectionVerify = {
        webhook: {
          signingSecret: {
            valueFrom: {
              secretRef: { ref: 'Secret/slack-webhook', key: 'signing_secret' },
            },
          },
        },
      };

      expect(verify.webhook?.signingSecret.valueFrom?.secretRef?.ref).toBe(
        'Secret/slack-webhook'
      );
    });
  });

  describe('IngressConfig', () => {
    it('rules 배열을 포함한다', () => {
      const ingress: IngressConfig = {
        rules: [
          {
            match: { event: 'app_mention' },
            route: { agentRef: { kind: 'Agent', name: 'planner' } },
          },
        ],
      };

      expect(ingress.rules).toHaveLength(1);
    });
  });

  describe('IngressRule', () => {
    it('route는 필수이다', () => {
      const rule: IngressRule = {
        route: {},
      };

      expect(rule.route).toBeDefined();
      expect(rule.route.agentRef).toBeUndefined();
    });

    it('match로 이벤트 이름 조건을 지정할 수 있다', () => {
      const rule: IngressRule = {
        match: { event: 'app_mention' },
        route: { agentRef: { kind: 'Agent', name: 'planner' } },
      };

      expect(rule.match?.event).toBe('app_mention');
    });

    it('match에 properties 조건을 지정할 수 있다', () => {
      const match: IngressMatch = {
        event: 'app_mention',
        properties: {
          channel_id: 'C-DEV-CHANNEL',
        },
      };

      expect(match.event).toBe('app_mention');
      expect(match.properties?.['channel_id']).toBe('C-DEV-CHANNEL');
    });

    it('route에 agentRef를 지정할 수 있다', () => {
      const route: IngressRoute = {
        agentRef: { kind: 'Agent', name: 'planner' },
      };

      expect(route.agentRef).toEqual({ kind: 'Agent', name: 'planner' });
    });

    it('route에 agentRef를 생략하면 entrypoint로 라우팅된다', () => {
      const route: IngressRoute = {};

      expect(route.agentRef).toBeUndefined();
    });
  });

  describe('ConnectionResource', () => {
    it('CLI Connection (가장 단순한 구성)을 정의할 수 있다', () => {
      const resource: ConnectionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'cli-to-default' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'cli' },
          ingress: {
            rules: [
              { route: {} },
            ],
          },
        },
      };

      expect(resource.kind).toBe('Connection');
      expect(resource.spec.connectorRef).toEqual({ kind: 'Connector', name: 'cli' });
      expect(resource.spec.ingress?.rules).toHaveLength(1);
    });

    it('Slack Connection (OAuth + verify)를 정의할 수 있다', () => {
      const resource: ConnectionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-main' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack' },
          auth: {
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          },
          verify: {
            webhook: {
              signingSecret: {
                valueFrom: {
                  secretRef: { ref: 'Secret/slack-webhook', key: 'signing_secret' },
                },
              },
            },
          },
          ingress: {
            rules: [
              {
                match: { event: 'app_mention' },
                route: { agentRef: { kind: 'Agent', name: 'planner' } },
              },
              {
                match: { event: 'message.im' },
                route: {},
              },
            ],
          },
        },
      };

      expect(resource.spec.auth?.oauthAppRef?.name).toBe('slack-bot');
      expect(resource.spec.verify?.webhook?.signingSecret).toBeDefined();
      expect(resource.spec.ingress?.rules).toHaveLength(2);
    });

    it('Telegram Connection (Static Token)을 정의할 수 있다', () => {
      const resource: ConnectionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'telegram-main' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'telegram' },
          auth: {
            staticToken: {
              valueFrom: { env: 'TELEGRAM_BOT_TOKEN' },
            },
          },
          ingress: {
            rules: [
              {
                match: { event: 'message' },
                route: { agentRef: { kind: 'Agent', name: 'planner' } },
              },
              { route: {} },
            ],
          },
        },
      };

      expect(resource.spec.auth?.staticToken?.valueFrom?.env).toBe('TELEGRAM_BOT_TOKEN');
      expect(resource.spec.ingress?.rules).toHaveLength(2);
    });

    it('properties 매칭을 사용하는 Connection을 정의할 수 있다', () => {
      const resource: ConnectionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-dev-team' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack' },
          auth: {
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          },
          ingress: {
            rules: [
              {
                match: {
                  event: 'app_mention',
                  properties: { channel_id: 'C-DEV-CHANNEL' },
                },
                route: { agentRef: { kind: 'Agent', name: 'dev-agent' } },
              },
            ],
          },
        },
      };

      expect(resource.spec.ingress?.rules?.[0]?.match?.properties?.['channel_id']).toBe(
        'C-DEV-CHANNEL'
      );
    });
  });
});
