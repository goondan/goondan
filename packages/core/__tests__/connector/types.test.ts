/**
 * Connector 시스템 타입 테스트
 * @see /docs/specs/connector.md
 */
import { describe, it, expect } from 'vitest';
import type {
  ConnectorAdapter,
  ConnectorSendInput,
  ConnectorOptions,
  ConnectorFactory,
  TriggerHandler,
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  TurnAuth,
  RuntimeEventInput,
} from '../../src/connector/types.js';
import type { JsonObject, Resource, ConnectorSpec } from '../../src/types/index.js';

describe('Connector 시스템 타입', () => {
  describe('ConnectorAdapter 인터페이스', () => {
    it('handleEvent 메서드는 필수이다', async () => {
      const adapter: ConnectorAdapter = {
        handleEvent: async (_payload: JsonObject): Promise<void> => {
          // no-op
        },
      };

      expect(adapter.handleEvent).toBeDefined();
      await expect(adapter.handleEvent({ text: 'hello' })).resolves.toBeUndefined();
    });

    it('send 메서드는 선택적이다', async () => {
      const adapter: ConnectorAdapter = {
        handleEvent: async (_payload: JsonObject): Promise<void> => {
          // no-op
        },
        send: async (input: ConnectorSendInput): Promise<unknown> => {
          return { ok: true, text: input.text };
        },
      };

      expect(adapter.send).toBeDefined();
      const result = await adapter.send?.({ text: 'response' });
      expect(result).toEqual({ ok: true, text: 'response' });
    });

    it('shutdown 메서드는 선택적이다', async () => {
      const adapter: ConnectorAdapter = {
        handleEvent: async (_payload: JsonObject): Promise<void> => {
          // no-op
        },
        shutdown: async (): Promise<void> => {
          // cleanup
        },
      };

      expect(adapter.shutdown).toBeDefined();
      await expect(adapter.shutdown?.()).resolves.toBeUndefined();
    });
  });

  describe('ConnectorSendInput 인터페이스', () => {
    it('text는 필수이다', () => {
      const input: ConnectorSendInput = {
        text: 'Hello, world!',
      };

      expect(input.text).toBe('Hello, world!');
    });

    it('origin, auth, metadata, kind는 선택적이다', () => {
      const input: ConnectorSendInput = {
        text: 'Response',
        origin: { channel: 'C123', threadTs: '123.456' },
        auth: { token: 'xoxb-xxx' },
        metadata: { requestId: 'req-123' },
        kind: 'progress',
      };

      expect(input.text).toBe('Response');
      expect(input.origin).toEqual({ channel: 'C123', threadTs: '123.456' });
      expect(input.auth).toEqual({ token: 'xoxb-xxx' });
      expect(input.metadata).toEqual({ requestId: 'req-123' });
      expect(input.kind).toBe('progress');
    });

    it('kind는 progress 또는 final이다', () => {
      const progressInput: ConnectorSendInput = {
        text: 'Processing...',
        kind: 'progress',
      };

      const finalInput: ConnectorSendInput = {
        text: 'Done!',
        kind: 'final',
      };

      expect(progressInput.kind).toBe('progress');
      expect(finalInput.kind).toBe('final');
    });
  });

  describe('TriggerEvent 인터페이스', () => {
    it('type, payload, timestamp는 필수이다', () => {
      const event: TriggerEvent = {
        type: 'webhook',
        payload: { body: { message: 'hello' } },
        timestamp: '2024-01-01T00:00:00Z',
      };

      expect(event.type).toBe('webhook');
      expect(event.payload).toEqual({ body: { message: 'hello' } });
      expect(event.timestamp).toBe('2024-01-01T00:00:00Z');
    });

    it('metadata는 선택적이다', () => {
      const event: TriggerEvent = {
        type: 'cron',
        payload: { scheduleName: 'daily' },
        timestamp: '2024-01-01T00:00:00Z',
        metadata: { source: 'scheduler' },
      };

      expect(event.metadata).toEqual({ source: 'scheduler' });
    });

    it('다양한 이벤트 타입을 지원한다', () => {
      const types = ['webhook', 'cron', 'queue', 'message'];

      for (const type of types) {
        const event: TriggerEvent = {
          type,
          payload: {},
          timestamp: new Date().toISOString(),
        };
        expect(event.type).toBe(type);
      }
    });
  });

  describe('TriggerContext 인터페이스', () => {
    it('emit과 logger는 필수이다', async () => {
      const emittedEvents: CanonicalEvent[] = [];

      const ctx: TriggerContext = {
        emit: async (event: CanonicalEvent): Promise<void> => {
          emittedEvents.push(event);
        },
        logger: console,
        connector: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: { type: 'custom' },
        },
      };

      expect(ctx.emit).toBeDefined();
      expect(ctx.logger).toBeDefined();
      expect(ctx.connector).toBeDefined();

      await ctx.emit({
        type: 'test',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'test-1',
        input: 'hello',
      });

      expect(emittedEvents.length).toBe(1);
    });

    it('oauth는 OAuthApp 기반 모드에서 사용 가능하다', async () => {
      const ctx: TriggerContext = {
        emit: async (_event: CanonicalEvent): Promise<void> => {},
        logger: console,
        connector: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: { type: 'slack' },
        },
        oauth: {
          getAccessToken: async (_request) => ({
            accessToken: 'xoxb-xxx',
            expiresAt: Date.now() + 3600000,
          }),
        },
      };

      expect(ctx.oauth).toBeDefined();
      const result = await ctx.oauth?.getAccessToken({ subject: 'slack:team:T123' });
      expect(result?.accessToken).toBe('xoxb-xxx');
    });

    it('liveConfig는 선택적이다', async () => {
      const ctx: TriggerContext = {
        emit: async (_event: CanonicalEvent): Promise<void> => {},
        logger: console,
        connector: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: { type: 'custom' },
        },
        liveConfig: {
          proposePatch: async (_patch) => {},
        },
      };

      expect(ctx.liveConfig).toBeDefined();
      await expect(
        ctx.liveConfig?.proposePatch({ resourceRef: 'Agent/coder', patch: { maxTokens: 2000 } })
      ).resolves.toBeUndefined();
    });
  });

  describe('CanonicalEvent 인터페이스', () => {
    it('type, swarmRef, instanceKey, input은 필수이다', () => {
      const event: CanonicalEvent = {
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'thread-123',
        input: 'Hello, agent!',
      };

      expect(event.type).toBe('message');
      expect(event.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
      expect(event.instanceKey).toBe('thread-123');
      expect(event.input).toBe('Hello, agent!');
    });

    it('agentName, origin, auth, metadata는 선택적이다', () => {
      const event: CanonicalEvent = {
        type: 'webhook',
        swarmRef: 'Swarm/default',
        instanceKey: 'req-456',
        input: 'Process this',
        agentName: 'planner',
        origin: { connector: 'slack', channel: 'C123' },
        auth: {
          actor: { type: 'user', id: 'U123' },
          subjects: { global: 'slack:team:T111' },
        },
        metadata: { priority: 'high' },
      };

      expect(event.agentName).toBe('planner');
      expect(event.origin).toEqual({ connector: 'slack', channel: 'C123' });
      expect(event.auth?.actor.id).toBe('U123');
      expect(event.metadata).toEqual({ priority: 'high' });
    });

    it('swarmRef는 문자열 또는 ObjectRef를 지원한다', () => {
      const stringRef: CanonicalEvent = {
        type: 'test',
        swarmRef: 'Swarm/my-swarm',
        instanceKey: 'key-1',
        input: 'text',
      };

      const objectRef: CanonicalEvent = {
        type: 'test',
        swarmRef: { kind: 'Swarm', name: 'my-swarm' },
        instanceKey: 'key-1',
        input: 'text',
      };

      expect(stringRef.swarmRef).toBe('Swarm/my-swarm');
      expect(objectRef.swarmRef).toEqual({ kind: 'Swarm', name: 'my-swarm' });
    });
  });

  describe('TurnAuth 인터페이스', () => {
    it('actor와 subjects로 인증 컨텍스트를 정의한다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'user',
          id: 'slack:U234567',
          display: 'alice',
        },
        subjects: {
          global: 'slack:team:T111',
          user: 'slack:user:T111:U234567',
        },
      };

      expect(auth.actor.type).toBe('user');
      expect(auth.actor.id).toBe('slack:U234567');
      expect(auth.actor.display).toBe('alice');
      expect(auth.subjects.global).toBe('slack:team:T111');
      expect(auth.subjects.user).toBe('slack:user:T111:U234567');
    });

    it('actor.display는 선택적이다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'system',
          id: 'scheduler',
        },
        subjects: {
          global: 'cron:default',
        },
      };

      expect(auth.actor.display).toBeUndefined();
    });

    it('subjects.user는 선택적이다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'system',
          id: 'webhook',
        },
        subjects: {
          global: 'webhook:default',
        },
      };

      expect(auth.subjects.user).toBeUndefined();
    });
  });

  describe('RuntimeEventInput 인터페이스', () => {
    it('CanonicalEvent를 Runtime에서 받을 형태로 정의한다', () => {
      const input: RuntimeEventInput = {
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'thread-123',
        input: 'Hello!',
        agentName: 'assistant',
        origin: { connector: 'cli' },
        auth: {
          actor: { type: 'cli', id: 'local-user' },
          subjects: { global: 'cli:local' },
        },
      };

      expect(input.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
      expect(input.instanceKey).toBe('thread-123');
      expect(input.input).toBe('Hello!');
    });
  });

  describe('ConnectorFactory 타입', () => {
    it('ConnectorAdapter를 생성하는 팩토리 함수이다', () => {
      const factory: ConnectorFactory = (options: ConnectorOptions): ConnectorAdapter => {
        return {
          handleEvent: async (payload: JsonObject): Promise<void> => {
            // 처리
          },
          send: async (input: ConnectorSendInput): Promise<unknown> => {
            return { ok: true };
          },
        };
      };

      const options: ConnectorOptions = {
        runtime: {
          handleEvent: async (_event) => {},
        },
        connectorConfig: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: { type: 'cli' },
        },
      };

      const adapter = factory(options);
      expect(adapter.handleEvent).toBeDefined();
      expect(adapter.send).toBeDefined();
    });
  });

  describe('TriggerHandler 타입', () => {
    it('TriggerEvent를 받아 처리하는 함수이다', async () => {
      const handler: TriggerHandler = async (
        event: TriggerEvent,
        connection: JsonObject,
        ctx: TriggerContext
      ): Promise<void> => {
        await ctx.emit({
          type: event.type,
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKey: String(event.payload['requestId'] ?? 'default'),
          input: String(event.payload['message'] ?? ''),
        });
      };

      const emitted: CanonicalEvent[] = [];
      const ctx: TriggerContext = {
        emit: async (event) => { emitted.push(event); },
        logger: console,
        connector: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test' },
          spec: { type: 'custom' },
        },
      };

      await handler(
        {
          type: 'webhook',
          payload: { requestId: 'req-1', message: 'test message' },
          timestamp: new Date().toISOString(),
        },
        {},
        ctx
      );

      expect(emitted.length).toBe(1);
      expect(emitted[0]?.input).toBe('test message');
    });
  });
});
