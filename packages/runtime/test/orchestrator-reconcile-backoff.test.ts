import { describe, expect, it } from "vitest";
import { OrchestratorImpl } from "../src/orchestrator/orchestrator.js";
import { createInertInterval, FakeProcessSpawner } from "./helpers.js";

describe("OrchestratorImpl reconciliation/backoff", () => {
  it("반복 크래시 시 backoff를 적용하고 허용 시점 이후에만 재스폰한다", async () => {
    const spawner = new FakeProcessSpawner();
    let nowMs = Date.parse("2026-02-11T00:00:00.000Z");

    const orchestrator = new OrchestratorImpl({
      swarmName: "default",
      bundleDir: process.cwd(),
      desiredAgents: ["coder"],
      spawner,
      crashThreshold: 1,
      initialBackoffMs: 1000,
      maxBackoffMs: 8000,
      now: () => new Date(nowMs),
      setIntervalFn: () => createInertInterval(),
      clearIntervalFn: () => {
        // no-op
      },
    });

    orchestrator.spawn("coder", "default");

    const first = spawner.latestAgent("coder", "default");
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error("first agent process missing");
    }

    first.emitExit(1);

    const reconcileAfterFirstCrash = await orchestrator.reconcile();
    expect(reconcileAfterFirstCrash.toSpawn).toHaveLength(1);

    const second = spawner.latestAgent("coder", "default");
    expect(second).toBeDefined();
    if (second === undefined) {
      throw new Error("second agent process missing");
    }

    second.emitExit(1);

    const backoffResult = await orchestrator.reconcile();
    expect(backoffResult.toRespawn).toHaveLength(1);
    expect(backoffResult.toRespawn[0]?.backoffMs).toBe(1000);

    nowMs += 1000;

    const reconcileAfterBackoff = await orchestrator.reconcile();
    expect(reconcileAfterBackoff.toSpawn).toHaveLength(1);
  });
});
