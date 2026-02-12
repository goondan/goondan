import type {
  AgentEvent,
  IpcMessage,
  JsonObject,
  Message,
  ProcessStatus,
} from "../src/types.js";
import type { ManagedChildProcess, RuntimeProcessSpawner } from "../src/orchestrator/types.js";

let nextMessageId = 1;

export function createMessage(input: {
  role: string;
  content: unknown;
  source?: Message["source"];
}): Message {
  const source = input.source ?? { type: "user" };

  return {
    id: `m-${nextMessageId++}`,
    data: {
      role: input.role,
      content: input.content,
    },
    metadata: {},
    createdAt: new Date(),
    source,
  };
}

export function createAgentEvent(input: {
  id?: string;
  type?: string;
  sourceName?: string;
  sourceKind?: "agent" | "connector";
  instanceKey?: string;
  payload?: JsonObject;
} = {}): AgentEvent {
  const payload = input.payload ?? {};

  return {
    id: input.id ?? "evt-1",
    type: input.type ?? "input",
    createdAt: new Date(),
    source: {
      kind: input.sourceKind ?? "connector",
      name: input.sourceName ?? "cli",
      instanceKey: input.instanceKey ?? "default",
      ...payload,
    },
    input: "hello",
  };
}

export class FakeChildProcess implements ManagedChildProcess {
  private messageListeners: Array<(message: IpcMessage) => void> = [];
  private exitListeners: Array<(code: number | null) => void> = [];

  readonly sentMessages: IpcMessage[] = [];
  readonly killSignals: Array<"SIGTERM" | "SIGKILL" | undefined> = [];

  constructor(readonly pid: number) {}

  send(message: IpcMessage): void {
    this.sentMessages.push(message);
  }

  kill(signal?: "SIGTERM" | "SIGKILL"): void {
    this.killSignals.push(signal);
  }

  onMessage(listener: (message: IpcMessage) => void): void {
    this.messageListeners.push(listener);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  emitMessage(message: IpcMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) {
      listener(code);
    }
  }
}

export class FakeProcessSpawner implements RuntimeProcessSpawner {
  private pidSeed = 100;

  readonly spawnedAgents: Array<{ agentName: string; instanceKey: string; process: FakeChildProcess }> = [];
  readonly spawnedConnectors: Array<{ name: string; process: FakeChildProcess }> = [];

  spawnAgent(agentName: string, instanceKey: string): FakeChildProcess {
    this.pidSeed += 1;
    const process = new FakeChildProcess(this.pidSeed);
    this.spawnedAgents.push({
      agentName,
      instanceKey,
      process,
    });
    return process;
  }

  spawnConnector(name: string): FakeChildProcess {
    this.pidSeed += 1;
    const process = new FakeChildProcess(this.pidSeed);
    this.spawnedConnectors.push({ name, process });
    return process;
  }

  latestAgent(agentName: string, instanceKey: string): FakeChildProcess | undefined {
    for (let index = this.spawnedAgents.length - 1; index >= 0; index -= 1) {
      const item = this.spawnedAgents[index];
      if (item.agentName === agentName && item.instanceKey === instanceKey) {
        return item.process;
      }
    }

    return undefined;
  }
}

export function createInertInterval(): NodeJS.Timeout {
  const handle = setTimeout(() => {
    // no-op
  }, 0);
  clearTimeout(handle);
  return handle;
}

export function createEventMessage(input: {
  from: string;
  to: string;
  instanceKey?: string;
}): IpcMessage {
  return {
    type: "event",
    from: input.from,
    to: input.to,
    payload: {
      id: "evt-1",
      type: "request",
      createdAt: new Date().toISOString(),
      source: {
        kind: "agent",
        name: input.from,
      },
      instanceKey: input.instanceKey ?? "default",
    },
  };
}
