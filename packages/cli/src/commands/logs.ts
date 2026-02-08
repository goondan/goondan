/**
 * gdn logs command
 *
 * View instance logs with various filtering options.
 * Reads from ~/.goondan/instances/<workspaceId>/<instanceId>/agents/<agent>/messages/base.jsonl
 *
 * @see /docs/specs/cli.md - Section 8 (gdn logs)
 * @see /docs/specs/workspace.md - Section 6 (Message State Log Schema)
 */

import { Command, Option } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { info, error as logError, debug } from "../utils/logger.js";
import { loadConfig, expandPath } from "../utils/config.js";
import { ExitCode } from "../types.js";

/**
 * Log type filter
 */
export type LogType = "messages" | "events" | "all";

/**
 * Logs command options
 */
export interface LogsOptions {
  /** Filter by agent name */
  agent?: string;
  /** Log type filter */
  type: LogType;
  /** Stream logs in real-time */
  follow: boolean;
  /** Number of lines to show from end */
  tail?: number;
  /** Show logs since this time */
  since?: string;
  /** Show logs until this time */
  until?: string;
  /** Filter by turn ID */
  turn?: string;
  /** Filter by trace ID */
  trace?: string;
  /** JSON output mode */
  json?: boolean;
}

/**
 * Message Base Log Record structure (Delta format)
 * @see /docs/specs/workspace.md - Section 6.3
 */
interface MessageBaseLogRecord {
  type: "message.base";
  recordedAt: string;
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  message: LlmMessage;
  seq: number;
}

/**
 * Message Event Log Record structure
 * @see /docs/specs/workspace.md - Section 6.4
 */
interface MessageEventLogRecord {
  type: "message.event";
  recordedAt: string;
  traceId: string;
  instanceId: string;
  instanceKey: string;
  agentName: string;
  turnId: string;
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  stepId?: string;
}

/**
 * LLM Message types
 */
type LlmMessage =
  | { id: string; role: "system"; content: string }
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { id: string; role: "tool"; toolCallId: string; toolName: string; output: unknown };

/**
 * Tool call structure
 */
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Agent Event Log Record structure
 * @see /docs/specs/workspace.md - Section 7.2
 */
interface AgentEventLogRecord {
  type: "agent.event";
  recordedAt: string;
  traceId: string;
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
 * Swarm Event Log Record structure
 * @see /docs/specs/workspace.md - Section 7.1
 */
interface SwarmEventLogRecord {
  type: "swarm.event";
  recordedAt: string;
  traceId: string;
  kind: string;
  instanceId: string;
  instanceKey: string;
  swarmName: string;
  agentName?: string;
  data?: Record<string, unknown>;
}

/**
 * Combined log record type
 */
type LogRecord = MessageBaseLogRecord | MessageEventLogRecord | AgentEventLogRecord | SwarmEventLogRecord;

/**
 * Instance information
 */
interface InstanceInfo {
  instanceId: string;
  workspaceId: string;
  path: string;
  modifiedAt: Date;
}

/**
 * Get the goondan home directory
 */
async function getGoondanHome(stateRoot?: string): Promise<string> {
  const config = await loadConfig({
    cliStateRoot: stateRoot,
  });
  if (config.stateRoot) {
    return expandPath(config.stateRoot);
  }
  return path.join(homedir(), ".goondan");
}

/**
 * List all instances across all workspaces
 */
async function listAllInstances(goondanHome: string): Promise<InstanceInfo[]> {
  const instancesDir = path.join(goondanHome, "instances");
  const instances: InstanceInfo[] = [];

  try {
    const workspaceIds = await fs.promises.readdir(instancesDir);

    for (const workspaceId of workspaceIds) {
      const workspacePath = path.join(instancesDir, workspaceId);
      const stat = await fs.promises.stat(workspacePath);

      if (!stat.isDirectory()) {
        continue;
      }

      try {
        const instanceIds = await fs.promises.readdir(workspacePath);

        for (const instanceId of instanceIds) {
          const instancePath = path.join(workspacePath, instanceId);
          const instanceStat = await fs.promises.stat(instancePath);

          if (instanceStat.isDirectory()) {
            instances.push({
              instanceId,
              workspaceId,
              path: instancePath,
              modifiedAt: instanceStat.mtime,
            });
          }
        }
      } catch {
        // Skip if can't read workspace directory
      }
    }
  } catch {
    // No instances directory
  }

  // Sort by modification time, most recent first
  instances.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return instances;
}

/**
 * Find instance by ID or get most recent
 */
async function findInstance(
  goondanHome: string,
  instanceId?: string
): Promise<InstanceInfo | undefined> {
  const instances = await listAllInstances(goondanHome);

  if (instances.length === 0) {
    return undefined;
  }

  if (!instanceId) {
    // Return most recent instance
    return instances[0];
  }

  // Find by instance ID
  return instances.find((i) => i.instanceId === instanceId);
}

/**
 * List agents in an instance
 */
async function listAgents(instancePath: string): Promise<string[]> {
  const agentsDir = path.join(instancePath, "agents");
  const agents: string[] = [];

  try {
    const entries = await fs.promises.readdir(agentsDir);

    for (const entry of entries) {
      const entryPath = path.join(agentsDir, entry);
      const stat = await fs.promises.stat(entryPath);
      if (stat.isDirectory()) {
        agents.push(entry);
      }
    }
  } catch {
    // No agents directory
  }

  return agents;
}

/**
 * Parse JSONL file and yield records
 */
async function* readJsonlFile<T>(filePath: string): AsyncGenerator<T> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    for (const line of content.split("\n")) {
      if (line.trim()) {
        try {
          yield JSON.parse(line) as T;
        } catch {
          // Skip invalid JSON lines
        }
      }
    }
  } catch (err) {
    // Check for ENOENT
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      // File doesn't exist, yield nothing
      return;
    }
    throw err;
  }
}

