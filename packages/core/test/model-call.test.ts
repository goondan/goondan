import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createRuntime, defineExtension, loadConfigSync, MemoryConversationStore,
  type Json, type Message, type Model, type ModelContext, type ModelInput, type ModelResult,
  type RuntimeEvent, type Tool,
} from "../src/index.ts";

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-model-")));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

/** The execution error a failed run throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[]; message: string } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes, message: detail.message } : undefined;
}

/** A value a host outside the type system could hand to the runtime. */
function untyped<T>(json: string): T {
  const parsed: T = JSON.parse(json);
  return parsed;
}

function assistant(text: string, id = "a"): Message {
  return { id, role: "assistant", source: "model", content: [{ type: "text", text }] };
}

function callMessage(callId: string, name: string, args: Json = null): Message {
  return { id: `m-${callId}`, role: "assistant", source: "model", content: [{ type: "tool.call", callId, name, args }] };
}

interface Recorded { input: ModelInput; ctx: ModelContext }

/** A model that answers with the next scripted reply and records the input and context it received. */
function scripted(replies: ModelResult[]): Model & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    async generate(input, ctx): Promise<ModelResult> {
      calls.push({ input, ctx });
      const reply = replies[calls.length - 1];
      if (!reply) throw new Error(`no scripted reply for call ${String(calls.length)}`);
      return reply;
    },
  };
}

const ok: ModelResult = { message: assistant("ok"), finishReason: "stop" };

function act(text = "acted"): Tool {
  return { name: "act", description: "act", input: { type: "object" }, execute: (input, ctx) => ({ callId: ctx.toolCall.id, name: ctx.toolCall.name, args: input, content: [{ type: "text", text }] }) };
}

