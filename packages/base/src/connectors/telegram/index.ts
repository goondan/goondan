/**
 * Telegram Connector (v1.0)
 *
 * Telegram Bot API를 통해 메시지를 수신하고 ConnectorEvent로 변환하여 emit한다.
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
import type { JsonObject } from '@goondan/core';
import { timingSafeEqual } from 'node:crypto';

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
  if (typeof direct === 'string') {
    return direct;
  }

  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

/**
 * Telegram secret token 헤더를 검증한다.
 */
function verifyTelegramRequest(
  request: HttpTriggerPayload['payload']['request'],
  signingSecret: string,
): boolean {
  const token = getHeaderValue(
    request.headers,
    'x-telegram-bot-api-secret-token',
  );

  if (!token) {
    return false;
  }

  const tokenBuffer = Buffer.from(token, 'utf8');
  const secretBuffer = Buffer.from(signingSecret, 'utf8');

  if (tokenBuffer.length !== secretBuffer.length) {
    return false;
  }

  return timingSafeEqual(tokenBuffer, secretBuffer);
}

/**
 * Connection verify 설정이 있을 때 Telegram 서명을 검증한다.
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

  const verified = verifyTelegramRequest(request, signingSecret);
  if (verified) {
    context.logger.debug('[Telegram] Signature verification passed');
    return true;
  }

  context.logger.warn('[Telegram] Signature verification failed');
  return false;
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
 */
function extractCommand(message: TelegramMessage): string | undefined {
  if (!message.text || !message.entities) {
    return undefined;
  }

  for (const entity of message.entities) {
    if (entity.type === 'bot_command' && entity.offset === 0) {
      const command = message.text.substring(entity.offset, entity.offset + entity.length);
      return command.split('@')[0];
    }
  }

  return undefined;
}

/**
 * 명령어를 제거한 텍스트를 반환합니다.
 */
function removeCommand(text: string, command: string): string {
  const pattern = new RegExp(`^${command}(@\\w+)?\\s*`, 'i');
  return text.replace(pattern, '').trim();
}

/**
 * 명령어에 대한 기본 입력 텍스트를 반환합니다.
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
// Connector Entry Function (단일 default export)
// ============================================================================

/**
 * Telegram Connector Entry Function
 *
 * Telegram Webhook으로부터 Update를 받아 ConnectorEvent로 변환하여 emit한다.
 */
const telegramConnector = async function (context: ConnectorContext): Promise<void> {
  const { event, emit, logger } = context;

  // connector.trigger 이벤트만 처리
  if (event.type !== 'connector.trigger') {
    return;
  }

  const trigger = event.trigger;

  // HTTP trigger만 처리
  if (!isHttpTrigger(trigger)) {
    logger.debug('[Telegram] Not an HTTP trigger, skipping');
    return;
  }

  const requestBody = trigger.payload.request.body;

  // verify.webhook.signingSecret이 제공된 경우 서명 검증
  if (!runVerifyHook(context, trigger.payload.request)) {
    return;
  }

  // Telegram Update 검증
  if (!isTelegramUpdate(requestBody)) {
    logger.warn('[Telegram] Invalid update payload received');
    return;
  }

  // 메시지 추출 (일반 메시지 또는 수정된 메시지)
  const message = requestBody.message ?? requestBody.edited_message;
  if (!message || !isTelegramMessage(message)) {
    logger.debug('[Telegram] No message in update, skipping');
    return;
  }

  // 텍스트가 없으면 스킵
  if (!message.text) {
    logger.debug('[Telegram] No text in message, skipping');
    return;
  }

  // 명령어 추출
  const command = extractCommand(message);

  // 입력 텍스트 추출 (명령어가 있으면 제거)
  let inputText = message.text;
  if (command) {
    inputText = removeCommand(message.text, command);
  }

  // 빈 입력 처리 (/start 등 명령어만 있는 경우)
  if (!inputText && command) {
    inputText = getDefaultInputForCommand(command);
  }

  const userId = message.from?.id?.toString() ?? 'unknown';
  const displayName = message.from
    ? [message.from.first_name, message.from.last_name].filter(Boolean).join(' ') || message.from.username || userId
    : 'Unknown User';

  // ConnectorEvent 생성 및 발행
  const connectorEvent: ConnectorEvent = {
    type: 'connector.event',
    name: 'telegram.message',
    message: {
      type: 'text',
      text: inputText || '',
    },
    properties: {
      chatId: message.chat.id.toString(),
      userId,
      chatType: message.chat.type,
      messageId: message.message_id,
    },
    auth: {
      actor: {
        id: `telegram:${userId}`,
        name: displayName,
      },
      subjects: {
        global: `telegram:chat:${message.chat.id}`,
        user: `telegram:user:${userId}`,
      },
    },
  };

  await emit(connectorEvent);

  logger.info(
    `[Telegram] Message emitted: chat=${message.chat.id}, command=${command ?? 'none'}`
  );
};

export default telegramConnector;

// ============================================================================
// Telegram API 함수
// ============================================================================

/**
 * Telegram에 메시지를 전송합니다.
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