/**
 * Parse time string to Date
 */
function parseTimeFilter(timeStr: string): Date | undefined {
  // Try ISO format first
  let date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try relative time (e.g., "1h", "30m", "2d")
  const relativeMatch = /^(\d+)([smhd])$/.exec(timeStr);
  if (relativeMatch && relativeMatch[1] && relativeMatch[2]) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();

    switch (unit) {
      case "s":
        return new Date(now - value * 1000);
      case "m":
        return new Date(now - value * 60 * 1000);
      case "h":
        return new Date(now - value * 60 * 60 * 1000);
      case "d":
        return new Date(now - value * 24 * 60 * 60 * 1000);
    }
  }

  return undefined;
}

/**
 * Filter log record by options
 */
function filterRecord(record: LogRecord, options: LogsOptions): boolean {
  // Filter by agent
  if (options.agent) {
    if ("agentName" in record && record.agentName !== options.agent) {
      return false;
    }
  }

  // Filter by turn
  if (options.turn) {
    if ("turnId" in record && record.turnId !== options.turn) {
      return false;
    }
  }

  // Filter by trace ID
  if (options.trace) {
    if ("traceId" in record && record.traceId !== options.trace) {
      return false;
    }
  }

  // Filter by time (since)
  if (options.since) {
    const sinceDate = parseTimeFilter(options.since);
    if (sinceDate) {
      const recordDate = new Date(record.recordedAt);
      if (recordDate < sinceDate) {
        return false;
      }
    }
  }

  // Filter by time (until)
  if (options.until) {
    const untilDate = parseTimeFilter(options.until);
    if (untilDate) {
      const recordDate = new Date(record.recordedAt);
      if (recordDate > untilDate) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toISOString().replace("T", " ").replace("Z", "").slice(0, 23);
}

/**
 * Format message base record for display
 */
function formatMessageBase(record: MessageBaseLogRecord): string {
  const timestamp = formatTimestamp(record.recordedAt);
  const agent = record.agentName;
  const c = chalk;
  const prefix = c.gray(`[${timestamp}] [${agent}]`);

  return `${prefix} ${c.magenta("base:")} seq=${record.seq} role=${record.message.role}`;
}

/**
 * Format message event record for display
 */
function formatMessageEvent(record: MessageEventLogRecord): string {
  const timestamp = formatTimestamp(record.recordedAt);
  const agent = record.agentName;
  const c = chalk;
  const prefix = c.gray(`[${timestamp}] [${agent}]`);

  const payloadStr = JSON.stringify(record.payload);
  const truncated = payloadStr.length > 200 ? payloadStr.slice(0, 200) + "..." : payloadStr;

  return `${prefix} ${c.cyan(`event[${record.eventType}]:`)} seq=${record.seq} ${truncated}`;
}

/**
 * Format event record for display
 */
function formatEventRecord(
  record: AgentEventLogRecord | SwarmEventLogRecord
): string {
  const timestamp = formatTimestamp(record.recordedAt);
  const c = chalk;

  if (record.type === "agent.event") {
    const agentRecord = record;
    const agent = agentRecord.agentName;
    const prefix = c.gray(`[${timestamp}] [${agent}]`);

    let details = "";
    if (agentRecord.turnId) {
      details += ` turnId=${agentRecord.turnId}`;
    }
    if (agentRecord.stepId) {
      details += ` stepId=${agentRecord.stepId}`;
    }
    if (agentRecord.data) {
      const dataStr = JSON.stringify(agentRecord.data);
      if (dataStr.length < 100) {
        details += ` ${dataStr}`;
      }
    }

    return `${prefix} ${c.yellow(agentRecord.kind)}${details}`;
  } else {
    const swarmRecord = record;
    const swarm = swarmRecord.swarmName;
    const prefix = c.gray(`[${timestamp}] [${swarm}]`);

    let details = "";
    if (swarmRecord.agentName) {
      details += ` agent=${swarmRecord.agentName}`;
    }
    if (swarmRecord.data) {
      const dataStr = JSON.stringify(swarmRecord.data);
      if (dataStr.length < 100) {
        details += ` ${dataStr}`;
      }
    }

    return `${prefix} ${c.yellow(swarmRecord.kind)}${details}`;
  }
}

/**
 * Format record for display
 */
function formatRecord(record: LogRecord, jsonOutput: boolean): string {
  if (jsonOutput) {
    return JSON.stringify(record);
  }

  if (record.type === "message.base") {
    return formatMessageBase(record);
  } else if (record.type === "message.event") {
    return formatMessageEvent(record);
  } else {
    return formatEventRecord(record);
  }
}

/**
 * Collect all log records from an instance
 */
async function collectLogs(
  instanceInfo: InstanceInfo,
  options: LogsOptions
): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  const agents = options.agent
    ? [options.agent]
    : await listAgents(instanceInfo.path);

  // Collect message logs
  if (options.type === "messages" || options.type === "all") {
    for (const agent of agents) {
      // Read base.jsonl (message snapshots)
      const basePath = path.join(
        instanceInfo.path,
        "agents",
        agent,
        "messages",
        "base.jsonl"
      );
      for await (const record of readJsonlFile<MessageBaseLogRecord>(
        basePath
      )) {
        if (filterRecord(record, options)) {
          records.push(record);
        }
      }

      // Read events.jsonl (message events)
      const messageEventsPath = path.join(
        instanceInfo.path,
        "agents",
        agent,
        "messages",
        "events.jsonl"
      );
      for await (const record of readJsonlFile<MessageEventLogRecord>(
        messageEventsPath
      )) {
        if (filterRecord(record, options)) {
          records.push(record);
        }
      }
    }
  }

  // Collect event logs
  if (options.type === "events" || options.type === "all") {
    // Agent events
    for (const agent of agents) {
      const eventsPath = path.join(
        instanceInfo.path,
        "agents",
        agent,
        "events",
        "events.jsonl"
      );
      for await (const record of readJsonlFile<AgentEventLogRecord>(
        eventsPath
      )) {
        if (filterRecord(record, options)) {
          records.push(record);
        }
      }
    }

    // Swarm events
    const swarmEventsPath = path.join(
      instanceInfo.path,
      "swarm",
      "events",
      "events.jsonl"
    );
    for await (const record of readJsonlFile<SwarmEventLogRecord>(
      swarmEventsPath
    )) {
      if (filterRecord(record, options)) {
        records.push(record);
      }
    }
  }

  // Sort by timestamp
  records.sort(
    (a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  return records;
}

/**
 * Watch log files for changes
 */
async function watchLogs(
  instanceInfo: InstanceInfo,
  options: LogsOptions
): Promise<void> {
  const agents = options.agent
    ? [options.agent]
    : await listAgents(instanceInfo.path);
  const watchedFiles: string[] = [];

  // Determine files to watch
  if (options.type === "messages" || options.type === "all") {
    for (const agent of agents) {
      watchedFiles.push(
        path.join(instanceInfo.path, "agents", agent, "messages", "base.jsonl")
      );
      watchedFiles.push(
        path.join(instanceInfo.path, "agents", agent, "messages", "events.jsonl")
      );
    }
  }

  if (options.type === "events" || options.type === "all") {
    for (const agent of agents) {
      watchedFiles.push(
        path.join(instanceInfo.path, "agents", agent, "events", "events.jsonl")
      );
    }
    watchedFiles.push(
      path.join(instanceInfo.path, "swarm", "events", "events.jsonl")
    );
  }

  // Track file positions
  const filePositions = new Map<string, number>();

  // Initialize positions
  for (const file of watchedFiles) {
    try {
      const stat = await fs.promises.stat(file);
      filePositions.set(file, stat.size);
    } catch {
      filePositions.set(file, 0);
    }
  }

  // Watch for changes
  const watchers: fs.FSWatcher[] = [];

  for (const file of watchedFiles) {
    const dir = path.dirname(file);

    // Ensure directory exists
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch {
      // Ignore
    }

    try {
      const watcher = fs.watch(dir, async (_eventType, filename) => {
        if (filename === path.basename(file)) {
          try {
            const stat = await fs.promises.stat(file);
            const lastPos = filePositions.get(file) ?? 0;

            if (stat.size > lastPos) {
              // Read new content
              const fd = await fs.promises.open(file, "r");
              const buffer = Buffer.alloc(stat.size - lastPos);
              await fd.read(buffer, 0, buffer.length, lastPos);
              await fd.close();

              const newContent = buffer.toString("utf8");
              const lines = newContent.split("\n").filter((l) => l.trim());

              for (const line of lines) {
                try {
                  const record = JSON.parse(line) as LogRecord;
                  if (filterRecord(record, options)) {
                    console.log(formatRecord(record, options.json ?? false));
                  }
                } catch {
                  // Skip invalid JSON
                }
              }

              filePositions.set(file, stat.size);
            }
          } catch {
            // Ignore read errors
          }
        }
      });

      watchers.push(watcher);
    } catch {
      // Ignore watch errors
    }
  }

  // Handle cleanup on exit
  const cleanup = (): void => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Keep process running
  info("Watching for new logs... (Ctrl+C to exit)");
  await new Promise<void>(() => {
    // Never resolves
  });
}

/**
 * Execute the logs command
 */
async function executeLogs(
  instanceId: string | undefined,
  options: LogsOptions,
  stateRoot?: string,
): Promise<void> {
  try {
    const goondanHome = await getGoondanHome(stateRoot);

    // Find instance
    const instanceInfo = await findInstance(goondanHome, instanceId);

    if (!instanceInfo) {
      if (instanceId) {
        logError(`Instance '${instanceId}' not found`);
      } else {
        logError("No instances found");
        info(
          "Run 'gdn run' to create an instance, or specify an instance ID"
        );
      }
      process.exitCode = ExitCode.CONFIG_ERROR;
      return;
    }

    debug(`Found instance: ${instanceInfo.instanceId} (workspace: ${instanceInfo.workspaceId})`);

    // If follow mode, start watching
    if (options.follow) {
      // First output existing logs
      const records = await collectLogs(instanceInfo, options);
      for (const record of records) {
        console.log(formatRecord(record, options.json ?? false));
      }

      // Then watch for new logs
      await watchLogs(instanceInfo, options);
      return;
    }

    // Collect and display logs
    let records = await collectLogs(instanceInfo, options);

    // Apply tail filter
    if (options.tail !== undefined && options.tail > 0) {
      records = records.slice(-options.tail);
    }

    if (records.length === 0) {
      info("No logs found matching the specified criteria");
      return;
    }

    // Output logs
    for (const record of records) {
      console.log(formatRecord(record, options.json ?? false));
    }
  } catch (err) {
    if (err instanceof Error) {
      logError(err.message);
      debug(err.stack ?? "");
    }
    process.exitCode = ExitCode.ERROR;
  }
}

/**
 * Create the logs command
 *
 * @returns Commander command for 'gdn logs'
 */
export function createLogsCommand(): Command {
  const command = new Command("logs")
    .description("View instance logs")
    .argument("[instance-id]", "Instance ID (default: most recent)")
    .addOption(
      new Option("-a, --agent <name>", "Filter by agent name")
    )
    .addOption(
      new Option("-t, --type <type>", "Log type")
        .choices(["messages", "events", "all"])
        .default("all")
    )
    .addOption(
      new Option("-f, --follow", "Stream logs in real-time").default(false)
    )
    .addOption(
      new Option("--tail <n>", "Show last n lines").argParser(parseInt)
    )
    .addOption(
      new Option("--since <time>", "Show logs since time (ISO8601 or relative: 1h, 30m, 2d)")
    )
    .addOption(
      new Option("--until <time>", "Show logs until time (ISO8601 or relative)")
    )
    .addOption(
      new Option("--turn <id>", "Filter by turn ID")
    )
    .addOption(
      new Option("--trace <id>", "Filter by trace ID")
    )
    .action(
      async (
        instanceIdArg: string | undefined,
        opts: Record<string, unknown>,
        command: Command,
      ) => {
        const globalOpts = command.optsWithGlobals<{ stateRoot?: string }>();
        const stateRoot =
          typeof globalOpts.stateRoot === "string" ? globalOpts.stateRoot : undefined;
        const logsOptions: LogsOptions = {
          agent: opts.agent as string | undefined,
          type: (opts.type as LogType) ?? "all",
          follow: opts.follow === true,
          tail: opts.tail as number | undefined,
          since: opts.since as string | undefined,
          until: opts.until as string | undefined,
          turn: opts.turn as string | undefined,
          trace: opts.trace as string | undefined,
          json: opts.json as boolean | undefined,
        };

        await executeLogs(instanceIdArg, logsOptions, stateRoot);
      }
    );

  return command;
}

export default createLogsCommand;
