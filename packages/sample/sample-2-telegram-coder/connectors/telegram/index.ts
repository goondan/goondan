/**
 * Telegram Connector 구현
 *
 * Telegram 봇 API를 통해 메시지를 수신하고 응답을 전송하는 Connector입니다.
 *
 * @see /docs/specs/connector.md - 11. Custom Connector with Triggers
 */

import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  TurnAuth,
} from '@goondan/core/connector';
import type { JsonObject } from '@goondan/core';

/**
 * Telegram Update 객체 타입
 * @see https://core.telegram.org/bots/api#update
 */
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Telegram Message 객체 타입
 * @see https://core.telegram.org/bots/api#message
 */
interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
}

/**
 * Telegram User 객체 타입
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
 * Telegram Chat 객체 타입
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
 * Telegram Message Entity 객체 타입
 */
interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

/**
 * Telegram Callback Query 객체 타입
 */
interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

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
 * 메시지에서 명령어를 추출합니다.
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

/**
 * Telegram Update 이벤트 핸들러
 *
 * Telegram Webhook으로부터 Update를 받아 처리합니다.
 *
 * @param event - Trigger 이벤트
 * @param _connection - Connection 설정 (미사용)
 * @param ctx - Trigger 컨텍스트
 */
export async function onTelegramUpdate(
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
    ctx.logger.warn('Invalid Telegram update payload');
    return;
  }

  // 메시지 추출 (일반 메시지 또는 수정된 메시지)
  const message = payload.message ?? payload.edited_message;
  if (!message || !isTelegramMessage(message)) {
    ctx.logger.debug('No message in update, skipping');
    return;
  }

  // 텍스트가 없으면 스킵
  if (!message.text) {
    ctx.logger.debug('No text in message, skipping');
    return;
  }

  // 명령어 추출
  const command = extractCommand(message);

  // Ingress 규칙 매칭
  for (const rule of ingressRules) {
    const match = rule.match;
    const route = rule.route;

    if (!route?.swarmRef) {
      ctx.logger.warn('ingress rule에 swarmRef가 없습니다.');
      continue;
    }

    // 명령어 매칭
    if (match?.command) {
      if (command !== match.command) {
        continue;
      }
    }

    // 채널 매칭 (chatId)
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
      switch (command) {
        case '/start':
          inputText = '안녕하세요! 저는 코딩을 도와주는 봇입니다. 어떤 도움이 필요하신가요?';
          break;
        case '/code':
          inputText = '코드 작성을 시작합니다. 어떤 코드를 작성하면 될까요?';
          break;
        default:
          inputText = `${command} 명령어를 실행합니다.`;
      }
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

    ctx.logger.info(`Telegram message routed: chat=${message.chat.id}, command=${command ?? 'none'}`);
    return;
  }

  ctx.logger.debug('No matching ingress rule found');
}

/**
 * Telegram에 메시지를 전송합니다.
 *
 * @param token - Bot Token
 * @param chatId - Chat ID
 * @param text - 전송할 텍스트
 * @param replyToMessageId - 답장할 메시지 ID (선택)
 */
export async function sendTelegramMessage(
  token: string,
  chatId: number | string,
  text: string,
  replyToMessageId?: number
): Promise<{ ok: boolean; result?: JsonObject; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };

  if (replyToMessageId !== undefined) {
    body['reply_to_message_id'] = replyToMessageId;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as { ok: boolean; result?: JsonObject; description?: string };

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    return { ok: true, result: data.result };
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
 */
export async function editTelegramMessage(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string
): Promise<{ ok: boolean; result?: JsonObject; error?: string }> {
  const url = `https://api.telegram.org/bot${token}/editMessageText`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as { ok: boolean; result?: JsonObject; description?: string };

    if (!data.ok) {
      return { ok: false, error: data.description ?? 'Unknown error' };
    }

    return { ok: true, result: data.result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}
