/**
 * gdn package deprecate command
 *
 * Sets deprecation notice on a package version
 * @see /docs/specs/cli.md - Section 6.9 (gdn package deprecate)
 * @see /docs/specs/bundle_package.md
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { info, success, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";

/**
 * Deprecate command options
 */
export interface DeprecateOptions {
  /** Deprecation message */
  message?: string;
  /** Custom registry URL */
  registry?: string;
}

/**
 * Parse package ref into name and optional version
 */
function parsePackageRef(ref: string): { name: string; version?: string } {
  // Handle scoped packages: @scope/name@version
  const atSignIndex = ref.lastIndexOf("@");

  // If the only @ is at position 0, it's a scoped package with no version
  if (atSignIndex <= 0) {
    return { name: ref };
  }

  return {
    name: ref.slice(0, atSignIndex),
    version: ref.slice(atSignIndex + 1),
  };
}

/**
 * Execute the deprecate command
 */
async function executeDeprecate(
  ref: string,
  options: DeprecateOptions,
): Promise<void> {
  const spinner = ora();

  try {
    const { name, version } = parsePackageRef(ref);
    const displayRef = version ? `${name}@${version}` : name;

    // Load config for registry URL
    const config = await loadConfig();
    const registryUrl =
      options.registry ??
      config.registry ??
      "https://registry.goondan.io";

    // Check authentication
    const registryAuth = config.registries?.[registryUrl];

    if (!registryAuth?.token) {
      logError("Not authenticated");
      info(`Run 'gdn package login --registry ${registryUrl}' first`);
      process.exitCode = 6; // AUTH_ERROR
      return;
    }

    const deprecationMessage = options.message ?? "";
    const isUndeprecate = deprecationMessage === "";

    if (isUndeprecate) {
      spinner.start(`Removing deprecation notice from ${displayRef}...`);
    } else {
      spinner.start(`Setting deprecation notice on ${displayRef}...`);
    }

    try {
      const body: Record<string, unknown> = {
        name,
        deprecated: deprecationMessage,
      };

      if (version) {
        body.version = version;
      }

      const response = await fetch(`${registryUrl}/${name}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${registryAuth.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorJson = JSON.parse(errorText) as {
            error?: string;
            message?: string;
          };
          errorMessage =
            errorJson.error ?? errorJson.message ?? errorMessage;
        } catch {
          if (errorText) {
            errorMessage = errorText;
          }
        }

        spinner.fail("Deprecation update failed");
        logError(errorMessage);
        process.exitCode = 1;
        return;
      }

      if (isUndeprecate) {
        spinner.succeed(
          `Removed deprecation notice from ${chalk.cyan(displayRef)}`,
        );
        console.log();
        success(`${displayRef} is no longer deprecated.`);
      } else {
        spinner.succeed(
          `Set deprecation notice on ${chalk.cyan(displayRef)}`,
        );
        console.log();
        success(
          `${displayRef} is now deprecated: ${chalk.yellow(deprecationMessage)}`,
        );
      }
    } catch (err) {
      spinner.fail("Deprecation update failed");
      if (err instanceof Error) {
        logError(err.message);
      }
      process.exitCode = 5; // NETWORK_ERROR
    }
  } catch (err) {
    spinner.fail("Deprecation update failed");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the deprecate command
 *
 * @returns Commander command for 'gdn package deprecate'
 */
export function createDeprecateCommand(): Command {
  const command = new Command("deprecate")
    .description("Set deprecation notice on a package")
    .argument("<ref>", "Package reference (e.g., @goondan/base@1.0.0)")
    .option("-m, --message <msg>", "Deprecation message")
    .option("--registry <url>", "Custom registry URL")
    .action(async (ref: string, options: Record<string, unknown>) => {
      const deprecateOptions: DeprecateOptions = {
        message:
          typeof options["message"] === "string"
            ? options["message"]
            : undefined,
        registry:
          typeof options["registry"] === "string"
            ? options["registry"]
            : undefined,
      };

      await executeDeprecate(ref, deprecateOptions);
    });

  return command;
}

export default createDeprecateCommand;
