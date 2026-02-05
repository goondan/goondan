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
import * as os from "node:os";
import * as crypto from "node:crypto";
import chalk from "chalk";
import ora from "ora";
import { info, success, error as logError } from "../../utils/logger.js";
import { loadConfig, expandPath } from "../../utils/config.js";
import { confirm, isPromptCancelled } from "../../utils/prompt.js";

/**
 * Delete command options
 */
export interface DeleteOptions {
  /** Skip confirmation prompt */
  force: boolean;
}

/**
 * Generate workspace ID from SwarmBundle root path
 */
function generateWorkspaceId(swarmBundleRoot: string): string {
  const normalized = path.resolve(swarmBundleRoot);
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  return hash.slice(0, 12);
}

/**
 * Get the Goondan home directory
 */
function getGoondanHome(stateRoot?: string): string {
  if (stateRoot) {
    return path.resolve(expandPath(stateRoot));
  }
  if (process.env.GOONDAN_STATE_ROOT) {
    return path.resolve(expandPath(process.env.GOONDAN_STATE_ROOT));
  }
  return path.join(os.homedir(), ".goondan");
}

/**
 * Find instance path by ID (searches all workspaces)
 */
function findInstancePath(
  instancesRoot: string,
  instanceId: string
): { instancePath: string; workspaceId: string } | null {
  if (!fs.existsSync(instancesRoot)) {
    return null;
  }

  // First try current workspace
  const currentWorkspaceId = generateWorkspaceId(process.cwd());
  const currentWorkspacePath = path.join(instancesRoot, currentWorkspaceId);
  const currentInstancePath = path.join(currentWorkspacePath, instanceId);

  if (fs.existsSync(currentInstancePath)) {
    return { instancePath: currentInstancePath, workspaceId: currentWorkspaceId };
  }

  // Search all workspaces
  const workspaceIds = fs.readdirSync(instancesRoot);

  for (const workspaceId of workspaceIds) {
    const workspacePath = path.join(instancesRoot, workspaceId);

    try {
      const stat = fs.statSync(workspacePath);

      if (!stat.isDirectory()) {
        continue;
      }

      const instancePath = path.join(workspacePath, instanceId);

      if (fs.existsSync(instancePath)) {
        return { instancePath, workspaceId };
      }
    } catch {
      // Ignore errors
    }
  }

  return null;
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
 * Get instance info for confirmation prompt
 */
function getInstanceInfo(instancePath: string): {
  swarmName: string;
  agentCount: number;
} | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  // Read first line to get swarm name
  const content = fs.readFileSync(swarmEventsPath, "utf-8");
  const firstLine = content.split("\n")[0];

  if (!firstLine) {
    return null;
  }

  try {
    const event: unknown = JSON.parse(firstLine);

    if (
      event !== null &&
      typeof event === "object" &&
      "swarmName" in event &&
      typeof (event as Record<string, unknown>).swarmName === "string"
    ) {
      // Count agents
      const agentsPath = path.join(instancePath, "agents");
      let agentCount = 0;

      if (fs.existsSync(agentsPath)) {
        try {
          const agents = fs.readdirSync(agentsPath);
          agentCount = agents.filter((name) => {
            const agentPath = path.join(agentsPath, name);
            return fs.statSync(agentPath).isDirectory();
          }).length;
        } catch {
          // Ignore errors
        }
      }

      return {
        swarmName: (event as Record<string, unknown>).swarmName as string,
        agentCount,
      };
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Execute the delete command
 */
async function executeDelete(
  instanceId: string,
  options: DeleteOptions
): Promise<void> {
  const spinner = ora();

  try {
    const config = await loadConfig();
    const goondanHome = getGoondanHome(config.stateRoot);
    const instancesRoot = path.join(goondanHome, "instances");

    const found = findInstancePath(instancesRoot, instanceId);

    if (!found) {
      logError(`Instance "${instanceId}" not found.`);
      info("Use 'gdn instance list --all' to see all instances.");
      process.exitCode = 1;
      return;
    }

    // Get instance info for confirmation
    const instanceInfo = getInstanceInfo(found.instancePath);

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
        { initial: false }
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
        force: options.force === true,
      };

      await executeDelete(instanceId, deleteOptions);
    });

  return command;
}

export default createDeleteCommand;
