import type { IpcMessage, ProcessStatus, ShutdownReason } from "../types.js";

export interface ShutdownOptions {
  gracePeriodMs?: number;
  reason?: ShutdownReason;
}

export interface AgentProcessHandle {
  readonly pid: number;
  readonly agentName: string;
  readonly instanceKey: string;
  readonly status: ProcessStatus;
  readonly consecutiveCrashes: number;
  readonly nextSpawnAllowedAt?: Date;
  send(message: IpcMessage): void;
  shutdown(options?: ShutdownOptions): Promise<void>;
  kill(): void;
}

export interface ReconciliationTarget {
  agentName: string;
  instanceKey: string;
}

export interface ReconciliationResult {
  toSpawn: ReconciliationTarget[];
  toTerminate: Array<{ agentName: string; reason: string }>;
  toRespawn: Array<{ agentName: string; instanceKey: string; backoffMs: number }>;
}

export interface Orchestrator {
  readonly swarmName: string;
  readonly bundleDir: string;
  readonly agents: Map<string, AgentProcessHandle>;
  spawn(agentName: string, instanceKey: string): AgentProcessHandle;
  restart(agentName: string): Promise<void>;
  reloadAndRestartAll(): Promise<void>;
  reconcile(): Promise<ReconciliationResult>;
  shutdown(): Promise<void>;
  route(message: IpcMessage): void;
}

export interface ManagedChildProcess {
  readonly pid: number;
  send(message: IpcMessage): void;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
  onMessage(listener: (message: IpcMessage) => void): void;
  onExit(listener: (code: number | null) => void): void;
}

export interface RuntimeProcessSpawner {
  spawnAgent(agentName: string, instanceKey: string): ManagedChildProcess;
  spawnConnector(name: string): ManagedChildProcess;
}

export interface OrchestratorOptions {
  swarmName: string;
  bundleDir: string;
  desiredAgents: string[];
  desiredConnectors?: string[];
  spawner: RuntimeProcessSpawner;
  reconcileIntervalMs?: number;
  crashThreshold?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  defaultGracePeriodMs?: number;
  now?: () => Date;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => NodeJS.Timeout;
  clearTimeoutFn?: (handle: NodeJS.Timeout) => void;
  setIntervalFn?: (handler: () => void, timeoutMs: number) => NodeJS.Timeout;
  clearIntervalFn?: (handle: NodeJS.Timeout) => void;
}
