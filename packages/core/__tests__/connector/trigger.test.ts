/**
 * TriggerHandler 실행 테스트
 * @see /docs/specs/connector.md - 6. Trigger Handler 시스템, 7. Trigger Execution Model
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TriggerExecutor,
  createTriggerContext,
  loadTriggerModule,
  validateTriggerHandlers,
} from '../../src/connector/trigger.js';
import type {
  TriggerHandler,
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
} from '../../src/connector/types.js';
import type { Resource, ConnectorSpec, JsonObject } from '../../src/types/index.js';

describe('TriggerHandler 실행', () => {
  describe('TriggerExecutor 클래스', () => {
    it('handler를 등록하고 실행할 수 있다', async () => {
      const emitted: CanonicalEvent[] = [];
      const executor = new TriggerExecutor({
        onEmit: async (event) => {
          emitted.push(event);
        },
        logger: console,
      });

      const handler: TriggerHandler = async (event, connection, ctx) => {
        await ctx.emit({
          type: event.type,
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKey: String(event.payload['id'] ?? 'default'),
          input: String(event.payload['message'] ?? ''),
        });
      };

      executor.registerHandler('onWebhook', handler);

      const triggerEvent: TriggerEvent = {
        type: 'webhook',
        payload: { id: 'req-1', message: 'test' },
        timestamp: new Date().toISOString(),
      };

      await executor.execute('onWebhook', triggerEvent, {});

      expect(emitted.length).toBe(1);
      expect(emitted[0]?.instanceKey).toBe('req-1');
    });

    it('등록되지 않은 handler 실행 시 에러를 던진다', async () => {
      const executor = new TriggerExecutor({
        onEmit: async () => {},
        logger: console,
      });

      const triggerEvent: TriggerEvent = {
        type: 'webhook',
        payload: {},
        timestamp: new Date().toISOString(),
      };

      await expect(executor.execute('nonexistent', triggerEvent, {})).rejects.toThrow(
        'Handler not found: nonexistent'
      );
    });

    it('여러 handler를 등록할 수 있다', async () => {
      const executor = new TriggerExecutor({
        onEmit: async () => {},
        logger: console,
      });

      const onWebhook: TriggerHandler = async () => {};
      const onCron: TriggerHandler = async () => {};

      executor.registerHandler('onWebhook', onWebhook);
      executor.registerHandler('onCron', onCron);

      expect(executor.hasHandler('onWebhook')).toBe(true);
      expect(executor.hasHandler('onCron')).toBe(true);
      expect(executor.hasHandler('onQueue')).toBe(false);
    });

    it('handler 실행 중 에러가 발생하면 전파한다', async () => {
      const executor = new TriggerExecutor({
        onEmit: async () => {},
        logger: console,
      });

      const failingHandler: TriggerHandler = async () => {
        throw new Error('Handler error');
      };

      executor.registerHandler('failing', failingHandler);

      const triggerEvent: TriggerEvent = {
        type: 'test',
        payload: {},
        timestamp: new Date().toISOString(),
      };

      await expect(executor.execute('failing', triggerEvent, {})).rejects.toThrow(
        'Handler error'
      );
    });
  });

  describe('createTriggerContext 함수', () => {
    it('TriggerContext를 생성한다', () => {
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test-connector' },
        spec: { type: 'custom' },
      };

      const ctx = createTriggerContext({
        connector,
        onEmit: async () => {},
        logger: console,
      });

      expect(ctx.emit).toBeDefined();
      expect(ctx.logger).toBeDefined();
      expect(ctx.connector).toBe(connector);
    });

    it('emit 호출 시 onEmit 콜백이 실행된다', async () => {
      const emitted: CanonicalEvent[] = [];
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test-connector' },
        spec: { type: 'custom' },
      };

      const ctx = createTriggerContext({
        connector,
        onEmit: async (event) => {
          emitted.push(event);
        },
        logger: console,
      });

      await ctx.emit({
        type: 'test',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-1',
        input: 'hello',
      });

      expect(emitted.length).toBe(1);
      expect(emitted[0]?.type).toBe('test');
    });

    it('oauth 옵션이 제공되면 ctx.oauth가 설정된다', async () => {
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack-connector' },
        spec: { type: 'slack' },
      };

      const ctx = createTriggerContext({
        connector,
        onEmit: async () => {},
        logger: console,
        oauth: {
          getAccessToken: async (request) => ({
            accessToken: 'xoxb-token',
            expiresAt: Date.now() + 3600000,
          }),
        },
      });

      expect(ctx.oauth).toBeDefined();
      const result = await ctx.oauth?.getAccessToken({ subject: 'slack:team:T123' });
      expect(result?.accessToken).toBe('xoxb-token');
    });

    it('liveConfig 옵션이 제공되면 ctx.liveConfig가 설정된다', async () => {
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'test-connector' },
        spec: { type: 'custom' },
      };

      const patches: unknown[] = [];
      const ctx = createTriggerContext({
        connector,
        onEmit: async () => {},
        logger: console,
        liveConfig: {
          proposePatch: async (patch) => {
            patches.push(patch);
          },
        },
      });

      expect(ctx.liveConfig).toBeDefined();
      await ctx.liveConfig?.proposePatch({
        resourceRef: 'Agent/coder',
        patch: { maxTokens: 2000 },
      });
      expect(patches.length).toBe(1);
    });
  });

  describe('loadTriggerModule 함수', () => {
    it('모듈에서 handler를 로드한다', async () => {
      // 모듈 모킹
      const mockModule = {
        onWebhook: async (
          event: TriggerEvent,
          connection: JsonObject,
          ctx: TriggerContext
        ) => {},
        onCron: async (
          event: TriggerEvent,
          connection: JsonObject,
          ctx: TriggerContext
        ) => {},
      };

      const handlers = loadTriggerModule(mockModule, ['onWebhook', 'onCron']);

      expect(handlers.size).toBe(2);
      expect(handlers.has('onWebhook')).toBe(true);
      expect(handlers.has('onCron')).toBe(true);
    });

    it('handler가 함수가 아니면 에러를 던진다', () => {
      const mockModule = {
        onWebhook: 'not a function',
      };

      expect(() => loadTriggerModule(mockModule, ['onWebhook'])).toThrow(
        'Handler is not a function: onWebhook'
      );
    });

    it('handler가 존재하지 않으면 에러를 던진다', () => {
      const mockModule = {
        onWebhook: async () => {},
      };

      expect(() => loadTriggerModule(mockModule, ['onWebhook', 'onCron'])).toThrow(
        'Handler not exported: onCron'
      );
    });
  });

  describe('validateTriggerHandlers 함수', () => {
    it('모든 handler가 존재하면 성공한다', () => {
      const module = {
        onWebhook: async () => {},
        onCron: async () => {},
      };
      const triggers = [{ handler: 'onWebhook' }, { handler: 'onCron' }];

      const result = validateTriggerHandlers(module, triggers);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('누락된 handler를 보고한다', () => {
      const module = {
        onWebhook: async () => {},
      };
      const triggers = [{ handler: 'onWebhook' }, { handler: 'onCron' }];

      const result = validateTriggerHandlers(module, triggers);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Handler not exported: onCron');
    });

    it('함수가 아닌 export를 보고한다', () => {
      const module = {
        onWebhook: async () => {},
        onCron: 'not a function',
      };
      const triggers = [{ handler: 'onWebhook' }, { handler: 'onCron' }];

      const result = validateTriggerHandlers(module, triggers);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Handler is not a function: onCron');
    });

    it('triggers가 비어있으면 성공한다', () => {
      const module = {};
      const triggers: { handler: string }[] = [];

      const result = validateTriggerHandlers(module, triggers);

      expect(result.valid).toBe(true);
    });
  });

  describe('TriggerExecutor connection 파라미터', () => {
    it('connection 객체를 handler에 전달한다', async () => {
      let receivedConnection: JsonObject | null = null;

      const executor = new TriggerExecutor({
        onEmit: async () => {},
        logger: console,
      });

      const handler: TriggerHandler = async (event, connection, ctx) => {
        receivedConnection = connection;
      };

      executor.registerHandler('onWebhook', handler);

      const connection: JsonObject = {
        apiKey: 'secret-key',
        baseUrl: 'https://api.example.com',
      };

      await executor.execute(
        'onWebhook',
        { type: 'webhook', payload: {}, timestamp: new Date().toISOString() },
        connection
      );

      expect(receivedConnection).toEqual(connection);
    });
  });

  describe('TriggerContext.connector 접근', () => {
    it('handler에서 connector 설정에 접근할 수 있다', async () => {
      let connectorName: string | undefined;

      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'my-webhook' },
        spec: {
          type: 'custom',
          ingress: [
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.id',
                inputFrom: '$.message',
              },
            },
          ],
        },
      };

      const executor = new TriggerExecutor({
        onEmit: async () => {},
        logger: console,
        connector,
      });

      const handler: TriggerHandler = async (event, connection, ctx) => {
        connectorName = ctx.connector.metadata.name;
      };

      executor.registerHandler('onWebhook', handler);

      await executor.execute(
        'onWebhook',
        { type: 'webhook', payload: {}, timestamp: new Date().toISOString() },
        {}
      );

      expect(connectorName).toBe('my-webhook');
    });
  });
});
