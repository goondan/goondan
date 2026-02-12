import fs from "node:fs/promises";
import path from "node:path";

import { requestAnthropicText } from "./anthropic.js";
import { applyEvolutionPlan, requestEvolutionPlan } from "./evolve.js";
import { BotStateStore, type ConversationTurn } from "./state.js";
import { TelegramClient, type TelegramTextUpdate } from "./telegram.js";
import { toErrorMessage, type ConnectorContext } from "./types.js";

interface ConnectorBotConfig {
  telegramBotToken: string;
  anthropicApiKey: string;
  anthropicModel: string;
  anthropicMaxTokens: number;
  pollingTimeoutSeconds: number;
  pollingRetryDelayMs: number;
  projectRoot: string;
  stateFilePath: string;
  backupRootDir: string;
  maxConversationTurns: number;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

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

function loadConfigFromContext(ctx: ConnectorContext): ConnectorBotConfig {
  const telegramBotToken = pickSecret(ctx.secrets, ["TELEGRAM_BOT_TOKEN", "BOT_TOKEN", "TELEGRAM_TOKEN"]);
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN secret is required");
  }

  const anthropicApiKey = pickSecret(ctx.secrets, ["ANTHROPIC_API_KEY"]);
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY secret is required");
  }

  const projectRoot = path.resolve(process.env.BOT_PROJECT_ROOT ?? process.cwd());
  const stateFilePath = path.resolve(
    projectRoot,
    process.env.BOT_STATE_FILE ?? ".telegram-evolving-bot-state.json",
  );
  const backupRootDir = path.resolve(
    projectRoot,
    process.env.BOT_BACKUP_DIR ?? ".evolve-backups",
  );

  return {
    telegramBotToken,
    anthropicApiKey,
    anthropicModel:
      pickConfigString(ctx.secrets, process.env, "ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL,
    anthropicMaxTokens: readPositiveInteger(
      pickConfigString(ctx.secrets, process.env, "ANTHROPIC_MAX_TOKENS"),
      1000,
      "ANTHROPIC_MAX_TOKENS",
    ),
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
    projectRoot,
    stateFilePath,
    backupRootDir,
    maxConversationTurns: readPositiveInteger(
      pickConfigString(ctx.secrets, process.env, "BOT_MAX_CONVERSATION_TURNS"),
      10,
      "BOT_MAX_CONVERSATION_TURNS",
    ),
  };
}

async function readSystemPrompt(projectRoot: string): Promise<string> {
  const promptPath = path.resolve(projectRoot, "prompts/system.md");
  return await fs.readFile(promptPath, "utf8");
}

function formatEvolutionResult(summary: string, changedFiles: string[]): string {
  const files = changedFiles.length > 0 ? changedFiles.join(", ") : "없음";
  return ["evolution 적용 완료", `summary: ${summary}`, `changed: ${files}`].join("\n");
}

function trimConversationForModel(turns: ConversationTurn[], maxTurns: number): ConversationTurn[] {
  const maxItems = maxTurns * 2;
  if (turns.length <= maxItems) {
    return turns;
  }

  return turns.slice(turns.length - maxItems);
}

async function handleUserMessage(input: {
  chatId: string;
  text: string;
  config: ConnectorBotConfig;
  systemPrompt: string;
  state: BotStateStore;
}): Promise<string> {
  const history = trimConversationForModel(
    input.state.getConversation(Number(input.chatId)),
    input.config.maxConversationTurns,
  );

  if (input.text.startsWith("/evolve")) {
    const instruction = input.text.replace("/evolve", "").trim();
    if (instruction.length === 0) {
      return "사용법: /evolve <개선 지시>";
    }

    const goondanYamlPath = path.resolve(input.config.projectRoot, "goondan.yaml");
    const goondanYaml = await fs.readFile(goondanYamlPath, "utf8");

    const plan = await requestEvolutionPlan({
      apiKey: input.config.anthropicApiKey,
      model: input.config.anthropicModel,
      maxTokens: input.config.anthropicMaxTokens,
      instruction,
      goondanYaml,
      turns: history,
    });

    const applied = await applyEvolutionPlan({
      projectRoot: input.config.projectRoot,
      backupRootDir: input.config.backupRootDir,
      plan,
    });

    return formatEvolutionResult(plan.summary, applied.changedFiles);
  }

  const reply = await requestAnthropicText({
    apiKey: input.config.anthropicApiKey,
    model: input.config.anthropicModel,
    systemPrompt: input.systemPrompt,
    maxTokens: input.config.anthropicMaxTokens,
    turns: history,
    userInput: input.text,
  });

  input.state.appendTurn(Number(input.chatId), {
    role: "user",
    content: input.text,
  });
  input.state.appendTurn(Number(input.chatId), {
    role: "assistant",
    content: reply,
  });

  return reply;
}

function shouldStop(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function emitIncomingEvent(ctx: ConnectorContext, update: TelegramTextUpdate): Promise<void> {
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
        from_display_name: update.fromDisplayName,
        message_id: String(update.messageId),
      },
    });
  } catch (error) {
    ctx.logger.warn(`[sample-10] connector emit warning: ${toErrorMessage(error)}`);
  }
}

async function processUpdate(input: {
  update: TelegramTextUpdate;
  state: BotStateStore;
  config: ConnectorBotConfig;
  systemPrompt: string;
  telegram: TelegramClient;
  context: ConnectorContext;
}): Promise<void> {
  const update = input.update;
  input.state.setOffset(update.updateId + 1);

  await emitIncomingEvent(input.context, update);

  const reply = await handleUserMessage({
    chatId: String(update.chatId),
    text: update.text,
    config: input.config,
    systemPrompt: input.systemPrompt,
    state: input.state,
  });

  await input.telegram.sendMessage(update.chatId, reply);
  await input.state.save();
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

export default async function run(ctx: ConnectorContext): Promise<void> {
  const config = loadConfigFromContext(ctx);
  const state = await BotStateStore.create(config.stateFilePath, config.maxConversationTurns);
  const systemPrompt = await readSystemPrompt(config.projectRoot);
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

          try {
            await processUpdate({
              update,
              state,
              config,
              systemPrompt,
              telegram,
              context: ctx,
            });
          } catch (error) {
            const message = toErrorMessage(error);
            await telegram.sendMessage(update.chatId, `오류: ${message}`);
            await state.save();
          }
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
