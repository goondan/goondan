/**
 * Connector Entry Function 로딩/실행 테스트 (v1.0)
 * @see /docs/specs/connector.md - 5. Entry Function 실행 모델
 */
import { describe, it, expect } from 'vitest';
import {
  createConnectorContext,
  loadConnectorEntry,
  validateConnectorEntry,
} from '../../src/connector/trigger.js';
import type {
  ConnectorEvent,
  ConnectorContext,
  ConnectorTriggerEvent,
} from '../../src/connector/types.js';
import type { Resource, ConnectorSpec, ConnectionSpec } from '../../src/types/index.js';

function createTestConnector(): Resource<ConnectorSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name: 'test-connector' },
    spec: {
      runtime: 'node',
      entry: './connectors/test/index.ts',
      triggers: [{ type: 'cli' }],
      events: [{ name: 'user_input' }],
    },
  };
}

function createTestConnection(): Resource<ConnectionSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connection',
    metadata: { name: 'test-conn' },
    spec: {
      connectorRef: { kind: 'Connector', name: 'test-connector' },
      ingress: {
        rules: [{ route: {} }],
      },
    },
  };
}

function createTestTriggerEvent(): ConnectorTriggerEvent {
  return {
    type: 'connector.trigger',
    trigger: {
      type: 'cli',
      payload: {
        text: 'hello world',
      },
    },
    timestamp: new Date().toISOString(),
  };
}

