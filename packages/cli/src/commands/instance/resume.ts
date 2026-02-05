/**
 * gdn instance resume command
 *
 * Resumes a saved instance
 * @see /docs/specs/cli.md - Section 7.5 (gdn instance resume)
 * @see /docs/specs/workspace.md - Instance State Root
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import chalk from "chalk";
import { info, warn, error as logError } from "../../utils/logger.js";
import { loadConfig, expandPath } from "../../utils/config.js";

/**
 * Resume command options
 */
export interface ResumeOptions {
  /** Input message to send when resuming */
  input?: string;
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
 * Get instance info from swarm events
 */
function getInstanceInfo(instancePath: string): {
  swarmName: string;
  instanceKey: string;
  lastEventTime: Date | null;
} | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  const content = fs.readFileSync(swarmEventsPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];

  if (!firstLine) {
    return null;
  }

  try {
    const firstEvent: unknown = JSON.parse(firstLine);

    if (
      firstEvent !== null &&
      typeof firstEvent === "object" &&
      "swarmName" in firstEvent &&
      typeof (firstEvent as Record<string, unknown>).swarmName === "string" &&
      "instanceKey" in firstEvent &&
      typeof (firstEvent as Record<string, unknown>).instanceKey === "string"
    ) {
      let lastEventTime: Date | null = null;

      if (lastLine) {
        try {
          const lastEvent: unknown = JSON.parse(lastLine);

          if (
            lastEvent !== null &&
            typeof lastEvent === "object" &&
            "recordedAt" in lastEvent &&
            typeof (lastEvent as Record<string, unknown>).recordedAt === "string"
          ) {
            lastEventTime = new Date(
              (lastEvent as Record<string, unknown>).recordedAt as string
            );
          }
        } catch {
          // Ignore parse errors
        }
      }

      return {
        swarmName: (firstEvent as Record<string, unknown>).swarmName as string,
        instanceKey: (firstEvent as Record<string, unknown>).instanceKey as string,
        lastEventTime,
      };
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Execute the resume command
 */
async function executeResume(
  instanceId: string,
  options: ResumeOptions
): Promise<void> {
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

    const instanceInfo = getInstanceInfo(found.instancePath);

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
          "This command will be available in a future release."
      )
    );

    console.log();
    info("To run a new instance, use:");
    console.log(
      `  gdn run --swarm ${instanceInfo.swarmName} --instance-key ${instanceInfo.instanceKey}`
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
        input: options.input as string | undefined,
      };

      await executeResume(instanceId, resumeOptions);
    });

  return command;
}

export default createResumeCommand;
