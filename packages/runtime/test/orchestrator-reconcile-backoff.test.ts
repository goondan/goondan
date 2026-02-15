import { describe, expect, it, vi } from "vitest";
import { OrchestratorImpl } from "../src/orchestrator/orchestrator.js";
import { createInertInterval, FakeProcessSpawner } from "./helpers.js";

describe("OrchestratorImpl reconciliation/backoff", () => {
  it("desiredAgents에 있고 state가 없는 agent를 reconcile에서 자동 스폰한다", async () => {
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
    });

    const result = await orchestrator.reconcile();

    expect(result.toSpawn).toEqual([
      {
        agentName: "coder",
        instanceKey: "default",
      },
    ]);
    expect(spawner.latestAgent("coder", "default")).toBeDefined();
    expect(orchestrator.agents.size).toBe(1);
  });

  it("desiredConnectors에서 제거된 connector process/state를 reconcile에서 종료 및 정리한다", async () => {
    const spawner = new FakeProcessSpawner();

    const orchestrator = new OrchestratorImpl({
      swarmName: "default",
      bundleDir: process.cwd(),
      desiredAgents: [],
      desiredConnectors: ["telegram"],
      spawner,
      setIntervalFn: () => createInertInterval(),
      clearIntervalFn: () => {
        // no-op
      },
    });

    await orchestrator.reconcile();

    const connectorProcess = spawner.spawnedConnectors[0]?.process;
    expect(connectorProcess).toBeDefined();
    if (connectorProcess === undefined) {
      throw new Error("connector process missing");
    }

    const desiredConnectorsValue = Reflect.get(orchestrator, "desiredConnectors");
    expect(desiredConnectorsValue instanceof Set).toBe(true);
    if (!(desiredConnectorsValue instanceof Set)) {
      throw new Error("desiredConnectors set missing");
    }
    desiredConnectorsValue.clear();

    const reconcileResult = await orchestrator.reconcile();
    expect(reconcileResult.toTerminate).toContainEqual({
      agentName: "telegram",
      reason: "connector_not_in_desired_state",
    });
    expect(connectorProcess.killSignals).toContain("SIGTERM");

    const connectorStateValue = Reflect.get(orchestrator, "connectorState");
    expect(connectorStateValue instanceof Map).toBe(true);
    if (!(connectorStateValue instanceof Map)) {
      throw new Error("connectorState map missing");
    }
    expect(connectorStateValue.has("telegram")).toBe(false);
  });

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

  it("crashLoopBackOff 진입 시 구조화 로그를 남기고 정상 종료 시 crash 추적값을 리셋한다", async () => {
    const spawner = new FakeProcessSpawner();
    let nowMs = Date.parse("2026-02-11T00:00:00.000Z");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // no-op
    });

    try {
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

      const handle = orchestrator.spawn("coder", "default");

      const first = spawner.latestAgent("coder", "default");
      expect(first).toBeDefined();
      if (first === undefined) {
        throw new Error("first agent process missing");
      }
      first.emitExit(1);

      await orchestrator.reconcile();

      const second = spawner.latestAgent("coder", "default");
      expect(second).toBeDefined();
      if (second === undefined) {
        throw new Error("second agent process missing");
      }
      second.emitExit(1);

      expect(handle.status).toBe("crashLoopBackOff");
      expect(handle.nextSpawnAllowedAt).toBeDefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toBe("[orchestrator] crashLoopBackOff");
      expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({
        event: "orchestrator.crashLoopBackOff",
        swarmName: "default",
        agentName: "coder",
        instanceKey: "default",
        status: "crashLoopBackOff",
        consecutiveCrashes: 2,
        crashThreshold: 1,
        backoffMs: 1000,
      });

      nowMs += 1000;
      await orchestrator.reconcile();

      const third = spawner.latestAgent("coder", "default");
      expect(third).toBeDefined();
      if (third === undefined) {
        throw new Error("third agent process missing");
      }

      third.emitExit(0);

      expect(handle.status).toBe("terminated");
      expect(handle.consecutiveCrashes).toBe(0);
      expect(handle.nextSpawnAllowedAt).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
