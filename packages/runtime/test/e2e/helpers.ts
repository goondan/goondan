/**
 * E2E test helpers.
 *
 * Orchestrator를 FakeProcessSpawner로 기동하고,
 * FakeChildProcess를 통해 IPC 이벤트를 프로그래밍 방식으로 주입/검증한다.
 */
import { OrchestratorImpl } from "../../src/orchestrator/orchestrator.js";
import type { OrchestratorOptions } from "../../src/orchestrator/types.js";
import {
  FakeProcessSpawner,
  FakeChildProcess,
  createInertInterval,
} from "../helpers.js";
import type { IpcMessage, JsonObject, JsonValue } from "../../src/types.js";

export { FakeProcessSpawner, FakeChildProcess, createInertInterval };

/**
 * E2E Orchestrator 생성 옵션
 */
export interface E2EOrchestratorOptions {
  swarmName?: string;
  desiredAgents: string[];
  desiredConnectors?: string[];
  crashThreshold?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  defaultGracePeriodMs?: number;
  reconcileIntervalMs?: number;
  nowMs?: number;
}

/**
 * E2E Orchestrator + Spawner 세트를 생성한다.
 *
 * reconcile 타이머를 비활성화(createInertInterval)하여 수동 제어 가능.
 */
export function createE2EOrchestrator(options: E2EOrchestratorOptions): {
  orchestrator: OrchestratorImpl;
  spawner: FakeProcessSpawner;
  getNowMs: () => number;
  setNowMs: (ms: number) => void;
  advanceTime: (delta: number) => void;
} {
  const spawner = new FakeProcessSpawner();
  let nowMs = options.nowMs ?? Date.parse("2026-02-20T00:00:00.000Z");

  const orchOptions: OrchestratorOptions = {
    swarmName: options.swarmName ?? "e2e-test",
    bundleDir: process.cwd(),
    desiredAgents: options.desiredAgents,
    desiredConnectors: options.desiredConnectors,
    spawner,
    crashThreshold: options.crashThreshold ?? 5,
    initialBackoffMs: options.initialBackoffMs ?? 1000,
    maxBackoffMs: options.maxBackoffMs ?? 300000,
    defaultGracePeriodMs: options.defaultGracePeriodMs ?? 500,
    reconcileIntervalMs: options.reconcileIntervalMs ?? 5000,
    now: () => new Date(nowMs),
    setIntervalFn: () => createInertInterval(),
    clearIntervalFn: () => {
      // no-op
    },
    setTimeoutFn: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeoutFn: (handle) => clearTimeout(handle),
  };

  const orchestrator = new OrchestratorImpl(orchOptions);

  return {
    orchestrator,
    spawner,
    getNowMs: () => nowMs,
    setNowMs: (ms: number) => {
      nowMs = ms;
    },
    advanceTime: (delta: number) => {
      nowMs += delta;
    },
  };
}

/**
 * Orchestrator의 desiredAgents를 모두 spawn + reconcile한 상태를 만든다.
 */
export async function spawnAllAgents(
  orchestrator: OrchestratorImpl,
  agentNames: string[],
): Promise<void> {
  for (const name of agentNames) {
    orchestrator.spawn(name, "default");
  }
  await orchestrator.reconcile();
}

/**
 * IPC event 메시지를 생성한다.
 */
export function createIpcEventMessage(options: {
  from: string;
  to: string;
  payload: JsonObject;
}): IpcMessage {
  return {
    type: "event",
    from: options.from,
    to: options.to,
    payload: options.payload,
  };
}

/**
 * 사용자 입력 이벤트 페이로드를 생성한다.
 */
export function createUserEventPayload(options: {
  input: string;
  instanceKey?: string;
  traceId?: string;
  sourceName?: string;
}): JsonObject {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "user_message",
    input: options.input,
    source: { kind: "connector", name: options.sourceName ?? "test" },
    instanceKey: options.instanceKey ?? "default",
    ...(options.traceId ? { traceId: options.traceId } : {}),
  };
}

/**
 * agents__request 이벤트 페이로드를 생성한다.
 */
export function createAgentRequestPayload(options: {
  from: string;
  target: string;
  input: string;
  instanceKey?: string;
  traceId?: string;
  callChain?: string[];
  timeoutMs?: number;
}): JsonObject {
  const payload: JsonObject = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "request",
    input: options.input,
    source: { kind: "agent", name: options.from },
    replyTo: {
      target: options.from,
      correlationId: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
    instanceKey: options.instanceKey ?? "default",
    target: options.target,
  };

  if (options.traceId) {
    payload.traceId = options.traceId;
  }
  if (options.callChain) {
    payload.__callChain = options.callChain;
  }

  return payload;
}

/**
 * agents__send (fire-and-forget) 이벤트 페이로드를 생성한다.
 */
export function createAgentSendPayload(options: {
  from: string;
  target: string;
  input: string;
  instanceKey?: string;
  traceId?: string;
}): JsonObject {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "notification",
    input: options.input,
    source: { kind: "agent", name: options.from },
    instanceKey: options.instanceKey ?? "default",
    target: options.target,
    ...(options.traceId ? { traceId: options.traceId } : {}),
  };
}

/**
 * 응답 이벤트 페이로드를 생성한다 (beta -> orchestrator -> alpha).
 */
export function createResponsePayload(options: {
  from: string;
  correlationId: string;
  responseText: string;
  instanceKey?: string;
}): JsonObject {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "response",
    input: options.responseText,
    source: { kind: "agent", name: options.from },
    metadata: { inReplyTo: options.correlationId },
    instanceKey: options.instanceKey ?? "default",
  };
}

/**
 * shutdown_ack IPC 메시지를 생성한다.
 */
export function createShutdownAck(agentName: string, instanceKey: string = "default"): IpcMessage {
  return {
    type: "shutdown_ack",
    from: agentName,
    to: "orchestrator",
    payload: { instanceKey },
  };
}

/**
 * FakeChildProcess에서 특정 타입의 sent 메시지를 찾는다.
 */
export function findSentMessages(
  process: FakeChildProcess,
  type: "event" | "shutdown" | "shutdown_ack",
): IpcMessage[] {
  return process.sentMessages.filter((m) => m.type === type);
}

/**
 * FakeChildProcess에서 특정 payload type을 가진 event 메시지를 찾는다.
 */
export function findSentEventsByPayloadType(
  fakeProcess: FakeChildProcess,
  payloadType: string,
): IpcMessage[] {
  return fakeProcess.sentMessages.filter((m) => {
    if (m.type !== "event") return false;
    const payload = m.payload;
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      return (payload as JsonObject).type === payloadType;
    }
    return false;
  });
}

/**
 * Payload에서 replyTo.correlationId를 추출한다.
 */
export function extractCorrelationId(payload: JsonValue): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const p = payload as JsonObject;
  const replyTo = p.replyTo;
  if (typeof replyTo !== "object" || replyTo === null || Array.isArray(replyTo)) {
    return undefined;
  }
  const rt = replyTo as JsonObject;
  return typeof rt.correlationId === "string" ? rt.correlationId : undefined;
}

/**
 * delay utility
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
