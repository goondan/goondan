/**
 * Telegram Connector 테스트 (v1.0)
 *
 * @see /packages/base/src/connectors/telegram/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import telegramConnector, {
  sendMessage,
  editMessage,
  deleteMessage,
  setWebhook,
  getWebhookInfo,
  deleteWebhook,
} from '../../../src/connectors/telegram/index.js';
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
// Mock 헬퍼
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
 * HTTP trigger를 통해 Telegram Update를 포함하는 ConnectorTriggerEvent 생성
 */
function createHttpTriggerEvent(
  body: JsonObject,
  headers: Record<string, string> = {},
): ConnectorTriggerEvent {
  return {
    type: 'connector.trigger',
    trigger: {
      type: 'http',
      payload: {
        request: {
          method: 'POST',
          path: '/webhook/telegram',
          headers,
          body,
        },
      },
    },
    timestamp: new Date().toISOString(),
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
      metadata: { name: 'telegram-connection' },
      spec: {
        connectorRef: { kind: 'Connector', name: 'telegram' },
      },
    } as Resource<ConnectionSpec>,
    connector: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connector',
      metadata: { name: 'telegram' },
      spec: {
        runtime: 'node',
        entry: './connectors/telegram/index.js',
        triggers: [{ type: 'http', endpoint: '/webhook/telegram' }],
        events: [{ name: 'telegram.message' }],
      },
    } as Resource<ConnectorSpec>,
  };
}

/**
 * Telegram 메시지 생성 헬퍼
 */
function createTelegramMessage(options: {
  messageId?: number;
  chatId?: number;
  chatType?: 'private' | 'group' | 'supergroup' | 'channel';
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
}): JsonObject {
  const message: JsonObject = {
    message_id: options.messageId ?? 1,
    chat: {
      id: options.chatId ?? 12345,
      type: options.chatType ?? 'private',
    },
    date: Math.floor(Date.now() / 1000),
  };

  if (options.userId !== undefined || options.username !== undefined) {
    const from: JsonObject = {
      id: options.userId ?? 111,
      is_bot: false,
      first_name: options.firstName ?? 'Test',
    };
    if (options.lastName) {
      from['last_name'] = options.lastName;
    }
    if (options.username) {
      from['username'] = options.username;
    }
    message['from'] = from;
  }

  if (options.text !== undefined) {
    message['text'] = options.text;
  }

  if (options.entities) {
    message['entities'] = options.entities;
  }

  return message;
}

/**
 * Telegram Update 생성 헬퍼
 */
function createTelegramUpdate(message: JsonObject): JsonObject {
  return {
    update_id: 100,
    message,
  };
}

// ============================================================================
// Fetch Mock 유틸
// ============================================================================

interface MockFetchResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
}

