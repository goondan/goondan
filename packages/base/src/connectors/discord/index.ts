/**
 * Discord Connector 구현
 *
 * Discord Gateway/Webhook 이벤트를 처리하여 canonical event로 변환하고,
 * 에이전트 응답을 Discord 채널로 전송한다.
 *
 * @see /docs/specs/connector.md
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
 * Discord 메시지 이벤트 페이로드 타입
 */
export interface DiscordMessagePayload {
  /** 이벤트 타입 (MESSAGE_CREATE 등) */
  t?: string;
  /** 메시지 데이터 */
  d?: DiscordMessageData;
}

/**
 * Discord 메시지 데이터 타입
 */
export interface DiscordMessageData {
  /** 메시지 ID */
  id: string;
  /** 채널 ID */
  channel_id: string;
  /** 길드(서버) ID */
  guild_id?: string;
  /** 작성자 정보 */
  author: DiscordUser;
  /** 메시지 내용 */
  content: string;
  /** 타임스탬프 */
  timestamp: string;
  /** 멘션 목록 */
  mentions?: DiscordUser[];
  /** 봇 여부 (author.bot에서 추출) */
  referenced_message?: DiscordMessageData;
}

/**
 * Discord 사용자 타입
 */
export interface DiscordUser {
  /** 사용자 ID */
  id: string;
  /** 사용자명 */
  username: string;
  /** 디스크리미네이터 (legacy) */
  discriminator?: string;
  /** 봇 여부 */
  bot?: boolean;
  /** 글로벌 표시 이름 */
  global_name?: string;
}

/**
 * Discord API 응답 타입
 */
export interface DiscordApiResponse {
  /** 메시지 ID (성공 시) */
  id?: string;
  /** 에러 메시지 */
  message?: string;
  /** 에러 코드 */
  code?: number;
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
 * boolean 타입 가드
 */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * JsonObject에서 DiscordUser를 파싱한다.
 *
 * @param obj - 파싱할 객체
 * @returns DiscordUser 또는 undefined
 */
function parseDiscordUser(obj: unknown): DiscordUser | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const id = obj['id'];
  const username = obj['username'];
  if (!isString(id) || !isString(username)) {
    return undefined;
  }

  const user: DiscordUser = { id, username };

  const discriminator = obj['discriminator'];
  if (isString(discriminator)) {
    user.discriminator = discriminator;
  }

  const bot = obj['bot'];
  if (isBoolean(bot)) {
    user.bot = bot;
  }

  const globalName = obj['global_name'];
  if (isString(globalName)) {
    user.global_name = globalName;
  }

  return user;
}

/**
 * JsonObject에서 DiscordMessageData를 파싱한다.
 *
 * @param obj - 파싱할 객체
 * @returns DiscordMessageData 또는 undefined
 */
function parseDiscordMessageData(obj: unknown): DiscordMessageData | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const id = obj['id'];
  const channelId = obj['channel_id'];
  const content = obj['content'];
  const timestamp = obj['timestamp'];

  if (!isString(id) || !isString(channelId) || !isString(content) || !isString(timestamp)) {
    return undefined;
  }

  const author = parseDiscordUser(obj['author']);
  if (!author) {
    return undefined;
  }

  const data: DiscordMessageData = {
    id,
    channel_id: channelId,
    author,
    content,
    timestamp,
  };

  const guildId = obj['guild_id'];
  if (isString(guildId)) {
    data.guild_id = guildId;
  }

  const mentions = obj['mentions'];
  if (Array.isArray(mentions)) {
    const parsedMentions: DiscordUser[] = [];
    for (const mention of mentions) {
      const parsedUser = parseDiscordUser(mention);
      if (parsedUser) {
        parsedMentions.push(parsedUser);
      }
    }
    if (parsedMentions.length > 0) {
      data.mentions = parsedMentions;
    }
  }

  const referencedMessage = obj['referenced_message'];
  if (isObject(referencedMessage)) {
    const parsedRef = parseDiscordMessageData(referencedMessage);
    if (parsedRef) {
      data.referenced_message = parsedRef;
    }
  }

  return data;
}

