import { describe, expect, it } from "vitest";

import {
  GOONDAN_API_VERSION,
  isAgentEvent,
  isEventEnvelope,
  isGoodanResource,
  isIpcMessage,
  isIpcMessageType,
  isModelResource,
  isProcessStatus,
  isRefItem,
  isRefOrSelector,
  isReplyChannel,
  isResource,
  isSelectorWithOverrides,
  isShutdownReason,
  isSwarmResource,
  isToolResource,
} from "../src/index.js";

describe("ProcessStatus and IPC guards", () => {
  it("matches all 7 process status values", () => {
    expect(isProcessStatus("spawning")).toBe(true);
    expect(isProcessStatus("idle")).toBe(true);
    expect(isProcessStatus("processing")).toBe(true);
    expect(isProcessStatus("draining")).toBe(true);
    expect(isProcessStatus("terminated")).toBe(true);
    expect(isProcessStatus("crashed")).toBe(true);
    expect(isProcessStatus("crashLoopBackOff")).toBe(true);

    expect(isProcessStatus("unknown")).toBe(false);
    expect(isProcessStatus(123)).toBe(false);
  });

  it("validates ipc message type and payload shape", () => {
    expect(isIpcMessageType("event")).toBe(true);
    expect(isIpcMessageType("shutdown")).toBe(true);
    expect(isIpcMessageType("shutdown_ack")).toBe(true);
    expect(isIpcMessageType("other")).toBe(false);

    const valid = {
      type: "event",
      from: "orchestrator",
      to: "agent:coder",
      payload: {
        ok: true,
        seq: 1,
      },
    };

    const invalid = {
      type: "event",
      from: "orchestrator",
      to: "agent:coder",
      payload: {
        fn: () => {
          return "not json";
        },
      },
    };

    expect(isIpcMessage(valid)).toBe(true);
    expect(isIpcMessage(invalid)).toBe(false);
  });

  it("validates shutdown reasons", () => {
    expect(isShutdownReason("restart")).toBe(true);
    expect(isShutdownReason("config_change")).toBe(true);
    expect(isShutdownReason("orchestrator_shutdown")).toBe(true);
    expect(isShutdownReason("unknown")).toBe(false);
  });
});

describe("Resource guards", () => {
  const validResource = {
    apiVersion: GOONDAN_API_VERSION,
    kind: "Model",
    metadata: { name: "claude" },
    spec: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  };

  it("isResource validates basic resource shape", () => {
    expect(isResource(validResource)).toBe(true);
    expect(isResource({})).toBe(false);
    expect(isResource({ apiVersion: "v1", kind: "X", metadata: {}, spec: {} })).toBe(false);
    expect(isResource({ apiVersion: "v1", kind: "X", metadata: { name: "a" }, spec: {} })).toBe(true);
    expect(isResource(null)).toBe(false);
  });

  it("isGoodanResource checks apiVersion", () => {
    expect(isGoodanResource(validResource)).toBe(true);
    expect(isGoodanResource({ ...validResource, apiVersion: "other/v1" })).toBe(false);
  });

  it("isModelResource validates kind", () => {
    expect(isModelResource(validResource)).toBe(true);
    expect(isModelResource({ ...validResource, kind: "Tool" })).toBe(false);
  });

  it("isSwarmResource validates kind", () => {
    const swarm = {
      ...validResource,
      kind: "Swarm",
      spec: { entryAgent: "Agent/coder", agents: [{ ref: "Agent/coder" }] },
    };
    expect(isSwarmResource(swarm)).toBe(true);
    expect(isSwarmResource(validResource)).toBe(false);
  });

  it("isToolResource validates kind", () => {
    const tool = {
      ...validResource,
      kind: "Tool",
      spec: { entry: "./tools/bash/index.ts", exports: [] },
    };
    expect(isToolResource(tool)).toBe(true);
    expect(isToolResource(validResource)).toBe(false);
  });
});

describe("Reference guards", () => {
  it("isRefItem validates ref wrapper", () => {
    expect(isRefItem({ ref: "Tool/bash" })).toBe(true);
    expect(isRefItem({ ref: { kind: "Tool", name: "bash" } })).toBe(true);
    expect(isRefItem({})).toBe(false);
    expect(isRefItem({ ref: 123 })).toBe(false);
    expect(isRefItem("Tool/bash")).toBe(false);
  });

  it("isSelectorWithOverrides validates selector shape", () => {
    expect(isSelectorWithOverrides({ selector: { kind: "Tool" } })).toBe(true);
    expect(isSelectorWithOverrides({ selector: { matchLabels: { tier: "base" } } })).toBe(true);
    expect(isSelectorWithOverrides({ selector: {} })).toBe(true);
    expect(isSelectorWithOverrides({})).toBe(false);
    expect(isSelectorWithOverrides({ selector: { kind: 123 } })).toBe(false);
    expect(isSelectorWithOverrides({ selector: { matchLabels: { tier: 42 } } })).toBe(false);
  });

  it("isRefOrSelector matches all ref/selector forms", () => {
    expect(isRefOrSelector("Tool/bash")).toBe(true);
    expect(isRefOrSelector({ kind: "Tool", name: "bash" })).toBe(true);
    expect(isRefOrSelector({ ref: "Tool/bash" })).toBe(true);
    expect(isRefOrSelector({ selector: { kind: "Tool" } })).toBe(true);
    expect(isRefOrSelector(123)).toBe(false);
    expect(isRefOrSelector(null)).toBe(false);
  });
});

describe("Event guards", () => {
  it("isEventEnvelope validates base envelope shape", () => {
    const valid = {
      id: "evt-1",
      type: "test.event",
      createdAt: new Date(),
    };
    expect(isEventEnvelope(valid)).toBe(true);
    expect(isEventEnvelope({ ...valid, traceId: "tr-1" })).toBe(true);
    expect(isEventEnvelope({ ...valid, traceId: 123 })).toBe(false);
    expect(isEventEnvelope({ ...valid, id: "" })).toBe(false);
    expect(isEventEnvelope({ ...valid, createdAt: "not-a-date" })).toBe(false);
  });

  it("isReplyChannel validates target and correlationId", () => {
    expect(isReplyChannel({ target: "agent:coder", correlationId: "abc" })).toBe(true);
    expect(isReplyChannel({ target: "", correlationId: "abc" })).toBe(false);
    expect(isReplyChannel({ target: "a" })).toBe(false);
  });

  it("isAgentEvent validates full agent event", () => {
    const valid = {
      id: "evt-1",
      type: "connector.event",
      createdAt: new Date(),
      source: { kind: "connector", name: "telegram" },
    };
    expect(isAgentEvent(valid)).toBe(true);
    expect(isAgentEvent({ ...valid, input: "hello" })).toBe(true);
    expect(isAgentEvent({ ...valid, replyTo: { target: "a", correlationId: "b" } })).toBe(true);
    expect(isAgentEvent({ ...valid, source: { kind: "unknown", name: "x" } })).toBe(false);
    expect(isAgentEvent({ ...valid, input: 123 })).toBe(false);
  });
});
