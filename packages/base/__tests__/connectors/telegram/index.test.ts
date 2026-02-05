/**
 * Telegram Connector 테스트
 *
 * @see /packages/base/src/connectors/telegram/AGENTS.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  onUpdate,
  sendMessage,
  editMessage,
  deleteMessage,
  setWebhook,
  getWebhookInfo,
  deleteWebhook,
} from '../../../src/connectors/telegram/index.js';
import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  Resource,
  ConnectorSpec,
  JsonObject,
} from '@goondan/core';

// ============================================================================
// Mock 타입 정의
// ============================================================================

/**
 * 테스트용 Mock Logger 인터페이스
 * Console 인터페이스의 필수 메서드만 포함
 */
interface MockLogger {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  log: Mock;
}

/**
 * 테스트용 Mock TriggerContext
 * TriggerContext와 호환되지만 logger가 MockLogger 타입
 */
interface MockTriggerContext {
  emit: Mock;
  logger: MockLogger;
  connector: Resource<ConnectorSpec>;
}

// ============================================================================
// Mock 헬퍼
// ============================================================================

/**
 * TriggerEvent 생성 헬퍼
 */
function createMockTriggerEvent(payload: JsonObject): TriggerEvent {
  return {
    type: 'webhook',
    payload,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Connector 리소스 생성 헬퍼
 */
function createMockConnector(
  ingress: ConnectorSpec['ingress'] = []
): Resource<ConnectorSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name: 'telegram-test' },
    spec: {
      type: 'telegram',
      runtime: 'node',
      entry: './connectors/telegram/index.js',
      ingress,
      triggers: [{ handler: 'onUpdate' }],
    },
  };
}

/**
 * Mock Logger 생성 헬퍼
 */
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
 * TriggerContext 생성 헬퍼
 *
 * 반환 타입이 MockTriggerContext이지만, TriggerContext와 구조적으로 호환됩니다.
 * onUpdate 함수는 logger의 debug/info/warn/error 메서드만 사용하므로 테스트에서 안전합니다.
 */
