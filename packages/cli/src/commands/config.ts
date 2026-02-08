/**
 * gdn config command
 *
 * Manage CLI configuration with get/set/list/delete/path subcommands.
 * Uses ~/.goondanrc for storing configuration.
 *
 * @see /docs/specs/cli.md - Section 9 (gdn config)
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  loadConfig,
  loadConfigFile,
  getGlobalConfigPath,
  getProjectConfigPath,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  type GoondanConfig,
} from "../utils/config.js";
import { info, success, warn, error as logError } from "../utils/logger.js";
import { ExitCode } from "../types.js";

/**
 * Valid configuration keys
 */
export const CONFIG_KEYS = [
  "registry",
  "stateRoot",
  "logLevel",
  "color",
  "editor",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * Check if a key is a valid config key
 */
function isValidConfigKey(key: string): key is ConfigKey {
  return CONFIG_KEYS.includes(key as ConfigKey);
}

/**
 * Format a config value for display
 */
function formatValue(value: unknown): string {
  if (value === undefined) {
    return chalk.gray("(not set)");
  }
  if (typeof value === "boolean") {
    return value ? chalk.green("true") : chalk.red("false");
  }
  if (typeof value === "string") {
    return chalk.cyan(value);
  }
  return chalk.cyan(JSON.stringify(value));
}

/**
 * Parse a config value from string input
 */
function parseValue(key: ConfigKey, valueStr: string): GoondanConfig[ConfigKey] {
  switch (key) {
    case "color":
      if (valueStr === "true" || valueStr === "1" || valueStr === "yes") {
        return true;
      }
      if (valueStr === "false" || valueStr === "0" || valueStr === "no") {
        return false;
      }
      throw new Error(`Invalid boolean value: ${valueStr}. Use true/false.`);

    case "logLevel":
      const validLevels = ["debug", "info", "warn", "error"];
      if (!validLevels.includes(valueStr)) {
        throw new Error(
          `Invalid log level: ${valueStr}. Valid values: ${validLevels.join(", ")}`
        );
      }
      return valueStr as "debug" | "info" | "warn" | "error";

    case "registry":
    case "stateRoot":
    case "editor":
      return valueStr;

    default:
      return valueStr;
  }
}

/**
 * Execute config get subcommand
 */
async function executeConfigGet(
  key: string,
  jsonOutput: boolean,
  stateRoot?: string,
): Promise<void> {
  if (!isValidConfigKey(key)) {
    logError(`Invalid config key: ${key}`);
    info(`Valid keys: ${CONFIG_KEYS.join(", ")}`);
    process.exitCode = ExitCode.INVALID_ARGS;
    return;
  }

  try {
    const config = await loadConfig({
      cliStateRoot: stateRoot,
    });
    const value = config[key];

    if (jsonOutput) {
      console.log(JSON.stringify({ key, value }));
    } else {
      if (value === undefined) {
        console.log(formatValue(value));
      } else {
        console.log(value);
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = ExitCode.ERROR;
  }
}

/**
 * Execute config set subcommand
 */
async function executeConfigSet(
  key: string,
  value: string,
  jsonOutput: boolean
): Promise<void> {
  if (!isValidConfigKey(key)) {
    logError(`Invalid config key: ${key}`);
    info(`Valid keys: ${CONFIG_KEYS.join(", ")}`);
    process.exitCode = ExitCode.INVALID_ARGS;
    return;
  }

  try {
    const parsedValue = parseValue(key, value);
    await setConfigValue(key, parsedValue);

    if (jsonOutput) {
      console.log(JSON.stringify({ key, value: parsedValue, success: true }));
    } else {
      success(`Set ${key} = ${formatValue(parsedValue)}`);
    }
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = ExitCode.ERROR;
  }
}

/**
 * Execute config list subcommand
 */
async function executeConfigList(
  jsonOutput: boolean,
  stateRoot?: string,
): Promise<void> {
  try {
    const config = await loadConfig({
      cliStateRoot: stateRoot,
    });
    const globalConfig = await loadConfigFile(getGlobalConfigPath());
    const projectConfigPath = getProjectConfigPath();
    const projectConfig = projectConfigPath
      ? await loadConfigFile(projectConfigPath)
      : undefined;

    if (jsonOutput) {
      console.log(
        JSON.stringify({
          merged: config,
          global: globalConfig ?? {},
          project: projectConfig ?? {},
          globalPath: getGlobalConfigPath(),
          projectPath: projectConfigPath ?? null,
        })
      );
      return;
    }

    console.log();
    console.log(chalk.bold("Configuration:"));
    console.log();

    // Show merged config with source indication
    for (const key of CONFIG_KEYS) {
      const mergedValue = config[key];
      const globalValue = globalConfig?.[key];
      const projectValue = projectConfig?.[key];

      let source = "";
      if (projectValue !== undefined) {
        source = chalk.gray(" (project)");
      } else if (globalValue !== undefined) {
        source = chalk.gray(" (global)");
      } else if (mergedValue !== undefined) {
        source = chalk.gray(" (default)");
      }

      console.log(`  ${chalk.white(key)}: ${formatValue(mergedValue)}${source}`);
    }

    console.log();

    // Show config file paths
    console.log(chalk.bold("Config files:"));
    console.log(`  Global:  ${chalk.cyan(getGlobalConfigPath())}`);
    if (projectConfigPath) {
      console.log(`  Project: ${chalk.cyan(projectConfigPath)}`);
    }
    console.log();
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = ExitCode.ERROR;
  }
}

/**
 * Execute config delete subcommand
 */
async function executeConfigDelete(
  key: string,
  jsonOutput: boolean
): Promise<void> {
  if (!isValidConfigKey(key)) {
    logError(`Invalid config key: ${key}`);
    info(`Valid keys: ${CONFIG_KEYS.join(", ")}`);
    process.exitCode = ExitCode.INVALID_ARGS;
    return;
  }

  try {
    const currentValue = await getConfigValue(key);

    if (currentValue === undefined) {
      if (jsonOutput) {
        console.log(JSON.stringify({ key, deleted: false, reason: "not set" }));
      } else {
        warn(`Config key '${key}' is not set in global config`);
      }
      return;
    }

    await deleteConfigValue(key);

    if (jsonOutput) {
      console.log(JSON.stringify({ key, deleted: true, previousValue: currentValue }));
    } else {
      success(`Deleted ${key} (was: ${formatValue(currentValue)})`);
    }
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = ExitCode.ERROR;
  }
}

/**
 * Execute config path subcommand
 */
function executeConfigPath(
  pathType: "global" | "project" | "all",
  jsonOutput: boolean
): void {
  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath();

  if (jsonOutput) {
    console.log(
      JSON.stringify({
        global: globalPath,
        project: projectPath ?? null,
      })
    );
    return;
  }

  switch (pathType) {
    case "global":
      console.log(globalPath);
      break;
    case "project":
      if (projectPath) {
        console.log(projectPath);
      } else {
        warn("No project config file found");
      }
      break;
    case "all":
    default:
      console.log(`Global:  ${globalPath}`);
      if (projectPath) {
        console.log(`Project: ${projectPath}`);
      }
      break;
  }
}

/**
 * Create the config get subcommand
 */
function createGetCommand(): Command {
  return new Command("get")
    .description("Get a configuration value")
    .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
    .action(async (key: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<{
        json?: boolean;
        stateRoot?: string;
      }>();
      const stateRoot =
        typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;
      await executeConfigGet(key, globalOpts.json === true, stateRoot);
    });
}

/**
 * Create the config set subcommand
 */
function createSetCommand(): Command {
  return new Command("set")
    .description("Set a configuration value")
    .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
    .argument("<value>", "Config value")
    .action(async (key: string, value: string, _opts: unknown, cmd: Command) => {
      const parentOpts = cmd.parent?.opts() as { json?: boolean } | undefined;
      await executeConfigSet(key, value, parentOpts?.json === true);
    });
}

/**
 * Create the config list subcommand
 */
function createListConfigCommand(): Command {
  return new Command("list")
    .description("List all configuration values")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<{
        json?: boolean;
        stateRoot?: string;
      }>();
      const stateRoot =
        typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;
      await executeConfigList(globalOpts.json === true, stateRoot);
    });
}

/**
 * Create the config delete subcommand
 */
function createDeleteCommand(): Command {
  return new Command("delete")
    .description("Delete a configuration value from global config")
    .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
    .action(async (key: string, _opts: unknown, cmd: Command) => {
      const parentOpts = cmd.parent?.opts() as { json?: boolean } | undefined;
      await executeConfigDelete(key, parentOpts?.json === true);
    });
}

/**
 * Create the config path subcommand
 */
function createPathCommand(): Command {
  return new Command("path")
    .description("Show configuration file path(s)")
    .argument(
      "[type]",
      "Path type: global, project, or all",
      "all"
    )
    .action((type: string, _opts: unknown, cmd: Command) => {
      const parentOpts = cmd.parent?.opts() as { json?: boolean } | undefined;
      const pathType = type === "global" || type === "project" ? type : "all";
      executeConfigPath(pathType, parentOpts?.json === true);
    });
}

/**
 * Create the config command group
 *
 * @returns Commander command for 'gdn config'
 */
export function createConfigCommand(): Command {
  const command = new Command("config")
    .description("Manage CLI configuration");

  // Register subcommands
  command.addCommand(createGetCommand());
  command.addCommand(createSetCommand());
  command.addCommand(createListConfigCommand());
  command.addCommand(createDeleteCommand());
  command.addCommand(createPathCommand());

  // If no subcommand provided, show list by default
  command.action(async (_opts: unknown, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{
      json?: boolean;
      stateRoot?: string;
    }>();
    const stateRoot =
      typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;
    await executeConfigList(globalOpts.json === true, stateRoot);
  });

  return command;
}

export default createConfigCommand;
