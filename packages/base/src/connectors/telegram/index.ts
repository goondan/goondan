/**
 * Telegram Connector
 *
 * Telegram Bot API를 통해 메시지를 수신하고 응답을 전송하는 Connector입니다.
 * 이 모듈은 @goondan/base 패키지에서 재사용 가능한 기본 Connector로 제공됩니다.
 *
 * @see /docs/specs/connector.md - Connector 시스템 스펙
 * @packageDocumentation
 */

import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  ConnectorTurnAuth,
  JsonObject,
} from '@goondan/core';

/**
 * TurnAuth 타입 별칭
 */
type TurnAuth = ConnectorTurnAuth;

// ============================================================================
// Telegram API 타입 정의
// ============================================================================

/**
 * Telegram Update 객체
 * @see https://core.telegram.org/bots/api#update
 */
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Telegram Message 객체
 * @see https://core.telegram.org/bots/api#message
 */
interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
  reply_to_message?: TelegramMessage;
}

/**
 * Telegram User 객체
 * @see https://core.telegram.org/bots/api#user
 */
interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram Chat 객체
 * @see https://core.telegram.org/bots/api#chat
 */
interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Telegram Message Entity 객체
 * @see https://core.telegram.org/bots/api#messageentity
 */
interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

/**
 * Telegram Callback Query 객체
 * @see https://core.telegram.org/bots/api#callbackquery
 */
interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

/**
 * Telegram API 응답
 */
interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ============================================================================
// 타입 가드
// ============================================================================

/**
 * object 타입 가드
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Telegram Update 타입 가드
 */
function isTelegramUpdate(payload: unknown): payload is TelegramUpdate {
  if (!isObject(payload)) {
    return false;
  }
  return typeof payload['update_id'] === 'number';
}

/**
 * Telegram Message 타입 가드
 */
function isTelegramMessage(message: unknown): message is TelegramMessage {
  if (!isObject(message)) {
    return false;
  }
  return (
    typeof message['message_id'] === 'number' &&
    isObject(message['chat'])
  );
}

/**
 * Telegram API 응답 타입 가드
 */
function isTelegramApiResponse(data: unknown): data is TelegramApiResponse {
  if (!isObject(data)) {
    return false;
  }
  return typeof data['ok'] === 'boolean';
}

/**
 * result가 JsonObject인지 확인하는 타입 가드
 */
