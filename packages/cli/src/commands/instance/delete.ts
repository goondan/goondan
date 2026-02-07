/**
 * gdn instance delete command
 *
 * Deletes instance state
 * @see /docs/specs/cli.md - Section 7.4 (gdn instance delete)
 * @see /docs/specs/workspace.md - Instance State Root
 */

import { Command } from "commander";
import * as fs from "node:fs";
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
 * Delete command options
 */
export interface DeleteOptions {
  /** Skip confirmation prompt */
  force: boolean;
}

/**
 * Recursively delete a directory
 */
function deleteDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      deleteDirectory(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }

  fs.rmdirSync(dirPath);
}

/**
 * Execute the delete command
 */
async function executeDelete(
  instanceId: string,
  options: DeleteOptions,
): Promise<void> {
  const spinner = ora();

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

    // Get instance info for confirmation
    const instanceInfo = getInstanceBasicInfo(found.instancePath);

    // Confirm deletion unless --force is specified
    if (!options.force) {
      console.log();

      if (instanceInfo) {
        console.log(`Instance: ${chalk.cyan(instanceId)}`);
        console.log(`Swarm:    ${instanceInfo.swarmName}`);
        console.log(`Agents:   ${instanceInfo.agentCount}`);
        console.log(`Path:     ${found.instancePath}`);
        console.log();
      }

      const confirmed = await confirm(
        `Are you sure you want to delete instance "${instanceId}"?`,
        { initial: false },
      );

      if (!confirmed) {
        info("Deletion cancelled.");
        return;
      }
    }

    // Delete the instance directory
    spinner.start(`Deleting instance ${instanceId}...`);

    deleteDirectory(found.instancePath);

    spinner.succeed(`Deleted instance ${chalk.cyan(instanceId)}`);

    // Check if workspace directory is empty and remove it
    const workspacePath = path.join(instancesRoot, found.workspaceId);

    if (fs.existsSync(workspacePath)) {
      const remainingInstances = fs.readdirSync(workspacePath);

      if (remainingInstances.length === 0) {
        fs.rmdirSync(workspacePath);
        info("Removed empty workspace directory.");
      }
    }

    console.log();
    success(`Instance "${instanceId}" has been deleted.`);
  } catch (err) {
    spinner.fail("Failed to delete instance");

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
 * Create the delete command
 *
 * @returns Commander command for 'gdn instance delete'
 */
export function createDeleteCommand(): Command {
  const command = new Command("delete")
    .description("Delete instance state")
    .argument("<id>", "Instance ID")
    .option("-f, --force", "Skip confirmation prompt", false)
    .action(async (instanceId: string, options: Record<string, unknown>) => {
      const deleteOptions: DeleteOptions = {
        force: options["force"] === true,
      };

      await executeDelete(instanceId, deleteOptions);
    });

  return command;
}

export default createDeleteCommand;
