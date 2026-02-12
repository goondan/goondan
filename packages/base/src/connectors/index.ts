export {
  default as runCliConnectorEntry,
  normalizeCliLine,
  runCliConnector,
} from './cli.js';
export type { CliConnectorConfig } from './cli.js';

export {
  default as runWebhookConnectorEntry,
  emitWebhookPayload,
  verifyWebhookSignature,
} from './webhook.js';
export type {
  WebhookEmitOptions,
  WebhookEmitResult,
} from './webhook.js';

export {
  default as runTelegramPollingConnectorEntry,
  pollTelegramUpdates,
  sendTelegramMessage,
} from './telegram-polling.js';
export type {
  TelegramPollingOptions,
  TelegramSendMessageOptions,
} from './telegram-polling.js';

export {
  default as runSlackConnectorEntry,
  handleSlackRequest,
  verifySlackSignature,
} from './slack.js';
export type { SlackConnectorConfig } from './slack.js';

export {
  default as runDiscordConnectorEntry,
  handleDiscordRequest,
  parseDiscordInteraction,
  createDiscordPingResponse,
} from './discord.js';

export {
  default as runGithubConnectorEntry,
  handleGithubRequest,
  parseGithubWebhook,
  verifyGithubSignature,
} from './github.js';
