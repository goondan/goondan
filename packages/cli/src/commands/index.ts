/**
 * CLI Commands
 *
 * This module exports all CLI commands.
 * Commands are organized by functionality and can be registered with the main program.
 */

export {
  createInitCommand,
  executeInit,
  executeInitCommand,
  type InitOptions,
  type TemplateName,
} from "./init.js";

export {
  createRunCommand,
  type RunOptions,
} from "./run.js";

export {
  createValidateCommand,
  type ValidateOptions,
  type OutputFormat,
  type ValidationIssue,
  type ValidateResult,
} from "./validate.js";

// Package commands
export {
  createPackageCommand,
  createInstallCommand,
  createAddCommand,
  createRemoveCommand,
  createUpdateCommand,
  createListCommand,
  createPublishCommand,
  createLoginCommand,
  createLogoutCommand,
  createPackCommand,
  createInfoCommand,
  createCacheCommand,
} from "./package/index.js";

// Instance commands
export {
  createInstanceCommand,
  createListCommand as createInstanceListCommand,
  createInspectCommand,
  createDeleteCommand,
  createResumeCommand,
  type ListOptions as InstanceListOptions,
  type DeleteOptions as InstanceDeleteOptions,
  type ResumeOptions as InstanceResumeOptions,
} from "./instance/index.js";

// Logs command
export {
  createLogsCommand,
  type LogsOptions,
  type LogType,
} from "./logs.js";

// Config command
export {
  createConfigCommand,
  CONFIG_KEYS,
  type ConfigKey,
} from "./config.js";

// Completion command
export {
  createCompletionCommand,
  type Shell,
} from "./completion.js";
