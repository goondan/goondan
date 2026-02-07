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
import chalk from "chalk";
import { info, error as logError } from "../../utils/logger.js";
import { loadConfig } from "../../utils/config.js";
import {
  getGoondanHomeSync,
  findInstancePath,
  readJsonlFile,
  countJsonlLines,
  isSwarmEventRecord,
  isAgentEventRecord,
  formatDate,
  formatStatus,
  determineInstanceStatus,
} from "./utils.js";
import type { InstanceStatus, SwarmEventRecord, AgentEventRecord } from "./utils.js";

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
  status: InstanceStatus;
  createdAt: Date;
  updatedAt: Date;
  agents: AgentInfo[];
  activeSwarmBundleRef: string | null;
  stateRoot: string;
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

      try {
        const stat = fs.statSync(agentPath);
        if (!stat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const eventsPath = path.join(agentPath, "events", "events.jsonl");
      const messagesPath = path.join(agentPath, "messages", "llm.jsonl");

      const events = readJsonlFile<AgentEventRecord>(eventsPath, isAgentEventRecord);
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
  instanceId: string,
): InstanceDetails | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  const events = readJsonlFile<SwarmEventRecord>(swarmEventsPath, isSwarmEventRecord);

  if (events.length === 0) {
    return null;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  if (!firstEvent || !lastEvent) {
    return null;
  }

  // Determine status
  const status: InstanceStatus = determineInstanceStatus(lastEvent);

  // Find activeSwarmBundleRef from changeset events
  let activeSwarmBundleRef: string | null = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (
      event &&
      event.kind === "changeset.activated" &&
      event.data &&
      typeof event.data["newRef"] === "string"
    ) {
      activeSwarmBundleRef = event.data["newRef"];
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
 * Execute the inspect command
 */
async function executeInspect(instanceId: string, json: boolean): Promise<void> {
  try {
    const config = await loadConfig();
    const goondanHome = getGoondanHomeSync(config.stateRoot);
    const instancesRoot = path.join(goondanHome, "instances");

    const found = findInstancePath(instancesRoot, instanceId);

    if (!found) {
      if (json) {
        console.log(JSON.stringify({ error: `Instance "${instanceId}" not found.` }));
      } else {
        logError(`Instance "${instanceId}" not found.`);
        info("Use 'gdn instance list --all' to see all instances.");
      }
      process.exitCode = 1;
      return;
    }

    const details = getInstanceDetails(found.instancePath, instanceId);

    if (!details) {
      if (json) {
        console.log(JSON.stringify({ error: `Failed to read instance "${instanceId}".` }));
      } else {
        logError(`Failed to read instance "${instanceId}".`);
      }
      process.exitCode = 1;
      return;
    }

    // JSON output
    if (json) {
      const jsonOutput = {
        instanceId: details.instanceId,
        swarmName: details.swarmName,
        status: details.status,
        createdAt: details.createdAt.toISOString(),
        updatedAt: details.updatedAt.toISOString(),
        agents: details.agents.map((a) => ({
          name: a.name,
          turns: a.turns,
          messages: a.messages,
          lastActive: a.lastActive?.toISOString() ?? null,
        })),
        activeSwarmBundleRef: details.activeSwarmBundleRef,
        stateRoot: details.stateRoot,
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
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
        `${chalk.bold("Active SwarmBundleRef:")} ${details.activeSwarmBundleRef}`,
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
    .option("--json", "Output in JSON format", false)
    .action(async (instanceId: string, options: Record<string, unknown>) => {
      await executeInspect(instanceId, options["json"] === true);
    });

  return command;
}

export default createInspectCommand;
