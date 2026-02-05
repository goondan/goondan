/**
 * Connector Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.6 Connector
 */
import { describe, it, expect } from 'vitest';
import type {
  ConnectorSpec,
  ConnectorAuth,
  IngressRule,
  IngressMatch,
  IngressRoute,
  EgressConfig,
  UpdatePolicy,
  TriggerConfig,
  ConnectorResource,
} from '../../../src/types/specs/connector.js';

describe('ConnectorSpec 타입', () => {
  describe('ConnectorSpec 인터페이스', () => {
    it('type은 필수이다', () => {
      const spec: ConnectorSpec = {
        type: 'slack',
      };

      expect(spec.type).toBe('slack');
    });

    it('custom 타입에서는 runtime과 entry가 필요하다', () => {
      const spec: ConnectorSpec = {
        type: 'custom',
        runtime: 'node',
        entry: './connectors/webhook/index.js',
      };

      expect(spec.type).toBe('custom');
      expect(spec.runtime).toBe('node');
      expect(spec.entry).toBe('./connectors/webhook/index.js');
    });
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

  describe('IngressRule', () => {
    it('route는 필수이다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      expect(rule.route.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
    });

    it('match로 조건을 지정할 수 있다', () => {
      const rule: IngressRule = {
        match: {
          command: '/swarm',
          eventType: 'message',
          channel: '#general',
        },
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.event.thread_ts',
          inputFrom: '$.event.text',
        },
      };

      expect(rule.match?.command).toBe('/swarm');
      expect(rule.route.instanceKeyFrom).toBe('$.event.thread_ts');
    });
  });

  describe('EgressConfig', () => {
    it('updatePolicy로 업데이트 정책을 설정할 수 있다', () => {
      const egress: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 1500,
        },
      };

      expect(egress.updatePolicy?.mode).toBe('updateInThread');
      expect(egress.updatePolicy?.debounceMs).toBe(1500);
    });

    it('모든 업데이트 모드를 지원해야 한다', () => {
      const modes: UpdatePolicy['mode'][] = [
        'replace',
        'updateInThread',
        'newMessage',
      ];

      expect(modes.length).toBe(3);
    });
  });

  describe('TriggerConfig', () => {
    it('handler로 핸들러 함수를 지정할 수 있다', () => {
      const trigger: TriggerConfig = {
        handler: 'onWebhook',
      };

      expect(trigger.handler).toBe('onWebhook');
    });
  });

  describe('ConnectorResource 타입', () => {
    it('Slack Connector (OAuth) 리소스를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: {
          name: 'slack-main',
        },
        spec: {
          type: 'slack',
          auth: {
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          },
          ingress: [
            {
              match: { command: '/swarm' },
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.event.thread_ts',
                inputFrom: '$.event.text',
              },
            },
          ],
          egress: {
            updatePolicy: {
              mode: 'updateInThread',
              debounceMs: 1500,
            },
          },
        },
      };

      expect(resource.kind).toBe('Connector');
      expect(resource.spec.type).toBe('slack');
      expect(resource.spec.auth?.oauthAppRef?.name).toBe('slack-bot');
    });

    it('CLI Connector 리소스를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: {
          name: 'cli',
        },
        spec: {
          type: 'cli',
          ingress: [
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.instanceKey',
                inputFrom: '$.text',
              },
            },
          ],
        },
      };

      expect(resource.kind).toBe('Connector');
      expect(resource.spec.type).toBe('cli');
    });

    it('Custom Connector 리소스를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: {
          name: 'custom-webhook',
        },
        spec: {
          type: 'custom',
          runtime: 'node',
          entry: './connectors/webhook/index.js',
          triggers: [{ handler: 'onWebhook' }, { handler: 'onCron' }],
          ingress: [
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.payload.id',
                inputFrom: '$.payload.message',
              },
            },
          ],
        },
      };

      expect(resource.kind).toBe('Connector');
      expect(resource.spec.type).toBe('custom');
      expect(resource.spec.triggers?.length).toBe(2);
    });
  });
});