describe("the model call", () => {
  it("passes the agent path, the identifiers and a model call number that starts at 1", async () => {
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, ok]);
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act: act() } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls.map((call) => call.ctx.step)).toEqual([1, 2]);
    expect(model.calls[0]?.ctx.agent).toBe("main");
    expect(model.calls[0]?.ctx.conversationId).toBe("c");
    expect(model.calls[0]?.ctx.turnId).toBe(model.calls[1]?.ctx.turnId);
    await runtime.close();
  });

  it("gives every model call a copy of the model input", async () => {
    const seen: ModelInput[] = [];
    const model: Model = {
      async generate(input): Promise<ModelResult> {
        seen.push(input);
        input.messages.push(assistant("intruder", "x"));
        input.options.temperature = 1;
        return ok;
      },
    };
    const store = new MemoryConversationStore();
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, conversationStore: store });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(seen).toHaveLength(1);
    // The stored conversation keeps the user message and the answer, not what the model added.
    expect((await store.load("c", "main")).map((message) => message.role)).toEqual(["user", "assistant"]);
    await runtime.close();
  });

  it("counts a retried model call as a new model call number", async () => {
    let retried = false;
    const model = scripted([{ message: assistant("first"), finishReason: "stop" }, ok]);
    const again = (): Json | null => {
      if (retried) return null;
      retried = true;
      return { retry: true, target: "model" };
    };
    const runtime = createRuntime({
      agents: { main: { model: "m", hooks: { modelResult: [{ fn: "again" }] } } },
    }, { directory: ".", models: { m: model }, functions: { again } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls.map((call) => call.ctx.step)).toEqual([1, 2]);
    await runtime.close();
  });

  it("stops a run that used up its model calls without a further modelInput stage", async () => {
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, ok]);
    let inputs = 0;
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: ["act"], hooks: { modelInput: [{ fn: "count" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act: act() }, maxSteps: 1,
      functions: { count: () => { inputs += 1; return null; } },
    });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.where).toBe("runtime");
    expect(failure(error)?.codes).toEqual(["runtime_error"]);
    expect(model.calls).toHaveLength(1);
    expect(inputs).toBe(1);
    await runtime.close();
  });

  it("never sends a model call limit failure to the error stage", async () => {
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]);
    let errors = 0;
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: ["act"], hooks: { error: [{ fn: "watch" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act: act() }, maxSteps: 1,
      functions: { watch: () => { errors += 1; return null; } },
    });

    await runtime.runTurn("hi", { conversationId: "c" }).catch(() => undefined);

    expect(errors).toBe(0);
    await runtime.close();
  });

  it("refuses a model call limit that is not an integer of 1 or more", () => {
    const build = (maxSteps: number): void => { createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: scripted([ok]) }, maxSteps }); };
    expect(() => { build(0); }).toThrow(TypeError);
    expect(() => { build(1.5); }).toThrow(TypeError);
    expect(() => { build(1); }).not.toThrow();
  });

  it("reports the code a model implementation declared as the second failure code", async () => {
    const overloaded = Object.assign(new Error("too busy"), { code: "overloaded" });
    const model: Model = { generate(): Promise<ModelResult> { return Promise.reject(overloaded); } };
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)).toEqual({ where: "model", codes: ["model_error", "overloaded"], message: "too busy" });
    expect(events.find((event) => event.name === "step.error")?.data.codes).toEqual(["model_error", "overloaded"]);
    await runtime.close();
  });

  it("lets an error hook select a model failure by its second code", async () => {
    let attempt = 0;
    const model: Model = {
      generate(): Promise<ModelResult> {
        attempt += 1;
        if (attempt === 1) return Promise.reject(Object.assign(new Error("slow down"), { code: "rate_limited" }));
        return Promise.resolve(ok);
      },
    };
    const retryRate = (value: Json): Json | null => {
      const codes = typeof value === "object" && value !== null && !Array.isArray(value) ? value.codes : null;
      return Array.isArray(codes) && codes.includes("rate_limited") ? { retry: true, target: "model" } : null;
    };
    const runtime = createRuntime({
      agents: { main: { model: "m", hooks: { error: [{ fn: "retryRate" }] } } },
    }, { directory: ".", models: { m: model }, functions: { retryRate } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.output.content).toEqual([{ type: "text", text: "ok" }]);
    await runtime.close();
  });

  it("uses a model failure code only when it is a non-empty string", async () => {
    const model: Model = { generate(): Promise<ModelResult> { return Promise.reject(Object.assign(new Error("nope"), { code: "" })); } };
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.codes).toEqual(["model_error"]);
    await runtime.close();
  });

  it("fills the identifier and the source a model result left out", async () => {
    const raw = untyped<ModelResult>('{"message":{"role":"assistant","content":[{"type":"text","text":"hi"}]},"finishReason":"stop"}');
    const model: Model = { async generate(): Promise<ModelResult> { return raw; } };
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.output.source).toBe("model");
    expect(result.output.id).not.toBe("");
    await runtime.close();
  });

  it("reports a model result that is not an object as an invalid modelResult value", async () => {
    const events: RuntimeEvent[] = [];
    const model: Model = { async generate(): Promise<ModelResult> { return untyped<ModelResult>("null"); } };
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
    });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    // A result the form check refuses is never a model failure, so it carries no model_error code.
    expect(failure(error)?.where).toBe("modelResult");
    expect(failure(error)?.codes).toEqual(["value_invalid"]);
    expect(events.find((event) => event.name === "step.error")?.data.codes).toEqual(["value_invalid"]);
    await runtime.close();
  });

  it("runs the tool calls of a response whatever the finish reason says", async () => {
    const model = scripted([
      { message: callMessage("c1", "act"), finishReason: "stop" },
      { message: assistant("done"), finishReason: "tool" },
    ]);
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act: act() } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls).toHaveLength(2);
    expect(result.output.content).toEqual([{ type: "text", text: "done" }]);
    await runtime.close();
  });
});

