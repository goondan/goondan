/**
 * gdn package unpublish command
 *
 * Unpublishes a package version from the registry
 * @see /docs/specs/cli.md - Section 6.8 (gdn package unpublish)
 * @see /docs/specs/bundle_package.md
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { info, success, warn, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import { confirm, isPromptCancelled } from "../../utils/prompt.js";

/**
 * Unpublish command options
 */
export interface UnpublishOptions {
  /** Skip confirmation prompt */
  force: boolean;
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
 * Execute the unpublish command
 */
async function executeUnpublish(
  ref: string,
  options: UnpublishOptions,
): Promise<void> {
  const spinner = ora();

  try {
    const { name, version } = parsePackageRef(ref);

    if (!version) {
      logError("A version must be specified. Example: @goondan/base@1.0.0");
      process.exitCode = 2;
      return;
    }

    // Load config for registry URL
    const config = await loadConfig();
    const registryUrl =
      options.registry ??
      config.registry ??
      "https://registry.goondan.io";

    // Confirm unless --force
    if (!options.force) {
      console.log();
      console.log(`Package: ${chalk.cyan(name)}@${chalk.gray(version)}`);
      console.log(`Registry: ${chalk.cyan(registryUrl)}`);
      console.log();
      warn(
        "Unpublishing a package version may break projects depending on it.",
      );
      console.log();

      const confirmed = await confirm(
        `Are you sure you want to unpublish ${name}@${version}?`,
        { initial: false },
      );

      if (!confirmed) {
        info("Unpublish cancelled.");
        return;
      }
    }

    // Check authentication
    const registryAuth = config.registries?.[registryUrl];

    if (!registryAuth?.token) {
      logError("Not authenticated");
      info(`Run 'gdn package login --registry ${registryUrl}' first`);
      process.exitCode = 6; // AUTH_ERROR
      return;
    }

    // Unpublish from registry
    spinner.start(`Unpublishing ${name}@${version}...`);

    try {
      const response = await fetch(
        `${registryUrl}/${name}/-rev/${version}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${registryAuth.token}`,
          },
        },
      );

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

        spinner.fail("Unpublish failed");
        logError(errorMessage);
        process.exitCode = 1;
        return;
      }

      spinner.succeed(`Unpublished ${chalk.cyan(name)}@${chalk.gray(version)}`);
      console.log();
      success(`${name}@${version} has been removed from the registry.`);
    } catch (err) {
      spinner.fail("Unpublish failed");
      if (err instanceof Error) {
        logError(err.message);
      }
      process.exitCode = 5; // NETWORK_ERROR
    }
  } catch (err) {
    spinner.fail("Unpublish failed");

    if (isPromptCancelled(err)) {
      info("Operation cancelled.");
      return;
    }

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the unpublish command
 *
 * @returns Commander command for 'gdn package unpublish'
 */
export function createUnpublishCommand(): Command {
  const command = new Command("unpublish")
    .description("Unpublish a package version from the registry")
    .argument("<ref>", "Package reference (e.g., @goondan/base@1.0.0)")
    .option("-f, --force", "Skip confirmation prompt", false)
    .option("--registry <url>", "Custom registry URL")
    .action(async (ref: string, options: Record<string, unknown>) => {
      const unpublishOptions: UnpublishOptions = {
        force: options["force"] === true,
        registry:
          typeof options["registry"] === "string"
            ? options["registry"]
            : undefined,
      };

      await executeUnpublish(ref, unpublishOptions);
    });

  return command;
}

export default createUnpublishCommand;
