/**
 * Slack Connector 테스트
 *
 * @see /packages/base/src/connectors/slack/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  onSlackEvent,
  postMessage,
  updateMessage,
  getErrorMessage,
} from '../../../src/connectors/slack/index.js';
import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
} from '@goondan/core/connector';
import type { ConnectorSpec, IngressRule } from '@goondan/core';
import type { Resource, JsonObject } from '@goondan/core';

// ============================================================================
// Type Guards
// ============================================================================

/**
 * JsonObject 타입 가드
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * 기본 ingress 규칙 생성
 */
function createDefaultIngressRules(): IngressRule[] {
  return [
    {
      match: { eventType: 'message' },
      route: {
        swarmRef: { name: 'test-swarm' },
      },
    },
    {
      match: { eventType: 'app_mention' },
      route: {
        swarmRef: { name: 'mention-swarm' },
        agentName: 'responder',
      },
    },
  ];
}

/**
 * Mock Connector 설정 생성
 */
function createMockConnector(
  overrides: Partial<{ metadata: { name: string }; spec: Partial<ConnectorSpec> }> = {}
): Resource<ConnectorSpec> {
  const defaultSpec: ConnectorSpec = {
    type: 'slack',
    ingress: createDefaultIngressRules(),
  };

  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name: 'slack-connector', ...overrides.metadata },
    spec: { ...defaultSpec, ...overrides.spec },
  };
}

/**
 * Mock TriggerContext 생성
 */
function createMockContext(
  overrides: Partial<{
    connector: Resource<ConnectorSpec>;
    emittedEvents: CanonicalEvent[];
  }> = {}
): TriggerContext & { emittedEvents: CanonicalEvent[] } {
  const emittedEvents: CanonicalEvent[] = overrides.emittedEvents ?? [];

  return {
    emit: vi.fn().mockImplementation((event: CanonicalEvent) => {
      emittedEvents.push(event);
      return Promise.resolve();
    }),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console,
    connector: overrides.connector ?? createMockConnector(),
    emittedEvents,
  };
}

/**
 * Mock TriggerEvent 생성
 */
function createMockTriggerEvent(payload: JsonObject): TriggerEvent {
  return {
    type: 'webhook',
    payload,
    timestamp: new Date().toISOString(),
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
  }> = {}
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
  }> = {}
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

// 글로벌 fetch mock 저장
let originalFetch: typeof global.fetch;

/**
 * Mock Response 타입 (테스트용)
 */
interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<JsonObject>;
  text: () => Promise<string>;
  headers: Headers;
}

