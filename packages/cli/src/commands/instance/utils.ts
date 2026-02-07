/**
 * Instance 명령어 공유 유틸리티
 *
 * instance 하위 명령어들이 공유하는 함수와 타입 가드를 모은다.
 * Core의 workspace 모듈(resolveGoondanHome, generateWorkspaceId)을 재활용한다.
 *
 * @see /docs/specs/workspace.md - Instance State Root
 * @see /docs/specs/cli.md - Section 7 (gdn instance)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import {
  resolveGoondanHome,
  generateWorkspaceId,
} from "@goondan/core";
import { loadConfig, expandPath } from "../../utils/config.js";

// ============================================================================
// Type Guards & Interfaces
// ============================================================================

/**
 * Swarm event log record structure
 */
export interface SwarmEventRecord {
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
export interface AgentEventRecord {
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
 * Instance status
 */
export type InstanceStatus = "active" | "idle" | "completed";

/**
 * Instance summary info
 */
export interface InstanceInfo {
  instanceId: string;
  swarmName: string;
  status: InstanceStatus;
  createdAt: Date;
  turns: number;
  workspaceId: string;
}

/**
 * Type guard: object이고 특정 key를 갖는지 확인
 */
function isObjectWithKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

/**
 * Type guard for SwarmEventRecord
 */
export function isSwarmEventRecord(value: unknown): value is SwarmEventRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (
    isObjectWithKey(value, "type") && value.type === "swarm.event" &&
    isObjectWithKey(value, "recordedAt") && typeof value.recordedAt === "string" &&
    isObjectWithKey(value, "kind") && typeof value.kind === "string" &&
    isObjectWithKey(value, "instanceId") && typeof value.instanceId === "string" &&
    isObjectWithKey(value, "swarmName") && typeof value.swarmName === "string"
  );
}

/**
 * Type guard for AgentEventRecord
 */
export function isAgentEventRecord(value: unknown): value is AgentEventRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (
    isObjectWithKey(value, "type") && value.type === "agent.event" &&
    isObjectWithKey(value, "recordedAt") && typeof value.recordedAt === "string" &&
    isObjectWithKey(value, "kind") && typeof value.kind === "string" &&
    isObjectWithKey(value, "instanceId") && typeof value.instanceId === "string" &&
    isObjectWithKey(value, "agentName") && typeof value.agentName === "string"
  );
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get the Goondan home directory
 *
 * 설정 파일의 stateRoot > 환경변수 GOONDAN_STATE_ROOT > 기본값 ~/.goondan
 */
export async function getGoondanHome(stateRoot?: string): Promise<string> {
  if (stateRoot) {
    return path.resolve(expandPath(stateRoot));
  }
  const config = await loadConfig();
  if (config.stateRoot) {
    return path.resolve(expandPath(config.stateRoot));
  }
  return resolveGoondanHome();
}

/**
 * Get the Goondan home directory (동기 버전, config 이미 로드된 경우)
 */
export function getGoondanHomeSync(stateRoot?: string): string {
  if (stateRoot) {
    return path.resolve(expandPath(stateRoot));
  }
  if (process.env.GOONDAN_STATE_ROOT) {
    return path.resolve(expandPath(process.env.GOONDAN_STATE_ROOT));
  }
  return resolveGoondanHome();
}

/**
 * Generate workspace ID from SwarmBundle root path
 * Core의 generateWorkspaceId를 재사용
 */
export { generateWorkspaceId };

/**
 * Find instance path by ID (searches all workspaces)
 */
export function findInstancePath(
  instancesRoot: string,
  instanceId: string,
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
  let workspaceIds: string[];
  try {
    workspaceIds = fs.readdirSync(instancesRoot);
  } catch {
    return null;
  }

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

// ============================================================================
// JSONL Utilities
// ============================================================================

/**
 * Read JSONL file and parse records with type guard
 */
export function readJsonlFile<T>(
  filePath: string,
  guard: (value: unknown) => value is T,
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
 * Count non-empty lines in a JSONL file
 */
export function countJsonlLines(filePath: string): number {
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

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format date for display (YYYY-MM-DD HH:mm:ss)
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format instance status with color
 */
export function formatStatus(status: InstanceStatus): string {
  switch (status) {
    case "active":
      return chalk.green(status);
    case "idle":
      return chalk.yellow(status);
    case "completed":
      return chalk.gray(status);
  }
}

// ============================================================================
// Instance Info Utilities
// ============================================================================

/**
 * Determine instance status from last swarm event
 */
export function determineInstanceStatus(lastEvent: SwarmEventRecord): InstanceStatus {
  if (lastEvent.kind === "swarm.stopped") {
    return "completed";
  }

  if (lastEvent.kind === "swarm.started" || lastEvent.kind.startsWith("agent.")) {
    const lastEventTime = new Date(lastEvent.recordedAt).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (now - lastEventTime < fiveMinutes) {
      return "active";
    }
  }

  return "idle";
}

/**
 * Count turn events from agent event logs under an instance path
 */
export function countTurns(instancePath: string): number {
  const agentsPath = path.join(instancePath, "agents");

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
        "events.jsonl",
      );

      if (fs.existsSync(agentEventsPath)) {
        const content = fs.readFileSync(agentEventsPath, "utf-8");

        for (const line of content.split("\n")) {
          if (line.includes('"turn.completed"')) {
            turnCount++;
          }
        }
      }
    }
  } catch {
    // Ignore errors reading agent directories
  }

  return turnCount;
}

/**
 * Get basic instance info from swarm events log
 */
export function getInstanceInfo(
  instancePath: string,
  instanceId: string,
  workspaceId: string,
): InstanceInfo | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  const events = readJsonlFile(swarmEventsPath, isSwarmEventRecord);

