/**
 * Slack Connector 테스트 (v1.0)
 *
 * @see /packages/base/src/connectors/slack/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createHmac } from 'node:crypto';
import slackConnector, {
  postMessage,
  updateMessage,
  getErrorMessage,
} from '../../../src/connectors/slack/index.js';
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
// Type Guards
// ============================================================================

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
 * HTTP trigger를 통해 Slack 페이로드를 포함하는 ConnectorTriggerEvent 생성
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
          path: '/webhook/slack',
          headers,
          body,
          rawBody,
        },
      },
    },
    timestamp: new Date().toISOString(),
  };
}

function createSlackSignatureHeaders(
  body: JsonObject,
  signingSecret: string,
  timestamp = '1700000000',
): Record<string, string> {
  const rawBody = JSON.stringify(body);
  const baseString = `v0:${timestamp}:${rawBody}`;
  const signature = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`;

  return {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': signature,
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
      metadata: { name: 'slack-connection' },
      spec: {
        connectorRef: { kind: 'Connector', name: 'slack' },
      },
    } as Resource<ConnectionSpec>,
    connector: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connector',
      metadata: { name: 'slack' },
      spec: {
        runtime: 'node',
        entry: './connectors/slack/index.js',
        triggers: [{ type: 'http', endpoint: '/webhook/slack' }],
        events: [{ name: 'slack.message' }],
      },
    } as Resource<ConnectorSpec>,
  };
}

/**
 * Slack message 이벤트 페이로드 생성
 */
function createSlackMessagePayload(
  overrides: Partial<{
    teamId: string;
    userId: string;
    channel: string;
    text: string;
    ts: string;
    threadTs: string;
    botId: string;
    subtype: string;
    eventId: string;
    eventTime: number;
    apiAppId: string;
  }> = {},
): JsonObject {
  const event: JsonObject = {
    type: 'message',
    user: overrides.userId ?? 'U123456',
    channel: overrides.channel ?? 'C123456',
    text: overrides.text ?? 'Hello, world!',
    ts: overrides.ts ?? '1234567890.123456',
  };

  if (overrides.threadTs !== undefined) {
    event['thread_ts'] = overrides.threadTs;
  }
  if (overrides.botId !== undefined) {
    event['bot_id'] = overrides.botId;
  }
  if (overrides.subtype !== undefined) {
    event['subtype'] = overrides.subtype;
  }

  const payload: JsonObject = {
    type: 'event_callback',
    team_id: overrides.teamId ?? 'T123456',
    event,
  };

  if (overrides.eventId !== undefined) {
    payload['event_id'] = overrides.eventId;
  }
  if (overrides.eventTime !== undefined) {
    payload['event_time'] = overrides.eventTime;
  }
  if (overrides.apiAppId !== undefined) {
    payload['api_app_id'] = overrides.apiAppId;
  }

  return payload;
}

/**
 * Slack app_mention 이벤트 페이로드 생성
 */
function createSlackMentionPayload(
  overrides: Partial<{
    teamId: string;
    userId: string;
    channel: string;
    text: string;
    ts: string;
  }> = {},
): JsonObject {
  return {
    type: 'event_callback',
    team_id: overrides.teamId ?? 'T123456',
    event: {
      type: 'app_mention',
      user: overrides.userId ?? 'U123456',
      channel: overrides.channel ?? 'C123456',
      text: overrides.text ?? '<@U789> help me',
      ts: overrides.ts ?? '1234567890.123456',
    },
  };
}

// ============================================================================
// Fetch Mock Setup
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

