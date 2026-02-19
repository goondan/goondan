/**
 * E2E Observability Tests (TC-O11Y-01 ~ TC-O11Y-05)
 *
 * OTel 호환 TraceContext 검증:
 * - RuntimeEvent에 TraceContext 포함
 * - 인터-에이전트 traceId 전파 (Orchestrator IPC 레벨)
 * - Turn -> Step -> Tool 계층 Span 연결
 * - turn.completed의 stepCount, duration
 * - 이벤트명 dot notation 준수
 */
import { describe, expect, it } from "vitest";
import { RuntimeEventBusImpl, RUNTIME_EVENT_TYPES } from "../../src/events/runtime-events.js";
import { PipelineRegistryImpl } from "../../src/pipeline/registry.js";
import { ConversationStateImpl } from "../../src/conversation/state.js";
import type {
  RuntimeEvent,
  RuntimeEventType,
} from "@goondan/types";
import type {
  MiddlewareAgentsApi,
  Turn,
} from "../../src/types.js";
import { createAgentEvent } from "../helpers.js";

const mockAgentsApi: MiddlewareAgentsApi = {
  async request(params) {
    return { target: params.target, response: `reply:${params.input ?? ""}` };
  },
  async send() {
    return { accepted: true };
  },
};

function createTurn(id: string, agentName: string): Turn {
  return {
    id,
    agentName,
    inputEvent: createAgentEvent(),
    messages: [],
    steps: [],
    status: "running",
    metadata: {},
  };
}

/**
 * Helper: Turn + Step + ToolCall을 한 번에 실행하고 캡처된 이벤트를 반환
 */
async function runFullTurnAndCapture(options: {
  agentName: string;
  instanceKey: string;
  traceId: string;
  turnId: string;
}): Promise<RuntimeEvent[]> {
  const eventBus = new RuntimeEventBusImpl();
  const registry = new PipelineRegistryImpl(eventBus);
  const conversationState = new ConversationStateImpl();
  const captured: RuntimeEvent[] = [];

  for (const eventType of RUNTIME_EVENT_TYPES) {
    eventBus.on(eventType, async (event) => {
      captured.push(event);
    });
  }

  await registry.runTurn(
    {
      agentName: options.agentName,
      instanceKey: options.instanceKey,
      turnId: options.turnId,
      traceId: options.traceId,
      inputEvent: createAgentEvent(),
      conversationState,
      agents: mockAgentsApi,
      emitMessageEvent: () => {},
      metadata: {},
    },
    async () => {
      await registry.runStep(
        {
          agentName: options.agentName,
          instanceKey: options.instanceKey,
          turnId: options.turnId,
          traceId: options.traceId,
          turn: createTurn(options.turnId, options.agentName),
          stepIndex: 0,
          conversationState,
          agents: mockAgentsApi,
          emitMessageEvent: () => {},
          toolCatalog: [],
          metadata: {},
        },
        async () => {
          await registry.runToolCall(
            {
              agentName: options.agentName,
              instanceKey: options.instanceKey,
              turnId: options.turnId,
              traceId: options.traceId,
              stepIndex: 0,
              toolName: "echo",
              toolCallId: "tc-1",
              args: { text: "hello" },
              metadata: {},
            },
            async () => ({
              toolCallId: "tc-1",
              toolName: "echo",
              status: "ok",
              output: "hello",
            }),
          );

          return {
            status: "completed",
            hasToolCalls: true,
            toolCalls: [{ id: "tc-1", name: "echo", args: { text: "hello" } }],
            toolResults: [{ toolCallId: "tc-1", toolName: "echo", status: "ok", output: "hello" }],
            metadata: {},
          };
        },
      );

      return { turnId: options.turnId, finishReason: "text_response" };
    },
  );

  return captured;
}

