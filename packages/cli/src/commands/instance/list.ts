/**
 * gdn instance list command
 *
 * Lists Swarm instances
 * @see /docs/specs/cli.md - Section 7.2 (gdn instance list)
 * @see /docs/specs/workspace.md - Instance State Root
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { info, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import {
  getGoondanHomeSync,
  generateWorkspaceId,
  getInstanceInfo,
  formatDate,
  formatStatus,
} from "./utils.js";
import type { InstanceInfo } from "./utils.js";

/**
 * Instance status filter values
 */
export type StatusFilter = "running" | "paused" | "terminated";

/**
 * List command options
 */
export interface ListOptions {
  /** Filter by Swarm name */
  swarm?: string;
  /** Filter by instance status */
  status?: StatusFilter;
  /** Maximum number of instances to show */
  limit: number;
  /** Show all instances (including other workspaces) */
  all: boolean;
  /** JSON output */
  json: boolean;
  /** Global --state-root override */
  stateRoot?: string;
}

/**
 * Map status filter values to internal InstanceStatus values
 */
function matchesStatusFilter(instanceStatus: string, filter: StatusFilter): boolean {
  switch (filter) {
    case "running":
      return instanceStatus === "active";
    case "paused":
      return instanceStatus === "idle";
    case "terminated":
      return instanceStatus === "completed";
    default:
      return true;
  }
}

/**
 * Execute the list command
 */
async function executeList(options: ListOptions): Promise<void> {
  try {
    const config = await loadConfig({
      cliStateRoot: options.stateRoot,
    });
    const goondanHome = getGoondanHomeSync(config.stateRoot);
    const instancesRoot = path.join(goondanHome, "instances");

    if (!fs.existsSync(instancesRoot)) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        info("No instances found.");
      }
      return;
    }

    const instances: InstanceInfo[] = [];
    const currentWorkspaceId = generateWorkspaceId(process.cwd());

    // List workspace directories
    let workspaceIds: string[];
    try {
      workspaceIds = fs.readdirSync(instancesRoot);
    } catch {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        info("No instances found.");
      }
      return;
    }

    for (const workspaceId of workspaceIds) {
      // Skip other workspaces unless --all is specified
      if (!options.all && workspaceId !== currentWorkspaceId) {
        continue;
      }

      const workspacePath = path.join(instancesRoot, workspaceId);

      try {
        const stat = fs.statSync(workspacePath);
        if (!stat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      // List instance directories
      let instanceIds: string[];
      try {
        instanceIds = fs.readdirSync(workspacePath);
      } catch {
        continue;
      }

      for (const instanceId of instanceIds) {
        const instancePath = path.join(workspacePath, instanceId);

        try {
          const instanceStat = fs.statSync(instancePath);
          if (!instanceStat.isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }

        const instanceInfo = getInstanceInfo(instancePath, instanceId, workspaceId);

        if (instanceInfo) {
          // Filter by swarm name if specified
          if (options.swarm && instanceInfo.swarmName !== options.swarm) {
            continue;
          }

          // Filter by status if specified
          if (options.status) {
            const statusMatches = matchesStatusFilter(instanceInfo.status, options.status);
            if (!statusMatches) {
              continue;
            }
          }

          instances.push(instanceInfo);
        }
      }
    }

    if (instances.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else if (options.swarm) {
        info(`No instances found for swarm "${options.swarm}".`);
      } else {
        info("No instances found.");
      }
      return;
    }

    // Sort by creation date (newest first)
    instances.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply limit
    const limitedInstances = instances.slice(0, options.limit);

    // JSON output
    if (options.json) {
      const jsonOutput = limitedInstances.map((i) => ({
        instanceId: i.instanceId,
        swarmName: i.swarmName,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
        turns: i.turns,
        workspaceId: i.workspaceId,
      }));
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Calculate column widths
    const idWidth = Math.max(
      11, // "INSTANCE ID".length
      ...limitedInstances.map((i) => i.instanceId.length),
    );
    const swarmWidth = Math.max(
      5, // "SWARM".length
      ...limitedInstances.map((i) => i.swarmName.length),
    );

    // Print header
    console.log(
      chalk.bold(
        `${"INSTANCE ID".padEnd(idWidth)}  ` +
          `${"SWARM".padEnd(swarmWidth)}  ` +
          `${"STATUS".padEnd(10)}  ` +
          `${"CREATED".padEnd(19)}  ` +
          `${"TURNS".padStart(5)}`,
      ),
    );

    // Print instances
    for (const instance of limitedInstances) {
      // chalk 색상 코드의 길이를 보정한 패딩
      const statusStr = formatStatus(instance.status);
      const statusPadding = statusStr.length - instance.status.length;

      console.log(
        `${instance.instanceId.padEnd(idWidth)}  ` +
          `${instance.swarmName.padEnd(swarmWidth)}  ` +
          `${statusStr.padEnd(10 + statusPadding)}  ` +
          `${formatDate(instance.createdAt).padEnd(19)}  ` +
          `${String(instance.turns).padStart(5)}`,
      );
    }

    if (instances.length > options.limit) {
      console.log();
      info(`Showing ${options.limit} of ${instances.length} instances. Use --limit or --all to see more.`);
    }
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = 1;
  }
}

/**
 * Create the list command
 *
 * @returns Commander command for 'gdn instance list'
 */
export function createListCommand(): Command {
  const command = new Command("list")
    .description("List Swarm instances")
    .option("-s, --swarm <name>", "Filter by Swarm name")
    .option("--status <status>", "Filter by status (running, paused, terminated)")
    .option("-n, --limit <n>", "Maximum number of instances to show", (v) => parseInt(v, 10), 20)
    .option("-a, --all", "Show all instances (including other workspaces)", false)
    .option("--json", "Output in JSON format", false)
    .action(async (options: Record<string, unknown>, command: Command) => {
      // Validate status option
      const statusValue = typeof options["status"] === "string" ? options["status"] : undefined;
      let status: StatusFilter | undefined;
      const globalOpts = command.optsWithGlobals<{ stateRoot?: string }>();
      const stateRoot =
        typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;

      if (statusValue) {
        if (statusValue !== "running" && statusValue !== "paused" && statusValue !== "terminated") {
          logError(`Invalid status filter: ${statusValue}. Must be one of: running, paused, terminated`);
          process.exitCode = 2;
          return;
        }
        status = statusValue;
      }

      const listOptions: ListOptions = {
        swarm: typeof options["swarm"] === "string" ? options["swarm"] : undefined,
        status,
        limit: typeof options["limit"] === "number" ? options["limit"] : 20,
        all: options["all"] === true,
        json: options["json"] === true,
        stateRoot,
      };

      await executeList(listOptions);
    });

  return command;
}

export default createListCommand;
