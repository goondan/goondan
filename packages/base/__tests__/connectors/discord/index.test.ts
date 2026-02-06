/**
 * Discord Connector 테스트
 *
 * @see /packages/base/src/connectors/discord/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  onDiscordMessage,
  sendMessage,
  editMessage,
  getErrorMessage,
} from '../../../src/connectors/discord/index.js';
import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
} from '@goondan/core/connector';
import type { ConnectorSpec, IngressRule, Resource, JsonObject } from '@goondan/core';

// ============================================================================
// Mock 타입 정의
// ============================================================================

interface MockLogger {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  log: Mock;
}

interface MockTriggerContext {
  emit: Mock;
  logger: MockLogger;
  connector: Resource<ConnectorSpec>;
}

// ============================================================================
// Mock Helpers
// ============================================================================

function createDefaultIngressRules(): IngressRule[] {
  return [
    {
      match: { eventType: 'MESSAGE_CREATE' },
      route: {
        swarmRef: { name: 'test-swarm' },
      },
    },
  ];
}

function createMockConnector(
  ingress?: IngressRule[]
): Resource<ConnectorSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name: 'discord-connector' },
    spec: {
      type: 'discord',
      runtime: 'node',
      entry: './connectors/discord/index.js',
      ingress: ingress ?? createDefaultIngressRules(),
      triggers: [{ handler: 'onDiscordMessage' }],
    },
  };
}

function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createMockContext(
  connector?: Resource<ConnectorSpec>,
  emittedEvents?: CanonicalEvent[]
): MockTriggerContext & { emittedEvents: CanonicalEvent[] } {
  const events: CanonicalEvent[] = emittedEvents ?? [];
  return {
    emit: vi.fn().mockImplementation((event: CanonicalEvent) => {
      events.push(event);
      return Promise.resolve();
    }),
    logger: createMockLogger(),
    connector: connector ?? createMockConnector(),
    emittedEvents: events,
  };
}

function createMockTriggerEvent(payload: JsonObject): TriggerEvent {
  return {
    type: 'webhook',
    payload,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Discord MESSAGE_CREATE 이벤트 페이로드 생성
 */
function createDiscordMessagePayload(
  overrides: Partial<{
    messageId: string;
    channelId: string;
    guildId: string;
    userId: string;
    username: string;
    globalName: string;
    content: string;
    isBot: boolean;
    timestamp: string;
    mentions: Array<{ id: string; username: string; bot?: boolean }>;
    referencedMessage: JsonObject;
  }> = {}
): JsonObject {
  const author: JsonObject = {
    id: overrides.userId ?? '111222333',
    username: overrides.username ?? 'testuser',
  };

  if (overrides.isBot !== undefined) {
    author['bot'] = overrides.isBot;
  }

  if (overrides.globalName !== undefined) {
    author['global_name'] = overrides.globalName;
  }

  const d: JsonObject = {
    id: overrides.messageId ?? 'msg-001',
    channel_id: overrides.channelId ?? 'ch-001',
    author,
    content: overrides.content ?? 'Hello, Discord!',
    timestamp: overrides.timestamp ?? '2024-01-01T00:00:00.000Z',
  };

  if (overrides.guildId !== undefined) {
    d['guild_id'] = overrides.guildId;
  }

  if (overrides.mentions !== undefined) {
    d['mentions'] = overrides.mentions;
  }

  if (overrides.referencedMessage !== undefined) {
    d['referenced_message'] = overrides.referencedMessage;
  }

  return {
    t: 'MESSAGE_CREATE',
    d,
  };
}

// ============================================================================
// Fetch Mock
// ============================================================================

let originalFetch: typeof global.fetch;

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<JsonObject>;
  text: () => Promise<string>;
  headers: Headers;
}