function createMockTriggerContext(
  connector: Resource<ConnectorSpec>,
  emittedEvents: CanonicalEvent[] = []
): MockTriggerContext {
  return {
    emit: vi.fn().mockImplementation((event: CanonicalEvent) => {
      emittedEvents.push(event);
      return Promise.resolve();
    }),
    logger: createMockLogger(),
    connector,
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

/**
 * 객체가 Record<string, unknown>인지 확인하는 타입 가드
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * fetch body에서 파싱된 JSON 객체를 안전하게 추출하는 헬퍼
 */
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

/**
 * result가 Record<string, unknown>인지 확인하는 타입 가드
 */
function isRecordResult(
  result: JsonObject | undefined
): result is Record<string, unknown> {
  return result !== undefined && typeof result === 'object' && result !== null;
}

// ============================================================================
// 테스트
// ============================================================================

describe('Telegram Connector', () => {
  describe('onUpdate Trigger Handler', () => {
    it('should be defined', () => {
      expect(onUpdate).toBeDefined();
      expect(typeof onUpdate).toBe('function');
    });

    it('should skip invalid update payload', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ invalid: 'data' });

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        '[Telegram] Invalid update payload received'
      );
    });

    it('should skip update without message', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ update_id: 100 });

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[Telegram] No message in update, skipping'
      );
    });

    it('should skip message without text', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({});
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[Telegram] No text in message, skipping'
      );
    });

    it('should emit canonical event for matching ingress rule', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        chatId: 12345,
        userId: 111,
        username: 'testuser',
        firstName: 'Test',
        text: 'Hello, bot!',
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      const emitted = emittedEvents[0];
      expect(emitted.type).toBe('telegram_message');
      expect(emitted.instanceKey).toBe('12345');
      expect(emitted.input).toBe('Hello, bot!');
      expect(emitted.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
    });

    it('should route to specific agent when agentName is specified', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            agentName: 'coder',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({ text: 'Hello' });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].agentName).toBe('coder');
    });

    it('should include correct auth information', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        chatId: 12345,
        userId: 111,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        text: 'Hello',
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      const auth = emittedEvents[0].auth;
      expect(auth).toBeDefined();
      expect(auth?.actor.type).toBe('user');
      expect(auth?.actor.id).toBe('telegram:111');
      expect(auth?.actor.display).toBe('Test User');
      expect(auth?.subjects.global).toBe('telegram:chat:12345');
      expect(auth?.subjects.user).toBe('telegram:user:111');
    });

    it('should include correct origin information', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        messageId: 999,
        chatId: 12345,
        chatType: 'group',
        userId: 111,
        username: 'testuser',
        text: 'Hello',
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      const origin = emittedEvents[0].origin;
      expect(origin).toBeDefined();
      expect(origin?.['connector']).toBe('telegram-test');
      expect(origin?.['chatId']).toBe(12345);
      expect(origin?.['messageId']).toBe(999);
      expect(origin?.['chatType']).toBe('group');
      expect(origin?.['userId']).toBe(111);
      expect(origin?.['username']).toBe('testuser');
    });

    it('should handle edited_message', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({ text: 'Edited message' });
      const update: JsonObject = {
        update_id: 100,
        edited_message: message,
      };
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].input).toBe('Edited message');
    });
  });

  describe('Bot Command Parsing', () => {
    it('should match command in ingress rule', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/start' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'starter' },
          },
        },
        {
          match: { command: '/help' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'helper' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        text: '/start some argument',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].swarmRef).toEqual({ kind: 'Swarm', name: 'starter' });
      expect(emittedEvents[0].input).toBe('some argument');
    });

    it('should remove command with @botname', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/start' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        text: '/start@MyBot hello world',
        entities: [{ type: 'bot_command', offset: 0, length: 12 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].input).toBe('hello world');
    });

    it('should use default input for command-only message', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/start' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].input).toBe('안녕하세요! 무엇을 도와드릴까요?');
    });

    it('should use default input for /help command', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/help' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        text: '/help',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].input).toBe('도움말을 요청합니다.');
    });

    it('should skip message when command does not match', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/start' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        text: '/help please',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
    });

    it('should not extract command from non-zero offset', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/help' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      // 명령어가 메시지 시작이 아닌 위치에 있는 경우
      const message = createTelegramMessage({
        text: 'Please /help me',
        entities: [{ type: 'bot_command', offset: 7, length: 5 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      // 명령어 매칭 필요한 규칙만 있으므로 매칭 실패
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('Channel Matching', () => {
    it('should match specific channel ID', async () => {
      const connector = createMockConnector([
        {
          match: { channel: '12345' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'channel-specific' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        chatId: 12345,
        text: 'Hello',
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].swarmRef).toEqual({ kind: 'Swarm', name: 'channel-specific' });
    });

    it('should skip message from non-matching channel', async () => {
      const connector = createMockConnector([
        {
          match: { channel: '12345' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'channel-specific' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        chatId: 99999,
        text: 'Hello',
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('Ingress Rule Precedence', () => {
    it('should use first matching rule', async () => {
      const connector = createMockConnector([
        {
          match: { command: '/special' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'special' },
          },
        },
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      // 일반 메시지 - 두 번째 규칙 매칭
      const message1 = createTelegramMessage({ text: 'Hello' });
      const update1 = createTelegramUpdate(message1);
      const event1 = createMockTriggerEvent(update1);

      await onUpdate(event1, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
    });

    it('should skip rule with missing swarmRef', async () => {
      // swarmRef가 없는 route를 시뮬레이션하기 위해
      // connector의 spec.ingress를 직접 구성 (런타임 오류 상황 테스트)
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'telegram-test' },
        spec: {
          type: 'telegram',
          runtime: 'node',
          entry: './connectors/telegram/index.js',
          // ingress 배열을 any 타입으로 우회하지 않고, 유효한 구조 사용
          // 첫 번째 규칙은 swarmRef가 비어있는 경우를 시뮬레이션
          ingress: [
            {
              match: { command: '/test' },
              // 런타임에서 route.swarmRef가 undefined/null이 될 수 있음
              // 타입 시스템에서는 필수지만, 런타임 검증이 필요
              route: Object.create(null),
            },
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'fallback' },
              },
            },
          ],
          triggers: [{ handler: 'onUpdate' }],
        },
      };
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const message = createTelegramMessage({
        text: '/test hello',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      });
      const update = createTelegramUpdate(message);
      const event = createMockTriggerEvent(update);

      await onUpdate(event, {}, ctx);

      // 첫 번째 규칙은 swarmRef 없어서 스킵, 두 번째 규칙은 명령어 매칭 없으므로 통과
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].swarmRef).toEqual({ kind: 'Swarm', name: 'fallback' });
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
        })
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
        })
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
        })
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
        })
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
        })
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
        })
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
