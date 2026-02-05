/**
 * gdn instance inspect command
 *
 * Shows detailed instance information
 * @see /docs/specs/cli.md - Section 7.3 (gdn instance inspect)
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
 * Agent event log record structure
 */
interface AgentEventRecord {
  type: "agent.event";
  recordedAt: string;
  kind: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId?: string;
  stepId?: string;
  stepIndex?: number;
  data?: Record<string, unknown>;
}

/**
 * Agent info for display
 */
interface AgentInfo {
  name: string;
  turns: number;
  messages: number;
  lastActive: Date | null;
}

/**
 * Instance details
 */
interface InstanceDetails {
  instanceId: string;
  swarmName: string;
  status: "active" | "idle" | "completed";
  createdAt: Date;
  updatedAt: Date;
  agents: AgentInfo[];
  activeSwarmBundleRef: string | null;
  stateRoot: string;
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
 * Type guard for AgentEventRecord
 */
function isAgentEventRecord(value: unknown): value is AgentEventRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "agent.event" &&
    typeof record.recordedAt === "string" &&
    typeof record.kind === "string" &&
    typeof record.instanceId === "string" &&
    typeof record.agentName === "string"
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
 * Count lines in a JSONL file
 */
function countJsonlLines(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  let count = 0;

  for (const line of content.split("\n")) {
    if (line.trim()) {
      count++;
    }
  }

  return count;
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
 * Get agent info from instance path
 */
function getAgentInfo(instancePath: string): AgentInfo[] {
  const agentsPath = path.join(instancePath, "agents");

  if (!fs.existsSync(agentsPath)) {
    return [];
  }

  const agents: AgentInfo[] = [];

  try {
    const agentNames = fs.readdirSync(agentsPath);

    for (const agentName of agentNames) {
      const agentPath = path.join(agentsPath, agentName);
      const stat = fs.statSync(agentPath);

      if (!stat.isDirectory()) {
        continue;
      }

      const eventsPath = path.join(agentPath, "events", "events.jsonl");
      const messagesPath = path.join(agentPath, "messages", "llm.jsonl");

      const events = readJsonlFile(eventsPath, isAgentEventRecord);
      const messages = countJsonlLines(messagesPath);

      // Count turn.completed events
      const turns = events.filter((e) => e.kind === "turn.completed").length;

      // Find last active time
      let lastActive: Date | null = null;

      if (events.length > 0) {
        const lastEvent = events[events.length - 1];
        if (lastEvent) {
          lastActive = new Date(lastEvent.recordedAt);
        }
      }

      agents.push({
        name: agentName,
        turns,
        messages,
        lastActive,
      });
    }
  } catch {
    // Ignore errors
  }

  // Sort by name
  agents.sort((a, b) => a.name.localeCompare(b.name));

  return agents;
}

/**
 * Get instance details
 */
function getInstanceDetails(
  instancePath: string,
  instanceId: string
): InstanceDetails | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  const events = readJsonlFile(swarmEventsPath, isSwarmEventRecord);

  if (events.length === 0) {
    return null;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  if (!firstEvent || !lastEvent) {
    return null;
  }

  // Determine status
  let status: "active" | "idle" | "completed" = "idle";

  if (lastEvent.kind === "swarm.stopped") {
    status = "completed";
  } else if (lastEvent.kind === "swarm.started" || lastEvent.kind.startsWith("agent.")) {
    const lastEventTime = new Date(lastEvent.recordedAt).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (now - lastEventTime < fiveMinutes) {
      status = "active";
    }
  }

  // Find activeSwarmBundleRef from changeset events
  let activeSwarmBundleRef: string | null = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (
      event &&
      event.kind === "changeset.activated" &&
      event.data &&
      typeof event.data.newRef === "string"
    ) {
      activeSwarmBundleRef = event.data.newRef;
      break;
    }
  }

  const agents = getAgentInfo(instancePath);

  return {
    instanceId,
    swarmName: firstEvent.swarmName,
    status,
    createdAt: new Date(firstEvent.recordedAt),
    updatedAt: new Date(lastEvent.recordedAt),
    agents,
    activeSwarmBundleRef,
    stateRoot: instancePath,
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
 * Execute the inspect command
 */
async function executeInspect(instanceId: string): Promise<void> {
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

    const details = getInstanceDetails(found.instancePath, instanceId);

    if (!details) {
      logError(`Failed to read instance "${instanceId}".`);
      process.exitCode = 1;
      return;
    }

    // Print instance details
    console.log();
    console.log(`${chalk.bold("Instance:")} ${details.instanceId}`);
    console.log(`${chalk.bold("Swarm:")}    ${details.swarmName}`);
    console.log(`${chalk.bold("Status:")}   ${formatStatus(details.status)}`);
    console.log(`${chalk.bold("Created:")}  ${formatDate(details.createdAt)}`);
    console.log(`${chalk.bold("Updated:")}  ${formatDate(details.updatedAt)}`);
    console.log();

    if (details.agents.length > 0) {
      console.log(chalk.bold("Agents:"));

      for (const agent of details.agents) {
        console.log(`  ${chalk.cyan(agent.name)}:`);
        console.log(`    Turns: ${agent.turns}`);
        console.log(`    Messages: ${agent.messages}`);

        if (agent.lastActive) {
          console.log(`    Last Active: ${formatDate(agent.lastActive)}`);
        }
      }

      console.log();
    }

    if (details.activeSwarmBundleRef) {
      console.log(
        `${chalk.bold("Active SwarmBundleRef:")} ${details.activeSwarmBundleRef}`
      );
      console.log();
    }

    console.log(`${chalk.bold("State Root:")} ${details.stateRoot}`);
    console.log();
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
    }
    process.exitCode = 1;
  }
}

/**
 * Create the inspect command
 *
 * @returns Commander command for 'gdn instance inspect'
 */
export function createInspectCommand(): Command {
  const command = new Command("inspect")
    .description("Show detailed instance information")
    .argument("<id>", "Instance ID")
    .action(async (instanceId: string) => {
      await executeInspect(instanceId);
    });

  return command;
}

export default createInspectCommand;