describe('Slack Connector', () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('slackConnector (default export)', () => {
    it('should be a function', () => {
      expect(typeof slackConnector).toBe('function');
    });

    describe('서명 검증', () => {
      it('유효한 서명 헤더가 있으면 emit을 수행해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload();
        const signingSecret = 'slack-secret';
        const headers = createSlackSignatureHeaders(payload, signingSecret);
        const event = createHttpTriggerEvent(payload, headers, JSON.stringify(payload));
        const ctx = createMockConnectorContext(event, emittedEvents);
        ctx.verify = {
          webhook: { signingSecret: 'slack-secret' },
        };

        await slackConnector(ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
      });

      it('서명이 유효하지 않으면 emit을 중단해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload();
        const event = createHttpTriggerEvent(
          payload,
          {
            'x-slack-request-timestamp': '1700000000',
            'x-slack-signature': 'v0=invalid-signature',
          },
          JSON.stringify(payload),
        );
        const ctx = createMockConnectorContext(event, emittedEvents);
        ctx.verify = {
          webhook: { signingSecret: 'slack-secret' },
        };

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] Signature verification failed');
      });
    });

    describe('페이로드 파싱', () => {
      it('유효한 message 이벤트를 파싱하고 ConnectorEvent를 발행해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
          channel: 'C001',
          text: 'Test message',
          ts: '1234567890.000001',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
        expect(emittedEvents.length).toBe(1);

        const emitted = emittedEvents[0];
        expect(emitted.type).toBe('connector.event');
        expect(emitted.name).toBe('slack.message');
        expect(emitted.message).toEqual({ type: 'text', text: 'Test message' });
      });

      it('app_mention 이벤트도 파싱할 수 있어야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMentionPayload({
          text: '<@U789> help me',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        const emitted = emittedEvents[0];
        expect(emitted.message).toEqual({ type: 'text', text: '<@U789> help me' });
      });

      it('thread_ts가 있으면 properties에 포함해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({
          ts: '1234567890.000001',
          threadTs: '1234567890.000000',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        expect(emittedEvents[0].properties?.['threadTs']).toBe('1234567890.000000');
      });
    });

    describe('봇 메시지 무시 로직', () => {
      it('bot_id가 있는 메시지는 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({ botId: 'B123456' });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(emittedEvents.length).toBe(0);
        expect(ctx.logger.debug).toHaveBeenCalledWith('[Slack] Ignoring bot message');
      });

      it('subtype이 bot_message인 경우 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({ subtype: 'bot_message' });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(emittedEvents.length).toBe(0);
      });
    });

    describe('URL verification 처리', () => {
      it('url_verification 이벤트는 로깅만 하고 emit하지 않아야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = {
          type: 'url_verification',
          challenge: 'test-challenge-string',
          token: 'test-token',
        };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(emittedEvents.length).toBe(0);
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          '[Slack] URL verification challenge received',
        );
      });
    });

    describe('유효하지 않은 페이로드 처리', () => {
      it('빈 페이로드는 경고 로그를 남기고 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const event = createHttpTriggerEvent({});
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] Invalid payload received');
      });

      it('event_callback이 아닌 타입은 무시해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = { type: 'app_rate_limited' };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
      });

      it('event 객체가 없는 event_callback은 경고해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = {
          type: 'event_callback',
          team_id: 'T123',
        };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No event object in payload');
      });

      it('team_id가 없으면 경고해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = {
          type: 'event_callback',
          event: {
            type: 'message',
            user: 'U123',
            channel: 'C123',
            text: 'test',
            ts: '123.456',
          },
        };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No team ID found');
      });

      it('user가 없으면 경고해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = {
          type: 'event_callback',
          team_id: 'T123',
          event: {
            type: 'message',
            channel: 'C123',
            text: 'test',
            ts: '123.456',
          },
        };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No user ID found');
      });

      it('channel이 없으면 경고해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload: JsonObject = {
          type: 'event_callback',
          team_id: 'T123',
          event: {
            type: 'message',
            user: 'U123',
            text: 'test',
            ts: '123.456',
          },
        };
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No channel found');
      });
    });

    describe('Auth 정보 생성', () => {
      it('올바른 actor 정보를 생성해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        const auth = emittedEvents[0].auth;
        expect(auth).toBeDefined();
        expect(auth?.actor.id).toBe('slack:U001');
        expect(auth?.actor.name).toBe('U001');
      });

      it('올바른 subjects를 생성해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        const auth = emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('slack:team:T001');
        expect(auth?.subjects.user).toBe('slack:user:T001:U001');
      });
    });

    describe('Properties 정보 생성', () => {
      it('기본 properties 필드가 포함되어야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
          channel: 'C001',
          ts: '123.456',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        expect(emittedEvents.length).toBe(1);
        const props = emittedEvents[0].properties;
        expect(props).toBeDefined();
        expect(props?.['channelId']).toBe('C001');
        expect(props?.['userId']).toBe('U001');
        expect(props?.['teamId']).toBe('T001');
        expect(props?.['eventType']).toBe('message');
      });

      it('thread_ts가 있으면 threadTs로 포함해야 함', async () => {
        const emittedEvents: ConnectorEvent[] = [];
        const payload = createSlackMessagePayload({
          ts: '123.456',
          threadTs: '123.000',
        });
        const event = createHttpTriggerEvent(payload);
        const ctx = createMockConnectorContext(event, emittedEvents);

        await slackConnector(ctx);

        const props = emittedEvents[0].properties;
        expect(props?.['threadTs']).toBe('123.000');
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

        await slackConnector(ctx);

        expect(emittedEvents).toHaveLength(0);
      });
    });
  });

  describe('postMessage API 함수', () => {
    it('성공적인 메시지 전송시 ok: true를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        ok: true,
        ts: '1234567890.123456',
        channel: 'C123',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await postMessage('xoxb-token', 'C123', 'Hello');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer xoxb-token',
            'Content-Type': 'application/json; charset=utf-8',
          },
        }),
      );
      expect(result.ok).toBe(true);
      expect(result.ts).toBe('1234567890.123456');
    });

    it('thread_ts가 제공되면 요청 본문에 포함해야 함', async () => {
      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          capturedBody = init.body;
        }
        return Promise.resolve(createMockFetchResponse({ ok: true }));
      });

      await postMessage('xoxb-token', 'C123', 'Reply', '123.456');

      expect(capturedBody).toBeDefined();
      const parsed: unknown = JSON.parse(capturedBody ?? '{}');
      expect(isJsonObject(parsed)).toBe(true);
      if (isJsonObject(parsed)) {
        expect(parsed['thread_ts']).toBe('123.456');
      }
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        ok: false,
        error: 'channel_not_found',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await postMessage('xoxb-token', 'invalid', 'Hello');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('channel_not_found');
    });

    it('네트워크 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await postMessage('xoxb-token', 'C123', 'Hello');

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

      const result = await postMessage('xoxb-token', 'C123', 'Hello');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid response format');
    });
  });

  describe('updateMessage API 함수', () => {
    it('성공적인 메시지 업데이트시 ok: true를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        ok: true,
        ts: '1234567890.123456',
        channel: 'C123',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateMessage(
        'xoxb-token',
        'C123',
        '1234567890.123456',
        'Updated message',
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.update',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer xoxb-token',
            'Content-Type': 'application/json; charset=utf-8',
          },
        }),
      );
      expect(result.ok).toBe(true);
    });

    it('요청 본문에 필수 필드가 포함되어야 함', async () => {
      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          capturedBody = init.body;
        }
        return Promise.resolve(createMockFetchResponse({ ok: true }));
      });

      await updateMessage('xoxb-token', 'C123', '123.456', 'New text');

      expect(capturedBody).toBeDefined();
      const parsed: unknown = JSON.parse(capturedBody ?? '{}');
      expect(isJsonObject(parsed)).toBe(true);
      if (isJsonObject(parsed)) {
        expect(parsed['channel']).toBe('C123');
        expect(parsed['ts']).toBe('123.456');
        expect(parsed['text']).toBe('New text');
      }
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        ok: false,
        error: 'message_not_found',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateMessage('xoxb-token', 'C123', 'invalid-ts', 'text');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('message_not_found');
    });

    it('네트워크 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      const result = await updateMessage('xoxb-token', 'C123', '123.456', 'text');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });
  });

  describe('getErrorMessage 함수', () => {
    it('알려진 에러 코드에 대해 설명을 반환해야 함', () => {
      expect(getErrorMessage('channel_not_found')).toBe('Channel not found');
      expect(getErrorMessage('not_in_channel')).toBe('Bot is not in the channel');
      expect(getErrorMessage('is_archived')).toBe('Channel is archived');
      expect(getErrorMessage('msg_too_long')).toBe('Message is too long');
      expect(getErrorMessage('no_text')).toBe('No message text provided');
      expect(getErrorMessage('rate_limited')).toBe('Rate limited - please try again later');
      expect(getErrorMessage('invalid_auth')).toBe('Invalid authentication token');
      expect(getErrorMessage('account_inactive')).toBe('Account is inactive');
      expect(getErrorMessage('token_revoked')).toBe('Token has been revoked');
      expect(getErrorMessage('no_permission')).toBe('Missing required permission');
      expect(getErrorMessage('missing_scope')).toBe('Missing required OAuth scope');
    });

    it('알려지지 않은 에러 코드에 대해 기본 메시지를 반환해야 함', () => {
      expect(getErrorMessage('some_unknown_error')).toBe('Unknown error: some_unknown_error');
      expect(getErrorMessage('')).toBe('Unknown error: ');
    });
  });
});
