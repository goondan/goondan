import { describe, expect, it } from "vitest";
import { ConversationStateImpl } from "../src/conversation/state.js";
import { PipelineRegistryImpl } from "../src/pipeline/registry.js";
import type { StepResult, Turn } from "../src/types.js";
import { createAgentEvent } from "./helpers.js";

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
});