function createMockFetch(responses: MockFetchResponse[]): typeof fetch {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const response = responses[callIndex] ?? { ok: false, description: 'No mock response' };
    callIndex++;
    return Promise.resolve({
      json: () => Promise.resolve(response),
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFetchBody(fetchMock: Mock): Record<string, unknown> {
  const calls = fetchMock.mock.calls;
  if (calls.length === 0) {
    return {};
  }
  const lastCall: unknown = calls[calls.length - 1];
  if (!Array.isArray(lastCall) || lastCall.length < 2) {
    return {};
  }
  const options: unknown = lastCall[1];
  if (!isRecord(options)) {
    return {};
  }
  const body: unknown = options['body'];
  if (typeof body !== 'string') {
    return {};
  }
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) {
    return {};
  }
  return parsed;
}

function isRecordResult(
  result: JsonObject | undefined,
): result is Record<string, unknown> {
  return result !== undefined && typeof result === 'object' && result !== null;
}

// ============================================================================
// 테스트
// ============================================================================

describe('Telegram Connector', () => {
  describe('telegramConnector (default export)', () => {
    it('should be a function', () => {
      expect(typeof telegramConnector).toBe('function');
    });

    describe('서명 검증', () => {
      it('유효한 secret token 헤더가 있으면 emit을 수행해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const message = createTelegramMessage({
          text: 'hello',
          userId: 111,
        });
        const update = createTelegramUpdate(message);
        const event = createHttpTriggerEvent(update, {
          'x-telegram-bot-api-secret-token': 'telegram-secret',
        });
        const ctx = createMockConnectorContext(event, emittedEvents);
        ctx.verify = {
          webhook: { signingSecret: 'telegram-secret' },
        };

        await telegramConnector(ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
      });

      it('secret token이 일치하지 않으면 emit을 중단해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const message = createTelegramMessage({
          text: 'hello',
          userId: 111,
        });
        const update = createTelegramUpdate(message);
        const event = createHttpTriggerEvent(update, {
          'x-telegram-bot-api-secret-token': 'invalid-token',
        });
        const ctx = createMockConnectorContext(event, emittedEvents);
        ctx.verify = {
          webhook: { signingSecret: 'telegram-secret' },
        };

        await telegramConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Telegram] Signature verification failed');
      });
    });

    it('should skip invalid update payload', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createHttpTriggerEvent({ invalid: 'data' });
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        '[Telegram] Invalid update payload received',
      );
    });

    it('should skip update without message', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createHttpTriggerEvent({ update_id: 100 });
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[Telegram] No message in update, skipping',
      );
    });

    it('should skip message without text', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({});
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[Telegram] No text in message, skipping',
      );
    });

    it('should emit ConnectorEvent for valid message', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        chatId: 12345,
        userId: 111,
        username: 'testuser',
        firstName: 'Test',
        text: 'Hello, bot!',
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      const emitted = emittedEvents[0];
      expect(emitted.type).toBe('connector.event');
      expect(emitted.name).toBe('telegram.message');
      expect(emitted.message).toEqual({ type: 'text', text: 'Hello, bot!' });
    });

    it('should include correct auth information', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        chatId: 12345,
        userId: 111,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        text: 'Hello',
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      const auth = emittedEvents[0].auth;
      expect(auth).toBeDefined();
      expect(auth?.actor.id).toBe('telegram:111');
      expect(auth?.actor.name).toBe('Test User');
      expect(auth?.subjects.global).toBe('telegram:chat:12345');
      expect(auth?.subjects.user).toBe('telegram:user:111');
    });

    it('should include correct properties information', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        messageId: 999,
        chatId: 12345,
        chatType: 'group',
        userId: 111,
        username: 'testuser',
        text: 'Hello',
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      const props = emittedEvents[0].properties;
      expect(props).toBeDefined();
      expect(props?.['chatId']).toBe('12345');
      expect(props?.['userId']).toBe('111');
      expect(props?.['chatType']).toBe('group');
      expect(props?.['messageId']).toBe(999);
    });

    it('should handle edited_message', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({ text: 'Edited message' });
      const update: JsonObject = {
        update_id: 100,
        edited_message: message,
      };
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].message).toEqual({ type: 'text', text: 'Edited message' });
    });

    it('should not emit for non-trigger events', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = {
        type: 'other',
        trigger: { type: 'http', payload: { request: { method: 'POST', path: '/', headers: {}, body: {} } } },
        timestamp: new Date().toISOString(),
      } as unknown as ConnectorTriggerEvent;
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('Bot Command Parsing', () => {
    it('should extract command text and remove command prefix', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        text: '/start some argument',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].message).toEqual({ type: 'text', text: 'some argument' });
    });

    it('should remove command with @botname', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        text: '/start@MyBot hello world',
        entities: [{ type: 'bot_command', offset: 0, length: 12 }],
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].message).toEqual({ type: 'text', text: 'hello world' });
    });

    it('should use default input for /start command-only message', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].message.type).toBe('text');
      if (emittedEvents[0].message.type === 'text') {
        expect(emittedEvents[0].message.text).toContain('도와드릴까요');
      }
    });

    it('should use default input for /help command', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const message = createTelegramMessage({
        text: '/help',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      });
      const update = createTelegramUpdate(message);
      const event = createHttpTriggerEvent(update);
      const ctx = createMockConnectorContext(event, emittedEvents);

      await telegramConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].message.type).toBe('text');
      if (emittedEvents[0].message.type === 'text') {
        expect(emittedEvents[0].message.text).toContain('도움말');
      }
    });
  });
});