describe('Connector Entry Function (v1.0)', () => {
  describe('createConnectorContext', () => {
    it('ConnectorContext를 생성한다', () => {
      const connector = createTestConnector();
      const connection = createTestConnection();
      const event = createTestTriggerEvent();

      const ctx = createConnectorContext({
        connector,
        connection,
        event,
        onEmit: async () => {},
        logger: console,
      });

      expect(ctx.event).toBe(event);
      expect(ctx.connector).toBe(connector);
      expect(ctx.connection).toBe(connection);
      expect(ctx.emit).toBeDefined();
      expect(ctx.logger).toBeDefined();
    });

    it('emit 호출 시 onEmit 콜백이 실행된다', async () => {
      const emitted: ConnectorEvent[] = [];

      const ctx = createConnectorContext({
        connector: createTestConnector(),
        connection: createTestConnection(),
        event: createTestTriggerEvent(),
        onEmit: async (event) => {
          emitted.push(event);
        },
        logger: console,
      });

      await ctx.emit({
        type: 'connector.event',
        name: 'user_input',
        message: { type: 'text', text: 'hello' },
      });

      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.name).toBe('user_input');
    });

    it('oauth 옵션이 제공되면 ctx.oauth가 설정된다', async () => {
      const ctx = createConnectorContext({
        connector: createTestConnector(),
        connection: createTestConnection(),
        event: createTestTriggerEvent(),
        onEmit: async () => {},
        logger: console,
        oauth: {
          getAccessToken: async () => ({
            accessToken: 'xoxb-token',
            expiresAt: Date.now() + 3600000,
          }),
        },
      });

      expect(ctx.oauth).toBeDefined();
      const result = await ctx.oauth?.getAccessToken({ subject: 'slack:team:T123' });
      expect(result?.accessToken).toBe('xoxb-token');
    });

    it('verify 옵션이 제공되면 ctx.verify가 설정된다', () => {
      const ctx = createConnectorContext({
        connector: createTestConnector(),
        connection: createTestConnection(),
        event: createTestTriggerEvent(),
        onEmit: async () => {},
        logger: console,
        verify: {
          webhook: {
            signingSecret: 'test-secret-value',
          },
        },
      });

      expect(ctx.verify).toBeDefined();
      expect(ctx.verify?.webhook?.signingSecret).toBe('test-secret-value');
    });

    it('oauth와 verify가 없으면 undefined이다', () => {
      const ctx = createConnectorContext({
        connector: createTestConnector(),
        connection: createTestConnection(),
        event: createTestTriggerEvent(),
        onEmit: async () => {},
        logger: console,
      });

      expect(ctx.oauth).toBeUndefined();
      expect(ctx.verify).toBeUndefined();
    });
  });

  describe('loadConnectorEntry', () => {
    it('모듈에서 default export 함수를 로드한다', () => {
      const mockModule = {
        default: async (ctx: ConnectorContext) => {
          await ctx.emit({
            type: 'connector.event',
            name: 'user_input',
            message: { type: 'text', text: 'loaded' },
          });
        },
      };

      const entry = loadConnectorEntry(mockModule);
      expect(typeof entry).toBe('function');
    });

    it('로드된 함수가 실행 가능하다', async () => {
      const emitted: ConnectorEvent[] = [];

      const mockModule = {
        default: async (ctx: ConnectorContext) => {
          await ctx.emit({
            type: 'connector.event',
            name: 'test',
            message: { type: 'text', text: 'from entry' },
          });
        },
      };

      const entry = loadConnectorEntry(mockModule);

      const ctx = createConnectorContext({
        connector: createTestConnector(),
        connection: createTestConnection(),
        event: createTestTriggerEvent(),
        onEmit: async (event) => { emitted.push(event); },
        logger: console,
      });

      await entry(ctx);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.message).toEqual({ type: 'text', text: 'from entry' });
    });

    it('default export가 없으면 에러를 던진다', () => {
      const mockModule = {
        namedExport: async () => {},
      };

      expect(() => loadConnectorEntry(mockModule)).toThrow(
        'Connector entry module must have a default export'
      );
    });

    it('default export가 함수가 아니면 에러를 던진다', () => {
      const mockModule = {
        default: 'not a function',
      };

      expect(() => loadConnectorEntry(mockModule)).toThrow(
        'Connector entry default export must be a function'
      );
    });
  });

  describe('validateConnectorEntry', () => {
    it('유효한 모듈이면 성공한다', () => {
      const module = {
        default: async () => {},
      };

      const result = validateConnectorEntry(module);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('default export가 없으면 실패한다', () => {
      const module = {
        namedExport: async () => {},
      };

      const result = validateConnectorEntry(module);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('default export not found');
    });

    it('default export가 함수가 아니면 실패한다', () => {
      const module = {
        default: 42,
      };

      const result = validateConnectorEntry(module);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('default export is not a function');
    });

    it('빈 모듈이면 실패한다', () => {
      const module = {};

      const result = validateConnectorEntry(module);

      expect(result.valid).toBe(false);
    });
  });

  describe('ConnectorTriggerEvent 타입 시스템', () => {
    it('HTTP trigger event를 생성할 수 있다', () => {
      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger: {
          type: 'http',
          payload: {
            request: {
              method: 'POST',
              path: '/webhook/slack/events',
              headers: { 'content-type': 'application/json' },
              body: { type: 'event_callback', event: { type: 'app_mention' } },
              rawBody: '{"type":"event_callback"}',
            },
          },
        },
        timestamp: '2026-02-08T00:00:00Z',
      };

      expect(event.trigger.type).toBe('http');
    });

    it('Cron trigger event를 생성할 수 있다', () => {
      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger: {
          type: 'cron',
          payload: {
            schedule: '0 9 * * MON-FRI',
            scheduledAt: '2026-02-08T09:00:00Z',
          },
        },
        timestamp: '2026-02-08T09:00:00Z',
      };

      expect(event.trigger.type).toBe('cron');
    });

    it('CLI trigger event를 생성할 수 있다', () => {
      const event: ConnectorTriggerEvent = {
        type: 'connector.trigger',
        trigger: {
          type: 'cli',
          payload: {
            text: 'hello agent',
            instanceKey: 'session-1',
          },
        },
        timestamp: '2026-02-08T00:00:00Z',
      };

      expect(event.trigger.type).toBe('cli');
      expect(event.trigger.payload.text).toBe('hello agent');
    });
  });

  describe('ConnectorEvent 타입 시스템', () => {
    it('텍스트 메시지 이벤트를 생성할 수 있다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'app_mention',
        message: { type: 'text', text: '<@U123> hello' },
        properties: { channel_id: 'C123', ts: '123.456' },
        auth: {
          actor: { id: 'slack:U234567' },
          subjects: {
            global: 'slack:team:T111',
            user: 'slack:user:T111:U234567',
          },
        },
      };

      expect(event.type).toBe('connector.event');
      expect(event.name).toBe('app_mention');
      expect(event.message.type).toBe('text');
    });

    it('이미지 메시지 이벤트를 생성할 수 있다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'image_upload',
        message: { type: 'image', image: 'base64-encoded-data' },
      };

      expect(event.message.type).toBe('image');
    });

    it('파일 메시지 이벤트를 생성할 수 있다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'file_upload',
        message: { type: 'file', data: 'base64-file-data', mediaType: 'application/pdf' },
      };

      expect(event.message.type).toBe('file');
    });

    it('properties와 auth는 선택적이다', () => {
      const event: ConnectorEvent = {
        type: 'connector.event',
        name: 'simple_event',
        message: { type: 'text', text: 'hello' },
      };

      expect(event.properties).toBeUndefined();
      expect(event.auth).toBeUndefined();
    });
  });
});
