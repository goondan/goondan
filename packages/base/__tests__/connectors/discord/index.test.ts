/**
 * Discord Connector 테스트 (v1.0)
 *
 * @see /packages/base/src/connectors/discord/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import discordConnector, {
  sendMessage,
  editMessage,
  getErrorMessage,
} from '../../../src/connectors/discord/index.js';
import type {
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEvent,
  Resource,
  ConnectionSpec,
  ConnectorSpec,
  JsonObject,
} from '@goondan/core';

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

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

/**
 * HTTP trigger를 통해 Discord 페이로드를 포함하는 ConnectorTriggerEvent 생성
 */
function createHttpTriggerEvent(
  body: JsonObject,
  headers: Record<string, string> = {},
  rawBody?: string,
): ConnectorTriggerEvent {
  return {
    type: 'connector.trigger',
    trigger: {
      type: 'http',
      payload: {
        request: {
          method: 'POST',
          path: '/webhook/discord',
          headers,
          body,
          rawBody,
        },
      },
    },
    timestamp: new Date().toISOString(),
  };
}

function createDiscordSignedRequest(body: JsonObject): {
  headers: Record<string, string>;
  signingSecret: string;
  rawBody: string;
} {
  const rawBody = JSON.stringify(body);
  const timestamp = '1700000000';
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`, 'utf8'), privateKey);
  const exportedPublicKey = publicKey.export({
    format: 'der',
    type: 'spki',
  });

  if (!Buffer.isBuffer(exportedPublicKey)) {
    throw new Error('Invalid public key export');
  }

  const signingSecret = exportedPublicKey.subarray(
    exportedPublicKey.length - 32,
  ).toString('hex');

  return {
    headers: {
      'x-signature-timestamp': timestamp,
      'x-signature-ed25519': signature.toString('hex'),
    },
    signingSecret,
    rawBody,
  };
}

function createMockConnectorContext(
  event: ConnectorTriggerEvent,
  emittedEvents: ConnectorEvent[] = [],
): ConnectorContext {
  const mockLogger = createMockLogger();
  return {
    event,
    emit: vi.fn().mockImplementation((e: ConnectorEvent) => {
      emittedEvents.push(e);
      return Promise.resolve();
    }),
    logger: mockLogger as unknown as Console,
    connection: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connection',
      metadata: { name: 'discord-connection' },
      spec: {
        connectorRef: { kind: 'Connector', name: 'discord' },
      },
    } as Resource<ConnectionSpec>,
    connector: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connector',
      metadata: { name: 'discord' },
      spec: {
        runtime: 'node',
        entry: './connectors/discord/index.js',
        triggers: [{ type: 'http', endpoint: '/webhook/discord' }],
        events: [{ name: 'discord.message' }],
      },
    } as Resource<ConnectorSpec>,
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
  }> = {},
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

  describe('discordConnector (default export)', () => {
    it('should be a function', () => {
      expect(typeof discordConnector).toBe('function');
    });

    describe('서명 검증', () => {
      it('유효한 서명 헤더가 있으면 emit을 수행해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          username: 'alice',
          channelId: 'C001',
          guildId: 'G001',
          content: 'hello',
        });
        const signedRequest = createDiscordSignedRequest(payload);
        const event = createHttpTriggerEvent(
          payload,
          signedRequest.headers,
          signedRequest.rawBody,
        );
        const ctx = createMockConnectorContext(event, emittedEvents);
        ctx.verify = {
          webhook: { signingSecret: signedRequest.signingSecret },
        };

        await discordConnector(ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
      });

      it('서명이 유효하지 않으면 emit을 중단해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          username: 'alice',
          channelId: 'C001',
          guildId: 'G001',
          content: 'hello',
        });
        const event = createHttpTriggerEvent(
          payload,
          {
            'x-signature-timestamp': '1700000000',
            'x-signature-ed25519': '0'.repeat(128),
          },
          JSON.stringify(payload),
        );
        const ctx = createMockConnectorContext(event, emittedEvents);
        ctx.verify = {
          webhook: { signingSecret: 'discord-secret' },
        };

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Discord] Signature verification failed');
      });
    });

    describe('페이로드 파싱', () => {
      it('유효한 MESSAGE_CREATE 이벤트를 파싱하고 ConnectorEvent를 발행해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          username: 'alice',
          channelId: 'C001',
          guildId: 'G001',
          content: 'Test message',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
        expect(emittedEvents.length).toBe(1);

        const emitted = emittedEvents[0];
        expect(emitted.type).toBe('connector.event');
        expect(emitted.name).toBe('discord.message');
        expect(emitted.message).toEqual({ type: 'text', text: 'Test message' });
      });

      it('global_name이 있으면 auth.actor.name에 사용해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          username: 'alice',
          globalName: 'Alice Wonderland',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        const auth = emittedEvents[0].auth;
        expect(auth?.actor.name).toBe('Alice Wonderland');
      });

      it('global_name이 없으면 username을 name에 사용해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          username: 'alice',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        const auth = emittedEvents[0].auth;
        expect(auth?.actor.name).toBe('alice');
      });
    });

    describe('봇 메시지 무시 로직', () => {
      it('bot 메시지는 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({ isBot: true });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(emittedEvents.length).toBe(0);
        expect(ctx.logger.debug).toHaveBeenCalledWith('[Discord] Ignoring bot message');
      });
    });

    describe('빈 메시지 처리', () => {
      it('빈 메시지 내용은 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({ content: '' });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith('[Discord] Empty message content, skipping');
      });

      it('공백만 있는 메시지도 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({ content: '   ' });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
      });
    });

    describe('유효하지 않은 페이로드 처리', () => {
      it('빈 페이로드는 경고 로그를 남기고 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const event = createHttpTriggerEvent({});
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Discord] Invalid payload received');
      });

      it('MESSAGE_CREATE가 아닌 이벤트는 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
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
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          '[Discord] Ignoring event type: MESSAGE_UPDATE',
        );
      });

      it('d가 없는 MESSAGE_CREATE는 경고해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = { t: 'MESSAGE_CREATE' };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Discord] No message data in payload');
      });
    });

    describe('Auth 정보 생성', () => {
      it('올바른 actor 정보를 생성해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          username: 'alice',
          guildId: 'G001',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        const auth = emittedEvents[0].auth;
        expect(auth?.actor.id).toBe('discord:U001');
      });

      it('서버 메시지일 때 올바른 subjects를 생성해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          guildId: 'G001',
          channelId: 'C001',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        const auth = emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('discord:guild:G001');
        expect(auth?.subjects.user).toBe('discord:user:U001');
      });

      it('DM 메시지일 때 올바른 subjects를 생성해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          userId: 'U001',
          channelId: 'DM001',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        const auth = emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('discord:dm:DM001');
        expect(auth?.subjects.user).toBe('discord:user:U001');
      });
    });

    describe('Properties 정보 생성', () => {
      it('기본 properties 필드가 포함되어야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createDiscordMessagePayload({
          messageId: 'msg-001',
          channelId: 'C001',
          guildId: 'G001',
          userId: 'U001',
          username: 'alice',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        const props = emittedEvents[0].properties;
        expect(props?.['channelId']).toBe('C001');
        expect(props?.['messageId']).toBe('msg-001');
        expect(props?.['userId']).toBe('U001');
        expect(props?.['username']).toBe('alice');
        expect(props?.['guildId']).toBe('G001');
      });
    });

    describe('non-trigger 이벤트 무시', () => {
      it('connector.trigger가 아닌 이벤트는 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const event = {
          type: 'other',
          trigger: { type: 'http', payload: { request: { method: 'POST', path: '/', headers: {}, body: {} } } },
          timestamp: new Date().toISOString(),
        } as unknown as ConnectorTriggerEvent;
        const ctx = createMockConnectorContext(event, emittedEvents);

        await discordConnector(ctx);

        expect(emittedEvents).toHaveLength(0);
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
        }),
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
        }),
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
