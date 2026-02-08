/**
 * Connector 시스템 타입 테스트 (v1.0)
 * @see /docs/specs/connector.md
 */
import { describe, it, expect } from 'vitest';
import type {
  ConnectorEvent,
  ConnectorEventMessage,
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEntryFunction,
  TriggerPayload,
  OAuthTokenRequest,
  OAuthTokenResult,
} from '../../src/connector/types.js';
import type { Resource, ConnectorSpec, ConnectionSpec } from '../../src/types/index.js';

/** v1.0 ConnectorSpec fixture */
function makeConnectorResource(name: string): Resource<ConnectorSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name },
    spec: { runtime: 'node', entry: './index.ts', triggers: [{ type: 'cli' }] },
  };
}

/** v1.0 ConnectionSpec fixture */
function makeConnectionResource(name: string, connectorName: string): Resource<ConnectionSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connection',
    metadata: { name },
    spec: { connectorRef: { kind: 'Connector', name: connectorName } },
  };
}

/** v1.0 ConnectorTriggerEvent fixture */
function makeCliTriggerEvent(): ConnectorTriggerEvent {
  return {
    type: 'connector.trigger',
    trigger: { type: 'cli', payload: { text: 'hello' } },
    timestamp: new Date().toISOString(),
  };
}

describe('Connector 시스템 타입 (v1.0)', () => {
  describe('ConnectorEventMessage 타입', () => {
    it('text 메시지를 지원한다', () => {
      const msg: ConnectorEventMessage = { type: 'text', text: 'hello' };
      expect(msg.type).toBe('text');
      expect(msg.text).toBe('hello');
    });

    it('image 메시지를 지원한다', () => {
      const msg: ConnectorEventMessage = { type: 'image', image: 'data:image/png;base64,abc' };
      expect(msg.type).toBe('image');
      expect(msg.image).toBe('data:image/png;base64,abc');
    });

    it('file 메시지를 지원한다', () => {
      const msg: ConnectorEventMessage = {
        type: 'file',
        data: 'base64data',
        mediaType: 'application/pdf',
      };
      expect(msg.type).toBe('file');
      expect(msg.data).toBe('base64data');
      expect(msg.mediaType).toBe('application/pdf');
    });
  });

  describe('ConnectorEvent 인터페이스', () => {
    it('type은 connector.event 고정이다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'user_message',
        message: { type: 'text', text: 'hello' },
      };

      expect(event.type).toBe('connector.event');
      expect(event.name).toBe('user_message');
      expect(event.message).toEqual({ type: 'text', text: 'hello' });
    });

    it('properties와 auth는 선택적이다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'webhook_received',
        message: { type: 'text', text: 'payload' },
        properties: { channel: 'C123', threadTs: '123.456' },
        auth: {
          actor: { id: 'U123', name: 'alice' },
          subjects: { global: 'slack:team:T111', user: 'slack:user:T111:U123' },
        },
      };

      expect(event.properties).toEqual({ channel: 'C123', threadTs: '123.456' });
      expect(event.auth?.actor.id).toBe('U123');
      expect(event.auth?.actor.name).toBe('alice');
      expect(event.auth?.subjects.global).toBe('slack:team:T111');
    });

    it('auth.actor.name은 선택적이다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'system_event',
        message: { type: 'text', text: 'ping' },
        auth: {
          actor: { id: 'system' },
          subjects: { global: 'cron:default' },
        },
      };

      expect(event.auth?.actor.name).toBeUndefined();
    });
  });

  describe('ConnectorTriggerEvent 인터페이스', () => {
    it('type은 connector.trigger 고정이다', () => {
      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger: { type: 'cli', payload: { text: 'hello' } },
        timestamp: '2024-01-01T00:00:00Z',
      };

      expect(event.type).toBe('connector.trigger');
      expect(event.trigger.type).toBe('cli');
      expect(event.timestamp).toBe('2024-01-01T00:00:00Z');
    });

    it('http trigger payload를 지원한다', () => {
      const trigger: TriggerPayload = {
        type: 'http',
        payload: {
          request: {
            method: 'POST',
            path: '/webhook',
            headers: { 'content-type': 'application/json' },
            body: { message: 'hello' },
          },
        },
      };

      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger,
        timestamp: new Date().toISOString(),
      };

      expect(event.trigger.type).toBe('http');
    });

    it('cron trigger payload를 지원한다', () => {
      const trigger: TriggerPayload = {
        type: 'cron',
        payload: { schedule: '0 * * * *', scheduledAt: '2024-01-01T00:00:00Z' },
      };

      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger,
        timestamp: new Date().toISOString(),
      };

      expect(event.trigger.type).toBe('cron');
    });

    it('cli trigger payload를 지원한다', () => {
      const trigger: TriggerPayload = {
        type: 'cli',
        payload: { text: 'hello', instanceKey: 'session-1' },
      };

      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger,
        timestamp: new Date().toISOString(),
      };

      expect(event.trigger.type).toBe('cli');
    });
  });

  describe('ConnectorContext 인터페이스', () => {
    it('event, connection, connector, emit, logger는 필수이다', async () => {
      const emittedEvents: ConnectorEvent[] = [];

      const ctx: ConnectorContext = {
        event: makeCliTriggerEvent(),
        connector: makeConnectorResource('test'),
        connection: makeConnectionResource('test-conn', 'test'),
        emit: async (event: ConnectorEvent): Promise<void> => {
          emittedEvents.push(event);
        },
        logger: console,
      };

      expect(ctx.event).toBeDefined();
      expect(ctx.emit).toBeDefined();
      expect(ctx.logger).toBeDefined();
      expect(ctx.connector).toBeDefined();
      expect(ctx.connection).toBeDefined();

      await ctx.emit({
        type: 'connector.event',
        name: 'user_input',
        message: { type: 'text', text: 'hello' },
      });

      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0]?.name).toBe('user_input');
    });

    it('oauth는 OAuthApp 기반 모드에서 사용 가능하다', async () => {
      const ctx: ConnectorContext = {
        event: makeCliTriggerEvent(),
        connector: makeConnectorResource('slack'),
        connection: makeConnectionResource('slack-conn', 'slack'),
        emit: async (_event: ConnectorEvent): Promise<void> => {},
        logger: console,
        oauth: {
          getAccessToken: async (_request: OAuthTokenRequest): Promise<OAuthTokenResult> => ({
            accessToken: 'xoxb-xxx',
            expiresAt: Date.now() + 3600000,
          }),
        },
      };

      expect(ctx.oauth).toBeDefined();
      const result = await ctx.oauth?.getAccessToken({ subject: 'slack:team:T123' });
      expect(result?.accessToken).toBe('xoxb-xxx');
    });

    it('verify는 서명 검증 시크릿을 제공한다', () => {
      const ctx: ConnectorContext = {
        event: makeCliTriggerEvent(),
        connector: makeConnectorResource('github'),
        connection: makeConnectionResource('github-conn', 'github'),
        emit: async (_event: ConnectorEvent): Promise<void> => {},
        logger: console,
        verify: {
          webhook: {
            signingSecret: 'whsec_test123',
          },
        },
      };

      expect(ctx.verify?.webhook?.signingSecret).toBe('whsec_test123');
    });
  });

  describe('ConnectorEntryFunction 타입', () => {
    it('ConnectorContext를 받아 처리하는 단일 default export 함수이다', async () => {
      const emitted: ConnectorEvent[] = [];

      const entryFn: ConnectorEntryFunction = async (ctx: ConnectorContext): Promise<void> => {
        await ctx.emit({
          type: 'connector.event',
          name: 'user_message',
          message: { type: 'text', text: 'processed' },
          properties: { source: ctx.connector.metadata.name },
        });
      };

      const ctx: ConnectorContext = {
        event: makeCliTriggerEvent(),
        connector: makeConnectorResource('test'),
        connection: makeConnectionResource('test-conn', 'test'),
        emit: async (event) => {
          emitted.push(event);
        },
        logger: console,
      };

      await entryFn(ctx);

      expect(emitted.length).toBe(1);
      expect(emitted[0]?.name).toBe('user_message');
      expect(emitted[0]?.properties).toEqual({ source: 'test' });
    });
  });
});