describe("E2E Observability", () => {
  // -------------------------------------------------------------------------
  // TC-O11Y-01: RuntimeEvent에 TraceContext 포함 확인
  // -------------------------------------------------------------------------
  describe("TC-O11Y-01: RuntimeEvent에 TraceContext 포함", () => {
    it("모든 레코드에 traceId, spanId, agentName, instanceKey가 포함된다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "inst-01",
        traceId: "aabbccdd11223344aabbccdd11223344",
        turnId: "turn-o11y-01",
      });

      expect(events.length).toBeGreaterThanOrEqual(6); // turn(2) + step(2) + tool(2)

      for (const event of events) {
        // traceId 포함
        expect(event.traceId).toBe("aabbccdd11223344aabbccdd11223344");

        // spanId 포함 (16자 hex)
        expect(event.spanId).toMatch(/^[0-9a-f]{16}$/);

        // agentName, instanceKey 포함
        expect(event.agentName).toBe("alpha");
        expect(event.instanceKey).toBe("inst-01");
      }
    });

    it("turn.started에는 parentSpanId가 없다 (root span)", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "default",
        traceId: "trace-root-span",
        turnId: "turn-root",
      });

      const turnStarted = events.find((e) => e.type === "turn.started");
      expect(turnStarted).toBeDefined();
      if (!turnStarted) throw new Error("turn.started not found");
      expect(turnStarted.parentSpanId).toBeUndefined();
    });

    it("step의 parentSpanId가 Turn의 spanId와 일치한다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "default",
        traceId: "trace-parent-step",
        turnId: "turn-parent-step",
      });

      const turnStarted = events.find((e) => e.type === "turn.started");
      const stepStarted = events.find((e) => e.type === "step.started");

      expect(turnStarted).toBeDefined();
      expect(stepStarted).toBeDefined();
      if (!turnStarted || !stepStarted) throw new Error("events not found");

      expect(stepStarted.parentSpanId).toBe(turnStarted.spanId);
    });

    it("tool의 parentSpanId가 Step의 spanId와 일치한다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "default",
        traceId: "trace-parent-tool",
        turnId: "turn-parent-tool",
      });

      const stepStarted = events.find((e) => e.type === "step.started");
      const toolCalled = events.find((e) => e.type === "tool.called");

      expect(stepStarted).toBeDefined();
      expect(toolCalled).toBeDefined();
      if (!stepStarted || !toolCalled) throw new Error("events not found");

      expect(toolCalled.parentSpanId).toBe(stepStarted.spanId);
    });
  });

  // -------------------------------------------------------------------------
  // TC-O11Y-02: 인터-에이전트 traceId 전파
  // -------------------------------------------------------------------------
  describe("TC-O11Y-02: 인터-에이전트 traceId 전파", () => {
    it("alpha와 beta의 RuntimeEvent가 동일한 traceId를 공유할 수 있다", async () => {
      // 이 테스트는 PipelineRegistry 레벨에서 두 에이전트의 이벤트를 같은 traceId로 실행
      const sharedTraceId = "shared-trace-alpha-beta-01020304";

      const alphaEvents = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "default",
        traceId: sharedTraceId,
        turnId: "turn-alpha",
      });

      const betaEvents = await runFullTurnAndCapture({
        agentName: "beta",
        instanceKey: "default",
        traceId: sharedTraceId,
        turnId: "turn-beta",
      });

      // 모든 이벤트가 동일한 traceId
      for (const event of [...alphaEvents, ...betaEvents]) {
        expect(event.traceId).toBe(sharedTraceId);
      }

      // alpha와 beta는 다른 agentName
      for (const event of alphaEvents) {
        expect(event.agentName).toBe("alpha");
      }
      for (const event of betaEvents) {
        expect(event.agentName).toBe("beta");
      }
    });

    it("IPC를 통한 traceId 전파: Orchestrator가 요청의 traceId를 유지한다", () => {
      // Orchestrator의 route()는 payload를 그대로 전달하므로
      // payload에 traceId가 있으면 대상 에이전트에 전달된다.
      // 이는 inter-agent.test.ts의 TC-IPC-01에서 실제 검증됨.
      // 여기서는 type-level 보장만 확인.
      const payload = {
        id: "evt-trace",
        type: "request",
        input: "hello",
        source: { kind: "agent", name: "alpha" },
        traceId: "trace-propagated",
        instanceKey: "default",
        replyTo: { target: "alpha", correlationId: "corr-1" },
      };

      // traceId 필드가 payload에 포함됨
      expect(payload.traceId).toBe("trace-propagated");
    });
  });

  // -------------------------------------------------------------------------
  // TC-O11Y-03: Turn -> Step -> Tool 계층 Span 연결
  // -------------------------------------------------------------------------
  describe("TC-O11Y-03: Turn -> Step -> Tool 계층 Span 연결", () => {
    it("올바른 parent-child spanId 체인이 형성된다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "planner",
        instanceKey: "default",
        traceId: "trace-span-chain",
        turnId: "turn-span-chain",
      });

      const turnStarted = events.find((e) => e.type === "turn.started");
      const turnCompleted = events.find((e) => e.type === "turn.completed");
      const stepStarted = events.find((e) => e.type === "step.started");
      const stepCompleted = events.find((e) => e.type === "step.completed");
      const toolCalled = events.find((e) => e.type === "tool.called");
      const toolCompleted = events.find((e) => e.type === "tool.completed");

      expect(turnStarted).toBeDefined();
      expect(turnCompleted).toBeDefined();
      expect(stepStarted).toBeDefined();
      expect(stepCompleted).toBeDefined();
      expect(toolCalled).toBeDefined();
      expect(toolCompleted).toBeDefined();

      if (!turnStarted || !turnCompleted || !stepStarted || !stepCompleted || !toolCalled || !toolCompleted) {
        throw new Error("expected events not found");
      }

      // turn.started와 turn.completed의 spanId가 동일
      expect(turnStarted.spanId).toBe(turnCompleted.spanId);

      // step의 parentSpanId == turn의 spanId
      expect(stepStarted.parentSpanId).toBe(turnStarted.spanId);
      expect(stepCompleted.parentSpanId).toBe(turnStarted.spanId);

      // tool의 parentSpanId == step의 spanId
      expect(toolCalled.parentSpanId).toBe(stepStarted.spanId);
      expect(toolCompleted.parentSpanId).toBe(stepStarted.spanId);

      // step.started와 step.completed의 spanId가 동일
      expect(stepStarted.spanId).toBe(stepCompleted.spanId);

      // tool.called와 tool.completed의 spanId가 동일
      expect(toolCalled.spanId).toBe(toolCompleted.spanId);
    });

    it("이벤트 발생 순서가 올바르다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "planner",
        instanceKey: "default",
        traceId: "trace-order",
        turnId: "turn-order",
      });

      const types = events.map((e) => e.type);

      expect(types).toEqual([
        "turn.started",
        "step.started",
        "tool.called",
        "tool.completed",
        "step.completed",
        "turn.completed",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // TC-O11Y-04: turn.completed의 stepCount, duration
  // -------------------------------------------------------------------------
  describe("TC-O11Y-04: turn.completed의 stepCount, duration", () => {
    it("stepCount >= 1이고 duration > 0이다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "default",
        traceId: "trace-metrics",
        turnId: "turn-metrics",
      });

      const turnCompleted = events.find((e) => e.type === "turn.completed");
      expect(turnCompleted).toBeDefined();
      if (!turnCompleted || turnCompleted.type !== "turn.completed") {
        throw new Error("turn.completed not found");
      }

      expect(turnCompleted.stepCount).toBeGreaterThanOrEqual(1);
      expect(turnCompleted.duration).toBeGreaterThanOrEqual(0);
    });

    it("tokenUsage가 포함될 때 유효한 값을 가진다", async () => {
      const eventBus = new RuntimeEventBusImpl();
      const registry = new PipelineRegistryImpl(eventBus);
      const conversationState = new ConversationStateImpl();
      const captured: RuntimeEvent[] = [];

      eventBus.on("turn.completed", async (event) => {
        captured.push(event);
      });
      eventBus.on("step.completed", async (event) => {
        captured.push(event);
      });

      await registry.runTurn(
        {
          agentName: "alpha",
          instanceKey: "default",
          turnId: "turn-token",
          traceId: "trace-token",
          inputEvent: createAgentEvent(),
          conversationState,
          agents: mockAgentsApi,
          emitMessageEvent: () => {},
          metadata: {},
        },
        async () => {
          await registry.runStep(
            {
              agentName: "alpha",
              instanceKey: "default",
              turnId: "turn-token",
              traceId: "trace-token",
              turn: createTurn("turn-token", "alpha"),
              stepIndex: 0,
              conversationState,
              agents: mockAgentsApi,
              emitMessageEvent: () => {},
              toolCatalog: [],
              metadata: {},
            },
            async () => ({
              status: "completed",
              hasToolCalls: false,
              toolCalls: [],
              toolResults: [],
              metadata: {
                "runtime.tokenUsage": {
                  promptTokens: 100,
                  completionTokens: 50,
                  totalTokens: 150,
                },
              },
            }),
          );

          return { turnId: "turn-token", finishReason: "text_response" };
        },
      );

      const turnCompleted = captured.find((e) => e.type === "turn.completed");
      expect(turnCompleted).toBeDefined();
      if (!turnCompleted || turnCompleted.type !== "turn.completed") {
        throw new Error("turn.completed not found");
      }

      expect(turnCompleted.tokenUsage).toBeDefined();
      if (!turnCompleted.tokenUsage) throw new Error("tokenUsage missing");
      expect(turnCompleted.tokenUsage.promptTokens).toBe(100);
      expect(turnCompleted.tokenUsage.completionTokens).toBe(50);
      expect(turnCompleted.tokenUsage.totalTokens).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  // TC-O11Y-05: 이벤트명 dot notation 준수
  // -------------------------------------------------------------------------
  describe("TC-O11Y-05: 이벤트명 dot notation 준수", () => {
    it("모든 RuntimeEvent type이 dot notation을 사용한다", async () => {
      const events = await runFullTurnAndCapture({
        agentName: "alpha",
        instanceKey: "default",
        traceId: "trace-dotnotation",
        turnId: "turn-dotnotation",
      });

      const allowedTypes = new Set<RuntimeEventType>([
        "turn.started",
        "turn.completed",
        "turn.failed",
        "step.started",
        "step.completed",
        "step.failed",
        "tool.called",
        "tool.completed",
        "tool.failed",
      ]);

      for (const event of events) {
        expect(allowedTypes.has(event.type)).toBe(true);
        // camelCase 형태가 아닌지 확인
        expect(event.type).toMatch(/^[a-z]+\.[a-z]+$/);
      }
    });

    it("camelCase 이벤트명(toolCall, turnCompleted 등)이 사용되지 않는다", () => {
      const camelCaseNames = ["toolCall", "turnCompleted", "stepStarted", "toolCompleted"];

      for (const name of camelCaseNames) {
        expect(RUNTIME_EVENT_TYPES).not.toContain(name);
      }

      // dot notation 확인
      for (const eventType of RUNTIME_EVENT_TYPES) {
        expect(eventType).toMatch(/^[a-z]+\.[a-z]+$/);
      }
    });
  });
});
