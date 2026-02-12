import { describe, expect, it } from "vitest";

import { isIpcMessage, isIpcMessageType, isProcessStatus } from "../src/index.js";

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
});