/**
 * Mock fetch response 생성
 */
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

  describe('onSlackEvent Trigger Handler', () => {
    describe('페이로드 파싱', () => {
      it('유효한 message 이벤트를 파싱하고 canonical event를 발행해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
          channel: 'C001',
          text: 'Test message',
          ts: '1234567890.000001',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
        expect(ctx.emittedEvents.length).toBe(1);

        const emitted = ctx.emittedEvents[0];
        expect(emitted).toBeDefined();
        expect(emitted.type).toBe('message');
        expect(emitted.input).toBe('Test message');
        expect(emitted.instanceKey).toBe('1234567890.000001');
      });

      it('thread_ts가 있으면 instanceKey로 사용해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          ts: '1234567890.000001',
          threadTs: '1234567890.000000',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const emitted = ctx.emittedEvents[0];
        expect(emitted.instanceKey).toBe('1234567890.000000');
      });

      it('app_mention 이벤트도 파싱할 수 있어야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMentionPayload({
          text: '<@U789> help me',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const emitted = ctx.emittedEvents[0];
        expect(emitted.type).toBe('app_mention');
        expect(emitted.input).toBe('<@U789> help me');
      });

      it('metadata 필드가 올바르게 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          eventId: 'Ev001',
          eventTime: 1234567890,
          apiAppId: 'A001',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const emitted = ctx.emittedEvents[0];
        expect(emitted.metadata).toBeDefined();
        expect(emitted.metadata?.['eventId']).toBe('Ev001');
        expect(emitted.metadata?.['eventTime']).toBe(1234567890);
        expect(emitted.metadata?.['apiAppId']).toBe('A001');
      });
    });

    describe('봇 메시지 무시 로직', () => {
      it('bot_id가 있는 메시지는 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          botId: 'B123456',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.emittedEvents.length).toBe(0);
        expect(ctx.logger.debug).toHaveBeenCalledWith('[Slack] Ignoring bot message');
      });

      it('subtype이 bot_message인 경우 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          subtype: 'bot_message',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.emittedEvents.length).toBe(0);
      });
    });

    describe('URL verification 처리', () => {
      it('url_verification 이벤트는 로깅만 하고 emit하지 않아야 함', async () => {
        const ctx = createMockContext();
        const payload: JsonObject = {
          type: 'url_verification',
          challenge: 'test-challenge-string',
          token: 'test-token',
        };
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.emittedEvents.length).toBe(0);
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          '[Slack] URL verification challenge received'
        );
      });
    });

    describe('유효하지 않은 페이로드 처리', () => {
      it('빈 페이로드는 경고 로그를 남기고 무시해야 함', async () => {
        const ctx = createMockContext();
        const event = createMockTriggerEvent({});

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] Invalid payload received');
      });

      it('event_callback이 아닌 타입은 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload: JsonObject = {
          type: 'app_rate_limited',
        };
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
      });

      it('event 객체가 없는 event_callback은 경고해야 함', async () => {
        const ctx = createMockContext();
        const payload: JsonObject = {
          type: 'event_callback',
          team_id: 'T123',
        };
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No event object in payload');
      });

      it('team_id가 없으면 경고해야 함', async () => {
        const ctx = createMockContext();
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
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No team ID found');
      });

      it('user가 없으면 경고해야 함', async () => {
        const ctx = createMockContext();
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
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No user ID found');
      });

      it('channel이 없으면 경고해야 함', async () => {
        const ctx = createMockContext();
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
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No channel found');
      });
    });

    describe('TurnAuth 생성', () => {
      it('올바른 actor 정보를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const auth = ctx.emittedEvents[0].auth;
        expect(auth).toBeDefined();
        expect(auth?.actor.type).toBe('user');
        expect(auth?.actor.id).toBe('slack:U001');
        expect(auth?.actor.display).toBe('U001');
      });

      it('올바른 subjects를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('slack:team:T001');
        expect(auth?.subjects.user).toBe('slack:user:T001:U001');
      });
    });

    describe('Origin 정보 생성', () => {
      it('기본 origin 필드가 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          teamId: 'T001',
          userId: 'U001',
          channel: 'C001',
          ts: '123.456',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        const origin = ctx.emittedEvents[0].origin;
        expect(origin).toBeDefined();
        expect(origin?.['connector']).toBe('slack-connector');
        expect(origin?.['teamId']).toBe('T001');
        expect(origin?.['userId']).toBe('U001');
        expect(origin?.['channel']).toBe('C001');
        expect(origin?.['eventType']).toBe('message');
        expect(origin?.['ts']).toBe('123.456');
      });

      it('thread_ts가 있으면 threadTs로 포함해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMessagePayload({
          ts: '123.456',
          threadTs: '123.000',
        });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        const origin = ctx.emittedEvents[0].origin;
        expect(origin?.['threadTs']).toBe('123.000');
      });
    });

    describe('Ingress 규칙 매칭', () => {
      it('eventType 매칭에 따라 올바른 swarmRef를 설정해야 함', async () => {
        const ctx = createMockContext();
        const payload = createSlackMentionPayload();
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const emitted = ctx.emittedEvents[0];
        expect(emitted.swarmRef).toEqual({ name: 'mention-swarm' });
        expect(emitted.agentName).toBe('responder');
      });

      it('매칭되는 ingress 규칙이 없으면 debug 로그를 남겨야 함', async () => {
        const ctx = createMockContext({
          connector: createMockConnector({
            spec: {
              type: 'slack',
              ingress: [
                {
                  match: { eventType: 'reaction_added' },
                  route: { swarmRef: { name: 'reaction-swarm' } },
                },
              ],
            },
          }),
        });
        const payload = createSlackMessagePayload();
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          '[Slack] No matching ingress rule for event type: message'
        );
      });

      it('channel 매칭 조건이 적용되어야 함', async () => {
        const ctx = createMockContext({
          connector: createMockConnector({
            spec: {
              type: 'slack',
              ingress: [
                {
                  match: { eventType: 'message', channel: 'C-specific' },
                  route: { swarmRef: { name: 'specific-swarm' } },
                },
                {
                  match: { eventType: 'message' },
                  route: { swarmRef: { name: 'default-swarm' } },
                },
              ],
            },
          }),
        });

        // 특정 채널 메시지
        const payload1 = createSlackMessagePayload({ channel: 'C-specific' });
        await onSlackEvent(createMockTriggerEvent(payload1), {}, ctx);
        expect(ctx.emittedEvents[0].swarmRef).toEqual({ name: 'specific-swarm' });

        // 다른 채널 메시지 - 두 번째 규칙 매칭
        const ctx2 = createMockContext({
          connector: ctx.connector,
        });
        const payload2 = createSlackMessagePayload({ channel: 'C-other' });
        await onSlackEvent(createMockTriggerEvent(payload2), {}, ctx2);
        expect(ctx2.emittedEvents[0].swarmRef).toEqual({ name: 'default-swarm' });
      });

      it('swarmRef가 없는 route는 경고하고 건너뛰어야 함', async () => {
        // 런타임에 잘못된 설정이 들어올 수 있으므로
        // JSON.parse를 통해 타입 검증 없이 객체를 생성
        const invalidIngressJson = JSON.stringify([
          {
            match: { eventType: 'message' },
            route: {},
          },
        ]);
        const invalidIngress: IngressRule[] = JSON.parse(invalidIngressJson);

        const connector = createMockConnector({
          spec: {
            type: 'slack',
            ingress: invalidIngress,
          },
        });

        const ctx = createMockContext({ connector });
        const payload = createSlackMessagePayload();
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.logger.warn).toHaveBeenCalledWith('[Slack] No swarmRef in route');
      });
    });

    describe('JSONPath를 통한 값 추출', () => {
      it('instanceKeyFrom이 지정되면 해당 경로에서 값을 추출해야 함', async () => {
        const ctx = createMockContext({
          connector: createMockConnector({
            spec: {
              type: 'slack',
              ingress: [
                {
                  match: { eventType: 'message' },
                  route: {
                    swarmRef: { name: 'test-swarm' },
                    instanceKeyFrom: '$.team_id',
                  },
                },
              ],
            },
          }),
        });
        const payload = createSlackMessagePayload({ teamId: 'CUSTOM_TEAM_KEY' });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents[0].instanceKey).toBe('CUSTOM_TEAM_KEY');
      });

      it('inputFrom이 지정되면 해당 경로에서 입력을 추출해야 함', async () => {
        const ctx = createMockContext({
          connector: createMockConnector({
            spec: {
              type: 'slack',
              ingress: [
                {
                  match: { eventType: 'message' },
                  route: {
                    swarmRef: { name: 'test-swarm' },
                    inputFrom: '$.team_id',
                  },
                },
              ],
            },
          }),
        });
        const payload = createSlackMessagePayload({ teamId: 'T999' });
        const event = createMockTriggerEvent(payload);

        await onSlackEvent(event, {}, ctx);

        expect(ctx.emittedEvents[0].input).toBe('T999');
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
        })
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
        'Updated message'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.update',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer xoxb-token',
            'Content-Type': 'application/json; charset=utf-8',
          },
        })
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
