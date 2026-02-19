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
      hasToolCalls: false,
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
        hasToolCalls: false,
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
        hasToolCalls: false,
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
});