describe("text chunks", () => {
  it("announces every string chunk of a running call in order", async () => {
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> {
        ctx.onTextDelta("he");
        ctx.onTextDelta("llo");
        return { message: assistant("hello"), finishReason: "stop" };
      },
    };
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("hi", { conversationId: "c" });

    const names = events.map((event) => event.name);
    expect(events.filter((event) => event.name === "step.textDelta").map((event) => event.data)).toEqual([{ step: 1, delta: "he" }, { step: 1, delta: "llo" }]);
    expect(names.indexOf("step.start")).toBeLessThan(names.indexOf("step.textDelta"));
    expect(names.lastIndexOf("step.textDelta")).toBeLessThan(names.indexOf("step.done"));
    await runtime.close();
  });

  it("drops a chunk that is not a string and a chunk that arrives after the call returned", async () => {
    let late = (): void => {};
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> {
        ctx.onTextDelta(untyped<string>("7"));
        ctx.onTextDelta("kept");
        late = () => { ctx.onTextDelta("late"); };
        return { message: assistant("kept"), finishReason: "stop" };
      },
    };
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("hi", { conversationId: "c" });
    late();

    expect(events.filter((event) => event.name === "step.textDelta").map((event) => event.data.delta)).toEqual(["kept"]);
    await runtime.close();
  });

  it("announces no chunk of a model call a hook made", async () => {
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> {
        ctx.onTextDelta("chunk");
        return { message: assistant("hi"), finishReason: "stop" };
      },
    };
    const events: RuntimeEvent[] = [];
    const probe = defineExtension({
      name: "probe", hooks: ["input"],
      create: () => ({ hooks: { input: async (value, ctx) => { await ctx.model.run([]); return value; } } }),
    });
    const runtime = createRuntime({
      agents: { main: { model: "m", extensions: { probe: {} }, hooks: { input: [{ extension: "probe" }] } } },
    }, { directory: ".", models: { m: model }, extensions: { probe }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("hi", { conversationId: "c" });

    // Only the run's own call announces a chunk, so the hook's call adds none.
    expect(events.filter((event) => event.name === "step.textDelta")).toHaveLength(1);
    await runtime.close();
  });

  it("gives a hook's model call the number of the last call the run started", async () => {
    const steps: number[] = [];
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> { steps.push(ctx.step); return { message: assistant("hi"), finishReason: "stop" }; },
    };
    const probe = defineExtension({
      name: "probe", hooks: ["input", "output"],
      create: () => ({ hooks: {
        input: async (value, ctx) => { await ctx.model.run([]); return value; },
        output: async (value, ctx) => { await ctx.model.run([]); return value; },
      } }),
    });
    const runtime = createRuntime({
      agents: { main: { model: "m", extensions: { probe: {} }, hooks: { input: [{ extension: "probe" }], output: [{ extension: "probe" }] } } },
    }, { directory: ".", models: { m: model }, extensions: { probe } });

    await runtime.runTurn("hi", { conversationId: "c" });

    // The input hook runs before the first call, the run's own call is 1 and the output hook reuses it.
    expect(steps).toEqual([0, 1, 1]);
    await runtime.close();
  });

  it("gives a modelInput hook's model call the number of the call that has not started yet", async () => {
    const steps: number[] = [];
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> {
        steps.push(ctx.step);
        return { message: steps.length < 3 ? callMessage(`c${String(steps.length)}`, "act") : assistant("done"), finishReason: "tool" };
      },
    };
    const probe = defineExtension({
      name: "probe", hooks: ["modelInput"],
      create: () => ({ hooks: { modelInput: async (value, ctx) => { await ctx.model.run([]); return value; } } }),
    });
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: ["act"], extensions: { probe: {} }, hooks: { modelInput: [{ extension: "probe" }] } } },
    }, { directory: ".", models: { m: model }, tools: { act: act() }, extensions: { probe }, maxSteps: 2 });

    await runtime.runTurn("hi", { conversationId: "c" }).catch(() => undefined);

    // The hook call before the first model call reports 0 and the one before the second reports 1.
    expect(steps.filter((_value, index) => index % 2 === 0)).toEqual([0, 1]);
    await runtime.close();
  });
});

describe("the model input", () => {
  it("builds a system block per declaration and keeps cache only where it was declared true", async () => {
    const model = scripted([ok]);
    const runtime = createRuntime({
      agents: { main: { model: "m", systemMessage: [{ text: "one", cache: true }, { text: "two", cache: false }, { text: "three" }] } },
    }, { directory: ".", models: { m: model } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls[0]?.input.system).toEqual([
      { text: "one", source: "system:0", cache: true },
      { text: "two", source: "system:1" },
      { text: "three", source: "system:2" },
    ]);
    await runtime.close();
  });

  it("starts the model call options as an empty object a hook can fill", async () => {
    const model = scripted([ok]);
    const tune = defineExtension({
      name: "tune", hooks: ["modelInput"],
      create: () => ({ hooks: { modelInput: (value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value) || !("options" in value)) return value;
        return { ...value, options: { maxTokens: 16, anthropic: { thinking: { type: "enabled" } } } };
      } } }),
    });
    const runtime = createRuntime({
      agents: { main: { model: "m", extensions: { tune: {} }, hooks: { modelInput: [{ extension: "tune" }] } } },
    }, { directory: ".", models: { m: model }, extensions: { tune } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls[0]?.input.options).toEqual({ maxTokens: 16, anthropic: { thinking: { type: "enabled" } } });
    await runtime.close();
  });
});

