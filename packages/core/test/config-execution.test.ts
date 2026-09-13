import { describe, expect, it } from "vitest";
import { createRuntime, defineExtension, MemoryConversationStore, validateConfig, type ModelResult } from "../src/index.ts";

describe("configuration and execution contracts", () => {
  it("resolves inheritance, overrides and individual removals without mutating the parent", () => {
    const config = validateConfig({ agents: {
      base: { model: "model", params: { a: 1, b: 2 }, tools: ["read", "write"], extensions: { memory: {}, audit: {} }, hooks: { modelInput: [{ extension: "memory" }, { name: "note", fn: "note" }, { extension: "audit" }] } },
      child: { inherit: "base", params: { b: 3 }, extensions: { audit: { enabled: false } }, remove: { tools: ["write"], extensions: ["memory"], hooks: { modelInput: ["note"] } } },
    } });
    expect(config.agents.child).toMatchObject({ model: "model", params: { a: 1, b: 3 }, tools: ["read"], extensions: { audit: { enabled: false } }, hooks: { modelInput: [] } });
    expect(config.agents.base?.tools).toEqual(["read", "write"]);
    expect(config.agents.base?.hooks?.modelInput).toHaveLength(3);
    expect(config.flow).toEqual({ in: "base" });
    expect(() => validateConfig({ agents: { a: { model: "m" } }, flow: ["a", "a"] })).toThrow("unique");
    expect(validateConfig(config)).toEqual(config);
    expect(() => validateConfig({ agents: { a: { inherit: "b" }, b: { inherit: "a" } } })).toThrow("Circular");
    expect(() => validateConfig({ agents: { a: { inherit: "missing" } } })).toThrow("Unknown inherited");
  });

  it("connects a serial flow with only the last output", async () => {
    const config = validateConfig({ agents: { analyst: { model: "a" }, editor: { inherit: "analyst", model: "e" } }, flow: ["analyst", "editor"] });
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, { models: {
      a: { async generate(): Promise<ModelResult> { return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "analysis" }] }, finishReason: "stop" }; } },
      e: { async generate(input): Promise<ModelResult> { expect(input.messages[0]?.content).toEqual([{ type: "text", text: "analysis" }]); return { message: { id: "e", role: "assistant", source: "model", content: [{ type: "text", text: "edited" }] }, finishReason: "stop" }; } },
    } });
    expect((await runtime.runTurn("input", { conversationId: "serial" })).output.content).toEqual([{ type: "text", text: "edited" }]);
    await runtime.close();
  });

  it("allows more than 32 model steps and completes after saving every result in the current tool batch", async () => {
    const store = new MemoryConversationStore(); let generations = 0; let toolCalls = 0;
    const config = validateConfig({ agents: { main: { model: "model", tools: ["work"], extensions: { policy: {} }, hooks: { toolResult: [{ extension: "policy" }] } } } });
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, { conversationStore: store, models: {
      model: { async generate(): Promise<ModelResult> {
        generations += 1;
        if (generations > 34) throw new Error("completion policy failed");
        return { message: { id: `m${generations}`, role: "assistant", source: "model", content: [0, 1].map((i) => ({ type: "tool.call", callId: `${generations}:${i}`, name: "work", args: null })) }, finishReason: "tool" };
      } },
    }, tools: { work: { name: "work", description: "work", input: {}, execute(input, ctx) { toolCalls += 1; return { callId: ctx.toolCall.id, name: "work", args: input, content: [{ type: "text", text: "done" }] }; } } },
    extensions: { policy: defineExtension({ name: "policy", create: () => ({ hooks: { toolResult(value, ctx) {
      if (toolCalls === 67) ctx.execution.complete({ id: "final", role: "assistant", source: "policy", content: [{ type: "text", text: "complete" }] });
      return value;
    } } }) }) } });
    const result = await runtime.runTurn("input", { conversationId: "long" });
    expect(generations).toBe(34); expect(toolCalls).toBe(68);
    expect(result.output.content).toEqual([{ type: "text", text: "complete" }]);
    expect((await store.load("long", "main")).flatMap((m) => m.content).filter((p) => p.type === "tool.result")).toHaveLength(68);
    await runtime.close();
  });
});
