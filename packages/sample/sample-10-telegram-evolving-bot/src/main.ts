import runConnector from "./connector-entry.js";
import type { ConnectorContext } from "./types.js";

function collectStandaloneSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
  const candidates = [
    "TELEGRAM_BOT_TOKEN",
    "BOT_TOKEN",
    "TELEGRAM_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_MAX_TOKENS",
    "TELEGRAM_POLL_TIMEOUT_SECONDS",
    "TELEGRAM_POLL_RETRY_DELAY_MS",
    "BOT_MAX_CONVERSATION_TURNS",
  ];

  const secrets: Record<string, string> = {};
  for (const key of candidates) {
    const value = env[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    secrets[key] = value;
  }
  return secrets;
}

function createStandaloneContext(): ConnectorContext {
  return {
    emit: async (): Promise<void> => {
      // standalone 실행에서는 connector event를 외부로 라우팅하지 않는다.
    },
    secrets: collectStandaloneSecrets(process.env),
    logger: console,
  };
}

void runConnector(createStandaloneContext()).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sample-10] fatal error: ${message}`);
  process.exitCode = 1;
});