describe("tool definitions", () => {
  it("exposes a host tool under its binding key and appends the hint to the description", async () => {
    const model = scripted([ok]);
    const tool: Tool = { name: "internalName", description: "publishes", input: { type: "object" }, execute: () => ({ callId: "x", name: "publish", args: null, content: [] }) };
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: [{ tool: "publish", hint: "show a draft first" }] } },
    }, { directory: ".", models: { m: model }, tools: { publish: tool } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls[0]?.input.tools).toEqual([{ name: "publish", description: "publishes\nshow a draft first", input: { type: "object" } }]);
    await runtime.close();
  });

  it("runs the implementation the binding key names, not the one the tool calls itself", async () => {
    const ran: string[] = [];
    const tool: Tool = {
      name: "internalName", description: "publishes", input: { type: "object" },
      execute: (_input, ctx) => { ran.push(ctx.toolCall.name); return { callId: ctx.toolCall.id, name: ctx.toolCall.name, args: null, content: [] }; },
    };
    const model = scripted([{ message: callMessage("c1", "publish"), finishReason: "tool" }, ok]);
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: ["publish"] } },
    }, { directory: ".", models: { m: model }, tools: { publish: tool } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(ran).toEqual(["publish"]);
    await runtime.close();
  });

  it("describes an agent tool with the target description or a default one", async () => {
    const model = scripted([ok]);
    const runtime = createRuntime({
      agents: {
        main: { model: "m", tools: [{ agent: "billing" }, { agent: "plain" }] },
        billing: { model: "m", description: "handles billing" },
        plain: { model: "m" },
      },
      flow: { in: "main" },
    }, { directory: ".", models: { m: model } });

    await runtime.runTurn("hi", { conversationId: "c", agent: "main" });

    expect(model.calls[0]?.input.tools).toEqual([
      { name: "billing", description: "handles billing", input: { type: "object" } },
      { name: "plain", description: "Run plain", input: { type: "object" } },
    ]);
    await runtime.close();
  });

  it("gives the tool definitions of the model input to a system block template", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    tools: [act]\n    params: {locale: ko-KR}\n    systemMessage: {template: ./sys.md}\n",
      "sys.md": "{{ agent.name }}|{{ model }}|{{ params.locale }}|{{ tools[0].name }}",
    });
    const model = scripted([ok]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, tools: { act: act() } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls[0]?.input.system[0]).toEqual({ text: "main|m|ko-KR|act", source: "system:0" });
    await runtime.close();
  });
});

