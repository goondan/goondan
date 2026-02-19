/**
 * E2E Architecture Tests (TC-ARCH-01 ~ TC-ARCH-06)
 *
 * Process-per-Agent 아키텍처 검증:
 * - 에이전트별 독립 프로세스 스폰
 * - 크래시 격리
 * - 크래시 후 자동 재스폰 및 백오프
 * - Watch 모드 선택적 재시작
 * - Graceful Shutdown Protocol
 * - Graceful Shutdown Timeout (SIGKILL)
 */
import { describe, expect, it, vi } from "vitest";
import {
  createE2EOrchestrator,
  spawnAllAgents,
  createShutdownAck,
  findSentMessages,
  delay,
} from "./helpers.js";

describe("E2E Architecture", () => {
  // -------------------------------------------------------------------------
  // TC-ARCH-01: 에이전트별 독립 프로세스 스폰 확인
  // -------------------------------------------------------------------------
  describe("TC-ARCH-01: 에이전트별 독립 프로세스 스폰", () => {
    it("각 에이전트가 별도 PID로 스폰된다", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha", "beta"],
      });

      await spawnAllAgents(orchestrator, ["alpha", "beta"]);

      // 검증: agents Map에 alpha, beta 핸들 존재
      const alphaHandle = orchestrator.agents.get("alpha:default");
      const betaHandle = orchestrator.agents.get("beta:default");

      expect(alphaHandle).toBeDefined();
      expect(betaHandle).toBeDefined();

      if (!alphaHandle || !betaHandle) {
        throw new Error("handles missing");
      }

      // 검증: PID가 서로 다름
      expect(alphaHandle.pid).not.toBe(betaHandle.pid);

      // 검증: 유효한 PID (> 0)
      expect(alphaHandle.pid).toBeGreaterThan(0);
      expect(betaHandle.pid).toBeGreaterThan(0);

      // 검증: spawner가 두 개의 agent를 스폰함
      expect(spawner.spawnedAgents).toHaveLength(2);
      expect(spawner.spawnedAgents[0]?.agentName).toBe("alpha");
      expect(spawner.spawnedAgents[1]?.agentName).toBe("beta");

      await orchestrator.shutdown();
    });

    it("Orchestrator 프로세스의 PID와 에이전트 PID가 다르다", async () => {
      const { orchestrator } = createE2EOrchestrator({
        desiredAgents: ["alpha"],
      });

      orchestrator.spawn("alpha", "default");

      const alphaHandle = orchestrator.agents.get("alpha:default");
      expect(alphaHandle).toBeDefined();

      if (!alphaHandle) {
        throw new Error("alpha handle missing");
      }

      // FakeChildProcess PID는 100+ 영역이므로 실제 process.pid와 다름
      expect(alphaHandle.pid).not.toBe(process.pid);

      await orchestrator.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // TC-ARCH-02: 에이전트 크래시 격리
  // -------------------------------------------------------------------------
  describe("TC-ARCH-02: 에이전트 크래시 격리", () => {
    it("하나의 에이전트가 크래시해도 다른 에이전트는 계속 동작한다", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha", "beta"],
      });

      await spawnAllAgents(orchestrator, ["alpha", "beta"]);

      const alphaProcess = spawner.latestAgent("alpha", "default");
      const betaProcess = spawner.latestAgent("beta", "default");

      expect(alphaProcess).toBeDefined();
      expect(betaProcess).toBeDefined();

      if (!alphaProcess || !betaProcess) {
        throw new Error("processes missing");
      }

      // alpha 프로세스 크래시 (exit code 1)
      alphaProcess.emitExit(1);

      // 검증: alpha 상태가 crashed
      const alphaHandle = orchestrator.agents.get("alpha:default");
      expect(alphaHandle).toBeDefined();
      if (!alphaHandle) throw new Error("alpha handle missing");
      expect(alphaHandle.status).toBe("crashed");

      // 검증: beta는 여전히 idle 상태 (영향 없음)
      const betaHandle = orchestrator.agents.get("beta:default");
      expect(betaHandle).toBeDefined();
      if (!betaHandle) throw new Error("beta handle missing");
      expect(betaHandle.status).toBe("idle");

      // 검증: beta에 메시지를 보내면 전달됨
      betaHandle.send({
        type: "event",
        from: "orchestrator",
        to: "beta",
        payload: { type: "test", input: "hello" },
      });
      expect(betaProcess.sentMessages).toHaveLength(1);

      await orchestrator.shutdown();
    });

    it("Orchestrator가 에이전트 크래시 후에도 계속 실행된다", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha", "beta"],
      });

      await spawnAllAgents(orchestrator, ["alpha", "beta"]);

      const alphaProcess = spawner.latestAgent("alpha", "default");
      if (!alphaProcess) throw new Error("alpha process missing");

      // alpha 크래시
      alphaProcess.emitExit(1);

      // Orchestrator의 reconcile은 여전히 호출 가능
      const result = await orchestrator.reconcile();

      // 크래시된 alpha가 재스폰됨
      expect(result.toSpawn.length).toBeGreaterThanOrEqual(1);

      await orchestrator.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // TC-ARCH-03: 크래시 후 자동 재스폰 및 백오프
  // -------------------------------------------------------------------------
  describe("TC-ARCH-03: 크래시 후 자동 재스폰 및 백오프", () => {
    it("처음 crashThreshold까지는 즉시 재스폰, 이후 crashLoopBackOff 진입", async () => {
      const { orchestrator, spawner, advanceTime } = createE2EOrchestrator({
        desiredAgents: ["alpha"],
        crashThreshold: 2,
        initialBackoffMs: 500,
      });

      orchestrator.spawn("alpha", "default");
      const handle = orchestrator.agents.get("alpha:default");
      expect(handle).toBeDefined();
      if (!handle) throw new Error("handle missing");

      // crash 1: 즉시 재스폰
      const first = spawner.latestAgent("alpha", "default");
      expect(first).toBeDefined();
      if (!first) throw new Error("first process missing");
      first.emitExit(1);

      expect(handle.status).toBe("crashed");
      expect(handle.consecutiveCrashes).toBe(1);

      const result1 = await orchestrator.reconcile();
      expect(result1.toSpawn).toHaveLength(1);

      // crash 2: 즉시 재스폰
      const second = spawner.latestAgent("alpha", "default");
      expect(second).toBeDefined();
      if (!second) throw new Error("second process missing");
      second.emitExit(1);

      expect(handle.status).toBe("crashed");
      expect(handle.consecutiveCrashes).toBe(2);

      const result2 = await orchestrator.reconcile();
      expect(result2.toSpawn).toHaveLength(1);

      // crash 3: crashThreshold(2) 초과 -> crashLoopBackOff
      const third = spawner.latestAgent("alpha", "default");
      expect(third).toBeDefined();
      if (!third) throw new Error("third process missing");
      third.emitExit(1);

      expect(handle.status).toBe("crashLoopBackOff");
      expect(handle.consecutiveCrashes).toBe(3);
      expect(handle.nextSpawnAllowedAt).toBeDefined();

      // backoff 미경과 시 재스폰되지 않음
      const result3 = await orchestrator.reconcile();
      expect(result3.toRespawn).toHaveLength(1);
      expect(result3.toSpawn).toHaveLength(0);

      // backoff 경과 후 재스폰
      advanceTime(500);
      const result4 = await orchestrator.reconcile();
      expect(result4.toSpawn).toHaveLength(1);

      await orchestrator.shutdown();
    });

    it("정상 종료(exit 0) 시 crash 추적값이 리셋된다", async () => {
      const { orchestrator, spawner, advanceTime } = createE2EOrchestrator({
        desiredAgents: ["alpha"],
        crashThreshold: 1,
        initialBackoffMs: 100,
      });

      const handle = orchestrator.spawn("alpha", "default");

      // crash 1
      const first = spawner.latestAgent("alpha", "default");
      if (!first) throw new Error("first process missing");
      first.emitExit(1);
      await orchestrator.reconcile();

      // crash 2 -> crashLoopBackOff
      const second = spawner.latestAgent("alpha", "default");
      if (!second) throw new Error("second process missing");
      second.emitExit(1);

      expect(handle.status).toBe("crashLoopBackOff");

      advanceTime(100);
      await orchestrator.reconcile();

      // 이번엔 정상 종료
      const third = spawner.latestAgent("alpha", "default");
      if (!third) throw new Error("third process missing");
      third.emitExit(0);

      expect(handle.status).toBe("terminated");
      expect(handle.consecutiveCrashes).toBe(0);
      expect(handle.nextSpawnAllowedAt).toBeUndefined();

      await orchestrator.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // TC-ARCH-04: Watch 모드 선택적 재시작
  // -------------------------------------------------------------------------
  describe("TC-ARCH-04: Watch 모드 선택적 재시작", () => {
    it("restart(agentName) 호출 시 해당 에이전트만 재시작된다", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha", "beta"],
      });

      await spawnAllAgents(orchestrator, ["alpha", "beta"]);

      const originalAlpha = spawner.latestAgent("alpha", "default");
      const originalBeta = spawner.latestAgent("beta", "default");

      expect(originalAlpha).toBeDefined();
      expect(originalBeta).toBeDefined();
      if (!originalAlpha || !originalBeta) throw new Error("processes missing");

      const originalAlphaPid = originalAlpha.pid;
      const originalBetaPid = originalBeta.pid;

      // alpha를 shutdown_ack 즉시 전송해서 restart 완료시킴
      originalAlpha.onMessage((msg) => {
        if (msg.type === "shutdown") {
          orchestrator.route(createShutdownAck("alpha"));
        }
      });

      // alpha만 restart
      await orchestrator.restart("alpha");

      // alpha는 새 프로세스로 재시작됨
      const newAlpha = spawner.latestAgent("alpha", "default");
      expect(newAlpha).toBeDefined();
      if (!newAlpha) throw new Error("new alpha missing");
      expect(newAlpha.pid).not.toBe(originalAlphaPid);

      // beta는 동일한 프로세스 유지
      const currentBeta = spawner.latestAgent("beta", "default");
      expect(currentBeta).toBeDefined();
      if (!currentBeta) throw new Error("beta missing");
      expect(currentBeta.pid).toBe(originalBetaPid);

      await orchestrator.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // TC-ARCH-05: Graceful Shutdown Protocol
  // -------------------------------------------------------------------------
  describe("TC-ARCH-05: Graceful Shutdown Protocol", () => {
    it("shutdown 요청 후 draining 상태 전환, shutdown_ack 후 terminated", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha"],
      });

      const handle = orchestrator.spawn("alpha", "default");
      const alphaProcess = spawner.latestAgent("alpha", "default");

      expect(alphaProcess).toBeDefined();
      if (!alphaProcess) throw new Error("alpha process missing");

      // shutdown 요청
      const shutdownPromise = handle.shutdown({
        gracePeriodMs: 10000,
        reason: "config_change",
      });

      // 검증: shutdown 메시지가 전송됨
      const shutdownMessages = findSentMessages(alphaProcess, "shutdown");
      expect(shutdownMessages).toHaveLength(1);

      // 검증: draining 상태
      expect(handle.status).toBe("draining");

      // shutdown_ack 전송
      orchestrator.route(createShutdownAck("alpha"));

      await shutdownPromise;

      // 검증: terminated 상태, SIGTERM 전송됨
      expect(handle.status).toBe("terminated");
      expect(alphaProcess.killSignals).toContain("SIGTERM");
    });

    it("shutdown 전송 후 진행 중인 Turn이 완료된 후 shutdown_ack 전송하면 정상 종료", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha"],
        defaultGracePeriodMs: 10000,
      });

      const handle = orchestrator.spawn("alpha", "default");
      const alphaProcess = spawner.latestAgent("alpha", "default");
      if (!alphaProcess) throw new Error("alpha process missing");

      // shutdown 요청
      const shutdownPromise = handle.shutdown({ reason: "restart" });

      expect(handle.status).toBe("draining");

      // 3초 뒤 ack (Turn 완료를 시뮬레이션)
      setTimeout(() => {
        orchestrator.route(createShutdownAck("alpha"));
      }, 100);

      await shutdownPromise;

      expect(handle.status).toBe("terminated");
      // crash 추적값 리셋
      expect(handle.consecutiveCrashes).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // TC-ARCH-06: Graceful Shutdown Timeout (SIGKILL)
  // -------------------------------------------------------------------------
  describe("TC-ARCH-06: Graceful Shutdown Timeout (SIGKILL)", () => {
    it("gracePeriod 초과 시 SIGKILL로 강제 종료된다", async () => {
      const { orchestrator, spawner } = createE2EOrchestrator({
        desiredAgents: ["alpha"],
      });

      const handle = orchestrator.spawn("alpha", "default");
      const alphaProcess = spawner.latestAgent("alpha", "default");
      if (!alphaProcess) throw new Error("alpha process missing");

      // 아주 짧은 gracePeriod로 shutdown (shutdown_ack 전송 안 함)
      const shutdownPromise = handle.shutdown({
        gracePeriodMs: 200,
        reason: "orchestrator_shutdown",
      });

      expect(handle.status).toBe("draining");

      // gracePeriod 초과 대기
      await shutdownPromise;

      // 검증: SIGKILL로 강제 종료됨
      expect(alphaProcess.killSignals).toContain("SIGKILL");
      expect(handle.status).toBe("terminated");
    });
  });
});
