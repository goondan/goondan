/**
 * Discord Connector 구현 (v1.0)
 *
 * Discord Gateway/Webhook 이벤트를 처리하여 ConnectorEvent로 변환하고 emit한다.
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
import { createPublicKey, verify as verifySignature } from 'node:crypto';

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

const DISCORD_ED25519_PUBLIC_KEY_DER_PREFIX = Buffer.from(
  '302a300506032b6570032100',
  'hex',
);

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
 * HttpTriggerPayload 타입 가드
 */
function isHttpTrigger(trigger: { type: string }): trigger is HttpTriggerPayload {
  return trigger.type === 'http';
}

/**
 * hex 문자열 타입 가드
 */
function isHexString(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
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
 * Discord 공개키(hex)를 Node KeyObject로 변환한다.
 */
function createDiscordPublicKey(signingSecret: string) {
  if (signingSecret.length !== 64 || !isHexString(signingSecret)) {
    return undefined;
  }

  const rawPublicKey = Buffer.from(signingSecret, 'hex');
  const derKey = Buffer.concat([
    DISCORD_ED25519_PUBLIC_KEY_DER_PREFIX,
    rawPublicKey,
  ]);

  try {
    return createPublicKey({
      key: derKey,
      format: 'der',
      type: 'spki',
    });
  } catch {
    return undefined;
  }
}

/**
 * Discord 요청 서명을 검증한다.
 */
function verifyDiscordRequest(
  request: HttpTriggerPayload['payload']['request'],
  signingSecret: string,
): boolean {
  const signature = getHeaderValue(request.headers, 'x-signature-ed25519');
  const timestamp = getHeaderValue(request.headers, 'x-signature-timestamp');

  if (!signature || !timestamp) {
    return false;
  }

  if (signature.length !== 128 || !isHexString(signature)) {
    return false;
  }

  const rawBody = getRequestRawBody(request);
  if (rawBody === undefined) {
    return false;
  }

  const publicKey = createDiscordPublicKey(signingSecret);
  if (!publicKey) {
    return false;
  }

  const message = Buffer.from(`${timestamp}${rawBody}`, 'utf8');
  const signatureBytes = Buffer.from(signature, 'hex');
  return verifySignature(null, message, publicKey, signatureBytes);
}

/**
 * Connection verify 설정이 있을 때 Discord 서명을 검증한다.
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

  const verified = verifyDiscordRequest(request, signingSecret);
  if (verified) {
    context.logger.debug('[Discord] Signature verification passed');
    return true;
  }

  context.logger.warn('[Discord] Signature verification failed');
  return false;
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
// Connector Entry Function (단일 default export)
// ============================================================================

/**
 * Discord Connector Entry Function
 *
 * Discord Webhook으로부터 이벤트를 받아
 * ConnectorEvent로 변환하여 emit한다.
 */
const discordConnector = async function (context: ConnectorContext): Promise<void> {
  const { event, emit, logger } = context;

  // connector.trigger 이벤트만 처리
  if (event.type !== 'connector.trigger') {
    return;
  }

  const trigger = event.trigger;

  // HTTP trigger만 처리
  if (!isHttpTrigger(trigger)) {
    logger.debug('[Discord] Not an HTTP trigger, skipping');
    return;
  }

  const requestBody = trigger.payload.request.body;

  // verify.webhook.signingSecret이 제공된 경우 서명 검증
  if (!runVerifyHook(context, trigger.payload.request)) {
    return;
  }

  // 페이로드 파싱
  const payload = parseDiscordPayload(requestBody);
  if (!payload) {
    logger.warn('[Discord] Invalid payload received');
    return;
  }

  // MESSAGE_CREATE 이벤트만 처리
  if (payload.t !== 'MESSAGE_CREATE') {
    logger.debug(`[Discord] Ignoring event type: ${payload.t ?? 'unknown'}`);
    return;
  }

  const messageData = payload.d;
  if (!messageData) {
    logger.warn('[Discord] No message data in payload');
    return;
  }

  // 봇 메시지 무시 (무한 루프 방지)
  if (messageData.author.bot) {
    logger.debug('[Discord] Ignoring bot message');
    return;
  }

  // 빈 메시지 무시
  if (!messageData.content.trim()) {
    logger.debug('[Discord] Empty message content, skipping');
    return;
  }

  const userId = messageData.author.id;
  const channelId = messageData.channel_id;
  const guildId = messageData.guild_id ?? '';
  const displayName = messageData.author.global_name ?? messageData.author.username;

  // ConnectorEvent 생성 및 발행
  const connectorEvent: ConnectorEvent = {
    type: 'connector.event',
    name: 'discord.message',
    message: {
      type: 'text',
      text: messageData.content,
    },
    properties: {
      channelId,
      guildId,
      userId,
      username: messageData.author.username,
      messageId: messageData.id,
      timestamp: messageData.timestamp,
    },
    auth: {
      actor: {
        id: `discord:${userId}`,
        name: displayName,
      },
      subjects: {
        global: guildId ? `discord:guild:${guildId}` : `discord:dm:${channelId}`,
        user: `discord:user:${userId}`,
      },
    },
  };

  await emit(connectorEvent);

  logger.info(
    `[Discord] Emitted connector event: name=discord.message, ` +
    `channel=${channelId}, user=${userId}, guild=${guildId || 'DM'}`
  );
};

export default discordConnector;

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