function hasJsonObjectResult(
  response: TelegramApiResponse
): response is TelegramApiResponse & { result: JsonObject } {
  return response.result !== undefined && isObject(response.result);
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 메시지에서 봇 명령어를 추출합니다.
 *
 * @param message - Telegram Message
 * @returns 명령어 문자열 또는 undefined
 */
function extractCommand(message: TelegramMessage): string | undefined {
  if (!message.text || !message.entities) {
    return undefined;
  }

  for (const entity of message.entities) {
    if (entity.type === 'bot_command' && entity.offset === 0) {
      const command = message.text.substring(entity.offset, entity.offset + entity.length);
      // @botname 부분 제거
      return command.split('@')[0];
    }
  }

  return undefined;
}

/**
 * 명령어를 제거한 텍스트를 반환합니다.
 *
 * @param text - 원본 텍스트
 * @param command - 제거할 명령어
 * @returns 명령어가 제거된 텍스트
 */
function removeCommand(text: string, command: string): string {
  // 명령어와 @botname 부분 제거
  const pattern = new RegExp(`^${command}(@\\w+)?\\s*`, 'i');
  return text.replace(pattern, '').trim();
}

/**
 * TurnAuth를 생성합니다.
 *
 * @param message - Telegram Message
 * @returns TurnAuth 객체
 */
function createTurnAuth(message: TelegramMessage): TurnAuth {
  const user = message.from;
  const chat = message.chat;

  const userId = user?.id?.toString() ?? 'unknown';
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || userId
    : 'Unknown User';

  return {
    actor: {
      type: 'user',
      id: `telegram:${userId}`,
      display: displayName,
    },
    subjects: {
      // 글로벌 subject: 채팅 ID (그룹 또는 개인)
      global: `telegram:chat:${chat.id}`,
      // 사용자 subject: 사용자 ID
      user: `telegram:user:${userId}`,
    },
  };
}

/**
 * Origin 정보를 생성합니다.
 *
 * @param message - Telegram Message
 * @param connectorName - Connector 이름
 * @returns Origin 객체
 */
function createOrigin(message: TelegramMessage, connectorName: string): JsonObject {
  return {
    connector: connectorName,
    chatId: message.chat.id,
    messageId: message.message_id,
    chatType: message.chat.type,
    userId: message.from?.id ?? null,
    username: message.from?.username ?? null,
    timestamp: new Date(message.date * 1000).toISOString(),
  };
}

// ============================================================================
// Trigger Handler
// ============================================================================

/**
 * Telegram Update 이벤트 핸들러
 *
 * Telegram Webhook으로부터 Update를 받아 처리합니다.
 * connector.yaml의 triggers에 handler: onUpdate로 등록되어야 합니다.
 *
 * @param event - Trigger 이벤트
 * @param _connection - Connection 설정 (현재 미사용)
 * @param ctx - Trigger 컨텍스트
 */
export async function onUpdate(
  event: TriggerEvent,
  _connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  const payload = event.payload;
  const connector = ctx.connector;
  const connectorName = connector.metadata?.name ?? 'telegram';
  const ingressRules = connector.spec.ingress ?? [];

  // Telegram Update 검증
  if (!isTelegramUpdate(payload)) {
    ctx.logger.warn('[Telegram] Invalid update payload received');
    return;
  }

  // 메시지 추출 (일반 메시지 또는 수정된 메시지)
  const message = payload.message ?? payload.edited_message;
  if (!message || !isTelegramMessage(message)) {
    ctx.logger.debug('[Telegram] No message in update, skipping');
    return;
  }

  // 텍스트가 없으면 스킵 (이미지, 스티커 등)
  if (!message.text) {
    ctx.logger.debug('[Telegram] No text in message, skipping');
    return;
  }

  // 명령어 추출
  const command = extractCommand(message);

  // Ingress 규칙 매칭
  for (const rule of ingressRules) {
    const match = rule.match;
    const route = rule.route;

    if (!route?.swarmRef) {
      ctx.logger.warn('[Telegram] Ingress rule missing swarmRef');
      continue;
    }

    // 명령어 매칭 (match.command가 있으면 검사)
    if (match?.command) {
      if (command !== match.command) {
        continue;
      }
    }

    // 채널 매칭 (match.channel이 있으면 검사)
    if (match?.channel) {
      if (message.chat.id.toString() !== match.channel) {
        continue;
      }
    }

    // 입력 텍스트 추출 (명령어가 있으면 제거)
    let inputText = message.text;
    if (command) {
      inputText = removeCommand(message.text, command);
    }

    // 빈 입력 처리 (/start 등 명령어만 있는 경우)
    if (!inputText && command) {
      inputText = getDefaultInputForCommand(command);
    }

    // CanonicalEvent 생성
    const canonicalEvent: CanonicalEvent = {
      type: 'telegram_message',
      swarmRef: route.swarmRef,
      instanceKey: message.chat.id.toString(),
      input: inputText || '',
      origin: createOrigin(message, connectorName),
      auth: createTurnAuth(message),
    };

    // agentName이 지정된 경우 추가
    if (route.agentName) {
      canonicalEvent.agentName = route.agentName;
    }

    // 이벤트 발행
    await ctx.emit(canonicalEvent);

    ctx.logger.info(
      `[Telegram] Message routed: chat=${message.chat.id}, command=${command ?? 'none'}`
    );
    return;
  }

  ctx.logger.debug('[Telegram] No matching ingress rule found');
}

/**
 * 명령어에 대한 기본 입력 텍스트를 반환합니다.
 *
 * @param command - 명령어
 * @returns 기본 입력 텍스트
 */
function getDefaultInputForCommand(command: string): string {
  switch (command) {
    case '/start':
      return '안녕하세요! 무엇을 도와드릴까요?';
    case '/help':
      return '도움말을 요청합니다.';
    default:
      return `${command} 명령어를 실행합니다.`;
  }
}

// ============================================================================
// Telegram API 함수
// ============================================================================

/**
 * Telegram에 메시지를 전송합니다.
 *
 * @param token - Bot Token
 * @param chatId - Chat ID
 * @param text - 전송할 텍스트
 * @param options - 추가 옵션
 * @returns API 응답
 */
export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  options?: {
    replyToMessageId?: number;
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    disableNotification?: boolean;
  }
): Promise<{ ok: boolean; result?: JsonObject; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode ?? 'Markdown',
  };

  if (options?.replyToMessageId !== undefined) {
    body['reply_to_message_id'] = options.replyToMessageId;
  }

  if (options?.disableNotification !== undefined) {
    body['disable_notification'] = options.disableNotification;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: unknown = await response.json();

    if (!isTelegramApiResponse(data)) {
      return { ok: false, error: 'Invalid API response format' };
    }

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    if (hasJsonObjectResult(data)) {
      return { ok: true, result: data.result };
    }
    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Telegram 메시지를 수정합니다.
 *
 * @param token - Bot Token
 * @param chatId - Chat ID
 * @param messageId - 수정할 메시지 ID
 * @param text - 새로운 텍스트
 * @param options - 추가 옵션
 * @returns API 응답
 */
export async function editMessage(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  options?: {
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  }
): Promise<{ ok: boolean; result?: JsonObject; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/editMessageText`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options?.parseMode ?? 'Markdown',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: unknown = await response.json();

    if (!isTelegramApiResponse(data)) {
      return { ok: false, error: 'Invalid API response format' };
    }

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    if (hasJsonObjectResult(data)) {
      return { ok: true, result: data.result };
    }
    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Telegram 메시지를 삭제합니다.
 *
 * @param token - Bot Token
 * @param chatId - Chat ID
 * @param messageId - 삭제할 메시지 ID
 * @returns API 응답
 */
export async function deleteMessage(
  token: string,
  chatId: number | string,
  messageId: number
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/deleteMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: unknown = await response.json();

    if (!isTelegramApiResponse(data)) {
      return { ok: false, error: 'Invalid API response format' };
    }

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Webhook URL을 설정합니다.
 *
 * @param token - Bot Token
 * @param webhookUrl - Webhook URL
 * @param options - 추가 옵션
 * @returns API 응답
 */
export async function setWebhook(
  token: string,
  webhookUrl: string,
  options?: {
    secretToken?: string;
    maxConnections?: number;
    allowedUpdates?: string[];
  }
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/setWebhook`;

  const body: Record<string, unknown> = {
    url: webhookUrl,
  };

  if (options?.secretToken) {
    body['secret_token'] = options.secretToken;
  }

  if (options?.maxConnections !== undefined) {
    body['max_connections'] = options.maxConnections;
  }

  if (options?.allowedUpdates) {
    body['allowed_updates'] = options.allowedUpdates;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: unknown = await response.json();

    if (!isTelegramApiResponse(data)) {
      return { ok: false, error: 'Invalid API response format' };
    }

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Webhook 정보를 조회합니다.
 *
 * @param token - Bot Token
 * @returns Webhook 정보
 */
export async function getWebhookInfo(
  token: string
): Promise<{ ok: boolean; result?: JsonObject; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;

  try {
    const response = await fetch(url, {
      method: 'GET',
    });

    const data: unknown = await response.json();

    if (!isTelegramApiResponse(data)) {
      return { ok: false, error: 'Invalid API response format' };
    }

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    if (hasJsonObjectResult(data)) {
      return { ok: true, result: data.result };
    }
    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * Webhook을 삭제합니다.
 *
 * @param token - Bot Token
 * @param dropPendingUpdates - 대기 중인 업데이트 삭제 여부
 * @returns API 응답
 */
export async function deleteWebhook(
  token: string,
  dropPendingUpdates?: boolean
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/deleteWebhook`;

  const body: Record<string, unknown> = {};

  if (dropPendingUpdates !== undefined) {
    body['drop_pending_updates'] = dropPendingUpdates;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: unknown = await response.json();

    if (!isTelegramApiResponse(data)) {
      return { ok: false, error: 'Invalid API response format' };
    }

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

// ============================================================================
// 타입 재export
// ============================================================================

export type {
  TelegramUpdate,
  TelegramMessage,
  TelegramUser,
  TelegramChat,
  TelegramMessageEntity,
  TelegramCallbackQuery,
};
