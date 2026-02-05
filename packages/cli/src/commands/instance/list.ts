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
import * as os from "node:os";
import * as crypto from "node:crypto";
import chalk from "chalk";
import { info, error as logError } from "../../utils/logger.js";
import { loadConfig, expandPath } from "../../utils/config.js";

/**
 * List command options
 */
export interface ListOptions {
  /** Filter by Swarm name */
  swarm?: string;
  /** Maximum number of instances to show */
  limit: number;
  /** Show all instances (including other workspaces) */
  all: boolean;
}

/**
 * Instance summary info
 */
interface InstanceInfo {
  instanceId: string;
  swarmName: string;
  status: "active" | "idle" | "completed";
  createdAt: Date;
  turns: number;
  workspaceId: string;
}

/**
 * Swarm event log record structure
 */
interface SwarmEventRecord {
  type: "swarm.event";
  recordedAt: string;
  kind: string;
  instanceId: string;
  instanceKey: string;
  swarmName: string;
  agentName?: string;
  data?: Record<string, unknown>;
}

/**
 * Type guard for SwarmEventRecord
 */
function isSwarmEventRecord(value: unknown): value is SwarmEventRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "swarm.event" &&
    typeof record.recordedAt === "string" &&
    typeof record.kind === "string" &&
    typeof record.instanceId === "string" &&
    typeof record.swarmName === "string"
  );
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
 * Read JSONL file and parse records
 */
function readJsonlFile<T>(
  filePath: string,
  guard: (value: unknown) => value is T
): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const records: T[] = [];

  for (const line of content.split("\n")) {
    if (line.trim()) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (guard(parsed)) {
          records.push(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return records;
}

/**
 * Count turn events in swarm event log
 */
function countTurns(eventsPath: string): number {
  // Read agent event logs to count turn.completed events
  const agentsDir = path.dirname(path.dirname(eventsPath));
  const agentsPath = path.join(agentsDir, "agents");

  if (!fs.existsSync(agentsPath)) {
    return 0;
  }

  let turnCount = 0;

  try {
    const agents = fs.readdirSync(agentsPath);

    for (const agent of agents) {
      const agentEventsPath = path.join(
        agentsPath,
        agent,
        "events",
        "events.jsonl"
      );

      if (fs.existsSync(agentEventsPath)) {
        const content = fs.readFileSync(agentEventsPath, "utf-8");

        for (const line of content.split("\n")) {
          if (line.includes('"turn.completed"') || line.includes('"turn.started"')) {
            turnCount++;
          }
        }
      }
    }
  } catch {
    // Ignore errors reading agent directories
  }

  // Divide by 2 since we counted both started and completed
  return Math.ceil(turnCount / 2);
}

/**
 * Get instance info from instance directory
 */
function getInstanceInfo(
  instancePath: string,
  instanceId: string,
  workspaceId: string
): InstanceInfo | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  const events = readJsonlFile(swarmEventsPath, isSwarmEventRecord);

  if (events.length === 0) {
    return null;
  }

  // Find the first event to get swarm name and creation time
  const firstEvent = events[0];
  if (!firstEvent) {
    return null;
  }

  // Find the last event to determine status
  const lastEvent = events[events.length - 1];

  // Determine status based on last event
  let status: "active" | "idle" | "completed" = "idle";

  if (lastEvent) {
    if (lastEvent.kind === "swarm.stopped") {
      status = "completed";
    } else if (lastEvent.kind === "swarm.started" || lastEvent.kind.startsWith("agent.")) {
      // Check if the last event was recent (within 5 minutes)
      const lastEventTime = new Date(lastEvent.recordedAt).getTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (now - lastEventTime < fiveMinutes) {
        status = "active";
      }
    }
  }

  const turns = countTurns(swarmEventsPath);

  return {
    instanceId,
    swarmName: firstEvent.swarmName,
    status,
    createdAt: new Date(firstEvent.recordedAt),
    turns,
    workspaceId,
  };
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
 * Format status with color
 */
function formatStatus(status: "active" | "idle" | "completed"): string {
  switch (status) {
    case "active":
      return chalk.green(status);
    case "idle":
      return chalk.yellow(status);
    case "completed":
      return chalk.gray(status);
  }
}

/**
 * Execute the list command
 */
async function executeList(options: ListOptions): Promise<void> {
  try {
    const config = await loadConfig();
    const goondanHome = getGoondanHome(config.stateRoot);
    const instancesRoot = path.join(goondanHome, "instances");

    if (!fs.existsSync(instancesRoot)) {
      info("No instances found.");
      return;
    }

    const instances: InstanceInfo[] = [];
    const currentWorkspaceId = generateWorkspaceId(process.cwd());

    // List workspace directories
    const workspaceIds = fs.readdirSync(instancesRoot);

    for (const workspaceId of workspaceIds) {
      // Skip other workspaces unless --all is specified
      if (!options.all && workspaceId !== currentWorkspaceId) {
        continue;
      }

      const workspacePath = path.join(instancesRoot, workspaceId);
      const stat = fs.statSync(workspacePath);

      if (!stat.isDirectory()) {
        continue;
      }

      // List instance directories
      const instanceIds = fs.readdirSync(workspacePath);

      for (const instanceId of instanceIds) {
        const instancePath = path.join(workspacePath, instanceId);
        const instanceStat = fs.statSync(instancePath);

        if (!instanceStat.isDirectory()) {
          continue;
        }

        const instanceInfo = getInstanceInfo(instancePath, instanceId, workspaceId);

        if (instanceInfo) {
          // Filter by swarm name if specified
          if (options.swarm && instanceInfo.swarmName !== options.swarm) {
            continue;
          }

          instances.push(instanceInfo);
        }
      }
    }

    if (instances.length === 0) {
      if (options.swarm) {
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

    // Calculate column widths
    const idWidth = Math.max(
      11, // "INSTANCE ID".length
      ...limitedInstances.map((i) => i.instanceId.length)
    );
    const swarmWidth = Math.max(
      5, // "SWARM".length
      ...limitedInstances.map((i) => i.swarmName.length)
    );

    // Print header
    console.log(
      chalk.bold(
        `${"INSTANCE ID".padEnd(idWidth)}  ` +
          `${"SWARM".padEnd(swarmWidth)}  ` +
          `${"STATUS".padEnd(10)}  ` +
          `${"CREATED".padEnd(19)}  ` +
          `${"TURNS".padStart(5)}`
      )
    );

    // Print instances
    for (const instance of limitedInstances) {
      console.log(
        `${instance.instanceId.padEnd(idWidth)}  ` +
          `${instance.swarmName.padEnd(swarmWidth)}  ` +
          `${formatStatus(instance.status).padEnd(10 + (instance.status === "active" ? 9 : instance.status === "idle" ? 9 : 5))}  ` +
          `${formatDate(instance.createdAt).padEnd(19)}  ` +
          `${String(instance.turns).padStart(5)}`
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
    .option("-n, --limit <n>", "Maximum number of instances to show", (v) => parseInt(v, 10), 20)
    .option("-a, --all", "Show all instances (including other workspaces)", false)
    .action(async (options: Record<string, unknown>) => {
      const listOptions: ListOptions = {
        swarm: options.swarm as string | undefined,
        limit: typeof options.limit === "number" ? options.limit : 20,
        all: options.all === true,
      };

      await executeList(listOptions);
    });

  return command;
}

export default createListCommand;
