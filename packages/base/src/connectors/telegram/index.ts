/**
 * Telegram Bot Connector Adapter
 *
 * Long Polling 또는 Webhook을 통해 Telegram 봇 메시지를 수신합니다.
 */
import type { ConnectorAdapter, ConnectorFactory } from '@goondan/core';
import type { JsonObject, ObjectRefLike } from '@goondan/core';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
    date: number;
  };
}

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

function isTelegramApiResponse(data: JsonObject): data is JsonObject & TelegramApiResponse {
  return typeof data.ok === 'boolean';
}

function isTelegramUpdateArray(data: unknown): data is TelegramUpdate[] {
  if (!Array.isArray(data)) return false;
  return data.every((item) => typeof item === 'object' && item !== null && typeof (item as TelegramUpdate).update_id === 'number');
}

export const createTelegramConnectorAdapter: ConnectorFactory = (options) => {
  const { runtime, connectorConfig, logger } = options;
  const spec = connectorConfig.spec as JsonObject;

  // Bot Token 획득
  const botTokenConfig = spec.botToken as JsonObject | undefined;
  let botToken: string | null = null;

  if (botTokenConfig?.value) {
    botToken = botTokenConfig.value as string;
  } else if (botTokenConfig?.valueFrom) {
    const valueFrom = botTokenConfig.valueFrom as JsonObject;
    if (valueFrom.env) {
      botToken = process.env[valueFrom.env as string] || null;
    }
  }

  if (!botToken) {
    logger?.warn?.('Telegram Bot Token이 설정되지 않았습니다. TELEGRAM_BOT_TOKEN 환경변수를 확인하세요.');
  }

  // Polling 설정
  const pollingConfig = spec.polling as JsonObject | undefined;
  const pollingEnabled = pollingConfig?.enabled !== false;
  const pollingTimeout = (pollingConfig?.timeout as number) || 30;

  // Ingress 라우팅 규칙
  const ingressRules = (spec.ingress as JsonObject[] | undefined) || [];

  // Egress 설정
  const egressConfig = spec.egress as JsonObject | undefined;
  const parseMode = (egressConfig?.parseMode as string) || 'Markdown';

  let offset = 0;
  let polling = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Telegram API 호출
   */
  async function callTelegramApi(method: string, body?: JsonObject): Promise<JsonObject> {
    if (!botToken) {
      throw new Error('Telegram Bot Token이 설정되지 않았습니다.');
    }
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await response.json()) as JsonObject;
  }

  /**
   * 메시지 라우팅 및 처리
   */
  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text) return;

    const text = msg.text;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';

    logger?.info?.(`[Telegram] ${username}: ${text}`);

    // Ingress 규칙 매칭
    for (const rule of ingressRules) {
      const match = rule.match as JsonObject | undefined;
      const route = rule.route as JsonObject | undefined;

      // command 매칭
      if (match?.command) {
        const cmd = match.command as string;
        if (!text.startsWith(cmd)) continue;
      }

      if (!route?.swarmRef) continue;

      const swarmRef = route.swarmRef as ObjectRefLike;
      const instanceKey = `telegram-${chatId}`;

      // Runtime에 이벤트 전달
      await runtime.handleEvent({
        swarmRef,
        instanceKey,
        input: text,
        origin: {
          connector: connectorConfig.metadata.name,
          platform: 'telegram',
          chatId,
          messageId: msg.message_id,
          userId,
          username,
        },
        auth: {
          actor: { type: 'user', id: `telegram:${userId}` },
          subjects: {
            global: `telegram:chat:${chatId}`,
            user: `telegram:user:${userId}`,
          },
        },
        metadata: {
          connector: connectorConfig.metadata.name,
          updateId: update.update_id,
        },
      });
      return;
    }

    // 기본 라우팅 (route만 있고 match가 없는 규칙)
    const defaultRule = ingressRules.find((r) => {
      const rule = r as JsonObject;
      return !rule.match && rule.route;
    });

    if (defaultRule) {
      const route = (defaultRule as JsonObject).route as JsonObject;
      const swarmRef = route.swarmRef as ObjectRefLike;
      const instanceKey = `telegram-${chatId}`;

      await runtime.handleEvent({
        swarmRef,
        instanceKey,
        input: text,
        origin: {
          connector: connectorConfig.metadata.name,
          platform: 'telegram',
          chatId,
          messageId: msg.message_id,
          userId,
          username,
        },
        auth: {
          actor: { type: 'user', id: `telegram:${userId}` },
          subjects: {
            global: `telegram:chat:${chatId}`,
            user: `telegram:user:${userId}`,
          },
        },
        metadata: {
          connector: connectorConfig.metadata.name,
          updateId: update.update_id,
        },
      });
    }
  }

  /**
   * Long Polling 루프
   */
  async function pollLoop(): Promise<void> {
    if (!polling || !botToken) return;

    try {
      const data = await callTelegramApi(`getUpdates?offset=${offset}&timeout=${pollingTimeout}`);

      if (isTelegramApiResponse(data) && data.ok && isTelegramUpdateArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            logger?.error?.('Telegram 메시지 처리 오류:', err);
            // 에러 발생 시 사용자에게 알림
            if (update.message?.chat.id) {
              await callTelegramApi('sendMessage', {
                chat_id: update.message.chat.id,
                text: `오류가 발생했습니다: ${(err as Error).message}`,
              });
            }
          }
        }
      }
    } catch (err) {
      logger?.error?.('Telegram polling 오류:', err);
    }

    // 다음 polling 예약
    if (polling) {
      pollTimer = setTimeout(() => void pollLoop(), 100);
    }
  }

  const adapter: ConnectorAdapter = {
    /**
     * 외부에서 직접 이벤트를 전달받을 때 (Webhook 등)
     */
    async handleEvent(payload: JsonObject): Promise<void> {
      const updateId = payload.update_id;
      if (typeof updateId === 'number') {
        await handleUpdate(payload as unknown as TelegramUpdate);
      }
    },

    /**
     * 메시지 전송
     */
    async send(input): Promise<unknown> {
      if (!botToken) {
        throw new Error('Telegram Bot Token이 설정되지 않았습니다.');
      }

      const chatId = (input.origin as JsonObject | undefined)?.chatId as number | undefined;
      if (!chatId) {
        logger?.warn?.('Telegram send: chatId가 없습니다.');
        return { ok: false, error: 'chatId not found in origin' };
      }

      const result = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: input.text,
        parse_mode: parseMode,
      });

      return result;
    },

    /**
     * Long Polling 시작
     */
    async start(): Promise<void> {
      if (!botToken) {
        logger?.warn?.('Telegram Bot Token이 없어 polling을 시작할 수 없습니다.');
        return;
      }

      if (!pollingEnabled) {
        logger?.info?.('Telegram polling이 비활성화되어 있습니다.');
        return;
      }

      polling = true;
      logger?.info?.(`Telegram 봇 polling 시작 (timeout: ${pollingTimeout}s)`);

      // 봇 정보 확인
      try {
        const me = await callTelegramApi('getMe');
        if (isTelegramApiResponse(me) && me.ok) {
          const result = me.result as JsonObject;
          logger?.info?.(`Telegram 봇: @${result.username}`);
        }
      } catch {
        // ignore
      }

      void pollLoop();
    },

    /**
     * Polling 중지
     */
    async stop(): Promise<void> {
      polling = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      logger?.info?.('Telegram 봇 polling 중지');
    },
  };

  return adapter;
};
