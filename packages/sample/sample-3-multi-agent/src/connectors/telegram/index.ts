/**
 * Telegram Bot Connector
 *
 * Telegram Bot API를 사용하여 메시지를 수신하고 응답하는 커넥터입니다.
 * Long Polling 또는 Webhook 방식을 지원합니다.
 */
import type { JsonObject, ObjectRefLike } from '@goondan/core';

interface TelegramConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      agentName?: string;
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
      metadata?: JsonObject;
    }) => Promise<void>;
  };
  connectorConfig: JsonObject;
  logger?: Console;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      type: 'private' | 'group' | 'supergroup' | 'channel';
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    date: number;
    text?: string;
    reply_to_message?: TelegramUpdate['message'];
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
  };
}

interface TelegramConfig {
  metadata?: { name?: string };
  spec?: {
    botToken?: { value?: string; valueFrom?: { env?: string } };
    polling?: { enabled?: boolean; timeout?: number };
    webhook?: { enabled?: boolean; url?: string; secret?: string };
    ingress?: Array<JsonObject>;
    egress?: { parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2' };
  };
}

export function createTelegramConnector(options: TelegramConnectorOptions) {
  const logger = options.logger || console;
  const config = options.connectorConfig as TelegramConfig;
  const connectorName = config.metadata?.name || 'telegram';

  let pollingActive = false;
  let lastUpdateId = 0;

  function getBotToken(): string | undefined {
    const tokenConfig = config.spec?.botToken;
    if (!tokenConfig) return process.env.TELEGRAM_BOT_TOKEN;
    if (tokenConfig.value) return tokenConfig.value;
    if (tokenConfig.valueFrom?.env) return process.env[tokenConfig.valueFrom.env];
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  async function telegramApi<T>(method: string, body?: JsonObject): Promise<T> {
    const token = getBotToken();
    if (!token) {
      throw new Error('Telegram bot token이 필요합니다. TELEGRAM_BOT_TOKEN 환경변수를 설정하세요.');
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const result = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!result.ok) {
      throw new Error(`Telegram API 오류: ${result.description || 'Unknown error'}`);
    }

    return result.result as T;
  }

  /**
   * Telegram 이벤트 처리 (webhook 또는 직접 호출)
   */
  async function handleEvent(payload: JsonObject): Promise<void> {
    const update = payload as unknown as TelegramUpdate;
    const message = update.message;

    if (!message?.text) {
      return; // 텍스트 메시지가 아니면 무시
    }

    const ingressRules = config.spec?.ingress || [];
    const text = message.text;

    for (const rule of ingressRules) {
      const match = rule.match as { command?: string; pattern?: string } | undefined;

      // 명령어 매칭
      if (match?.command && !text.startsWith(match.command)) {
        continue;
      }

      // 패턴 매칭 (선택)
      if (match?.pattern) {
        const regex = new RegExp(match.pattern);
        if (!regex.test(text)) {
          continue;
        }
      }

      const route = rule.route as {
        swarmRef?: ObjectRefLike;
        instanceKeyFrom?: string;
        inputFrom?: string;
        agentName?: string;
      };

      if (!route?.swarmRef) {
        logger.warn('swarmRef가 없는 ingress rule입니다.');
        continue;
      }

      // 명령어 prefix 제거
      let input = text;
      if (match?.command && text.startsWith(match.command)) {
        input = text.slice(match.command.length).trim();
      }

      // 인스턴스 키: 채팅 ID + 스레드(답글) ID 조합
      // 이렇게 하면 같은 채팅방에서 새로운 대화 스레드마다 새 인스턴스가 생성됨
      const chatId = message.chat.id;
      const replyToId = message.reply_to_message?.message_id;
      const instanceKey = replyToId ? `${chatId}:${replyToId}` : `${chatId}:${message.message_id}`;

      await options.runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey,
        agentName: route.agentName,
        input,
        origin: {
          connector: connectorName,
          chatId,
          messageId: message.message_id,
          replyToMessageId: replyToId,
          chatType: message.chat.type,
          chatTitle: message.chat.title,
        },
        auth: {
          actor: {
            type: 'user',
            id: `telegram:${message.from?.id}`,
            display: formatUserName(message.from),
          },
          subjects: {
            global: `telegram:chat:${chatId}`,
            user: message.from?.id ? `telegram:user:${message.from.id}` : undefined,
          },
        },
        metadata: {
          connector: connectorName,
          telegram: {
            updateId: update.update_id,
            messageId: message.message_id,
            chatId,
            chatType: message.chat.type,
          },
        },
      });

      return;
    }

    // 기본 라우팅 (ingress 규칙이 없는 경우)
    if (ingressRules.length === 0) {
      const chatId = message.chat.id;
      const replyToId = message.reply_to_message?.message_id;
      const instanceKey = replyToId ? `${chatId}:${replyToId}` : `${chatId}:${message.message_id}`;

      await options.runtime.handleEvent({
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey,
        input: text,
        origin: {
          connector: connectorName,
          chatId,
          messageId: message.message_id,
          replyToMessageId: replyToId,
          chatType: message.chat.type,
        },
        auth: {
          actor: {
            type: 'user',
            id: `telegram:${message.from?.id}`,
            display: formatUserName(message.from),
          },
          subjects: {
            global: `telegram:chat:${chatId}`,
            user: message.from?.id ? `telegram:user:${message.from.id}` : undefined,
          },
        },
        metadata: { connector: connectorName },
      });
    }
  }

