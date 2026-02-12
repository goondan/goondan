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
