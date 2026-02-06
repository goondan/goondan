/**
 * ConnectorAdapter 테스트
 * @see /docs/specs/connector.md - 8. ConnectorAdapter 인터페이스
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BaseConnectorAdapter,
  createConnectorAdapter,
} from '../../src/connector/adapter.js';
import type {
  ConnectorAdapter,
  ConnectorOptions,
  ConnectorSendInput,
  CanonicalEvent,
  RuntimeEventInput,
} from '../../src/connector/types.js';
import type { Resource, ConnectorSpec, ConnectionSpec, JsonObject } from '../../src/types/index.js';

describe('ConnectorAdapter', () => {
  describe('BaseConnectorAdapter 클래스', () => {
    it('handleEvent로 외부 이벤트를 처리한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test' },
        spec: {
          type: 'cli',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'test-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'test' },
          rules: [
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

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
      });

      await adapter.handleEvent({
        instanceKey: 'session-1',
        text: 'Hello, agent!',
      });

      expect(events.length).toBe(1);
      expect(events[0]?.instanceKey).toBe('session-1');
      expect(events[0]?.input).toBe('Hello, agent!');
    });

    it('match 조건에 맞는 규칙으로만 라우팅한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack' },
        spec: {
          type: 'slack',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack' },
          rules: [
            {
              match: { command: '/agent' },
              route: {
                swarmRef: { kind: 'Swarm', name: 'agent-swarm' },
                instanceKeyFrom: '$.thread_ts',
                inputFrom: '$.text',
              },
            },
            {
              match: { eventType: 'message' },
              route: {
                swarmRef: { kind: 'Swarm', name: 'chat-swarm' },
                instanceKeyFrom: '$.thread_ts',
                inputFrom: '$.text',
              },
            },
          ],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
      });

      // /agent 명령어
      await adapter.handleEvent({
        command: '/agent',
        text: 'do something',
        thread_ts: '123.456',
      });

      expect(events.length).toBe(1);
      expect(events[0]?.swarmRef).toEqual({ kind: 'Swarm', name: 'agent-swarm' });

      // 일반 message
      events.length = 0;
      await adapter.handleEvent({
        type: 'message',
        text: 'hello',
        thread_ts: '789.012',
      });

      expect(events.length).toBe(1);
      expect(events[0]?.swarmRef).toEqual({ kind: 'Swarm', name: 'chat-swarm' });
    });

    it('매칭되는 규칙이 없으면 이벤트를 무시한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack' },
        spec: {
          type: 'slack',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack' },
          rules: [
            {
              match: { command: '/specific' },
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
              },
            },
          ],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
      });

      await adapter.handleEvent({
        type: 'message',
        text: 'random',
      });

      expect(events.length).toBe(0);
    });

    it('origin 정보를 생성하여 전달한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack-main' },
        spec: {
          type: 'slack',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-main-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack-main' },
          rules: [
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.thread_ts',
                inputFrom: '$.text',
              },
            },
          ],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
        buildOrigin: (payload) => ({
          connector: 'slack-main',
          channel: String(payload['channel'] ?? ''),
          threadTs: String(payload['thread_ts'] ?? ''),
        }),
      });

      await adapter.handleEvent({
        thread_ts: '123.456',
        text: 'hello',
        channel: 'C123',
      });

      expect(events[0]?.origin).toEqual({
        connector: 'slack-main',
        channel: 'C123',
        threadTs: '123.456',
      });
    });

    it('auth 정보를 생성하여 전달한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack' },
        spec: {
          type: 'slack',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack' },
          rules: [
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.thread_ts',
                inputFrom: '$.text',
              },
            },
          ],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
        buildAuth: (payload) => ({
          actor: {
            type: 'user',
            id: `slack:${String(payload['user'] ?? '')}`,
          },
          subjects: {
            global: `slack:team:${String(payload['team_id'] ?? '')}`,
            user: `slack:user:${String(payload['team_id'] ?? '')}:${String(payload['user'] ?? '')}`,
          },
        }),
      });

      await adapter.handleEvent({
        thread_ts: '123',
        text: 'hi',
        user: 'U123',
        team_id: 'T456',
      });

      expect(events[0]?.auth?.actor.id).toBe('slack:U123');
      expect(events[0]?.auth?.subjects.global).toBe('slack:team:T456');
    });
  });

  describe('send 메서드', () => {
    it('send 메서드로 응답을 전송한다', async () => {
      const sentMessages: ConnectorSendInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test' },
        spec: {
          type: 'cli',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'test-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'test' },
          rules: [{ route: { swarmRef: { kind: 'Swarm', name: 'default' } } }],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: { handleEvent: async () => {} },
        connectorConfig,
        connectionConfig,
        sendImpl: async (input) => {
          sentMessages.push(input);
          return { ok: true };
        },
      });

      const result = await adapter.send?.({
        text: 'Response text',
        kind: 'final',
      });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]?.text).toBe('Response text');
      expect(result).toEqual({ ok: true });
    });

    it('sendImpl이 없으면 send가 undefined이다', () => {
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test' },
        spec: {
          type: 'webhook',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'test-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'test' },
          rules: [{ route: { swarmRef: { kind: 'Swarm', name: 'default' } } }],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: { handleEvent: async () => {} },
        connectorConfig,
        connectionConfig,
      });

      expect(adapter.send).toBeUndefined();
    });
  });

  describe('shutdown 메서드', () => {
    it('shutdown 메서드로 정리 작업을 수행한다', async () => {
      let shutdownCalled = false;
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test' },
        spec: {
          type: 'cli',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'test-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'test' },
          rules: [{ route: { swarmRef: { kind: 'Swarm', name: 'default' } } }],
        },
      };

      const adapter = new BaseConnectorAdapter({
        runtime: { handleEvent: async () => {} },
        connectorConfig,
        connectionConfig,
        shutdownImpl: async () => {
          shutdownCalled = true;
        },
      });

      await adapter.shutdown?.();

      expect(shutdownCalled).toBe(true);
    });
  });

  describe('createConnectorAdapter 팩토리 함수', () => {
    it('ConnectorAdapter를 생성한다', async () => {
      const events: RuntimeEventInput[] = [];
      const options: ConnectorOptions = {
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: {
            type: 'cli',
          },
        },
        connectionConfig: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'test' },
            rules: [
              {
                route: {
                  swarmRef: { kind: 'Swarm', name: 'default' },
                  instanceKeyFrom: '$.id',
                  inputFrom: '$.message',
                },
              },
            ],
          },
        },
      };

      const adapter = createConnectorAdapter(options);

      expect(adapter.handleEvent).toBeDefined();

      await adapter.handleEvent({ id: 'test-1', message: 'hello' });

      expect(events.length).toBe(1);
    });

    it('logger 옵션을 전달할 수 있다', async () => {
      const logMessages: string[] = [];
      const mockLogger = {
        ...console,
        debug: (msg: string) => logMessages.push(msg),
        info: (msg: string) => logMessages.push(msg),
      };

      const options: ConnectorOptions = {
        runtime: { handleEvent: async () => {} },
        connectorConfig: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: {
            type: 'cli',
          },
        },
        connectionConfig: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'test' },
            rules: [{ route: { swarmRef: { kind: 'Swarm', name: 'default' } } }],
          },
        },
        logger: mockLogger,
      };

      const adapter = createConnectorAdapter(options);
      expect(adapter).toBeDefined();
    });
  });

  describe('Slack Connector 시나리오', () => {
    it('Slack 이벤트를 올바르게 라우팅한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack-main' },
        spec: {
          type: 'slack',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'slack-main-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'slack-main' },
          auth: {
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
          },
          rules: [
            {
              match: { command: '/agent' },
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.event.thread_ts',
                inputFrom: '$.event.text',
              },
            },
            {
              match: { eventType: 'app_mention' },
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

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
        buildOrigin: (payload) => {
          const event = payload['event'];
          if (typeof event === 'object' && event !== null) {
            const e = event as JsonObject;
            return {
              connector: 'slack-main',
              channel: String(e['channel'] ?? ''),
              threadTs: String(e['thread_ts'] ?? ''),
              teamId: String(payload['team_id'] ?? ''),
              userId: String(e['user'] ?? ''),
            };
          }
          return { connector: 'slack-main' };
        },
        buildAuth: (payload) => {
          const event = payload['event'];
          const teamId = String(payload['team_id'] ?? '');
          let userId = '';
          if (typeof event === 'object' && event !== null) {
            userId = String((event as JsonObject)['user'] ?? '');
          }
          return {
            actor: {
              type: 'user',
              id: `slack:${userId}`,
            },
            subjects: {
              global: `slack:team:${teamId}`,
              user: `slack:user:${teamId}:${userId}`,
            },
          };
        },
      });

      // app_mention 이벤트
      await adapter.handleEvent({
        team_id: 'T111',
        event: {
          type: 'app_mention',
          thread_ts: '1700000000.000100',
          text: '<@U123BOT> hello agent',
          user: 'U234567',
          channel: 'C123456',
        },
      });

      expect(events.length).toBe(1);
      expect(events[0]?.instanceKey).toBe('1700000000.000100');
      expect(events[0]?.input).toBe('<@U123BOT> hello agent');
      expect(events[0]?.auth?.subjects.global).toBe('slack:team:T111');
    });
  });

  describe('CLI Connector 시나리오', () => {
    it('CLI 입력을 올바르게 라우팅한다', async () => {
      const events: RuntimeEventInput[] = [];
      const connectorConfig: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'cli' },
        spec: {
          type: 'cli',
        },
      };
      const connectionConfig: Resource<ConnectionSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connection',
        metadata: { name: 'cli-connection' },
        spec: {
          connectorRef: { kind: 'Connector', name: 'cli' },
          rules: [
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

      const adapter = new BaseConnectorAdapter({
        runtime: {
          handleEvent: async (event) => {
            events.push(event);
          },
        },
        connectorConfig,
        connectionConfig,
        buildOrigin: () => ({ connector: 'cli' }),
        buildAuth: () => ({
          actor: { type: 'cli', id: 'local-user' },
          subjects: { global: 'cli:local' },
        }),
      });

      await adapter.handleEvent({
        instanceKey: 'session-123',
        text: 'Run the analysis',
      });

      expect(events.length).toBe(1);
      expect(events[0]?.instanceKey).toBe('session-123');
      expect(events[0]?.input).toBe('Run the analysis');
      expect(events[0]?.origin).toEqual({ connector: 'cli' });
      expect(events[0]?.auth?.actor.type).toBe('cli');
    });
  });
});
