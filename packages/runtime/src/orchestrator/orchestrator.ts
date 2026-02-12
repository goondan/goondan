import type { IpcMessage, JsonValue, ProcessStatus, ShutdownReason } from "../types.js";
import { isJsonObject } from "../types.js";
import type {
  AgentProcessHandle,
  ManagedChildProcess,
  Orchestrator,
  OrchestratorOptions,
  ReconciliationResult,
  ShutdownOptions,
} from "./types.js";

interface AgentRuntimeState {
  pid: number;
  agentName: string;
  instanceKey: string;
  status: ProcessStatus;
  consecutiveCrashes: number;
  nextSpawnAllowedAt?: Date;
  process: ManagedChildProcess | null;
  shutdownRequest?: {
    promise: Promise<void>;
    resolve: () => void;
  };
}

interface ConnectorRuntimeState {
  name: string;
  process: ManagedChildProcess | null;
}

export class OrchestratorImpl implements Orchestrator {
  readonly swarmName: string;
  readonly bundleDir: string;
  readonly agents = new Map<string, AgentProcessHandle>();

  private readonly desiredAgents = new Set<string>();
  private readonly desiredConnectors = new Set<string>();
  private readonly agentState = new Map<string, AgentRuntimeState>();
  private readonly connectorState = new Map<string, ConnectorRuntimeState>();
  private readonly reconcileIntervalMs: number;
  private readonly crashThreshold: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly defaultGracePeriodMs: number;
  private readonly now: () => Date;
  private readonly setTimeoutFn: (handler: () => void, timeoutMs: number) => NodeJS.Timeout;
  private readonly clearTimeoutFn: (handle: NodeJS.Timeout) => void;
  private readonly setIntervalFn: (handler: () => void, timeoutMs: number) => NodeJS.Timeout;
  private readonly clearIntervalFn: (handle: NodeJS.Timeout) => void;

  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: OrchestratorOptions) {
    this.swarmName = options.swarmName;
    this.bundleDir = options.bundleDir;

    this.reconcileIntervalMs = options.reconcileIntervalMs ?? 5000;
    this.crashThreshold = options.crashThreshold ?? 5;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 300000;
    this.defaultGracePeriodMs = options.defaultGracePeriodMs ?? 30000;

    this.now = options.now ?? (() => new Date());
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;

    for (const agentName of options.desiredAgents) {
      this.desiredAgents.add(agentName);
    }

    for (const connectorName of options.desiredConnectors ?? []) {
      this.desiredConnectors.add(connectorName);
    }

    this.reconcileTimer = this.setIntervalFn(() => {
      void this.reconcile();
    }, this.reconcileIntervalMs);
  }

  spawn(agentName: string, instanceKey: string): AgentProcessHandle {
    const key = buildAgentKey(agentName, instanceKey);
    const existingState = this.agentState.get(key);

    if (existingState !== undefined) {
      if (existingState.process === null) {
        this.spawnIntoState(existingState);
      }

      const existingHandle = this.agents.get(key);
      if (existingHandle !== undefined) {
        return existingHandle;
      }
    }

    const state: AgentRuntimeState = {
      pid: -1,
      agentName,
      instanceKey,
      status: "spawning",
      consecutiveCrashes: 0,
      process: null,
    };

    const handle = this.createHandle(state);
    this.agentState.set(key, state);
    this.agents.set(key, handle);

    this.spawnIntoState(state);

    return handle;
  }

  async restart(agentName: string): Promise<void> {
    const matching = [...this.agentState.values()].filter((state) => state.agentName === agentName);

    for (const state of matching) {
      await this.gracefulShutdown(state, { reason: "restart" });
      state.consecutiveCrashes = 0;
      state.nextSpawnAllowedAt = undefined;
      this.spawnIntoState(state);
    }
  }

  async reloadAndRestartAll(): Promise<void> {
    const uniqueAgentNames = new Set<string>();
    for (const state of this.agentState.values()) {
      uniqueAgentNames.add(state.agentName);
    }

    for (const agentName of uniqueAgentNames) {
      await this.restart(agentName);
    }
  }

  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      toSpawn: [],
      toTerminate: [],
      toRespawn: [],
    };

    for (const connectorName of this.desiredConnectors) {
      const connector = this.connectorState.get(connectorName);
      if (connector === undefined || connector.process === null) {
        this.spawnConnector(connectorName);
      }
    }

    for (const [key, state] of this.agentState.entries()) {
      if (!this.desiredAgents.has(state.agentName)) {
        result.toTerminate.push({
          agentName: state.agentName,
          reason: "not_in_desired_state",
        });
        await this.gracefulShutdown(state, { reason: "config_change" });
        this.agentState.delete(key);
        this.agents.delete(key);
        continue;
      }

      if (state.status === "crashed" || state.status === "crashLoopBackOff") {
        const now = this.now();
        const nextAllowedAt = state.nextSpawnAllowedAt;
        const backoffMs = nextAllowedAt === undefined ? 0 : Math.max(0, nextAllowedAt.getTime() - now.getTime());

        if (nextAllowedAt !== undefined && nextAllowedAt.getTime() > now.getTime()) {
          result.toRespawn.push({
            agentName: state.agentName,
            instanceKey: state.instanceKey,
            backoffMs,
          });
          continue;
        }

        this.spawnIntoState(state);
        result.toSpawn.push({
          agentName: state.agentName,
          instanceKey: state.instanceKey,
        });
      }
    }

    return result;
  }

  async shutdown(): Promise<void> {
    if (this.reconcileTimer !== null) {
      this.clearIntervalFn(this.reconcileTimer);
      this.reconcileTimer = null;
    }

    for (const state of this.agentState.values()) {
      await this.gracefulShutdown(state, { reason: "orchestrator_shutdown" });
    }

    for (const connector of this.connectorState.values()) {
      if (connector.process !== null) {
        connector.process.kill("SIGTERM");
        connector.process = null;
      }
    }
  }

  route(message: IpcMessage): void {
    if (message.type === "shutdown_ack") {
      this.handleShutdownAck(message);
      return;
    }

    if (message.type !== "event") {
      return;
    }

    const target = message.to === "orchestrator" ? inferTargetFromPayload(message.payload) : message.to;
    if (target === undefined) {
      return;
    }

    const instanceKey = inferInstanceKey(message.payload);
    const handle = this.spawn(target, instanceKey);

    handle.send({
      type: "event",
      from: message.from,
      to: target,
      payload: message.payload,
    });
  }

  private createHandle(state: AgentRuntimeState): AgentProcessHandle {
    return {
      get pid() {
        return state.pid;
      },
      get agentName() {
        return state.agentName;
      },
      get instanceKey() {
        return state.instanceKey;
      },
      get status() {
        return state.status;
      },
      get consecutiveCrashes() {
        return state.consecutiveCrashes;
      },
      get nextSpawnAllowedAt() {
        return state.nextSpawnAllowedAt;
      },
      send: (message: IpcMessage): void => {
        if (state.process !== null) {
          state.process.send(message);
        }
      },
      shutdown: (options?: ShutdownOptions): Promise<void> => this.gracefulShutdown(state, options),
      kill: (): void => {
        if (state.process !== null) {
          state.process.kill("SIGKILL");
        }
      },
    };
  }

  private spawnIntoState(state: AgentRuntimeState): void {
    const process = this.options.spawner.spawnAgent(state.agentName, state.instanceKey);
    state.process = process;
    state.pid = process.pid;
    state.status = "spawning";

    process.onMessage((message) => {
      this.route(message);
    });

    process.onExit((code) => {
      state.process = null;

      if (code === 0) {
        state.status = "terminated";
        return;
      }

      state.consecutiveCrashes += 1;
      state.status = "crashed";

      if (state.consecutiveCrashes > this.crashThreshold) {
        const backoffMs = this.calculateBackoffMs(state.consecutiveCrashes);
        state.status = "crashLoopBackOff";
        state.nextSpawnAllowedAt = new Date(this.now().getTime() + backoffMs);
      }
    });

    state.status = "idle";
  }

  private spawnConnector(name: string): void {
    const process = this.options.spawner.spawnConnector(name);
    const state: ConnectorRuntimeState = {
      name,
      process,
    };

    process.onMessage((message) => {
      this.route(message);
    });

    process.onExit(() => {
      state.process = null;
    });

    this.connectorState.set(name, state);
  }

  private calculateBackoffMs(consecutiveCrashes: number): number {
    const exponent = consecutiveCrashes - this.crashThreshold - 1;
    const factor = exponent <= 0 ? 1 : Math.pow(2, exponent);
    return Math.min(this.initialBackoffMs * factor, this.maxBackoffMs);
  }

  private async gracefulShutdown(state: AgentRuntimeState, options: ShutdownOptions = {}): Promise<void> {
    if (state.process === null) {
      state.status = "terminated";
      return;
    }

    if (state.shutdownRequest !== undefined) {
      return state.shutdownRequest.promise;
    }

    const gracePeriodMs = options.gracePeriodMs ?? this.defaultGracePeriodMs;
    const reason: ShutdownReason = options.reason ?? "orchestrator_shutdown";

    state.status = "draining";
    state.process.send({
      type: "shutdown",
      from: "orchestrator",
      to: state.agentName,
      payload: {
        gracePeriodMs,
        reason,
      },
    });

    let settled = false;
    let resolvePromise: (() => void) | undefined;

    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const timer = this.setTimeoutFn(() => {
      if (settled) {
        return;
      }
      settled = true;

      if (state.process !== null) {
        state.process.kill("SIGKILL");
        state.process = null;
      }
      state.status = "terminated";
      state.shutdownRequest = undefined;

      if (resolvePromise !== undefined) {
        resolvePromise();
      }
    }, gracePeriodMs);

    state.shutdownRequest = {
      promise,
      resolve: () => {
        if (settled) {
          return;
        }
        settled = true;

        this.clearTimeoutFn(timer);
        if (state.process !== null) {
          state.process.kill("SIGTERM");
          state.process = null;
        }
        state.status = "terminated";
        state.shutdownRequest = undefined;

        if (resolvePromise !== undefined) {
          resolvePromise();
        }
      },
    };

    return promise;
  }

  private handleShutdownAck(message: IpcMessage): void {
    const targetState = this.findStateForShutdownAck(message);
    if (targetState === undefined) {
      return;
    }

    if (targetState.shutdownRequest !== undefined) {
      targetState.shutdownRequest.resolve();
    }
  }

  private findStateForShutdownAck(message: IpcMessage): AgentRuntimeState | undefined {
    const payload = isJsonObject(message.payload) ? message.payload : undefined;

    if (payload !== undefined && typeof payload.instanceKey === "string") {
      const key = buildAgentKey(message.from, payload.instanceKey);
      return this.agentState.get(key);
    }

    const candidates = [...this.agentState.values()].filter(
      (state) => state.agentName === message.from && state.status === "draining",
    );

    return candidates.length === 1 ? candidates[0] : undefined;
  }
}

function buildAgentKey(agentName: string, instanceKey: string): string {
  return `${agentName}:${instanceKey}`;
}

function inferTargetFromPayload(payload: JsonValue): string | undefined {
  if (!isJsonObject(payload)) {
    return undefined;
  }

  const replyTo = payload.replyTo;
  if (isJsonObject(replyTo) && typeof replyTo.target === "string") {
    return replyTo.target;
  }

  return undefined;
}

function inferInstanceKey(payload: JsonValue): string {
  if (!isJsonObject(payload)) {
    return "default";
  }

  const value = payload.instanceKey;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return "default";
}