function createMockFetchResponse(body: JsonObject, ok = true): MockResponse {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? 'OK' : 'Bad Request',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Discord Connector', () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('onDiscordMessage Trigger Handler', () => {
    describe('페이로드 파싱', () => {
      it('유효한 MESSAGE_CREATE 이벤트를 파싱하고 canonical event를 발행해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          username: 'alice',
          channelId: 'C001',
          guildId: 'G001',
          content: 'Test message',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
        expect(ctx.emittedEvents.length).toBe(1);

        const emitted = ctx.emittedEvents[0];
        expect(emitted.type).toBe('MESSAGE_CREATE');
        expect(emitted.input).toBe('Test message');
        expect(emitted.instanceKey).toBe('discord:G001:C001');
      });

      it('guild_id가 없으면 DM instanceKey를 사용해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          channelId: 'DM001',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        expect(ctx.emittedEvents[0].instanceKey).toBe('discord:dm:DM001');
      });

      it('global_name이 있으면 actor.display에 사용해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          username: 'alice',
          globalName: 'Alice Wonderland',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.actor.display).toBe('Alice Wonderland');
      });

      it('global_name이 없으면 username을 display에 사용해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          username: 'alice',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.actor.display).toBe('alice');
      });

      it('mentions가 있으면 metadata에 mentionCount를 포함해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          mentions: [
            { id: 'U001', username: 'bob' },
            { id: 'U002', username: 'charlie' },
          ],
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        expect(ctx.emittedEvents[0].metadata?.['mentionCount']).toBe(2);
      });

      it('referenced_message가 있으면 metadata에 isReply를 포함해야 함', async () => {
        const ctx = createMockContext();
        const referencedMessage: JsonObject = {
          id: 'ref-msg-001',
          channel_id: 'ch-001',
          author: { id: 'U999', username: 'original-author' },
          content: 'Original message',
          timestamp: '2024-01-01T00:00:00.000Z',
        };
        const payload = createDiscordMessagePayload({
          referencedMessage,
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        expect(ctx.emittedEvents[0].metadata?.['isReply']).toBe(true);
        expect(ctx.emittedEvents[0].metadata?.['referencedMessageId']).toBe('ref-msg-001');
      });
    });

    describe('봇 메시지 무시 로직', () => {
      it('bot 메시지는 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          isBot: true,
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.emittedEvents.length).toBe(0);
        expect(ctx.logger.debug).toHaveBeenCalledWith('[Discord] Ignoring bot message');
      });
    });

    describe('빈 메시지 처리', () => {
      it('빈 메시지 내용은 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          content: '',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith('[Discord] Empty message content, skipping');
      });

      it('공백만 있는 메시지도 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          content: '   ',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
      });
    });

    describe('유효하지 않은 페이로드 처리', () => {
      it('빈 페이로드는 경고 로그를 남기고 무시해야 함', async () => {
        const ctx = createMockContext();
        const event = createMockTriggerEvent({});

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Discord] Invalid payload received');
      });

      it('MESSAGE_CREATE가 아닌 이벤트는 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload: JsonObject = {
          t: 'MESSAGE_UPDATE',
          d: {
            id: 'msg-001',
            channel_id: 'ch-001',
            author: { id: 'U001', username: 'test' },
            content: 'Updated',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        };
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          '[Discord] Ignoring event type: MESSAGE_UPDATE'
        );
      });

      it('d가 없는 MESSAGE_CREATE는 경고해야 함', async () => {
        const ctx = createMockContext();
        const payload: JsonObject = {
          t: 'MESSAGE_CREATE',
        };
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Discord] No message data in payload');
      });
    });

    describe('TurnAuth 생성', () => {
      it('올바른 actor 정보를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          username: 'alice',
          guildId: 'G001',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.actor.type).toBe('user');
        expect(auth?.actor.id).toBe('discord:U001');
      });

      it('서버 메시지일 때 올바른 subjects를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          guildId: 'G001',
          channelId: 'C001',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('discord:guild:G001');
        expect(auth?.subjects.user).toBe('discord:user:U001');
      });

      it('DM 메시지일 때 올바른 subjects를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          channelId: 'DM001',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('discord:dm:DM001');
        expect(auth?.subjects.user).toBe('discord:user:U001');
      });
    });

    describe('Origin 정보 생성', () => {
      it('기본 origin 필드가 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createDiscordMessagePayload({
          messageId: 'msg-001',
          channelId: 'C001',
          guildId: 'G001',
          userId: 'U001',
          username: 'alice',
        });
        const event = createMockTriggerEvent(payload);

        await onDiscordMessage(event, {}, ctx);

        const origin = ctx.emittedEvents[0].origin;
        expect(origin?.['connector']).toBe('discord-connector');
        expect(origin?.['channelId']).toBe('C001');
        expect(origin?.['messageId']).toBe('msg-001');
        expect(origin?.['userId']).toBe('U001');
        expect(origin?.['username']).toBe('alice');
        expect(origin?.['guildId']).toBe('G001');
      });
    });

    describe('Ingress 규칙 매칭', () => {
      it('channel 매칭이 적용되어야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              match: { channel: 'C-specific' },
              route: { swarmRef: { name: 'specific-swarm' } },
            },
            {
              route: { swarmRef: { name: 'default-swarm' } },
            },
          ])
        );
        const payload = createDiscordMessagePayload({ channelId: 'C-specific' });
        await onDiscordMessage(createMockTriggerEvent(payload), {}, ctx);
        expect(ctx.emittedEvents[0].swarmRef).toEqual({ name: 'specific-swarm' });
      });

      it('매칭되지 않는 channel은 다음 규칙으로 넘어가야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              match: { channel: 'C-specific' },
              route: { swarmRef: { name: 'specific-swarm' } },
            },
            {
              route: { swarmRef: { name: 'default-swarm' } },
            },
          ])
        );
        const payload = createDiscordMessagePayload({ channelId: 'C-other' });
        await onDiscordMessage(createMockTriggerEvent(payload), {}, ctx);
        expect(ctx.emittedEvents[0].swarmRef).toEqual({ name: 'default-swarm' });
      });

      it('매칭되는 ingress 규칙이 없으면 debug 로그를 남겨야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              match: { channel: 'C-specific' },
              route: { swarmRef: { name: 'specific-swarm' } },
            },
          ])
        );
        const payload = createDiscordMessagePayload({ channelId: 'C-other' });
        await onDiscordMessage(createMockTriggerEvent(payload), {}, ctx);
        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          '[Discord] No matching ingress rule for message'
        );
      });

      it('agentName이 지정되면 포함해야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              route: {
                swarmRef: { name: 'test-swarm' },
                agentName: 'responder',
              },
            },
          ])
        );
        const payload = createDiscordMessagePayload();
        await onDiscordMessage(createMockTriggerEvent(payload), {}, ctx);
        expect(ctx.emittedEvents[0].agentName).toBe('responder');
      });

      it('swarmRef가 없는 route는 경고하고 건너뛰어야 함', async () => {
        const invalidIngressJson = JSON.stringify([
          {
            match: { eventType: 'MESSAGE_CREATE' },
            route: {},
          },
        ]);
        const invalidIngress: IngressRule[] = JSON.parse(invalidIngressJson);

        const ctx = createMockContext(createMockConnector(invalidIngress));
        const payload = createDiscordMessagePayload();
        await onDiscordMessage(createMockTriggerEvent(payload), {}, ctx);

        expect(ctx.logger.warn).toHaveBeenCalledWith('[Discord] No swarmRef in route');
      });
    });
  });

  describe('sendMessage API 함수', () => {
    it('성공적인 메시지 전송시 ok: true를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        id: 'msg-new-001',
        content: 'Hello',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await sendMessage('bot-token', 'ch-001', 'Hello');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://discord.com/api/v10/channels/ch-001/messages',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bot bot-token',
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result.ok).toBe(true);
      expect(result.id).toBe('msg-new-001');
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        message: 'Missing Access',
        code: 50001,
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await sendMessage('bot-token', 'invalid', 'Hello');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Missing Access');
    });

    it('네트워크 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await sendMessage('bot-token', 'ch-001', 'Hello');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('유효하지 않은 응답 형식 시 에러를 반환해야 함', async () => {
      const invalidMockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve('invalid'),
        text: () => Promise.resolve('invalid'),
        headers: new Headers(),
      };
      global.fetch = vi.fn().mockResolvedValue(invalidMockResponse);

      const result = await sendMessage('bot-token', 'ch-001', 'Hello');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid response format');
    });
  });

  describe('editMessage API 함수', () => {
    it('성공적인 메시지 수정시 ok: true를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        id: 'msg-001',
        content: 'Updated',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await editMessage('bot-token', 'ch-001', 'msg-001', 'Updated');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://discord.com/api/v10/channels/ch-001/messages/msg-001',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            Authorization: 'Bot bot-token',
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result.ok).toBe(true);
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        message: 'Unknown Message',
        code: 10008,
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await editMessage('bot-token', 'ch-001', 'invalid', 'text');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Unknown Message');
    });

    it('네트워크 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      const result = await editMessage('bot-token', 'ch-001', 'msg-001', 'text');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });
  });

  describe('getErrorMessage 함수', () => {
    it('알려진 에러 코드에 대해 설명을 반환해야 함', () => {
      expect(getErrorMessage(10003)).toBe('Unknown channel');
      expect(getErrorMessage(10008)).toBe('Unknown message');
      expect(getErrorMessage(50001)).toBe('Missing access');
      expect(getErrorMessage(50013)).toBe('Missing permissions');
      expect(getErrorMessage(50035)).toBe('Invalid form body');
      expect(getErrorMessage(40001)).toBe('Unauthorized');
      expect(getErrorMessage(40005)).toBe('Request entity too large');
      expect(getErrorMessage(429)).toBe('Rate limited');
    });

    it('알려지지 않은 에러 코드에 대해 기본 메시지를 반환해야 함', () => {
      expect(getErrorMessage(99999)).toBe('Unknown error code: 99999');
    });
  });
});
