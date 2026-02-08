/**
 * Slack Connector 구현 (v1.0)
 *
 * Slack Events API 이벤트를 처리하여 ConnectorEvent로 변환하고 emit한다.
 * 단일 default export 패턴을 따른다.
 *
 * @see /docs/specs/connector.md - 5. Entry Function 실행 모델
 * @packageDocumentation
 */

import type {
  ConnectorContext,
  ConnectorEvent,
  HttpTriggerPayload,
} from '@goondan/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Slack 이벤트 페이로드 타입
 */
export interface SlackEventPayload {
  /** 이벤트 래퍼 타입 (event_callback, url_verification 등) */
  type?: string;
  /** 팀/워크스페이스 ID */
  team_id?: string;
  /** API 앱 ID */
  api_app_id?: string;
  /** 이벤트 객체 */
  event?: SlackEvent;
  /** 이벤트 ID */
  event_id?: string;
  /** 이벤트 시각 */
  event_time?: number;
  /** URL 검증용 챌린지 */
  challenge?: string;
  /** 토큰 (deprecated) */
  token?: string;
}

/**
 * Slack 이벤트 타입
 */
export interface SlackEvent {
  /** 이벤트 타입 (message, app_mention 등) */
  type: string;
  /** 팀 ID */
  team?: string;
  /** 사용자 ID */
  user?: string;
  /** 채널 ID */
  channel?: string;
  /** 스레드 타임스탬프 */
  thread_ts?: string;
  /** 메시지 타임스탬프 */
  ts?: string;
  /** 메시지 텍스트 */
  text?: string;
  /** 서브타입 (bot_message, message_changed 등) */
  subtype?: string;
  /** 봇 ID */
  bot_id?: string;
  /** 슬래시 커맨드 */
  command?: string;
  /** 채널 타입 (channel, im, mpim, group) */
  channel_type?: string;
}

/**
 * Slack API 응답 타입
 */
export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

// ============================================================================
// Type Guards and Parsers
// ============================================================================

/**
 * object 타입 가드
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * string 타입 가드
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * number 타입 가드
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

/**
 * HttpTriggerPayload 타입 가드
 */
function isHttpTrigger(trigger: { type: string }): trigger is HttpTriggerPayload {
  return trigger.type === 'http';
}

/**
 * 헤더 키를 대소문자 구분 없이 조회한다.
 */
function getHeaderValue(
  headers: Record<string, string>,
  headerName: string,
): string | undefined {
  const direct = headers[headerName];
  if (isString(direct)) {
    return direct;
  }

  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName && isString(value)) {
      return value;
    }
  }

  return undefined;
}

/**
 * 요청 본문을 서명 검증용 문자열로 직렬화한다.
 */
function getRequestRawBody(request: HttpTriggerPayload['payload']['request']): string | undefined {
  if (isString(request.rawBody)) {
    return request.rawBody;
  }

  try {
    return JSON.stringify(request.body);
  } catch {
    return undefined;
  }
}

/**
 * Slack 요청 서명을 검증한다.
 */
