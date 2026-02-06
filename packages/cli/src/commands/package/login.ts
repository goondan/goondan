/**
 * gdn package login command
 *
 * Authenticates with the package registry
 * @see /docs/specs/cli.md - Section 6.8 (gdn package login)
 * @see /docs/specs/bundle_package.md - Section 13.8
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { info, success, warn, error as logError } from "../../utils/logger.js";
import {
  loadConfig,
  loadConfigFile,
  saveConfig,
  getGlobalConfigPath,
  type GoondanConfig,
} from "../../utils/config.js";
import { password as promptPassword } from "../../utils/prompt.js";

/**
 * Login command options
 */
export interface LoginOptions {
  registry?: string;
  scope?: string;
  token?: string;
}

/**
 * Default registry URL
 */
const DEFAULT_REGISTRY = "https://goondan-registry.yechanny.workers.dev";

/**
 * Execute the login command
 */
async function executeLogin(options: LoginOptions): Promise<void> {
  const spinner = ora();

  try {
    // Determine registry URL
    const config = await loadConfig();
    const registryUrl = options.registry ?? config.registry ?? DEFAULT_REGISTRY;

    console.log();
    console.log(chalk.bold(`Logging in to ${chalk.cyan(registryUrl)}`));

    if (options.scope) {
      console.log(`Scope: ${chalk.cyan(options.scope)}`);
    }

    console.log();

    // Get token (from option or prompt)
    let token = options.token;

    if (!token) {
      // Check for environment variable
      token = process.env.GOONDAN_REGISTRY_TOKEN;

      if (!token) {
        // Prompt for token
        info("Enter your authentication token:");
        info(chalk.gray("(You can get a token from your registry account settings)"));
        console.log();

        token = await promptPassword("Token: ");

        if (!token) {
          warn("No token provided. Login cancelled.");
          return;
        }
      } else {
        info("Using token from GOONDAN_REGISTRY_TOKEN environment variable");
      }
    }

    // Validate token (stub - would actually verify with registry)
    spinner.start("Verifying credentials...");

    // Stub: In real implementation, this would:
    // 1. Make authenticated request to registry
    // 2. Verify token is valid
    // 3. Get user info

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Stub: Simulate success
    spinner.succeed("Credentials verified");

    // Save token to config
    spinner.start("Saving credentials...");

    const globalConfig: GoondanConfig = (await loadConfigFile(getGlobalConfigPath())) ?? {};

    // Initialize registries object if needed
    if (!globalConfig.registries) {
      globalConfig.registries = {};
    }

    // Save token for registry
    globalConfig.registries[registryUrl] = {
      token,
    };

    // If scope is specified, also save scoped registry mapping
    if (options.scope) {
      if (!globalConfig.scopedRegistries) {
        globalConfig.scopedRegistries = {};
      }
      globalConfig.scopedRegistries[options.scope] = registryUrl;
    }

    await saveConfig(globalConfig);
    spinner.succeed("Credentials saved");

    console.log();
    success(`Logged in to ${chalk.cyan(registryUrl)}`);

    if (options.scope) {
      info(`Packages with scope ${chalk.cyan(options.scope)} will use this registry`);
    }

    // Show config file location
    console.log();
    console.log(chalk.gray(`Credentials saved to: ${getGlobalConfigPath()}`));

    // Show stub warning
    console.log();
    warn(chalk.yellow("Note: This is a stub. Token validation is simulated."));
  } catch (err) {
    spinner.fail("Login failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the login command
 *
 * @returns Commander command for 'gdn package login'
 */
export function createLoginCommand(): Command {
  const command = new Command("login")
    .description("Authenticate with package registry")
    .option("--registry <url>", "Registry URL")
    .option("--scope <scope>", "Associate scope with registry (e.g., @myorg)")
    .option("--token <token>", "Authentication token (for CI)")
    .action(async (options: Record<string, unknown>) => {
      const loginOptions: LoginOptions = {
        registry: options.registry as string | undefined,
        scope: options.scope as string | undefined,
        token: options.token as string | undefined,
      };

      await executeLogin(loginOptions);
    });

  return command;
}

export default createLoginCommand;
