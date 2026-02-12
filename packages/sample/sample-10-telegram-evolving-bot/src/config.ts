import path from "node:path";

export interface BotConfig {
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

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`필수 환경 변수가 없습니다: ${name}`);
  }
  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name}는 양의 정수여야 합니다.`);
  }
  return parsed;
}

export function loadConfig(): BotConfig {
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
    telegramBotToken: readRequiredEnv("TELEGRAM_BOT_TOKEN"),
    anthropicApiKey: readRequiredEnv("ANTHROPIC_API_KEY"),
    anthropicModel: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    anthropicMaxTokens: readPositiveInteger("ANTHROPIC_MAX_TOKENS", 1000),
    pollingTimeoutSeconds: readPositiveInteger("TELEGRAM_POLL_TIMEOUT_SECONDS", 25),
    pollingRetryDelayMs: readPositiveInteger("TELEGRAM_POLL_RETRY_DELAY_MS", 3_000),
    projectRoot,
    stateFilePath,
    backupRootDir,
    maxConversationTurns: readPositiveInteger("BOT_MAX_CONVERSATION_TURNS", 10),
  };
}
