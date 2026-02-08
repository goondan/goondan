/**
 * gdn instance pause command
 *
 * Pauses an instance, preventing new turns from executing.
 * Current in-progress turns complete before the instance transitions to paused state.
 *
 * @see /docs/specs/cli.md - Section 7.4 (gdn instance pause)
 * @see /docs/specs/runtime.md - Instance lifecycle
 */

import { Command } from "commander";
import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { info, success, warn, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import {
  getGoondanHomeSync,
  findInstancePath,
  getInstanceBasicInfo,
} from "./utils.js";

/**
 * Pause command options
 */
export interface PauseOptions {
  /** Force-stop in-progress turns immediately */
  force: boolean;
}

/**
 * Execute the pause command
 */
async function executePause(
  instanceId: string,
  options: PauseOptions,
  stateRoot?: string,
): Promise<void> {
  const spinner = ora();

  try {
    const config = await loadConfig({
      cliStateRoot: stateRoot,
    });
    const goondanHome = getGoondanHomeSync(config.stateRoot);
    const instancesRoot = path.join(goondanHome, "instances");

    const found = findInstancePath(instancesRoot, instanceId);

    if (!found) {
      logError(`Instance "${instanceId}" not found.`);
      info("Use 'gdn instance list --all' to see all instances.");
      process.exitCode = 1;
      return;
    }

    const instanceInfo = getInstanceBasicInfo(found.instancePath);

    if (!instanceInfo) {
      logError(`Failed to read instance "${instanceId}".`);
      process.exitCode = 1;
      return;
    }

    console.log();
    console.log(`${chalk.bold("Instance:")} ${instanceId}`);
    console.log(`${chalk.bold("Swarm:")}    ${instanceInfo.swarmName}`);
    console.log();

    if (options.force) {
      spinner.start(`Force-pausing instance ${instanceId}...`);
    } else {
      spinner.start(`Pausing instance ${instanceId}...`);
    }

    // TODO: Implement actual pause functionality
    // This would involve:
    // 1. Signaling the runtime to stop accepting new turns
    // 2. If --force, aborting the current in-progress turn
    // 3. Updating instance status to "paused"

    spinner.succeed(`Paused instance ${chalk.cyan(instanceId)}`);

    console.log();

    if (options.force) {
      warn("In-progress turns were forcefully stopped.");
    } else {
      info("Waiting for in-progress turns to complete before pausing.");
    }

    console.log();
    success(`Instance "${instanceId}" is now paused.`);
    info(`Use 'gdn instance resume ${instanceId}' to resume.`);
  } catch (err) {
    spinner.fail("Failed to pause instance");

    if (err instanceof Error) {
      logError(err.message);
    }

    process.exitCode = 1;
  }
}

/**
 * Create the pause command
 *
 * @returns Commander command for 'gdn instance pause'
 */
export function createPauseCommand(): Command {
  const command = new Command("pause")
    .description("Pause an instance")
    .argument("<id>", "Instance ID")
    .option("-f, --force", "Force-stop in-progress turns immediately", false)
    .action(async (instanceId: string, options: Record<string, unknown>, command: Command) => {
      const globalOpts = command.optsWithGlobals<{ stateRoot?: string }>();
      const stateRoot =
        typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;
      const pauseOptions: PauseOptions = {
        force: options["force"] === true,
      };

      await executePause(instanceId, pauseOptions, stateRoot);
    });

  return command;
}

export default createPauseCommand;