function verifySlackSignature(
  request: HttpTriggerPayload['payload']['request'],
  signingSecret: string,
): boolean {
  const signature = getHeaderValue(request.headers, 'x-slack-signature');
  const timestamp = getHeaderValue(request.headers, 'x-slack-request-timestamp');

  if (!signature || !timestamp) {
    return false;
  }

  if (!signature.startsWith('v0=')) {
    return false;
  }

  const rawBody = getRequestRawBody(request);
  if (!rawBody) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`;

  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Connection verify 설정이 있을 때 Slack 서명을 검증한다.
 *
 * 검증 실패 시 emit을 중단해야 한다.
 */
function runVerifyHook(
  context: ConnectorContext,
  request: HttpTriggerPayload['payload']['request'],
): boolean {
  const signingSecret = context.verify?.webhook?.signingSecret;

  if (!signingSecret) {
    return true;
  }

  const verified = verifySlackSignature(request, signingSecret);
  if (verified) {
    context.logger.debug('[Slack] Signature verification passed');
    return true;
  }

  context.logger.warn('[Slack] Signature verification failed');
  return false;
}

/**
 * JsonObject에서 SlackEvent를 파싱한다.
 */
function parseSlackEvent(obj: unknown): SlackEvent | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const type = obj['type'];
  if (!isString(type)) {
    return undefined;
  }

  const event: SlackEvent = { type };

  const team = obj['team'];
  if (isString(team)) {
    event.team = team;
  }

  const user = obj['user'];
  if (isString(user)) {
    event.user = user;
  }

  const channel = obj['channel'];
  if (isString(channel)) {
    event.channel = channel;
  }

  const thread_ts = obj['thread_ts'];
  if (isString(thread_ts)) {
    event.thread_ts = thread_ts;
  }

  const ts = obj['ts'];
  if (isString(ts)) {
    event.ts = ts;
  }

  const text = obj['text'];
  if (isString(text)) {
    event.text = text;
  }

  const subtype = obj['subtype'];
  if (isString(subtype)) {
    event.subtype = subtype;
  }

  const bot_id = obj['bot_id'];
  if (isString(bot_id)) {
    event.bot_id = bot_id;
  }

  const command = obj['command'];
  if (isString(command)) {
    event.command = command;
  }

  const channel_type = obj['channel_type'];
  if (isString(channel_type)) {
    event.channel_type = channel_type;
  }

  return event;
}

/**
 * JsonObject에서 SlackEventPayload를 파싱한다.
 */
function parseSlackEventPayload(obj: unknown): SlackEventPayload | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const payload: SlackEventPayload = {};

  const type = obj['type'];
  if (isString(type)) {
    payload.type = type;
  }

  const team_id = obj['team_id'];
  if (isString(team_id)) {
    payload.team_id = team_id;
  }

  const api_app_id = obj['api_app_id'];
  if (isString(api_app_id)) {
    payload.api_app_id = api_app_id;
  }

  const eventObj = obj['event'];
  if (isObject(eventObj)) {
    const parsedEvent = parseSlackEvent(eventObj);
    if (parsedEvent) {
      payload.event = parsedEvent;
    }
  }

  const event_id = obj['event_id'];
  if (isString(event_id)) {
    payload.event_id = event_id;
  }

  const event_time = obj['event_time'];
  if (isNumber(event_time)) {
    payload.event_time = event_time;
  }

  const challenge = obj['challenge'];
  if (isString(challenge)) {
    payload.challenge = challenge;
  }

  const token = obj['token'];
  if (isString(token)) {
    payload.token = token;
  }

  // type 또는 event가 있어야 유효한 payload
  if (payload.type === undefined && payload.event === undefined) {
    return undefined;
  }

  return payload;
}

// ============================================================================
// Connector Entry Function (단일 default export)
// ============================================================================

/**
 * Slack Connector Entry Function
 *
 * Slack Events API Webhook으로부터 이벤트를 받아
 * ConnectorEvent로 변환하여 emit한다.
 */
const slackConnector = async function (context: ConnectorContext): Promise<void> {
  const { event, emit, logger } = context;

  // connector.trigger 이벤트만 처리
  if (event.type !== 'connector.trigger') {
    return;
  }

  const trigger = event.trigger;

  // HTTP trigger만 처리
  if (!isHttpTrigger(trigger)) {
    logger.debug('[Slack] Not an HTTP trigger, skipping');
    return;
  }

  const requestBody = trigger.payload.request.body;

  // verify.webhook.signingSecret이 제공된 경우 서명 검증
  if (!runVerifyHook(context, trigger.payload.request)) {
    return;
  }

  // 페이로드 파싱
  const payload = parseSlackEventPayload(requestBody);
  if (!payload) {
    logger.warn('[Slack] Invalid payload received');
    return;
  }

  // URL Verification 처리 (Slack Events API 설정 시 사용)
  if (payload.type === 'url_verification') {
    logger.debug('[Slack] URL verification challenge received');
    return;
  }

  // event_callback 타입만 처리
  if (payload.type !== 'event_callback') {
    logger.debug(`[Slack] Ignoring event type: ${payload.type ?? 'unknown'}`);
    return;
  }

  const slackEvent = payload.event;
  if (!slackEvent) {
    logger.warn('[Slack] No event object in payload');
    return;
  }

  // 봇 메시지는 무시 (무한 루프 방지)
  if (slackEvent.bot_id || slackEvent.subtype === 'bot_message') {
    logger.debug('[Slack] Ignoring bot message');
    return;
  }

  // 팀 ID 추출
  const teamId = payload.team_id ?? slackEvent.team ?? '';
  if (!teamId) {
    logger.warn('[Slack] No team ID found');
    return;
  }

  // 사용자 ID 추출
  const userId = slackEvent.user ?? '';
  if (!userId) {
    logger.warn('[Slack] No user ID found');
    return;
  }

  // 채널 ID 추출
  const channel = slackEvent.channel ?? '';
  if (!channel) {
    logger.warn('[Slack] No channel found');
    return;
  }

  // ConnectorEvent 생성 및 발행
  const connectorEvent: ConnectorEvent = {
    type: 'connector.event',
    name: 'slack.message',
    message: {
      type: 'text',
      text: slackEvent.text ?? '',
    },
    properties: {
      channelId: channel,
      userId,
      teamId,
      threadTs: slackEvent.thread_ts ?? slackEvent.ts ?? '',
      eventType: slackEvent.type,
    },
    auth: {
      actor: {
        id: `slack:${userId}`,
        name: userId,
      },
      subjects: {
        global: `slack:team:${teamId}`,
        user: `slack:user:${teamId}:${userId}`,
      },
    },
  };

  await emit(connectorEvent);

  logger.info(
    `[Slack] Emitted connector event: name=slack.message, ` +
    `channel=${channel}, user=${userId}`
  );
};

export default slackConnector;

// ============================================================================
// Slack API Helpers (Egress용)
// ============================================================================

/**
 * Slack 메시지를 전송한다.
 *
 * @param token - Bot OAuth 토큰
 * @param channel - 채널 ID
 * @param text - 메시지 텍스트
 * @param threadTs - 스레드 타임스탬프 (선택)
 * @returns API 응답
 */
export async function postMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<SlackApiResponse> {
  const body: Record<string, string> = {
    channel,
    text,
  };

  if (threadTs) {
    body.thread_ts = threadTs;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    const result: unknown = await response.json();

    if (isSlackApiResponse(result)) {
      return result;
    }

    return { ok: false, error: 'Invalid response format' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Slack 메시지를 업데이트한다.
 *
 * @param token - Bot OAuth 토큰
 * @param channel - 채널 ID
 * @param ts - 업데이트할 메시지의 타임스탬프
 * @param text - 새 메시지 텍스트
 * @returns API 응답
 */
export async function updateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string
): Promise<SlackApiResponse> {
  try {
    const response = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        ts,
        text,
      }),
    });

    const result: unknown = await response.json();

    if (isSlackApiResponse(result)) {
      return result;
    }

    return { ok: false, error: 'Invalid response format' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * SlackApiResponse 타입 가드
 */
function isSlackApiResponse(value: unknown): value is SlackApiResponse {
  if (!isObject(value)) {
    return false;
  }
  return typeof value['ok'] === 'boolean';
}

/**
 * Slack API 에러 메시지를 반환한다.
 *
 * @param errorCode - Slack API 에러 코드
 * @returns 사람이 읽을 수 있는 에러 메시지
 */
export function getErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    channel_not_found: 'Channel not found',
    not_in_channel: 'Bot is not in the channel',
    is_archived: 'Channel is archived',
    msg_too_long: 'Message is too long',
    no_text: 'No message text provided',
    rate_limited: 'Rate limited - please try again later',
    invalid_auth: 'Invalid authentication token',
    account_inactive: 'Account is inactive',
    token_revoked: 'Token has been revoked',
    no_permission: 'Missing required permission',
    missing_scope: 'Missing required OAuth scope',
  };

  return errorMessages[errorCode] ?? `Unknown error: ${errorCode}`;
}
