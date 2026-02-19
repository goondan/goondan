/**
 * 에이전트 통신 API 타입 (단일 계약)
 * 원형: docs/specs/shared-types.md 섹션 8
 */
import type { JsonObject, JsonValue } from "./json.js";
import type { AgentEvent } from "./events.js";

// --- 8.1 통신 옵션 / 결과 타입 ---

export interface AgentRuntimeRequestOptions {
  timeoutMs?: number;
}

export interface AgentRuntimeRequestResult {
  eventId: string;
  target: string;
  response?: JsonValue;
  correlationId: string;
}

export interface AgentRuntimeSendResult {
  eventId: string;
  target: string;
  accepted: boolean;
}

export interface AgentRuntimeSpawnOptions {
  instanceKey?: string;
  cwd?: string;
}

export interface AgentRuntimeSpawnResult {
  target: string;
  instanceKey: string;
  spawned: boolean;
  cwd?: string;
}

export interface AgentRuntimeListOptions {
  includeAll?: boolean;
}

export interface SpawnedAgentInfo {
  target: string;
  instanceKey: string;
  ownerAgent: string;
  ownerInstanceKey: string;
  createdAt: string;
  cwd?: string;
}

export interface AgentRuntimeListResult {
  agents: SpawnedAgentInfo[];
}

export interface AgentRuntimeCatalogResult {
  swarmName: string;
  entryAgent: string;
  selfAgent: string;
  availableAgents: string[];
  callableAgents: string[];
}

// --- 8.2 AgentToolRuntime ---

export interface AgentToolRuntime {
  request(
    target: string,
    event: AgentEvent,
    options?: AgentRuntimeRequestOptions,
  ): Promise<AgentRuntimeRequestResult>;
  send(target: string, event: AgentEvent): Promise<AgentRuntimeSendResult>;
  spawn(target: string, options?: AgentRuntimeSpawnOptions): Promise<AgentRuntimeSpawnResult>;
  list(options?: AgentRuntimeListOptions): Promise<AgentRuntimeListResult>;
  catalog(): Promise<AgentRuntimeCatalogResult>;
}

// --- 8.3 MiddlewareAgentsApi ---

export interface MiddlewareAgentsApi {
  request(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    timeoutMs?: number;
    metadata?: JsonObject;
  }): Promise<{ target: string; response: string }>;

  send(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    metadata?: JsonObject;
  }): Promise<{ accepted: boolean }>;
}