describe("tool calls", () => {
  it("fails a call the agent's tools list does not expose", async () => {
    const model = scripted([{ message: callMessage("c1", "hidden"), finishReason: "tool" }]);
    const hidden: Tool = { name: "hidden", description: "hidden", input: {}, execute: () => ({ callId: "c1", name: "hidden", args: null, content: [] }) };
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }] } },
    }, { directory: ".", models: { m: model }, tools: { act: act(), hidden } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.where).toBe("tool");
    expect(failure(error)?.codes).toEqual(["tool_unavailable"]);
    // The availability check happens before any approval, so the call made no operation.
    expect(await runtime.listOperations("c")).toEqual([]);
    await runtime.close();
  });

  it("runs a call again when a new response repeats an identifier of an earlier turn", async () => {
    const seen: string[] = [];
    const tool: Tool = { name: "act", description: "act", input: {}, execute: (_input, ctx) => { seen.push(ctx.toolCall.id); return { callId: ctx.toolCall.id, name: "act", args: null, content: [] }; } };
    const model = scripted([
      { message: callMessage("same", "act"), finishReason: "tool" }, ok,
      { message: callMessage("same", "act"), finishReason: "tool" }, ok,
    ]);
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act: tool } });

    await runtime.runTurn("one", { conversationId: "c" });
    await runtime.runTurn("two", { conversationId: "c" });

    expect(seen).toEqual(["same", "same"]);
    await runtime.close();
  });

  it("runs a call again when a new response of the same run repeats an identifier", async () => {
    const seen: string[] = [];
    const tool: Tool = { name: "act", description: "act", input: {}, execute: (_input, ctx) => { seen.push(ctx.toolCall.id); return { callId: ctx.toolCall.id, name: "act", args: null, content: [] }; } };
    const model = scripted([
      { message: { id: "m1", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "same", name: "act", args: null }] }, finishReason: "tool" },
      { message: { id: "m2", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "same", name: "act", args: null }] }, finishReason: "tool" },
      ok,
    ]);
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act: tool } });

    await runtime.runTurn("one", { conversationId: "c" });

    // Only a retry that continues the same batch skips a stored call, so the second response runs.
    expect(seen).toEqual(["same", "same"]);
    await runtime.close();
  });

  it("runs every call of one response, including two that share an identifier", async () => {
    const seen: string[] = [];
    const tool: Tool = { name: "act", description: "act", input: {}, execute: (_input, ctx) => { seen.push(ctx.toolCall.id); return { callId: ctx.toolCall.id, name: "act", args: null, content: [] }; } };
    const model = scripted([
      { message: { id: "m1", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "same", name: "act", args: null }, { type: "tool.call", callId: "same", name: "act", args: null }] }, finishReason: "tool" },
      ok,
    ]);
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act: tool } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(seen).toEqual(["same", "same"]);
    await runtime.close();
  });

  it("announces tool.error when the result of a tool does not have the tool result form", async () => {
    const events: RuntimeEvent[] = [];
    const broken: Tool = { name: "act", description: "act", input: {}, execute: () => untyped<never>('{"callId":"c1","name":"act","args":null,"content":"text"}') };
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]);
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } }, {
      directory: ".", models: { m: model }, tools: { act: broken }, host: { emit: (event) => { events.push(event); } },
    });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.where).toBe("toolResult");
    expect(events.map((event) => event.name).filter((name) => name.startsWith("tool."))).toEqual(["tool.start", "tool.error"]);
    expect(events.find((event) => event.name === "tool.error")?.data.codes).toEqual(["value_invalid"]);
    await runtime.close();
  });

  it("announces tool.error when a required toolResult hook fails after the tool ran", async () => {
    const events: RuntimeEvent[] = [];
    const strict = defineExtension({ name: "strict", hooks: ["toolResult"], create: () => ({ hooks: { toolResult: () => { throw new Error("refused"); } } }) });
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]);
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: ["act"], extensions: { strict: {} }, hooks: { toolResult: [{ extension: "strict" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act: act() }, extensions: { strict },
      host: { emit: (event) => { events.push(event); } },
    });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.codes).toEqual(["hook_error"]);
    expect(events.map((event) => event.name).filter((name) => name.startsWith("tool."))).toEqual(["tool.start", "tool.error"]);
    expect(events.find((event) => event.name === "tool.error")?.data.codes).toEqual(["hook_error"]);
    await runtime.close();
  });

  it("runs an agent tool in the sub-conversation of the parent turn and counts its usage", async () => {
    const conversations: string[] = [];
    const helper: Model = {
      async generate(_input, ctx): Promise<ModelResult> {
        conversations.push(ctx.conversationId);
        return { message: assistant("helped"), finishReason: "stop", usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 } };
      },
    };
    const model = scripted([
      { message: callMessage("c1", "helper"), finishReason: "tool" },
      { message: assistant("done"), finishReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
    ]);
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: [{ agent: "helper" }] }, helper: { model: "h" } },
      flow: { in: "main" },
    }, { directory: ".", models: { m: model, h: helper } });

    const result = await runtime.runTurn("hi", { conversationId: "c", agent: "main" });

    const turnId = model.calls[0]?.ctx.turnId ?? "";
    expect(conversations).toEqual([`c:${turnId}:helper`]);
    expect(result.usage).toEqual({ input: 4, output: 5, cacheRead: 0, cacheWrite: 0 });
    await runtime.close();
  });

  it("turns a failing agent tool into a tool failure of the calling run", async () => {
    const broken: Model = { generate(): Promise<ModelResult> { return Promise.reject(new Error("helper broke")); } };
    const model = scripted([{ message: callMessage("c1", "helper"), finishReason: "tool" }]);
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: [{ agent: "helper" }] }, helper: { model: "h" } },
      flow: { in: "main" },
    }, { directory: ".", models: { m: model, h: broken } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c", agent: "main" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.where).toBe("tool");
    expect(failure(error)?.codes).toEqual(["tool_error"]);
    await runtime.close();
  });
});