/**
 * JsonObject에서 DiscordMessagePayload를 파싱한다.
 *
 * @param obj - 파싱할 객체
 * @returns DiscordMessagePayload 또는 undefined
 */
function parseDiscordPayload(obj: unknown): DiscordMessagePayload | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const payload: DiscordMessagePayload = {};

  const t = obj['t'];
  if (isString(t)) {
    payload.t = t;
  }

  const d = obj['d'];
  if (isObject(d)) {
    const parsedData = parseDiscordMessageData(d);
    if (parsedData) {
      payload.d = parsedData;
    }
  }

  // t 또는 d가 있어야 유효한 payload
  if (payload.t === undefined && payload.d === undefined) {
    return undefined;
  }

  return payload;
}

// ============================================================================
// Trigger Handler
// ============================================================================

/**
 * Discord 메시지 이벤트를 처리하는 트리거 핸들러
 *
 * @param event - 트리거 이벤트
 * @param _connection - 연결 설정 (현재 미사용)
 * @param ctx - 트리거 컨텍스트
 */
export async function onDiscordMessage(
  event: TriggerEvent,
  _connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  // 페이로드 파싱
  const payload = parseDiscordPayload(event.payload);
  if (!payload) {
    ctx.logger.warn('[Discord] Invalid payload received');
    return;
  }

  // MESSAGE_CREATE 이벤트만 처리
  if (payload.t !== 'MESSAGE_CREATE') {
    ctx.logger.debug(`[Discord] Ignoring event type: ${payload.t ?? 'unknown'}`);
    return;
  }

  const messageData = payload.d;
  if (!messageData) {
    ctx.logger.warn('[Discord] No message data in payload');
    return;
  }

  // 봇 메시지 무시 (무한 루프 방지)
  if (messageData.author.bot) {
    ctx.logger.debug('[Discord] Ignoring bot message');
    return;
  }

  // 빈 메시지 무시
  if (!messageData.content.trim()) {
    ctx.logger.debug('[Discord] Empty message content, skipping');
    return;
  }

  const userId = messageData.author.id;
  const channelId = messageData.channel_id;
  const guildId = messageData.guild_id ?? '';

  // Connector 설정
  const connector = ctx.connector;
  const connectorName = connector.metadata?.name ?? 'discord';
  const ingressRules = connector.spec?.ingress ?? [];

  // Ingress 규칙 매칭
  for (const rule of ingressRules) {
    const match = rule.match ?? {};
    const route = rule.route;

    if (!route?.swarmRef) {
      ctx.logger.warn('[Discord] No swarmRef in route');
      continue;
    }

    // channel 매칭
    if (match.channel && channelId !== match.channel) {
      continue;
    }

    // eventType 매칭
    if (match.eventType && match.eventType !== 'MESSAGE_CREATE') {
      continue;
    }

    // instanceKey 추출 (guild:channel 또는 channel)
    const instanceKey = extractInstanceKey(messageData);

    // TurnAuth 생성
    const auth = createTurnAuth(messageData, guildId);

    // Origin 정보 생성
    const origin = createOrigin(messageData, connectorName);

    // metadata 생성
    const metadata = buildMetadata(messageData);

    // Canonical event 생성
    const canonicalEvent: CanonicalEvent = {
      type: 'MESSAGE_CREATE',
      swarmRef: route.swarmRef,
      instanceKey,
      input: messageData.content,
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
      `[Discord] Emitted canonical event: channel=${channelId}, ` +
      `user=${userId}, guild=${guildId || 'DM'}`
    );
    return;
  }

  ctx.logger.debug('[Discord] No matching ingress rule for message');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * instanceKey를 추출한다.
 * guild_id가 있으면 guild:channel, 없으면 dm:channel
 *
 * @param data - Discord 메시지 데이터
 * @returns instanceKey
 */
function extractInstanceKey(data: DiscordMessageData): string {
  if (data.guild_id) {
    return `discord:${data.guild_id}:${data.channel_id}`;
  }
  return `discord:dm:${data.channel_id}`;
}

/**
 * TurnAuth를 생성한다.
 *
 * @param data - Discord 메시지 데이터
 * @param guildId - 길드 ID
 * @returns TurnAuth 객체
 */
function createTurnAuth(data: DiscordMessageData, guildId: string): TurnAuth {
  const displayName = data.author.global_name ?? data.author.username;

  return {
    actor: {
      type: 'user',
      id: `discord:${data.author.id}`,
      display: displayName,
    },
    subjects: {
      global: guildId ? `discord:guild:${guildId}` : `discord:dm:${data.channel_id}`,
      user: `discord:user:${data.author.id}`,
    },
  };
}

/**
 * Origin 정보를 생성한다.
 *
 * @param data - Discord 메시지 데이터
 * @param connectorName - Connector 이름
 * @returns Origin 객체
 */
function createOrigin(data: DiscordMessageData, connectorName: string): JsonObject {
  const origin: JsonObject = {
    connector: connectorName,
    channelId: data.channel_id,
    messageId: data.id,
    userId: data.author.id,
    username: data.author.username,
    timestamp: data.timestamp,
  };

  if (data.guild_id !== undefined) {
    origin['guildId'] = data.guild_id;
  }

  return origin;
}

/**
 * metadata 정보를 생성한다.
 *
 * @param data - Discord 메시지 데이터
 * @returns metadata 객체
 */
function buildMetadata(data: DiscordMessageData): JsonObject {
  const metadata: JsonObject = {};

  if (data.mentions && data.mentions.length > 0) {
    metadata['mentionCount'] = data.mentions.length;
  }

  if (data.referenced_message) {
    metadata['isReply'] = true;
    metadata['referencedMessageId'] = data.referenced_message.id;
  }

  return metadata;
}

// ============================================================================
// Discord API Helpers (Egress용)
// ============================================================================

/**
 * Discord 메시지를 전송한다.
 *
 * @param token - Bot Token
 * @param channelId - 채널 ID
 * @param content - 메시지 내용
 * @returns API 응답
 */
export async function sendMessage(
  token: string,
  channelId: string,
  content: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    const result: unknown = await response.json();

    if (!isObject(result)) {
      return { ok: false, error: 'Invalid response format' };
    }

    // Discord API는 성공 시 메시지 객체를 반환
    const id = result['id'];
    if (isString(id)) {
      return { ok: true, id };
    }

    // 에러 응답
    const errorMessage = result['message'];
    if (isString(errorMessage)) {
      return { ok: false, error: errorMessage };
    }

    return { ok: false, error: 'Unknown error' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Discord 메시지를 수정한다.
 *
 * @param token - Bot Token
 * @param channelId - 채널 ID
 * @param messageId - 메시지 ID
 * @param content - 새 메시지 내용
 * @returns API 응답
 */
export async function editMessage(
  token: string,
  channelId: string,
  messageId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    const result: unknown = await response.json();

    if (!isObject(result)) {
      return { ok: false, error: 'Invalid response format' };
    }

    const id = result['id'];
    if (isString(id)) {
      return { ok: true };
    }

    const errorMessage = result['message'];
    if (isString(errorMessage)) {
      return { ok: false, error: errorMessage };
    }

    return { ok: false, error: 'Unknown error' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Discord 에러 코드에 대한 에러 메시지를 반환한다.
 *
 * @param errorCode - Discord API 에러 코드
 * @returns 사람이 읽을 수 있는 에러 메시지
 */
export function getErrorMessage(errorCode: number): string {
  const errorMessages: Record<number, string> = {
    10003: 'Unknown channel',
    10008: 'Unknown message',
    50001: 'Missing access',
    50013: 'Missing permissions',
    50035: 'Invalid form body',
    40001: 'Unauthorized',
    40005: 'Request entity too large',
    429: 'Rate limited',
  };

  return errorMessages[errorCode] ?? `Unknown error code: ${errorCode}`;
}