describe('Telegram API Functions', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, result: { message_id: 123 } },
      ]);

      const result = await sendMessage('test-token', 12345, 'Hello!');

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ message_id: 123 });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should send message with options', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, result: { message_id: 123 } },
      ]);

      const result = await sendMessage('test-token', 12345, 'Hello!', {
        replyToMessageId: 100,
        parseMode: 'HTML',
        disableNotification: true,
      });

      expect(result.ok).toBe(true);

      const body = parseFetchBody(vi.mocked(globalThis.fetch));

      expect(body['reply_to_message_id']).toBe(100);
      expect(body['parse_mode']).toBe('HTML');
      expect(body['disable_notification']).toBe(true);
    });

    it('should handle API error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, description: 'Bad Request: chat not found' },
      ]);

      const result = await sendMessage('test-token', 99999, 'Hello!');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Bad Request: chat not found');
    });

    it('should handle network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await sendMessage('test-token', 12345, 'Hello!');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('editMessage', () => {
    it('should edit message successfully', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, result: { message_id: 123 } },
      ]);

      const result = await editMessage('test-token', 12345, 123, 'Updated text');

      expect(result.ok).toBe(true);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/editMessageText',
        expect.objectContaining({
          method: 'POST',
        }),
      );

      const body = parseFetchBody(vi.mocked(globalThis.fetch));

      expect(body['chat_id']).toBe(12345);
      expect(body['message_id']).toBe(123);
      expect(body['text']).toBe('Updated text');
    });

    it('should edit message with parseMode', async () => {
      globalThis.fetch = createMockFetch([
        { ok: true, result: { message_id: 123 } },
      ]);

      const result = await editMessage('test-token', 12345, 123, '<b>Bold</b>', {
        parseMode: 'HTML',
      });

      expect(result.ok).toBe(true);

      const body = parseFetchBody(vi.mocked(globalThis.fetch));

      expect(body['parse_mode']).toBe('HTML');
    });

    it('should handle edit error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, description: 'Message to edit not found' },
      ]);

      const result = await editMessage('test-token', 12345, 999, 'Updated');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Message to edit not found');
    });
  });

  describe('deleteMessage', () => {
    it('should delete message successfully', async () => {
      globalThis.fetch = createMockFetch([{ ok: true, result: true }]);

      const result = await deleteMessage('test-token', 12345, 123);

      expect(result.ok).toBe(true);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/deleteMessage',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should handle delete error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, description: 'Message to delete not found' },
      ]);

      const result = await deleteMessage('test-token', 12345, 999);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Message to delete not found');
    });
  });

  describe('setWebhook', () => {
    it('should set webhook successfully', async () => {
      globalThis.fetch = createMockFetch([{ ok: true, result: true }]);

      const result = await setWebhook('test-token', 'https://example.com/webhook');

      expect(result.ok).toBe(true);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/setWebhook',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should set webhook with options', async () => {
      globalThis.fetch = createMockFetch([{ ok: true, result: true }]);

      const result = await setWebhook('test-token', 'https://example.com/webhook', {
        secretToken: 'secret123',
        maxConnections: 100,
        allowedUpdates: ['message', 'edited_message'],
      });

      expect(result.ok).toBe(true);

      const body = parseFetchBody(vi.mocked(globalThis.fetch));

      expect(body['url']).toBe('https://example.com/webhook');
      expect(body['secret_token']).toBe('secret123');
      expect(body['max_connections']).toBe(100);
      expect(body['allowed_updates']).toEqual(['message', 'edited_message']);
    });

    it('should handle setWebhook error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, description: 'Invalid URL' },
      ]);

      const result = await setWebhook('test-token', 'invalid-url');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid URL');
    });
  });

  describe('getWebhookInfo', () => {
    it('should get webhook info successfully', async () => {
      globalThis.fetch = createMockFetch([
        {
          ok: true,
          result: {
            url: 'https://example.com/webhook',
            has_custom_certificate: false,
            pending_update_count: 0,
          },
        },
      ]);

      const result = await getWebhookInfo('test-token');

      expect(result.ok).toBe(true);
      expect(result.result).toBeDefined();

      if (isRecordResult(result.result)) {
        expect(result.result['url']).toBe('https://example.com/webhook');
      }

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/getWebhookInfo',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should handle getWebhookInfo error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, description: 'Unauthorized' },
      ]);

      const result = await getWebhookInfo('invalid-token');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook successfully', async () => {
      globalThis.fetch = createMockFetch([{ ok: true, result: true }]);

      const result = await deleteWebhook('test-token');

      expect(result.ok).toBe(true);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/deleteWebhook',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should delete webhook with dropPendingUpdates', async () => {
      globalThis.fetch = createMockFetch([{ ok: true, result: true }]);

      const result = await deleteWebhook('test-token', true);

      expect(result.ok).toBe(true);

      const body = parseFetchBody(vi.mocked(globalThis.fetch));

      expect(body['drop_pending_updates']).toBe(true);
    });

    it('should handle deleteWebhook error', async () => {
      globalThis.fetch = createMockFetch([
        { ok: false, description: 'Internal error' },
      ]);

      const result = await deleteWebhook('test-token');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Internal error');
    });
  });
});
