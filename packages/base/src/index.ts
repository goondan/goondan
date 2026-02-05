/**
 * Goondan Base - 기본 Tool, Extension, Connector 번들
 *
 * @packageDocumentation
 */

// Tools
export { handlers as bashHandlers } from './tools/bash/index.js';

// Extensions
export { register as registerBasicCompaction } from './extensions/basicCompaction/index.js';
export type { CompactionConfig } from './extensions/basicCompaction/index.js';

// Connectors - Telegram
export {
  onUpdate as telegramOnUpdate,
  sendMessage as telegramSendMessage,
  editMessage as telegramEditMessage,
  deleteMessage as telegramDeleteMessage,
  setWebhook as telegramSetWebhook,
  getWebhookInfo as telegramGetWebhookInfo,
  deleteWebhook as telegramDeleteWebhook,
} from './connectors/telegram/index.js';
export type {
  TelegramUpdate,
  TelegramMessage,
  TelegramUser,
  TelegramChat,
} from './connectors/telegram/index.js';

// Connectors - Slack
export {
  onSlackEvent,
  postMessage as slackPostMessage,
  updateMessage as slackUpdateMessage,
  getErrorMessage as slackGetErrorMessage,
} from './connectors/slack/index.js';
export type {
  SlackEventPayload,
  SlackEvent,
  SlackApiResponse,
} from './connectors/slack/index.js';
