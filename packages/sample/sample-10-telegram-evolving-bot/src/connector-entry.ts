import path from "node:path";

import { BotStateStore } from "./state.js";
import { TelegramClient } from "./telegram.js";
import { toErrorMessage, type ConnectorContext } from "./types.js";

/**
 * Connector 설정 중 polling 관련 부분만 포함.
 * Connector는 이벤트 수신과 정규화만 담당한다.
 */
interface ConnectorPollingConfig {
  telegramBotToken: string;
  pollingTimeoutSeconds: number;
  pollingRetryDelayMs: number;
  stateFilePath: string;
}

function pickSecret(secrets: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = secrets[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function pickConfigString(
  secrets: Record<string, string>,
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const secretValue = secrets[key];
  if (typeof secretValue === "string" && secretValue.trim().length > 0) {
    return secretValue;
  }
  const envValue = env[key];
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    return envValue;
  }
  return undefined;
}

function readPositiveInteger(raw: string | undefined, fallback: number, field: string): number {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field}는 양의 정수여야 합니다.`);
  }
  return parsed;
}

function loadPollingConfig(ctx: ConnectorContext): ConnectorPollingConfig {
  const telegramBotToken = pickSecret(ctx.secrets, ["TELEGRAM_BOT_TOKEN", "BOT_TOKEN", "TELEGRAM_TOKEN"]);
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN secret is required");
  }

  const projectRoot = path.resolve(process.env.BOT_PROJECT_ROOT ?? process.cwd());
  const stateFilePath = path.resolve(
    projectRoot,
    process.env.BOT_STATE_FILE ?? ".telegram-evolving-bot-state.json",
  );

  return {
    telegramBotToken,
    pollingTimeoutSeconds: readPositiveInteger(
      pickConfigString(ctx.secrets, process.env, "TELEGRAM_POLL_TIMEOUT_SECONDS"),
      25,
      "TELEGRAM_POLL_TIMEOUT_SECONDS",
    ),
    pollingRetryDelayMs: readPositiveInteger(
      pickConfigString(ctx.secrets, process.env, "TELEGRAM_POLL_RETRY_DELAY_MS"),
      3000,
      "TELEGRAM_POLL_RETRY_DELAY_MS",
    ),
    stateFilePath,
  };
}

async function emitIncomingEvent(ctx: ConnectorContext, update: {
  updateId: number;
  chatId: number;
  messageId: number;
  text: string;
  fromDisplayName: string;
}): Promise<void> {
  try {
    await ctx.emit({
      name: "telegram_message",
      instanceKey: `telegram:${String(update.chatId)}`,
      message: {
        type: "text",
        text: update.text,
      },
      properties: {
        update_id: String(update.updateId),
        chat_id: String(update.chatId),
        from_username: update.fromDisplayName,
        message_id: String(update.messageId),
      },
    });
  } catch (error) {
    ctx.logger.warn(`[sample-10] connector emit warning: ${toErrorMessage(error)}`);
  }
}

function shouldStop(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runConnectorLoop(ctx: ConnectorContext): Promise<void> {
  const config = loadPollingConfig(ctx);
  const state = await BotStateStore.create(config.stateFilePath);
  const telegram = new TelegramClient(config.telegramBotToken);

  const controller = new AbortController();
  const shutdown = (): void => {
    controller.abort();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    while (!shouldStop(controller.signal)) {
      try {
        const updates = await telegram.getUpdates(
          state.getOffset(),
          config.pollingTimeoutSeconds,
        );
        for (const update of updates) {
          if (shouldStop(controller.signal)) {
            break;
          }

          state.setOffset(update.updateId + 1);
          await emitIncomingEvent(ctx, update);
          await state.save();
        }
      } catch (error) {
        const message = toErrorMessage(error);
        ctx.logger.warn(`[sample-10] polling warning: ${message}`);
        await waitForRetry(config.pollingRetryDelayMs, controller.signal);
      }
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await state.save();
  }
}

/**
 * Runtime Connector entry (default export).
 * Connector 스펙에 따라 polling + emit만 수행한다.
 */
export default async function run(ctx: ConnectorContext): Promise<void> {
  await runConnectorLoop(ctx);
}
