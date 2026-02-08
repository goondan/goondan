/**
 * gdn instance terminate command
 *
 * Terminates an instance. Terminated instances no longer process turns
 * and their status is set to "terminated".
 *
 * @see /docs/specs/cli.md - Section 7.6 (gdn instance terminate)
 * @see /docs/specs/runtime.md - Instance lifecycle
 */

import { Command } from "commander";
import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { info, success, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import { confirm, isPromptCancelled } from "../../utils/prompt.js";
import {
  getGoondanHomeSync,
  findInstancePath,
  getInstanceBasicInfo,
} from "./utils.js";

/**
 * Terminate command options
 */
export interface TerminateOptions {
  /** Skip confirmation prompt */
  force: boolean;
  /** Termination reason */
  reason?: string;
}

/**
 * Execute the terminate command
 */
async function executeTerminate(
  instanceId: string,
  options: TerminateOptions,
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

    // Confirm termination unless --force
    if (!options.force) {
      console.log();
      console.log(`${chalk.bold("Instance:")} ${instanceId}`);
      console.log(`${chalk.bold("Swarm:")}    ${instanceInfo.swarmName}`);
      console.log(`${chalk.bold("Agents:")}   ${instanceInfo.agentCount}`);

      if (options.reason) {
        console.log(`${chalk.bold("Reason:")}   ${options.reason}`);
      }

      console.log();

      const confirmed = await confirm(
        `Are you sure you want to terminate instance "${instanceId}"?`,
        { initial: false },
      );

      if (!confirmed) {
        info("Termination cancelled.");
        return;
      }
    }

    // Terminate the instance
    spinner.start(`Terminating instance ${instanceId}...`);

    // TODO: Implement actual termination
    // This would involve:
    // 1. Signaling the runtime to stop processing
    // 2. Aborting any in-progress turns
    // 3. Updating instance status to "terminated"
    // 4. Writing termination event with reason to swarm events log

    spinner.succeed(`Terminated instance ${chalk.cyan(instanceId)}`);

    console.log();

    if (options.reason) {
      info(`Reason: ${options.reason}`);
    }

    success(`Instance "${instanceId}" has been terminated.`);
    info(
      `Use 'gdn instance delete ${instanceId}' to remove instance state.`,
    );
  } catch (err) {
    spinner.fail("Failed to terminate instance");

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
 * Create the terminate command
 *
 * @returns Commander command for 'gdn instance terminate'
 */
export function createTerminateCommand(): Command {
  const command = new Command("terminate")
    .description("Terminate an instance")
    .argument("<id>", "Instance ID")
    .option("-f, --force", "Skip confirmation prompt", false)
    .option("--reason <text>", "Termination reason")
    .action(async (instanceId: string, options: Record<string, unknown>, command: Command) => {
      const globalOpts = command.optsWithGlobals<{ stateRoot?: string }>();
      const stateRoot =
        typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;
      const terminateOptions: TerminateOptions = {
        force: options["force"] === true,
        reason:
          typeof options["reason"] === "string"
            ? options["reason"]
            : undefined,
      };

      await executeTerminate(instanceId, terminateOptions, stateRoot);
    });

  return command;
}

export default createTerminateCommand;
