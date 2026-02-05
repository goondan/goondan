/**
 * Slack Connector 구현
 *
 * Slack Events API 이벤트를 처리하여 canonical event로 변환하고,
 * 에이전트 응답을 Slack 채널로 전송한다.
 *
 * @see /docs/specs/connector.md - 10. Slack Connector 구현 예시
 * @packageDocumentation
 */

import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  ConnectorTurnAuth,
} from '@goondan/core/connector';
import type { JsonObject } from '@goondan/core';

/**
 * TurnAuth 타입 별칭
 */
type TurnAuth = ConnectorTurnAuth;

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
 * JsonObject에서 SlackEvent를 파싱한다.
 *
 * @param obj - 파싱할 객체
 * @returns SlackEvent 또는 undefined
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
 *
 * @param obj - 파싱할 객체
 * @returns SlackEventPayload 또는 undefined
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
// Trigger Handler
// ============================================================================

/**
 * Slack Events API 이벤트를 처리하는 트리거 핸들러
 *
 * @param event - 트리거 이벤트
 * @param _connection - 연결 설정 (현재 미사용)
 * @param ctx - 트리거 컨텍스트
 */
export async function onSlackEvent(
  event: TriggerEvent,
  _connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  // 페이로드 파싱
  const payload = parseSlackEventPayload(event.payload);
  if (!payload) {
    ctx.logger.warn('[Slack] Invalid payload received');
    return;
  }

  // URL Verification 처리 (Slack Events API 설정 시 사용)
  if (payload.type === 'url_verification') {
    ctx.logger.debug('[Slack] URL verification challenge received');
    // URL verification은 웹 서버에서 직접 처리해야 함
    // 여기서는 로깅만 수행
    return;
  }

  // event_callback 타입만 처리
  if (payload.type !== 'event_callback') {
    ctx.logger.debug(`[Slack] Ignoring event type: ${payload.type ?? 'unknown'}`);
    return;
  }

  const slackEvent = payload.event;
  if (!slackEvent) {
    ctx.logger.warn('[Slack] No event object in payload');
    return;
  }

  // 봇 메시지는 무시 (무한 루프 방지)
  if (slackEvent.bot_id || slackEvent.subtype === 'bot_message') {
    ctx.logger.debug('[Slack] Ignoring bot message');
    return;
  }

  // 팀 ID 추출 (payload.team_id 또는 event.team에서)
  const teamId = payload.team_id ?? slackEvent.team ?? '';
  if (!teamId) {
    ctx.logger.warn('[Slack] No team ID found');
    return;
  }

  // 사용자 ID 추출
  const userId = slackEvent.user ?? '';
  if (!userId) {
    ctx.logger.warn('[Slack] No user ID found');
    return;
  }

  // 채널 ID 추출
  const channel = slackEvent.channel ?? '';
  if (!channel) {
    ctx.logger.warn('[Slack] No channel found');
    return;
  }

  // Connector 설정에서 ingress 규칙 조회
  const connector = ctx.connector;
  const connectorName = connector.metadata?.name ?? 'slack';
  const ingressRules = connector.spec?.ingress ?? [];

  // ingress 규칙 매칭
  for (const rule of ingressRules) {
    const match = rule.match ?? {};
    const route = rule.route;

    if (!route?.swarmRef) {
      ctx.logger.warn('[Slack] No swarmRef in route');
      continue;
    }

    // eventType 매칭
    if (match.eventType && slackEvent.type !== match.eventType) {
      continue;
    }

    // command 매칭 (슬래시 커맨드용)
    if (match.command && slackEvent.command !== match.command) {
      continue;
    }

    // channel 매칭
    if (match.channel && slackEvent.channel !== match.channel) {
      continue;
    }

    // instanceKey 추출 (thread_ts 또는 ts 사용)
    const instanceKey = extractInstanceKey(payload, route.instanceKeyFrom, slackEvent);

    // input 추출
    const input = extractInput(payload, route.inputFrom, slackEvent);

    // TurnAuth 생성
    const auth = createTurnAuth(teamId, userId);

    // Origin 정보 생성
    const origin = createOrigin(slackEvent, connectorName, teamId, userId);

    // metadata 생성 (undefined 제외)
    const metadata = buildMetadata(payload);

    // Canonical event 생성
    const canonicalEvent: CanonicalEvent = {
      type: slackEvent.type,
      swarmRef: route.swarmRef,
      instanceKey,
      input,
      origin,
      auth,
    };

    // metadata가 있으면 추가
    if (Object.keys(metadata).length > 0) {
      canonicalEvent.metadata = metadata;
    }

    // agentName이 지정된 경우 추가
    if (route.agentName) {
      canonicalEvent.agentName = route.agentName;
    }

    // Canonical event 발행
    await ctx.emit(canonicalEvent);

    ctx.logger.info(
      `[Slack] Emitted canonical event: type=${slackEvent.type}, ` +
      `instanceKey=${instanceKey}, channel=${channel}`
    );
    return;
  }

  ctx.logger.debug(`[Slack] No matching ingress rule for event type: ${slackEvent.type}`);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * TurnAuth를 생성한다.
 *
 * @param teamId - Slack 팀 ID
 * @param userId - Slack 사용자 ID
 * @returns TurnAuth 객체
 */
function createTurnAuth(teamId: string, userId: string): TurnAuth {
  return {
    actor: {
      type: 'user',
      id: `slack:${userId}`,
      display: userId,
    },
    subjects: {
      // 워크스페이스 단위 토큰 조회용 (subjectMode=global)
      global: `slack:team:${teamId}`,
      // 사용자 단위 토큰 조회용 (subjectMode=user)
      user: `slack:user:${teamId}:${userId}`,
    },
  };
}

/**
 * Origin 정보를 생성한다.
 *
 * @param slackEvent - Slack 이벤트 객체
 * @param connectorName - Connector 이름
 * @param teamId - 팀 ID
 * @param userId - 사용자 ID
 * @returns Origin 객체
 */
function createOrigin(
  slackEvent: SlackEvent,
  connectorName: string,
  teamId: string,
  userId: string
): JsonObject {
  const origin: JsonObject = {
    connector: connectorName,
    teamId,
    userId,
    eventType: slackEvent.type,
  };

  // undefined가 아닌 값만 추가
  if (slackEvent.channel !== undefined) {
    origin['channel'] = slackEvent.channel;
  }
  if (slackEvent.thread_ts !== undefined) {
    origin['threadTs'] = slackEvent.thread_ts;
  } else if (slackEvent.ts !== undefined) {
    origin['threadTs'] = slackEvent.ts;
  }
  if (slackEvent.ts !== undefined) {
    origin['ts'] = slackEvent.ts;
  }
  if (slackEvent.channel_type !== undefined) {
    origin['channelType'] = slackEvent.channel_type;
  }

  return origin;
}

/**
 * metadata 정보를 생성한다.
 * undefined 값은 제외된다.
 *
 * @param payload - Slack 이벤트 페이로드
 * @returns metadata 객체
 */
function buildMetadata(payload: SlackEventPayload): JsonObject {
  const metadata: JsonObject = {};

  if (payload.event_id !== undefined) {
    metadata['eventId'] = payload.event_id;
  }
  if (payload.event_time !== undefined) {
    metadata['eventTime'] = payload.event_time;
  }
  if (payload.api_app_id !== undefined) {
    metadata['apiAppId'] = payload.api_app_id;
  }

  return metadata;
}

/**
 * JSONPath 또는 기본값으로 instanceKey를 추출한다.
 *
 * @param payload - 전체 페이로드
 * @param instanceKeyFrom - JSONPath 표현식
 * @param slackEvent - Slack 이벤트 객체
 * @returns instanceKey
 */
function extractInstanceKey(
  payload: SlackEventPayload,
  instanceKeyFrom: string | undefined,
  slackEvent: SlackEvent
): string {
  if (instanceKeyFrom) {
    const value = readSimplePathFromPayload(payload, instanceKeyFrom);
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  // 기본값: thread_ts (스레드 내 대화) 또는 ts (새 대화)
  return slackEvent.thread_ts ?? slackEvent.ts ?? `slack-${Date.now()}`;
}

/**
 * JSONPath 또는 기본값으로 input을 추출한다.
 *
 * @param payload - 전체 페이로드
 * @param inputFrom - JSONPath 표현식
 * @param slackEvent - Slack 이벤트 객체
 * @returns input 텍스트
 */
function extractInput(
  payload: SlackEventPayload,
  inputFrom: string | undefined,
  slackEvent: SlackEvent
): string {
  if (inputFrom) {
    const value = readSimplePathFromPayload(payload, inputFrom);
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  // 기본값: event.text
  return slackEvent.text ?? '';
}

/**
 * SlackEventPayload에서 간단한 JSONPath를 읽는다.
 * 타입 단언 없이 안전하게 값을 추출한다.
 *
 * @param payload - SlackEventPayload
 * @param expr - JSONPath 표현식 (예: "$.event.text")
 * @returns 추출된 값 또는 undefined
 */
function readSimplePathFromPayload(
  payload: SlackEventPayload,
  expr: string
): unknown {
  if (!expr || !expr.startsWith('$.')) {
    return undefined;
  }

  // $. 제거 후 경로 분리
  const path = expr.slice(2);
  if (!path) {
    return payload;
  }

  // 배열 인덱스와 dot notation 처리
  const segments = path.split(/\.|\[|\]/).filter(Boolean);

  let current: unknown = payload;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (!isObject(current) && !Array.isArray(current)) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index)) {
        return undefined;
      }
      current = current[index];
    } else {
      current = current[segment];
    }
  }

  return current;
}

// ============================================================================
// Slack API Helpers (Egress용)
// ============================================================================

/**
 * Slack API 호출을 위한 헬퍼 함수들
 * 실제 egress 처리는 ConnectorAdapter의 send 메서드에서 이 함수들을 사용한다.
 */

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
