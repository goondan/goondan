/**
 * @goondan/cli - Goondan Agent Swarm Orchestrator CLI
 *
 * This module exports the CLI program and all commands.
 * @packageDocumentation
 */

// Main CLI (from cli.ts - the comprehensive implementation)
export {
  run,
  createProgram,
  CLI_VERSION,
  CLI_NAME,
  EXIT_CODES,
} from "./cli.js";
export type {
  GlobalOptions,
  CommandContext,
  ProgramCommand,
} from "./cli.js";

// Re-export commands
export * from "./commands/index.js";

// Re-export types (legacy, for backward compatibility)
export * from "./types.js";

// Re-export utilities - Logger
export {
  logger,
  debug,
  info,
  warn,
  error,
  success,
  json,
  configureLogger,
  getLoggerOptions,
} from "./utils/logger.js";
export type {
  LogLevel,
  LoggerOptions,
  JsonLogEntry,
  Logger,
} from "./utils/logger.js";

// Re-export utilities - Config
export {
  DEFAULT_CONFIG,
  CONFIG_FILE_NAME,
  getGlobalConfigPath,
  getProjectConfigPath,
  loadConfigFile,
  expandPath,
  mergeConfigs,
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  getConfigPath,
} from "./utils/config.js";
export type {
  RegistryAuth,
  GoondanConfig,
  LoadConfigOptions,
} from "./utils/config.js";

// Re-export utilities - Prompt
export {
  PromptCancelledError,
  confirm,
  select,
  input,
  password,
  multiselect,
  isPromptCancelled,
} from "./utils/prompt.js";
export type {
  ConfirmOptions,
  SelectChoice,
  SelectOptions,
  InputOptions,
  PasswordOptions,
  MultiselectOptions,
} from "./utils/prompt.js";
