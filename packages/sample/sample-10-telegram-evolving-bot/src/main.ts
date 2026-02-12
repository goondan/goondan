import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "./config.js";
import { requestAnthropicText } from "./anthropic.js";
import { applyEvolutionPlan, requestEvolutionPlan } from "./evolve.js";
import { BotStateStore, type ConversationTurn } from "./state.js";
import { TelegramClient, type TelegramTextUpdate } from "./telegram.js";

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
  projectRoot: string;
  systemPrompt: string;
  state: BotStateStore;
  anthropicApiKey: string;
  anthropicModel: string;
  anthropicMaxTokens: number;
  backupRootDir: string;
  maxConversationTurns: number;
}): Promise<string> {
  const history = trimConversationForModel(
    input.state.getConversation(Number(input.chatId)),
    input.maxConversationTurns,
  );

  if (input.text.startsWith("/evolve")) {
    const instruction = input.text.replace("/evolve", "").trim();
    if (instruction.length === 0) {
      return "사용법: /evolve <개선 지시>";
    }

    const goondanYamlPath = path.resolve(input.projectRoot, "goondan.yaml");
    const goondanYaml = await fs.readFile(goondanYamlPath, "utf8");

    const plan = await requestEvolutionPlan({
      apiKey: input.anthropicApiKey,
      model: input.anthropicModel,
      maxTokens: input.anthropicMaxTokens,
      instruction,
      goondanYaml,
      turns: history,
    });

    const applied = await applyEvolutionPlan({
      projectRoot: input.projectRoot,
      backupRootDir: input.backupRootDir,
      plan,
    });

    return formatEvolutionResult(plan.summary, applied.changedFiles);
  }

  const reply = await requestAnthropicText({
    apiKey: input.anthropicApiKey,
    model: input.anthropicModel,
    systemPrompt: input.systemPrompt,
    maxTokens: input.anthropicMaxTokens,
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

async function processUpdate(input: {
  update: TelegramTextUpdate;
  state: BotStateStore;
  config: ReturnType<typeof loadConfig>;
  systemPrompt: string;
  telegram: TelegramClient;
}): Promise<void> {
  const update = input.update;
  input.state.setOffset(update.updateId + 1);

  const reply = await handleUserMessage({
    chatId: String(update.chatId),
    text: update.text,
    projectRoot: input.config.projectRoot,
    systemPrompt: input.systemPrompt,
    state: input.state,
    anthropicApiKey: input.config.anthropicApiKey,
    anthropicModel: input.config.anthropicModel,
    anthropicMaxTokens: input.config.anthropicMaxTokens,
    backupRootDir: input.config.backupRootDir,
    maxConversationTurns: input.config.maxConversationTurns,
  });

  await input.telegram.sendMessage(update.chatId, reply);
  await input.state.save();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const state = await BotStateStore.create(config.stateFilePath, config.maxConversationTurns);
  const systemPrompt = await readSystemPrompt(config.projectRoot);
  const telegram = new TelegramClient(config.telegramBotToken);

  const controller = new AbortController();
  const shutdown = (): void => {
    controller.abort();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!shouldStop(controller.signal)) {
    try {
      const updates = await telegram.getUpdates(state.getOffset(), config.pollingTimeoutSeconds);
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
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await telegram.sendMessage(update.chatId, `오류: ${message}`);
          await state.save();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[sample-10] polling warning: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, config.pollingRetryDelayMs));
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sample-10] fatal error: ${message}`);
  process.exitCode = 1;
});
