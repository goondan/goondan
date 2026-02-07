/**
 * gdn instance resume command
 *
 * Resumes a saved instance
 * @see /docs/specs/cli.md - Section 7.5 (gdn instance resume)
 * @see /docs/specs/workspace.md - Instance State Root
 */

import { Command } from "commander";
import * as path from "node:path";
import chalk from "chalk";
import { info, warn, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import {
  getGoondanHomeSync,
  findInstancePath,
  getInstanceBasicInfo,
  formatDate,
} from "./utils.js";

/**
 * Resume command options
 */
export interface ResumeOptions {
  /** Input message to send when resuming */
  input?: string;
}

/**
 * Execute the resume command
 */
async function executeResume(
  instanceId: string,
  options: ResumeOptions,
): Promise<void> {
  try {
    const config = await loadConfig();
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

    if (instanceInfo.lastEventTime) {
      console.log(`${chalk.bold("Last Active:")} ${formatDate(instanceInfo.lastEventTime)}`);
    }

    console.log();

    if (options.input) {
      console.log(`${chalk.bold("Resume message:")} ${options.input}`);
      console.log();
    }

    // TODO: Implement actual resume functionality
    // This would involve:
    // 1. Loading the SwarmBundle from the original SwarmBundleRoot
    // 2. Restoring the instance state
    // 3. Starting the runtime with the restored state
    // 4. Sending the resume message if provided

    warn(
      chalk.yellow(
        "Note: Resume functionality is not yet implemented. " +
          "This command will be available in a future release.",
      ),
    );

    console.log();
    info("To run a new instance, use:");
    console.log(
      `  gdn run --swarm ${instanceInfo.swarmName} --instance-key ${instanceInfo.instanceKey}`,
    );
    console.log();
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = 1;
  }
}

/**
 * Create the resume command
 *
 * @returns Commander command for 'gdn instance resume'
 */
export function createResumeCommand(): Command {
  const command = new Command("resume")
    .description("Resume a saved instance")
    .argument("<id>", "Instance ID")
    .option("--input <text>", "Input message to send when resuming")
    .action(async (instanceId: string, options: Record<string, unknown>) => {
      const resumeOptions: ResumeOptions = {
        input: typeof options["input"] === "string" ? options["input"] : undefined,
      };

      await executeResume(instanceId, resumeOptions);
    });

  return command;
}

export default createResumeCommand;
