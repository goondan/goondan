import { describe, expect, it } from "vitest";
import { ConversationStateImpl } from "../src/conversation/state.js";
import {
  RuntimeEventBusImpl,
  STEP_STARTED_LLM_INPUT_MESSAGES_METADATA_KEY,
  type RuntimeEvent,
} from "../src/events/runtime-events.js";
import { PipelineRegistryImpl } from "../src/pipeline/registry.js";
import type { MiddlewareAgentsApi, StepResult, Turn } from "../src/types.js";
import { createAgentEvent } from "./helpers.js";

const mockMiddlewareAgentsApi: MiddlewareAgentsApi = {
  async request(params) {
    return {
      target: params.target,
      response: `reply:${params.input ?? ""}`,
    };
  },
  async send() {
    return {
      accepted: true,
    };
  },
};

describe("PipelineRegistryImpl", () => {
  it("step middleware를 priority + stable sort로 onion 체이닝한다", async () => {
    const registry = new PipelineRegistryImpl();
    const order: string[] = [];

    registry.register("step", async (ctx) => {
      order.push("A:pre");
      const result = await ctx.next();
      order.push("A:post");
      return result;
    }, { priority: 10 });

    registry.register("step", async (ctx) => {
      order.push("B:pre");
      const result = await ctx.next();
      order.push("B:post");
      return result;
    }, { priority: 5 });

    registry.register("step", async (ctx) => {
      order.push("C:pre");
      const result = await ctx.next();
      order.push("C:post");
      return result;
    }, { priority: 10 });

    const conversationState = new ConversationStateImpl();
    const turn: Turn = {
      id: "turn-1",
      agentName: "coder",
      inputEvent: createAgentEvent(),
      messages: [],
      steps: [],
      status: "running",
      metadata: {},
    };

    const stepResult: StepResult = {
      status: "completed",
      shouldContinue: false,
      toolCalls: [],
      toolResults: [],
      metadata: {},
    };

    const result = await registry.runStep(
      {
        agentName: "coder",
        instanceKey: "default",
        turnId: "turn-1",
        traceId: "trace-1",
        turn,
        stepIndex: 0,
        conversationState,
        agents: mockMiddlewareAgentsApi,
        emitMessageEvent: (event) => {
          conversationState.emitMessageEvent(event);
        },
        toolCatalog: [],
        metadata: {},
      },
      async () => {
        order.push("core");
        return stepResult;
      },
    );

    expect(result.status).toBe("completed");
    expect(order).toEqual(["B:pre", "A:pre", "C:pre", "core", "C:post", "A:post", "B:post"]);
  });

  it("turn/step 미들웨어 컨텍스트에서 ctx.agents API를 노출한다", async () => {
    const registry = new PipelineRegistryImpl();
    const conversationState = new ConversationStateImpl();
    const turn: Turn = {
      id: "turn-ctx-agents",
      agentName: "coder",
      inputEvent: createAgentEvent(),
      messages: [],
      steps: [],
      status: "running",
      metadata: {},
    };

    let sendAccepted = false;
    let requestResponse = "";

    registry.register("turn", async (ctx) => {
      const result = await ctx.agents.send({
        target: "observer",
        input: "turn-post",
      });
      sendAccepted = result.accepted;
      return ctx.next();
    });

    registry.register("step", async (ctx) => {
      const result = await ctx.agents.request({
        target: "retriever",
        input: "step-pre",
      });
      requestResponse = result.response;
      return ctx.next();
    });

    await registry.runTurn(
      {
        agentName: "coder",
        instanceKey: "default",
        turnId: "turn-ctx-agents",
        traceId: "trace-ctx-agents",
        inputEvent: createAgentEvent(),
        conversationState,
        agents: mockMiddlewareAgentsApi,
        emitMessageEvent: () => {},
        metadata: {},
      },
      async () => ({
        turnId: "turn-ctx-agents",
        finishReason: "text_response",
      }),
    );

    await registry.runStep(
      {
        agentName: "coder",
        instanceKey: "default",
        turnId: "turn-ctx-agents",
        traceId: "trace-ctx-agents",
        turn,
        stepIndex: 1,
        conversationState,
        agents: mockMiddlewareAgentsApi,
        emitMessageEvent: () => {},
        toolCatalog: [],
        metadata: {},
      },
      async () => ({
        status: "completed",
        shouldContinue: false,
        toolCalls: [],
        toolResults: [],
        metadata: {},
      }),
    );

    expect(sendAccepted).toBe(true);
    expect(requestResponse).toBe("reply:step-pre");
  });

  it("step.started 이벤트에 LLM 입력 메시지 목록을 포함한다", async () => {
    const eventBus = new RuntimeEventBusImpl();
    const registry = new PipelineRegistryImpl(eventBus);
    const conversationState = new ConversationStateImpl();
    const turn: Turn = {
      id: "turn-step-events",
      agentName: "coder",
      inputEvent: createAgentEvent(),
      messages: [],
      steps: [],
      status: "running",
      metadata: {},
    };

    const captured: RuntimeEvent[] = [];
    const unsubscribe = eventBus.on("step.started", async (event) => {
      captured.push(event);
    });

    await registry.runStep(
      {
        agentName: "coder",
        instanceKey: "default",
        turnId: "turn-step-events",
        traceId: "trace-step-events",
        turn,
        stepIndex: 0,
        conversationState,
        agents: mockMiddlewareAgentsApi,
        emitMessageEvent: () => {},
        toolCatalog: [],
        metadata: {
          [STEP_STARTED_LLM_INPUT_MESSAGES_METADATA_KEY]: [
            {
              role: "system",
              content: "You are coder.",
            },
            {
              role: "user",
              content: "Fix this bug.",
            },
          ],
        },
      },
      async () => ({
        status: "completed",
        shouldContinue: false,
        toolCalls: [],
        toolResults: [],
        metadata: {},
      }),
    );

    unsubscribe();

    expect(captured).toHaveLength(1);
    const event = captured[0];
    if (!event || event.type !== "step.started") {
      throw new Error("step.started event not captured");
    }
    expect(event.llmInputMessages).toEqual([
      {
        role: "system",
        content: "You are coder.",
      },
      {
        role: "user",
        content: "Fix this bug.",
      },
    ]);
  });

  it("step.started 이벤트에 TraceContext 필드(traceId, spanId, instanceKey)를 포함한다", async () => {
    const eventBus = new RuntimeEventBusImpl();
    const registry = new PipelineRegistryImpl(eventBus);
    const conversationState = new ConversationStateImpl();
    const turn: Turn = {
      id: "turn-trace",
      agentName: "coder",
      inputEvent: createAgentEvent(),
      messages: [],
      steps: [],
      status: "running",
      metadata: {},
    };

    const captured: RuntimeEvent[] = [];
    const unsubscribe = eventBus.on("step.started", async (event) => {
      captured.push(event);
    });

    await registry.runStep(
      {
        agentName: "coder",
        instanceKey: "inst-abc",
        turnId: "turn-trace",
        traceId: "aabb0011",
        turn,
        stepIndex: 2,
        conversationState,
        agents: mockMiddlewareAgentsApi,
        emitMessageEvent: () => {},
        toolCatalog: [],
        metadata: {},
      },
      async () => ({
        status: "completed",
        shouldContinue: false,
        toolCalls: [],
        toolResults: [],
        metadata: {},
      }),
    );

    unsubscribe();

    expect(captured).toHaveLength(1);
    const event = captured[0];
    if (!event || event.type !== "step.started") {
      throw new Error("step.started event not captured");
    }
    expect(event.traceId).toBe("aabb0011");
    expect(event.instanceKey).toBe("inst-abc");
    expect(event.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(event.stepId).toBe("turn-trace-step-2");
  });

  it("turn → step → tool 이벤트의 span hierarchy가 올바르다", async () => {
    const eventBus = new RuntimeEventBusImpl();
    const registry = new PipelineRegistryImpl(eventBus);
    const conversationState = new ConversationStateImpl();

    const captured: RuntimeEvent[] = [];
    for (const eventType of [
      "turn.started",
      "turn.completed",
      "step.started",
      "step.completed",
      "tool.called",
      "tool.completed",
    ] as const) {
      eventBus.on(eventType, async (event) => {
        captured.push(event);
      });
    }

    await registry.runTurn(
      {
        agentName: "planner",
        instanceKey: "default",
        turnId: "turn-span-h",
        traceId: "trace-span-h",
        inputEvent: createAgentEvent(),
        conversationState,
        agents: mockMiddlewareAgentsApi,
        emitMessageEvent: () => {},
        metadata: {},
      },
      async () => {
        // Inside the turn, run a step
        await registry.runStep(
          {
            agentName: "planner",
            instanceKey: "default",
            turnId: "turn-span-h",
            traceId: "trace-span-h",
            turn: {
              id: "turn-span-h",
              agentName: "planner",
              inputEvent: createAgentEvent(),
              messages: [],
              steps: [],
              status: "running",
              metadata: {},
            },
            stepIndex: 0,
            conversationState,
            agents: mockMiddlewareAgentsApi,
            emitMessageEvent: () => {},
            toolCatalog: [],
            metadata: {},
          },
          async () => {
            // Inside the step, run a tool call
            await registry.runToolCall(
              {
                agentName: "planner",
                instanceKey: "default",
                turnId: "turn-span-h",
                traceId: "trace-span-h",
                stepIndex: 0,
                toolName: "search",
                toolCallId: "tc-1",
                args: {},
                metadata: {},
              },
              async () => ({
                status: "ok",
                content: "found",
                metadata: {},
              }),
            );

            return {
              status: "completed",
              shouldContinue: true,
              toolCalls: [{ toolCallId: "tc-1", toolName: "search", args: {} }],
              toolResults: [{ toolCallId: "tc-1", toolName: "search", status: "ok", content: "found", metadata: {} }],
              metadata: {},
            };
          },
        );

        return { turnId: "turn-span-h", finishReason: "text_response" };
      },
    );

    // Verify span hierarchy
    const turnStarted = captured.find((e) => e.type === "turn.started");
    const stepStarted = captured.find((e) => e.type === "step.started");
    const toolCalled = captured.find((e) => e.type === "tool.called");
    const turnCompleted = captured.find((e) => e.type === "turn.completed");

    if (!turnStarted || !stepStarted || !toolCalled || !turnCompleted) {
      throw new Error("Expected events not captured");
    }

    // All events share the same traceId
    expect(turnStarted.traceId).toBe("trace-span-h");
    expect(stepStarted.traceId).toBe("trace-span-h");
    expect(toolCalled.traceId).toBe("trace-span-h");

    // Turn has no parent
    expect(turnStarted.parentSpanId).toBeUndefined();

    // Step's parent is the turn's spanId
    if (stepStarted.type !== "step.started") throw new Error("type guard");
    expect(stepStarted.parentSpanId).toBe(turnStarted.spanId);

    // Tool's parent is the step's spanId
    if (toolCalled.type !== "tool.called") throw new Error("type guard");
    expect(toolCalled.parentSpanId).toBe(stepStarted.spanId);

    // turn.completed has correct stepCount
    if (turnCompleted.type !== "turn.completed") throw new Error("type guard");
    expect(turnCompleted.stepCount).toBe(1);
    expect(turnCompleted.spanId).toBe(turnStarted.spanId);
  });
});