describe("the input rule", () => {
  it("uses the function result as it is when it is a string and as JSON text otherwise", async () => {
    const model = scripted([ok, ok]);
    const runtime = createRuntime({
      agents: {
        text: { model: "m", input: { fn: "asText" } },
        value: { model: "m", input: { fn: "asValue" } },
      },
      flow: { in: "text" },
    }, {
      directory: ".", models: { m: model },
      functions: { asText: () => "plain", asValue: () => ({ a: 1, b: [true, null] }) },
    });

    await runtime.runTurn("hi", { conversationId: "c", agent: "text" });
    await runtime.runTurn("hi", { conversationId: "c", agent: "value" });

    expect(model.calls[0]?.input.messages[0]?.content).toEqual([{ type: "text", text: "plain" }]);
    expect(model.calls[1]?.input.messages[0]?.content).toEqual([{ type: "text", text: '{"a":1,"b":[true,null]}' }]);
    await runtime.close();
  });

  it("treats a function that answers with nothing as null", async () => {
    const model = scripted([ok]);
    const runtime = createRuntime({
      agents: { main: { model: "m", input: { fn: "silent" } } },
    }, { directory: ".", models: { m: model }, functions: { silent: () => undefined } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls[0]?.input.messages[0]?.content).toEqual([{ type: "text", text: "null" }]);
    await runtime.close();
  });

  it("prefers the function over the template and names the agent as the message source", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    input: {fn: asText, template: ./in.md}\n",
      "in.md": "from the template",
    });
    const model = scripted([ok]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, functions: { asText: () => "from the function" } });

    await runtime.runTurn("hi", { conversationId: "c" });

    expect(model.calls[0]?.input.messages[0]).toMatchObject({ role: "user", source: "main", content: [{ type: "text", text: "from the function" }] });
    await runtime.close();
  });

  it("reports a failing input function as a runtime error and a result that is not JSON as an invalid value", async () => {
    const model = scripted([ok, ok]);
    const runtime = createRuntime({
      agents: {
        broken: { model: "m", input: { fn: "broken" } },
        odd: { model: "m", input: { fn: "odd" } },
      },
      flow: { in: "broken" },
    }, {
      directory: ".", models: { m: model },
      functions: { broken: () => { throw new Error("no input"); }, odd: () => untyped<Json>("null") ?? Number.POSITIVE_INFINITY },
    });

    const first: unknown = await runtime.runTurn("hi", { conversationId: "c", agent: "broken" }).catch((error: unknown) => error);
    const second: unknown = await runtime.runTurn("hi", { conversationId: "c", agent: "odd" }).catch((error: unknown) => error);

    expect(failure(first)).toMatchObject({ where: "input", codes: ["runtime_error"], message: "no input" });
    expect(failure(second)?.where).toBe("input");
    expect(failure(second)?.codes).toEqual(["value_invalid"]);
    await runtime.close();
  });

  it("gives an object input its keys and any other value the text variable", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  obj: {model: m, input: {template: ./obj.md}}\n  plain: {model: m, input: {template: ./plain.md}}\nflow:\n  in: obj\n",
      "obj.md": "{{ topic }}!",
      "plain.md": "[{{ text }}]",
    });
    const model = scripted([ok, ok]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model } });

    await runtime.runTurn({ topic: "billing" }, { conversationId: "c", agent: "obj" });
    await runtime.runTurn("free text", { conversationId: "c", agent: "plain" });

    expect(model.calls[0]?.input.messages[0]?.content).toEqual([{ type: "text", text: "billing!" }]);
    expect(model.calls[1]?.input.messages[0]?.content).toEqual([{ type: "text", text: "[free text]" }]);
    await runtime.close();
  });
});
