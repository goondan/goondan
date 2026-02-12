import { describe, expect, it } from "vitest";
import { OrchestratorImpl } from "../src/orchestrator/orchestrator.js";
import { createInertInterval, FakeProcessSpawner } from "./helpers.js";

describe("OrchestratorImpl graceful shutdown", () => {
  it("shutdown_ack 수신 시 graceful shutdown promise를 완료한다", async () => {
    const spawner = new FakeProcessSpawner();

    const orchestrator = new OrchestratorImpl({
      swarmName: "default",
      bundleDir: process.cwd(),
      desiredAgents: ["coder"],
      spawner,
      setIntervalFn: () => createInertInterval(),
      clearIntervalFn: () => {
        // no-op
      },
      setTimeoutFn: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      clearTimeoutFn: (handle) => clearTimeout(handle),
    });

    const handle = orchestrator.spawn("coder", "default");
    const agentProcess = spawner.latestAgent("coder", "default");

    expect(agentProcess).toBeDefined();
    if (agentProcess === undefined) {
      throw new Error("agent process missing");
    }

    const shutdownPromise = handle.shutdown({
      gracePeriodMs: 200,
      reason: "config_change",
    });

    expect(agentProcess.sentMessages).toHaveLength(1);
    expect(agentProcess.sentMessages[0]?.type).toBe("shutdown");

    orchestrator.route({
      type: "shutdown_ack",
      from: "coder",
      to: "orchestrator",
      payload: {
        instanceKey: "default",
      },
    });

    await shutdownPromise;

    expect(agentProcess.killSignals).toContain("SIGTERM");
    expect(handle.status).toBe("terminated");
  });
});
