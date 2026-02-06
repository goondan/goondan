/**
 * Goondan Base - 기본 Tool, Extension, Connector 번들
 *
 * @packageDocumentation
 */

// Tools
export { handlers as bashHandlers } from './tools/bash/index.js';
export { handlers as httpFetchHandlers } from './tools/http-fetch/index.js';
export { handlers as jsonQueryHandlers } from './tools/json-query/index.js';
export { handlers as fileSystemHandlers } from './tools/file-system/index.js';
export { handlers as textTransformHandlers } from './tools/text-transform/index.js';

// Extensions
export { register as registerBasicCompaction } from './extensions/basicCompaction/index.js';
export type { CompactionConfig } from './extensions/basicCompaction/index.js';
export { register as registerLogging } from './extensions/logging/index.js';
export type { LoggingConfig } from './extensions/logging/index.js';

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

// Connectors - CLI
export {
  onCliInput,
  startInteractiveCli,
  isExitCommand,
} from './connectors/cli/index.js';
export type { InteractiveCliOptions } from './connectors/cli/index.js';

// Connectors - Discord
export {
  onDiscordMessage,
  sendMessage as discordSendMessage,
  editMessage as discordEditMessage,
  getErrorMessage as discordGetErrorMessage,
} from './connectors/discord/index.js';
export type {
  DiscordMessagePayload,
  DiscordMessageData,
  DiscordUser,
  DiscordApiResponse,
} from './connectors/discord/index.js';

// Connectors - GitHub
export {
  onGitHubEvent,
  createIssueComment as githubCreateIssueComment,
  createPRReview as githubCreatePRReview,
} from './connectors/github/index.js';
export type {
  GitHubWebhookPayload,
  GitHubRepository,
  GitHubUser as GitHubUserType,
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubCommit,
  GitHubApiResponse,
} from './connectors/github/index.js';
