/**
 * gdn package logout command
 *
 * Removes registry authentication
 * @see /docs/specs/cli.md - Section 6.9 (gdn package logout)
 * @see /docs/specs/bundle_package.md - Section 13.8
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { info, success, error as logError } from "../../utils/logger.js";
import {
  loadConfig,
  loadConfigFile,
  saveConfig,
  getGlobalConfigPath,
  type GoondanConfig,
} from "../../utils/config.js";

/**
 * Logout command options
 */
export interface LogoutOptions {
  registry?: string;
  scope?: string;
}

/**
 * Default registry URL
 */
const DEFAULT_REGISTRY = "https://goondan-registry.yechanny.workers.dev";

/**
 * Execute the logout command
 */
async function executeLogout(options: LogoutOptions): Promise<void> {
  const spinner = ora();

  try {
    // Determine registry URL
    const config = await loadConfig();
    const registryUrl = options.registry ?? config.registry ?? DEFAULT_REGISTRY;

    console.log();
    console.log(chalk.bold(`Logging out from ${chalk.cyan(registryUrl)}`));

    if (options.scope) {
      console.log(`Scope: ${chalk.cyan(options.scope)}`);
    }

    console.log();

    // Load global config
    spinner.start("Removing credentials...");

    const globalConfig: GoondanConfig = (await loadConfigFile(getGlobalConfigPath())) ?? {};

    let removedRegistry = false;
    let removedScope = false;

    // Remove registry token
    if (globalConfig.registries?.[registryUrl]) {
      delete globalConfig.registries[registryUrl];
      removedRegistry = true;

      // Clean up empty registries object
      if (Object.keys(globalConfig.registries).length === 0) {
        delete globalConfig.registries;
      }
    }

    // Remove scoped registry if specified
    if (options.scope && globalConfig.scopedRegistries?.[options.scope]) {
      delete globalConfig.scopedRegistries[options.scope];
      removedScope = true;

      // Clean up empty scopedRegistries object
      if (Object.keys(globalConfig.scopedRegistries).length === 0) {
        delete globalConfig.scopedRegistries;
      }
    }

    if (!removedRegistry && !removedScope) {
      spinner.warn("No credentials found");

      if (options.scope) {
        info(`No credentials found for scope ${chalk.cyan(options.scope)}`);
      } else {
        info(`No credentials found for registry ${chalk.cyan(registryUrl)}`);
      }

      return;
    }

    // Save updated config
    await saveConfig(globalConfig);
    spinner.succeed("Credentials removed");

    console.log();
    success(`Logged out from ${chalk.cyan(registryUrl)}`);

    if (removedScope) {
      info(`Removed scope mapping for ${chalk.cyan(options.scope)}`);
    }

    // Show config file location
    console.log();
    console.log(chalk.gray(`Updated: ${getGlobalConfigPath()}`));
  } catch (err) {
    spinner.fail("Logout failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the logout command
 *
 * @returns Commander command for 'gdn package logout'
 */
export function createLogoutCommand(): Command {
  const command = new Command("logout")
    .description("Remove registry authentication")
    .option("--registry <url>", "Registry URL")
    .option("--scope <scope>", "Remove scope mapping (e.g., @myorg)")
    .action(async (options: Record<string, unknown>) => {
      const logoutOptions: LogoutOptions = {
        registry: options.registry as string | undefined,
        scope: options.scope as string | undefined,
      };

      await executeLogout(logoutOptions);
    });

  return command;
}

export default createLogoutCommand;
