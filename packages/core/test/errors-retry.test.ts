import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createGoondan, MemoryConversationStore,
  type Json, type Message, type Model, type ModelResult, type Tool,
} from "../src/index.ts";

/** The execution error a failed turn throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[]; attempt: number } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes, attempt: detail.attempt } : undefined;
}

function assistant(text: string, id = "a"): Message {
  return { id, role: "assistant", source: "model", content: [{ type: "text", text }] };
}

function calls(id: string, ...callIds: string[]): Message {
  return { id, role: "assistant", source: "model", content: callIds.map((callId) => ({ type: "tool.call", callId, name: "act", args: null })) };
}

function scripted(replies: ModelResult[]): Model & { count: () => number } {
  let call = 0;
  return {
    count: () => call,
    async generate(): Promise<ModelResult> {
      const reply = replies[call];
      call += 1;
      if (!reply) throw new Error(`no scripted reply for call ${String(call)}`);
      return reply;
    },
  };
}

describe("the retry limit", () => {
  it("follows three retries by default, so a failing model is called four times", async () => {
    let attempts = 0;
    const model: Model = { async generate(): Promise<ModelResult> { attempts += 1; throw new Error("model is unwell"); } };
    const seen: Json[] = [];
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { error: [{ name: "again", fn: "again" }] } } } }, {
      directory: ".", models: { m: model },
      functions: { again: (value) => { seen.push(value); return { retry: true, target: "model" }; } },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((issue: unknown) => issue);

    expect(attempts).toBe(4);
    expect(failure(error)).toEqual({ where: "model", codes: ["model_error"], attempt: 4 });
    expect(seen.map((value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value.attempt : null))).toEqual([1, 2, 3, 4]);
    await runtime.close();
  });

  it("honours a retry limit of zero", async () => {
    let attempts = 0;
    const model: Model = { async generate(): Promise<ModelResult> { attempts += 1; throw new Error("model is unwell"); } };
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { error: [{ name: "again", fn: "again" }] } } } }, {
      directory: ".", models: { m: model }, maxRetries: 0,
      functions: { again: () => ({ retry: true, target: "model" }) },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((issue: unknown) => issue);

    expect(attempts).toBe(1);
    expect(failure(error)).toEqual({ where: "model", codes: ["model_error"], attempt: 1 });
    await runtime.close();
  });

  it("stops waiting for a retry delay as soon as the run is told to stop", async () => {
    let reached = (): void => {};
    const arrived = new Promise<void>((settle) => { reached = () => { settle(); }; });
    const model: Model = { async generate(): Promise<ModelResult> { throw new Error("model is unwell"); } };
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { error: [{ name: "again", fn: "again" }] } } } }, {
      directory: ".", models: { m: model },
      functions: { again: () => { reached(); return { retry: true, target: "model", afterMs: 60_000 }; } },
    });

    const running = runtime.run("hi", { sessionId: "c" });
    await arrived;
    // The error stage has answered, so the run is waiting out the delay it asked for.
    await new Promise((settle) => { setTimeout(settle, 5); });
    expect(runtime.abort("c")).toBe(true);
    const error: unknown = await running.catch((issue: unknown) => issue);

    // The run stopped waiting at once instead of sitting out the whole delay.
    expect(failure(error)).toEqual({ where: "runtime", codes: ["aborted"], attempt: 2 });
    await runtime.close();
  });

  it("refuses a retry limit that is not a whole number of zero or more", () => {
    expect(() => createGoondan({ agents: { a: { model: "m" } } }, { directory: ".", models: {}, maxRetries: -1 })).toThrow(TypeError);
    expect(() => createGoondan({ agents: { a: { model: "m" } } }, { directory: ".", models: {}, maxRetries: 1.5 })).toThrow(TypeError);
  });

  it("gives every agent run its own retry count", async () => {
    let helperCalls = 0;
    const helper: Model = {
      async generate(): Promise<ModelResult> {
        helperCalls += 1;
        if (helperCalls <= 3) throw new Error("helper is unwell");
        return { message: assistant("helped"), finishReason: "stop" };
      },
    };
    let mainCalls = 0;
    const main: Model = {
      async generate(): Promise<ModelResult> {
        mainCalls += 1;
        if (mainCalls === 1) return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "h1", name: "helper", args: null }] }, finishReason: "tool" };
        return { message: assistant("done"), finishReason: "stop" };
      },
    };
    const runtime = createGoondan({
      agents: {
        main: { model: "m", tools: [{ agent: "helper" }] },
        helper: { model: "h", hooks: { error: [{ name: "again", fn: "again" }] } },
      },
    }, { directory: ".", models: { m: main, h: helper }, functions: { again: () => ({ retry: true, target: "model" }) } });

    const result = await runtime.run("hi", { sessionId: "c" });

    // The sub-run used its own three retries; the parent never retried.
    expect(helperCalls).toBe(4);
    expect(result.runs.map((run) => run.status)).toEqual(["done", "done"]);
    await runtime.close();
  });
});

describe("a tool retry", () => {
  it("counts the attempt per agent run and keeps the calls a retried call had not reached", async () => {
    const attempts: string[] = [];
    const act: Tool = {
      name: "act", description: "act", input: {},
      execute: (input, ctx) => {
        attempts.push(ctx.toolCall.id);
        const first = attempts.filter((id) => id === ctx.toolCall.id).length === 1;
        if (first && ctx.toolCall.id !== "a") throw new Error(`${ctx.toolCall.id} is unwell`);
        return { callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "ran" }] };
      },
    };
    const seen: Json[] = [];
    const model = scripted([{ message: calls("m1", "a", "b", "c"), finishReason: "tool" }, { message: assistant("after"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { error: [{ name: "again", fn: "again" }] } } } }, {
      directory: ".", models: { m: model }, tools: { act },
      functions: { again: (value) => { seen.push(value); return { retry: true, target: "tool" }; } },
    });

    await runtime.run("go", { sessionId: "c" });

    expect(attempts).toEqual(["a", "b", "b", "c", "c"]);
    expect(seen.map((value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value.attempt : null))).toEqual([1, 2]);
    await runtime.close();
  });

  it("carries the failed call of the tool location in the execution error", async () => {
    const act: Tool = { name: "act", description: "act", input: {}, execute: () => { throw new Error("tool is unwell"); } };
    const model = scripted([{ message: calls("m1", "c1"), finishReason: "tool" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act } });

    const error: unknown = await runtime.run("go", { sessionId: "c" }).catch((issue: unknown) => issue);

    expect(executionError(error)?.toolCall).toEqual({ id: "c1", name: "act", args: null });
    await runtime.close();
  });
});

describe("a failed run and its conversation", () => {
  it("keeps the messages a failed run stored", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: calls("m1", "c1"), finishReason: "tool" }]);
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, conversationStore: store });

    const error: unknown = await runtime.run("go", { sessionId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "tool", codes: ["tool_unavailable"], attempt: 1 });
    const stored = await store.load("c", "main");
    expect(stored.map((message) => message.role)).toEqual(["user", "assistant"]);
    await runtime.close();
  });

  it("removes the tool call parts a previous run left unpaired before the first safe point", async () => {
    const store = new MemoryConversationStore();
    await store.replace("c", "main", [
      calls("m1", "c1", "c2"),
      { id: "m2", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "c1", content: [{ type: "text", text: "ran" }] }] },
      calls("m3", "c3"),
      { id: "m4", role: "assistant", source: "model", content: [] },
    ]);
    const seen: Message[][] = [];
    const model: Model = {
      async generate(input): Promise<ModelResult> { seen.push(input.messages); return { message: assistant("done"), finishReason: "stop" }; },
    };
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, conversationStore: store });

    await runtime.run("go", { sessionId: "c" });

    // `c2` and `c3` had no result, so their parts are gone and the message `c3` emptied is dropped.
    expect(seen[0]?.map((message) => message.id)).toEqual(["m1", "m2", "m4", seen[0]?.[3]?.id ?? ""]);
    expect(seen[0]?.[0]?.content).toEqual([{ type: "tool.call", callId: "c1", name: "act", args: null }]);
    const stored = await store.load("c", "main");
    expect(stored.map((message) => message.id).slice(0, 3)).toEqual(["m1", "m2", "m4"]);
    await runtime.close();
  });

  it("leaves a conversation whose tool calls all have a result untouched", async () => {
    const store = new MemoryConversationStore();
    const paired: Message[] = [
      calls("m1", "c1"),
      { id: "m2", role: "tool", source: "tool", content: [{ type: "tool.result", callId: "c1", content: [] }] },
    ];
    await store.replace("c", "main", paired);
    const seen: Message[][] = [];
    const model: Model = {
      async generate(input): Promise<ModelResult> { seen.push(input.messages); return { message: assistant("done"), finishReason: "stop" }; },
    };
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, conversationStore: store });

    await runtime.run("go", { sessionId: "c" });

    expect(seen[0]?.slice(0, 2)).toEqual(paired);
    await runtime.close();
  });
});