  if (events.length === 0) {
    return null;
  }

  const firstEvent = events[0];
  if (!firstEvent) {
    return null;
  }

  const lastEvent = events[events.length - 1];
  const status: InstanceStatus = lastEvent
    ? determineInstanceStatus(lastEvent)
    : "idle";

  const turns = countTurns(instancePath);

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
 * Get basic instance info from the first swarm event (타입 안전)
 */
export function getInstanceBasicInfo(instancePath: string): {
  swarmName: string;
  instanceKey: string;
  agentCount: number;
  lastEventTime: Date | null;
} | null {
  const swarmEventsPath = path.join(instancePath, "swarm", "events", "events.jsonl");

  if (!fs.existsSync(swarmEventsPath)) {
    return null;
  }

  const events = readJsonlFile(swarmEventsPath, isSwarmEventRecord);

  if (events.length === 0) {
    return null;
  }

  const firstEvent = events[0];
  if (!firstEvent) {
    return null;
  }

  const lastEvent = events[events.length - 1];
  const lastEventTime = lastEvent
    ? new Date(lastEvent.recordedAt)
    : null;

  // Count agents
  const agentsPath = path.join(instancePath, "agents");
  let agentCount = 0;

  if (fs.existsSync(agentsPath)) {
    try {
      const agents = fs.readdirSync(agentsPath);
      agentCount = agents.filter((name) => {
        try {
          const agentPath = path.join(agentsPath, name);
          return fs.statSync(agentPath).isDirectory();
        } catch {
          return false;
        }
      }).length;
    } catch {
      // Ignore errors
    }
  }

  return {
    swarmName: firstEvent.swarmName,
    instanceKey: firstEvent.instanceKey,
    agentCount,
    lastEventTime,
  };
}

/**
 * swarmName을 SwarmEventRecord 데이터에서 타입 안전하게 추출
 */
export function extractSwarmName(value: unknown): string | null {
  if (!isObjectWithKey(value, "swarmName") || typeof value.swarmName !== "string") {
    return null;
  }
  return value.swarmName;
}