  /**
   * 메시지 송신
   */
  async function send(input: {
    text: string;
    origin?: JsonObject;
    auth?: JsonObject;
    kind?: 'progress' | 'final';
  }): Promise<JsonObject> {
    const chatId = input.origin?.chatId;
    if (!chatId) {
      throw new Error('Telegram connector: origin.chatId가 필요합니다.');
    }

    const replyToMessageId = input.origin?.messageId;
    const parseMode = config.spec?.egress?.parseMode || 'Markdown';

    // 마크다운 특수문자 이스케이프 (MarkdownV2인 경우)
    let text = input.text;
    if (parseMode === 'MarkdownV2') {
      text = escapeMarkdownV2(text);
    }

    const result = await telegramApi<JsonObject>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      reply_to_message_id: replyToMessageId,
    });

    return result;
  }

  /**
   * Long Polling 시작
   */
  async function startPolling(): Promise<void> {
    if (pollingActive) {
      logger.warn('Telegram polling이 이미 실행 중입니다.');
      return;
    }

    pollingActive = true;
    const timeout = config.spec?.polling?.timeout ?? 30;
    logger.info(`Telegram long polling 시작 (timeout: ${timeout}s)`);

    while (pollingActive) {
      try {
        const updates = await telegramApi<TelegramUpdate[]>('getUpdates', {
          offset: lastUpdateId + 1,
          timeout,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          lastUpdateId = update.update_id;
          try {
            await handleEvent(update as unknown as JsonObject);
          } catch (err) {
            logger.error('Update 처리 실패:', err);
          }
        }
      } catch (err) {
        logger.error('Telegram polling 오류:', err);
        // 연결 오류 시 잠시 대기
        await sleep(5000);
      }
    }
  }

  /**
   * Long Polling 중지
   */
  function stopPolling(): void {
    pollingActive = false;
  }

  /**
   * 파일 다운로드 URL 가져오기
   */
  async function getFileUrl(fileId: string): Promise<string> {
    const token = getBotToken();
    if (!token) {
      throw new Error('Telegram bot token이 필요합니다.');
    }

    const file = await telegramApi<{ file_path?: string }>('getFile', {
      file_id: fileId,
    });

    if (!file.file_path) {
      throw new Error('파일 경로를 가져올 수 없습니다.');
    }

    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  }

  return {
    handleEvent,
    send,
    startPolling,
    stopPolling,
    getFileUrl,
    telegramApi,
  };
}

function formatUserName(user?: { first_name: string; last_name?: string; username?: string }): string {
  if (!user) return 'Unknown';
  const parts = [user.first_name];
  if (user.last_name) parts.push(user.last_name);
  if (user.username) parts.push(`(@${user.username})`);
  return parts.join(' ');
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
