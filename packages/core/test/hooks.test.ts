import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createGoondan, defineExtension, GoondanConfigError, GoondanExecutionError, MemoryConversationStore,
  type ConversationStore, type ExtensionInstance, type HookContext, type Json, type Message,
  type Model, type ModelResult, type Part, type RuntimeEvent, type Tool,
} from "../src/index.ts";

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-hooks-")));
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => { resolve = () => { settle(); }; });
  return { promise, resolve };
}

function assistant(text: string, id = "a"): Message {
  return { id, role: "assistant", source: "model", content: [{ type: "text", text }] };
}

function callMessage(callId: string, name: string, args: Json = null): Message {
  return { id: `m-${callId}`, role: "assistant", source: "model", content: [{ type: "tool.call", callId, name, args }] };
}

interface ModelCall { messages: Message[]; system: string[]; tools: string[]; step: number }

/** A model that answers with the next scripted reply and records what it received. */
function scripted(replies: ModelResult[]): Model & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    calls,
    async generate(input, ctx): Promise<ModelResult> {
      calls.push({ messages: input.messages, system: input.system.map((block) => block.text), tools: input.tools.map((tool) => tool.name), step: ctx.step });
      const reply = replies[calls.length - 1];
      if (!reply) throw new Error(`no scripted reply for call ${String(calls.length)}`);
      return reply;
    },
  };
}

const ok: Model = { async generate(): Promise<ModelResult> { return { message: assistant("ok"), finishReason: "stop" }; } };

function echoTool(name: string): Tool {
  return { name, description: name, input: {}, execute: (input, ctx) => ({ callId: ctx.toolCall.id, name, args: input, content: [{ type: "text", text: `${name} done` }] }) };
}

/** The text of a message that reached a hook as a plain JSON value. */
function textOfValue(value: Json): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return String(value);
  const content = value.content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "object" && part !== null && !Array.isArray(part) && typeof part.text === "string" ? part.text : "")).join("");
}

function texts(messages: readonly Message[]): string[] {
  return messages.map((message) => message.content.map((part: Part) => part.type === "text" ? part.text : "").join(""));
}

describe("value processing stages", () => {
  it("runs the conversation stage once per agent run, not per model call", async () => {
    let conversations = 0; let modelInputs = 0;
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: {
      conversation: [{ fn: "countConversation" }], modelInput: [{ fn: "countModelInput" }],
    } } } }, {
      directory: ".", models: { m: model }, tools: { act: echoTool("act") },
      functions: { countConversation: () => { conversations += 1; return null; }, countModelInput: () => { modelInputs += 1; return null; } },
    });

    await runtime.run("x", { sessionId: "c" });

    expect(conversations).toBe(1);
    expect(modelInputs).toBe(2);
    await runtime.close();
  });

  it("skips an inline input agent result that cannot replace a message array", async () => {
    const main = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const helper = scripted([{ message: assistant("helper"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { input: [{ agent: "helper" }] } },
      helper: { model: "h" },
    } }, { models: { m: main, h: helper } });

    await runtime.run("hi", { sessionId: "s" });

    expect(texts(main.calls[0]?.messages ?? [])).toEqual(["hi"]);
    expect(helper.calls).toHaveLength(1);
    await runtime.close();
  });

  it("ends an inline hook without a result when its fn answers with nothing", async () => {
    let agentRuns = 0;
    const main = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const helper: Model = { async generate(): Promise<ModelResult> { agentRuns += 1; return { message: assistant("h"), finishReason: "stop" }; } };
    const runtime = createGoondan(
      { agents: { main: { model: "m", hooks: { conversation: [{ name: "maybe", fn: "nothing", agent: "helper" }] } }, helper: { model: "h" } } },
      { directory: ".", models: { m: main, h: helper }, functions: { nothing: () => undefined } },
    );

    await runtime.run("hi", { sessionId: "c" });

    expect(agentRuns).toBe(0);
    expect(texts(main.calls[0]?.messages ?? [])).toEqual(["hi"]);
    await runtime.close();
  });

  it("turns an inline result into an appended message, an assistant output or a raw value", async () => {
    const model = scripted([{ message: assistant("reply"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: {
      input: [{ name: "shape", fn: "shape" }],
      conversation: [{ name: "note", fn: "note", role: "system" }],
      output: [{ name: "polish", fn: "polish" }],
    } } } }, {
      directory: ".", models: { m: model },
      // The output stage hands the assistant message itself to the hook.
      functions: {
        shape: () => [{ id: "shaped", role: "user", source: "shape", content: [{ type: "json", value: { said: "hi" } }] }],
        note: () => ({ k: 1 }),
        polish: (value) => `polished ${textOfValue(value)}`,
      },
    });

    const result = await runtime.run({ greeting: "hi" }, { sessionId: "c" });

    const sent = model.calls[0]?.messages ?? [];
    // The input stage keeps the raw value, the conversation stage appends a system message.
    expect(sent.map((message) => [message.role, message.source])).toEqual([["user", "shape"], ["system", "note"]]);
    expect(texts(sent)).toEqual(['{"said":"hi"}', '{"k":1}']);
    expect(result.output.role).toBe("assistant");
    expect(result.output.source).toBe("polish");
    expect(texts([result.output])).toEqual(["polished reply"]);
    await runtime.close();
  });

  it("renders an output template hook over the assistant message itself", async () => {
    const root = workspace({ "out.md": "{{ text.content[0].text }}!" });
    const model = scripted([{ message: assistant("hello"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { output: [{ template: "out.md" }] } } } }, { directory: root, models: { m: model } });

    const result = await runtime.run("x", { sessionId: "c" });

    expect(texts([result.output])).toEqual(["hello!"]);
    expect(result.output.source).toBe("out.md");
    await runtime.close();
  });

  it("gives every hook a copy, so a change without a return has no effect", async () => {
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const probe = defineExtension({ name: "probe", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (value) => { if (Array.isArray(value)) value.length = 0; return null; },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} }, hooks: { conversation: [{ extension: "probe" }] } } } },
      { directory: ".", models: { m: model }, extensions: { probe } });

    await runtime.run("hi", { sessionId: "c" });

    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["hi"]);
    await runtime.close();
  });

  it("chooses the hook's value with using and reports a condition that is not a boolean", async () => {
    const seen: Json[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [
      { name: "first", fn: "add" },
      { name: "watch", using: "conversation", fn: "record" },
      { name: "byInput", using: "input", fn: "record" },
      { name: "byFn", using: { fn: "count" }, fn: "record" },
    ] } } } }, {
      directory: ".", models: { m: model },
      functions: { add: () => "added", record: (value) => { seen.push(value); return null; }, count: (value) => (Array.isArray(value) ? value.length : -1) },
    });

    await runtime.run("hi", { sessionId: "c" });

    // `using: conversation` inside the conversation stage sees the message the first hook appended.
    expect(Array.isArray(seen[0]) ? seen[0].length : 0).toBe(2);
    expect(Array.isArray(seen[1]) ? seen[1].length : 0).toBe(1);
    expect(seen[2]).toBe(2);
    await runtime.close();
  });

  it("skips a hook whose condition is false and fails one whose condition is not a boolean", async () => {
    const events: RuntimeEvent[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { conversation: [{ name: "off", when: { fn: "no" }, fn: "add" }] } },
      broken: { model: "m", hooks: { conversation: [{ name: "odd", when: { fn: "maybe" }, fn: "add" }] } },
    } }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
      functions: { no: () => false, maybe: () => "yes", add: () => "added" },
    });

    await runtime.run("hi", { sessionId: "c" });
    expect(events.filter((event) => event.name === "hook.skipped").map((event) => event.data)).toEqual([{ value: "conversation", hook: "off" }]);
    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["hi"]);

    const error: unknown = await runtime.run("hi", { sessionId: "c2", agent: "broken" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"] });
    expect(events.filter((event) => event.name === "hook.failed").map((event) => event.data.hook)).toEqual(["odd"]);
    await runtime.close();
  });

  it("keeps the earlier value when an optional hook fails and fails the run for a required one", async () => {
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { conversation: [{ name: "soft", fn: "boom", optional: true }, { name: "note", fn: "note" }] } },
      hard: { model: "m", hooks: { conversation: [{ name: "hard", fn: "boom" }] } },
    } }, {
      directory: ".", models: { m: model },
      functions: { boom: () => { throw new Error("hook exploded"); }, note: () => "kept going" },
    });

    await runtime.run("hi", { sessionId: "c" });
    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["hi", "kept going"]);

    const error: unknown = await runtime.run("hi", { sessionId: "c2", agent: "hard" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"], message: "hook exploded" });
    await runtime.close();
  });

  it("tells a hook that its time limit elapsed and fails it", async () => {
    let told = false;
    const release = deferred();
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const slow = defineExtension({ name: "slow", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: async (_value, ctx: HookContext) => {
        await new Promise<void>((settle) => { ctx.signal.addEventListener("abort", () => { told = true; settle(); }, { once: true }); });
        release.resolve();
        return null;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { slow: {} }, hooks: { conversation: [{ extension: "slow", timeout: 5 }] } } } },
      { directory: ".", models: { m: model }, extensions: { slow } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    await release.promise;
    expect(told).toBe(true);
    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"] });
    await runtime.close();
  });

  it("treats an inline hook that declares an agent as optional", async () => {
    const main = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const broken: Model = { async generate(): Promise<ModelResult> { throw new Error("helper failed"); } };
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { conversation: [{ agent: "helper", using: "input" }] } },
      helper: { model: "h" },
    } }, { directory: ".", models: { m: main, h: broken } });

    const result = await runtime.run("hi", { sessionId: "c" });

    expect(texts([result.output])).toEqual(["done"]);
    await runtime.close();
  });

  it("fails an inline hook with the error of the first declared agent, not of the one that failed first", async () => {
    const reached = deferred();
    const late: Model = { async generate(): Promise<ModelResult> { await reached.promise; throw new Error("first failed"); } };
    const early: Model = { async generate(): Promise<ModelResult> { reached.resolve(); throw new Error("second failed"); } };
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { conversation: [{ name: "pair", agent: ["first", "second"], optional: false }] } },
      first: { model: "f" }, second: { model: "s" },
    } }, { directory: ".", models: { m: ok, f: late, s: early } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toEqual({ where: "conversation", codes: ["hook_error"], message: "first failed" });
    await runtime.close();
  });

  it("keeps the error of the first declared agent when a later one ended aborted", async () => {
    const broken: Model = { async generate(): Promise<ModelResult> { throw new Error("first failed"); } };
    const caller = scripted([{ message: callMessage("c1", "stop"), finishReason: "tool" }]);
    // What an agent tool whose target run was stopped carries out of the tool: an abort, not a tool failure.
    const stop: Tool = {
      name: "stop", description: "stop", input: {},
      execute: () => { throw new GoondanExecutionError({ where: "runtime", codes: ["aborted"], message: "aborted" }); },
    };
    const events: RuntimeEvent[] = [];
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { conversation: [{ name: "pair", agent: ["first", "second"], optional: false }] } },
      first: { model: "f" }, second: { model: "s", tools: ["stop"] },
    } }, { directory: ".", models: { m: ok, f: broken, s: caller }, tools: { stop }, host: { emit: (event) => { events.push(event); } } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    // The later target really ended aborted, and the earlier one with an ordinary execution error.
    const ended = events.filter((event) => event.name === "turn.error").map((event) => `${event.agent}:${String(event.data.codes)}`);
    expect(ended).toContain("second:aborted");
    expect(ended).toContain("first:model_error");
    // Declaration order alone chooses the reported failure; the kind of the later failure is no criterion.
    expect(failure(error)).toEqual({ where: "conversation", codes: ["hook_error"], message: "first failed" });
    await runtime.close();
  });

  it("keeps the message of a retried model result out of the conversation", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: assistant("try one", "one"), finishReason: "stop" }, { message: assistant("try two", "two"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { modelResult: [{ name: "once", fn: "once" }] } } } }, {
      directory: ".", models: { m: model }, conversationStore: store,
      functions: { once: (value) => (model.calls.length === 1 ? { retry: true, target: "model" } : value) },
    });

    await runtime.run("hi", { sessionId: "c" });

    expect(texts(await store.load("c", "main"))).toEqual(["hi", "try two"]);
    await runtime.close();
  });

  it("keeps a modelInput append out of the conversation and replaces the stored reply", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: assistant("raw"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: {
      modelInput: [{ name: "extra", fn: "note" }],
      output: [{ name: "polish", fn: "polish" }],
    } } } }, {
      directory: ".", models: { m: model }, conversationStore: store,
      functions: { note: () => "for this call only", polish: () => "polished" },
    });

    await runtime.run("hi", { sessionId: "c" });

    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["hi", "for this call only"]);
    expect(texts(await store.load("c", "main"))).toEqual(["hi", "polished"]);
    await runtime.close();
  });

  it("leaves the stored model reply in place when the output stage fails", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: assistant("raw"), finishReason: "stop" }]);
    const broken = defineExtension({ name: "broken", hooks: ["output"], create: () => ({ hooks: { output: () => "not a message" } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { broken: {} }, hooks: { output: [{ extension: "broken" }] } } } },
      { directory: ".", models: { m: model }, conversationStore: store, extensions: { broken } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "output", codes: ["hook_error"] });
    expect(texts(await store.load("c", "main"))).toEqual(["hi", "raw"]);
    await runtime.close();
  });

  it("stores the array a conversation hook returned as the whole conversation", async () => {
    const store = new MemoryConversationStore();
    await store.append("c", "main", [{ id: "old", role: "user", source: "main", content: [{ type: "text", text: "stale" }] }]);
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const trim = defineExtension({ name: "trim", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (value) => (Array.isArray(value) ? value.slice(-1) : value),
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { trim: {} }, hooks: { conversation: [{ extension: "trim" }] } } } },
      { directory: ".", models: { m: model }, conversationStore: store, extensions: { trim } });

    await runtime.run("hi", { sessionId: "c" });

    expect(texts(await store.load("c", "main"))).toEqual(["hi", "done"]);
    await runtime.close();
  });

  it("carries the keep and meta of a tool result onto the stored message", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { toolResult: [{ name: "mark", fn: "mark" }] } } } }, {
      directory: ".", models: { m: model }, tools: { act: echoTool("act") }, conversationStore: store,
      functions: { mark: (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, keep: true, meta: { note: "kept" } } : value) },
    });

    await runtime.run("hi", { sessionId: "c" });

    const stored = (await store.load("c", "main")).find((message) => message.role === "tool");
    expect(stored).toMatchObject({ source: "tool", keep: true, meta: { note: "kept" } });
    // A tool result without a `key` never adds the field to the stored message.
    expect(stored !== undefined && Object.hasOwn(stored, "key")).toBe(false);
    await runtime.close();
  });
});

describe("control results", () => {
  it("adds messages with append and leaves out a repeat of the last message of the same source", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: assistant("first"), finishReason: "stop" }, { message: assistant("second"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [{ name: "memo", fn: "memo" }] } } } },
      { directory: ".", models: { m: model }, conversationStore: store, functions: { memo: () => "remember this" } });

    await runtime.run("one", { sessionId: "c" });
    await runtime.run("two", { sessionId: "c" });

    // The second run produces the same text, which the duplicate check leaves out.
    expect(texts(await store.load("c", "main")).filter((text) => text === "remember this")).toHaveLength(1);
    expect(texts(model.calls[1]?.messages ?? [])).toEqual(["one", "remember this", "first", "two"]);
    await runtime.close();
  });

  it("replaces the tool call, adds an approval reason and supplies a tool result", async () => {
    const executions: Json[] = [];
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => { executions.push(ctx.execution); return { callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "ran" }] }; } };
    const model = scripted([
      { message: callMessage("c1", "act", { a: 1 }), finishReason: "tool" },
      { message: assistant("after"), finishReason: "stop" },
    ]);
    const control = defineExtension({ name: "control", hooks: ["toolCall"], create: () => ({ hooks: {
      toolCall: (value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
        return { call: { ...value, args: { a: 2 } }, execution: { trace: "one" } };
      },
    } }) });
    const second = defineExtension({ name: "second", hooks: ["toolCall"], create: () => ({ hooks: { toolCall: (value) => ({ call: value, execution: { trace: "two" } }) } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], extensions: { control: {}, second: {} }, hooks: { toolCall: [{ extension: "control" }, { extension: "second" }] } } } },
      { directory: ".", models: { m: model }, tools: { act }, extensions: { control, second } });

    await runtime.run("go", { sessionId: "c" });

    // The last execution replaces the earlier one.
    expect(executions).toEqual([{ trace: "two" }]);
    await runtime.close();
  });

  it("skips the tool and the approval when a toolCall hook returns a result", async () => {
    let ran = false;
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => { ran = true; return { callId: ctx.toolCall.id, name: "act", args: input, content: [] }; } };
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("after"), finishReason: "stop" }]);
    const short = defineExtension({ name: "short", hooks: ["toolCall"], create: () => ({ hooks: {
      toolCall: () => ({ result: { callId: "c1", name: "act", args: null, content: [{ type: "text", text: "cached" }] } }),
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], extensions: { short: {} }, hooks: { toolCall: [{ extension: "short" }, { extension: "short", name: "never" }] } } } },
      { directory: ".", models: { m: model }, tools: { act }, extensions: { short } });

    await runtime.run("go", { sessionId: "c" });

    expect(ran).toBe(false);
    expect(await runtime.listOperations("c")).toEqual([]);
    const sent = model.calls[1]?.messages ?? [];
    expect(sent[sent.length - 1]?.content).toEqual([{ type: "tool.result", callId: "c1", content: [{ type: "text", text: "cached" }] }]);
    await runtime.close();
  });

  it("compares a new message with the last one of the same source and key, not the previous message", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([
      { message: callMessage("c1", "act"), finishReason: "tool" },
      { message: assistant("first"), finishReason: "stop" },
      { message: assistant("second"), finishReason: "stop" },
    ]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { conversation: [{ name: "memo", fn: "memo" }] } } } },
      { directory: ".", models: { m: model }, tools: { act: echoTool("act") }, conversationStore: store, functions: { memo: () => "remember this" } });

    await runtime.run("one", { sessionId: "c" });
    await runtime.run("two", { sessionId: "c" });

    // A tool result and an assistant message sit between the two candidates, which are still compared.
    expect(texts(await store.load("c", "main")).filter((text) => text === "remember this")).toHaveLength(1);
    await runtime.close();
  });

  it("adds an approval reason before the tool's own one and creates one operation", async () => {
    let ran = false;
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => { ran = true; return { callId: ctx.toolCall.id, name: "act", args: input, content: [] }; } };
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("waiting"), finishReason: "stop" }]);
    const gate = defineExtension({ name: "gate", hooks: ["toolCall"], create: () => ({ hooks: { toolCall: () => ({ approval: { reason: "policy asks" } }) } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], extensions: { gate: {} }, hooks: { toolCall: [{ extension: "gate" }] } } } },
      { directory: ".", models: { m: model }, tools: { act }, extensions: { gate } });

    await runtime.run("go", { sessionId: "c" });

    expect(ran).toBe(false);
    const [operation] = await runtime.listOperations("c");
    expect(operation?.reasons).toEqual(["policy asks", "Tool act requires approval"]);
    await runtime.close();
  });

  it("retries the failed tool call from the error stage and then the remaining calls", async () => {
    const attempts: string[] = [];
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => {
      attempts.push(ctx.toolCall.id);
      if (ctx.toolCall.id === "c1" && attempts.length === 1) throw new Error("tool is unwell");
      return { callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "ran" }] };
    } };
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "act", args: null }, { type: "tool.call", callId: "c2", name: "act", args: null }] }, finishReason: "tool" },
      { message: assistant("after"), finishReason: "stop" },
    ]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { error: [{ name: "again", fn: "again" }] } } } },
      { directory: ".", models: { m: model }, tools: { act }, functions: { again: () => ({ retry: true, target: "tool", afterMs: 0 }) } });

    const result = await runtime.run("go", { sessionId: "c" });

    expect(attempts).toEqual(["c1", "c1", "c2"]);
    expect(texts([result.output])).toEqual(["after"]);
    await runtime.close();
  });

  it("fails a hook that returns a malformed control result and keeps an unrelated shape as a value", async () => {
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    // A message without a `source` does not satisfy the schema, so the append result is malformed.
    const bad = defineExtension({ name: "bad", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: () => ({ append: [{ id: "x", role: "user", content: [] }] }),
    } }) });
    const runtime = createGoondan({ agents: {
      bad: { model: "m", extensions: { bad: {} }, hooks: { conversation: [{ extension: "bad" }] } },
      plain: { model: "m", hooks: { input: [{ name: "shape", fn: "retryShape" }] } },
    } }, {
      directory: ".", models: { m: model }, extensions: { bad },
      functions: { retryShape: () => [{ id: "retry", role: "user", source: "shape", content: [{ type: "json", value: { retry: true, target: "model" } }] }] },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"] });

    // The same shape outside its stages is an ordinary value, so it becomes the agent input.
    await runtime.run({ request: "hi" }, { sessionId: "c2", agent: "plain" });
    expect(texts(model.calls[0]?.messages ?? [])).toEqual(['{"retry":true,"target":"model"}']);
    await runtime.close();
  });

  it("retries the model from a modelResult hook and fails the hook once the limit is reached", async () => {
    const model = scripted([
      { message: assistant("one", "one"), finishReason: "stop" },
      { message: assistant("two", "two"), finishReason: "stop" },
      { message: assistant("three", "three"), finishReason: "stop" },
    ]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { modelResult: [{ name: "again", fn: "again" }] } } } }, {
      directory: ".", models: { m: model }, maxRetries: 1,
      functions: { again: (value) => (typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.message === "object" && value.message !== null && !Array.isArray(value.message) && value.message.id === "one" ? { retry: true, target: "model" } : null) },
    });

    const result = await runtime.run("hi", { sessionId: "c" });

    // The retried message is not stored, so the second answer is the one the run reports.
    expect(texts([result.output])).toEqual(["two"]);
    expect(model.calls).toHaveLength(2);

    const always = createGoondan({ agents: { main: { model: "m", hooks: { modelResult: [{ name: "always", fn: "always" }] } } } }, {
      directory: ".", models: { m: scripted([{ message: assistant("a"), finishReason: "stop" }, { message: assistant("b"), finishReason: "stop" }]) },
      maxRetries: 1, functions: { always: () => ({ retry: true, target: "model" }) },
    });
    const error: unknown = await always.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "modelResult", codes: ["hook_error"] });
    await runtime.close();
    await always.close();
  });

  it("replaces the execution an earlier call result attached with the value of the last one", async () => {
    let seen: Json = null;
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => { seen = ctx.execution; return { callId: ctx.toolCall.id, name: "act", args: input, content: [] }; } };
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { toolCall: [
      { name: "one", fn: "first" }, { name: "two", fn: "second" },
    ] } } } }, {
      directory: ".", models: { m: model }, tools: { act },
      functions: {
        first: (value) => ({ call: value, execution: { from: "first" } }),
        second: (value) => ({ call: value, execution: { from: "second" } }),
      },
    });

    await runtime.run("hi", { sessionId: "c" });

    expect(seen).toEqual({ from: "second" });
    await runtime.close();
  });

  it("fails a hook whose approval result carries a key the form does not allow", async () => {
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { toolCall: [{ name: "ask", fn: "ask" }] } } } }, {
      directory: ".", models: { m: model }, tools: { act: echoTool("act") },
      functions: { ask: () => ({ approval: { reason: "why", extra: true } }) },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "toolCall", codes: ["hook_error"] });
    await runtime.close();
  });

  it("fails a hook whose tool result names another call", async () => {
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { toolCall: [{ name: "wrong", fn: "wrong" }] } } } }, {
      directory: ".", models: { m: model }, tools: { act: echoTool("act") },
      functions: { wrong: () => ({ result: { callId: "other", name: "act", args: null, content: [] } }) },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "toolCall", codes: ["hook_error"] });
    await runtime.close();
  });

  it("leaves the messages already in the list in place and skips only the repeats it would add", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: assistant("one"), finishReason: "stop" }, { message: assistant("two"), finishReason: "stop" }]);
    const twice = defineExtension({ name: "twice", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (_value, ctx: HookContext) => ctx.append(ctx.message.user("same"), ctx.message.user("same"), ctx.message.user("other")),
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { twice: {} }, hooks: { conversation: [{ extension: "twice" }] } } } },
      { directory: ".", models: { m: model }, conversationStore: store, extensions: { twice } });

    await runtime.run("hi", { sessionId: "c" });
    await runtime.run("again", { sessionId: "c" });

    // The repeat is left out only while it is the last message of its source, and nothing is removed.
    expect(texts(await store.load("c", "main"))).toEqual(["hi", "same", "other", "one", "again", "same", "other", "two"]);
    await runtime.close();
  });

  it("never runs a call whose result the run already stored again after a tool retry", async () => {
    let acted = 0;
    const model = scripted([{ message: { id: "a", role: "assistant", source: "model", content: [
      { type: "tool.call", callId: "c1", name: "act", args: null },
      { type: "tool.call", callId: "c2", name: "boom", args: null },
    ] }, finishReason: "tool" }]);
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => { acted += 1; return { callId: ctx.toolCall.id, name: "act", args: input, content: [] }; } };
    const boom: Tool = { name: "boom", description: "boom", input: {}, execute: () => { throw new Error("boom"); } };
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act", "boom"], hooks: { error: [{ name: "again", fn: "again" }] } } } }, {
      directory: ".", models: { m: model }, tools: { act, boom },
      functions: { again: () => ({ retry: true, target: "tool" }) },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(acted).toBe(1);
    expect(failure(error)).toMatchObject({ where: "tool" });
    await runtime.close();
  });
});

describe("the error stage", () => {
  it("runs once for a model failure and retries where the error hook asks", async () => {
    const events: RuntimeEvent[] = [];
    const seen: Json[] = [];
    let attempts = 0;
    const model: Model = { async generate(): Promise<ModelResult> {
      attempts += 1;
      if (attempts === 1) throw new Error("model is unwell");
      return { message: assistant("recovered"), finishReason: "stop" };
    } };
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { error: [{ name: "retry", fn: "retry" }] } } } }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
      functions: { retry: (value) => { seen.push(value); return { retry: true, target: "model" }; } },
    });

    const result = await runtime.run("hi", { sessionId: "c" });

    expect(texts([result.output])).toEqual(["recovered"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ where: "model", codes: ["model_error"], message: "model is unwell", attempt: 1 });
    expect(events.some((event) => event.name === "turn.error")).toBe(false);
    await runtime.close();
  });

  it("never sends a hook failure to the error stage and keeps the reported failure", async () => {
    const seen: Json[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: {
      conversation: [{ name: "boom", fn: "boom" }], error: [{ name: "watch", fn: "watch" }],
    } } } }, {
      directory: ".", models: { m: model },
      functions: { boom: () => { throw new Error("no"); }, watch: (value) => { seen.push(value); return "changed"; } },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(seen).toEqual([]);
    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"] });
    await runtime.close();
  });

  it("keeps the original failure when the error hook changes the value without asking for a retry", async () => {
    const model: Model = { async generate(): Promise<ModelResult> { throw new Error("still unwell"); } };
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { error: [{ name: "note", fn: "note" }] } } } },
      { directory: ".", models: { m: model }, functions: { note: () => ({ where: "runtime", codes: ["other"], message: "rewritten" }) } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "model", codes: ["model_error"], message: "still unwell" });
    await runtime.close();
  });

  it("announces step.done before the modelResult stage and step.error for an invalid result", async () => {
    const events: RuntimeEvent[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { modelResult: [{ name: "watch", fn: "watch" }] } } } },
      { directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } }, functions: { watch: () => null } });
    await runtime.run("hi", { sessionId: "c" });
    expect(events.map((event) => event.name).filter((name) => name.startsWith("step.") || name.startsWith("hook.")))
      .toEqual(["step.start", "step.done", "hook.applied"]);
    await runtime.close();

    events.length = 0;
    const broken: Model = { async generate(): Promise<ModelResult> { return { message: { id: "a", role: "user", source: "model", content: [] }, finishReason: "stop" }; } };
    const second = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: broken }, host: { emit: (event) => { events.push(event); } } });
    await second.run("hi", { sessionId: "c" }).catch(() => undefined);
    expect(events.filter((event) => event.name === "step.error").map((event) => event.data.codes)).toEqual([["value_invalid"]]);
    expect(events.some((event) => event.name === "step.done")).toBe(false);
    await second.close();
  });

  it("reports an invalid model or tool result as value_invalid of its own stage", async () => {
    const broken: Model = { async generate(): Promise<ModelResult> { return { message: assistant("x"), finishReason: "other", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: Number.NaN } }; } };
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: broken } });
    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "modelResult", codes: ["value_invalid"] });
    await runtime.close();

    const badTool: Tool = { name: "act", description: "act", input: {}, execute: () => ({ callId: "other", name: "act", args: null, content: [] }) };
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("after"), finishReason: "stop" }]);
    const second = createGoondan({ agents: { main: { model: "m", tools: ["act"] } } }, { directory: ".", models: { m: model }, tools: { act: badTool } });
    const toolError: unknown = await second.run("go", { sessionId: "c" }).catch((cause: unknown) => cause);
    expect(failure(toolError)).toMatchObject({ where: "toolResult", codes: ["value_invalid"] });
    await second.close();
  });

  it("hands the execution error of the failed call to the stage as a JSON value", async () => {
    let seen: Json = null;
    const model: Model = { async generate(): Promise<ModelResult> { throw new Error("model down"); } };
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { error: [{ name: "watch", fn: "watch" }] } } } }, {
      directory: ".", models: { m: model },
      functions: { watch: (value) => { seen = value; return null; } },
    });

    await runtime.run("hi", { sessionId: "c" }).catch(() => undefined);

    expect(seen).toMatchObject({ where: "model", codes: ["model_error"], message: "model down", attempt: 1 });
    await runtime.close();
  });
});

describe("asynchronous hooks", () => {
  it("never blocks the turn and adds its message at the next safe conversation point", async () => {
    const store = new MemoryConversationStore();
    const release = deferred();
    const model = scripted([{ message: assistant("one"), finishReason: "stop" }, { message: assistant("two"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [{ name: "later", fn: "later", mode: "async" }] } } } }, {
      directory: ".", models: { m: model }, conversationStore: store,
      functions: { later: async () => { await release.promise; return "from the background"; } },
    });

    await runtime.run("one", { sessionId: "c" });
    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["one"]);

    release.resolve();
    await runtime.idle();
    await runtime.run("two", { sessionId: "c" });

    // The result of the first turn's task reaches the conversation of the second turn.
    // The user message of the new turn is stored before the safe point that applies the result.
    expect(texts(model.calls[1]?.messages ?? [])).toEqual(["one", "one", "two", "from the background"]);
    await runtime.close();
  });

  it("schedules one task per identifier and never fails a turn when it fails", async () => {
    const events: RuntimeEvent[] = [];
    const release = deferred();
    let started = 0;
    const model = scripted([{ message: assistant("one"), finishReason: "stop" }, { message: assistant("two"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [{ name: "slow", fn: "slow", mode: "async" }] } } } }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
      functions: { slow: async () => { started += 1; await release.promise; throw new Error("background failed"); } },
    });

    await runtime.run("one", { sessionId: "c" });
    await runtime.run("two", { sessionId: "c" });
    expect(started).toBe(1);

    release.resolve();
    await runtime.idle();

    const failed = events.filter((event) => event.name === "hook.failed");
    expect(failed.map((event) => event.data.hook)).toEqual(["slow"]);
    expect(failed[0]?.turnId).toBe(events.find((event) => event.name === "turn.start")?.turnId);
    await runtime.close();
  });

  it("tells a running asynchronous hook that the runtime closed", async () => {
    let told = false;
    const stopped = deferred();
    const model = scripted([{ message: assistant("one"), finishReason: "stop" }]);
    const slow = defineExtension({ name: "slow", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: async (_value, ctx: HookContext) => {
        await new Promise<void>((settle) => { ctx.signal.addEventListener("abort", () => { told = true; settle(); }, { once: true }); });
        stopped.resolve();
        return null;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { slow: {} }, hooks: { conversation: [{ extension: "slow", mode: "async" }] } } } },
      { directory: ".", models: { m: model }, extensions: { slow } });

    await runtime.run("one", { sessionId: "c" });
    await runtime.close();
    await stopped.promise;

    expect(told).toBe(true);
  });

  it("does not schedule an asynchronous hook whose condition is false", async () => {
    const events: RuntimeEvent[] = [];
    let started = 0;
    const model = scripted([{ message: assistant("one"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [{ name: "later", when: { fn: "no" }, fn: "later", mode: "async" }] } } } }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
      functions: { no: () => false, later: () => { started += 1; return "x"; } },
    });

    await runtime.run("one", { sessionId: "c" });
    await runtime.idle();

    expect(started).toBe(0);
    expect(events.filter((event) => event.name === "hook.skipped")).toHaveLength(1);
    await runtime.close();
  });

  it("fails a turn requested after close with a runtime error", async () => {
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: ok } });
    await runtime.close();
    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "runtime", codes: ["runtime_error"] });
  });

  it("gives the task the conversation of the moment it was scheduled", async () => {
    let seen: readonly Message[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const watch = defineExtension({ name: "watch", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (_value, ctx: HookContext) => { seen = ctx.conversation; return null; },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { watch: {} }, hooks: { conversation: [
      { name: "first", fn: "note" },
      { name: "second", extension: "watch", mode: "async" },
    ] } } } }, { directory: ".", models: { m: model }, extensions: { watch }, functions: { note: () => "added" } });

    await runtime.run("hi", { sessionId: "c" });
    await runtime.idle();

    // The append of the earlier hook belongs to the conversation the task was scheduled with.
    expect(texts(seen)).toEqual(["hi", "added"]);
    await runtime.close();
  });

  it("announces a failure and schedules nothing when the condition is not a boolean", async () => {
    const events: RuntimeEvent[] = [];
    let started = 0;
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [
      { name: "later", fn: "later", when: { fn: "maybe" }, mode: "async" },
    ] } } } }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
      functions: { later: () => { started += 1; return "text"; }, maybe: () => 1 },
    });

    await runtime.run("hi", { sessionId: "c" });
    await runtime.idle();

    expect(started).toBe(0);
    expect(events.filter((event) => event.name === "hook.failed").map((event) => event.data.hook)).toEqual(["later"]);
    await runtime.close();
  });

  it("leaves out a result that is still the last message of its source", async () => {
    const store = new MemoryConversationStore();
    const model = scripted([{ message: assistant("one"), finishReason: "stop" }, { message: assistant("two"), finishReason: "stop" }, { message: assistant("three"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [{ name: "note", fn: "same", mode: "async" }] } } } }, {
      directory: ".", models: { m: model }, conversationStore: store,
      functions: { same: () => "constant" },
    });

    for (const input of ["one", "two", "three"]) {
      await runtime.run(input, { sessionId: "c" });
      await runtime.idle();
    }

    expect(texts(await store.load("c", "main"))).toEqual(["one", "one", "two", "constant", "two", "three", "three"]);
    await runtime.close();
  });

  it("applies a finished task at the next model call of the same agent run", async () => {
    const store = new MemoryConversationStore();
    const release = deferred();
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], hooks: { conversation: [{ name: "later", fn: "later", mode: "async" }] } } } }, {
      directory: ".", models: { m: model }, tools: { act: echoTool("act") }, conversationStore: store,
      functions: { later: async () => { await release.promise; return "from the background"; } },
    });

    release.resolve();
    await runtime.run("hi", { sessionId: "c" });
    await runtime.idle();

    // The safe point before the second model call is inside the same run, not the next turn.
    // The assistant call and the tool result carry no text part, so only the first and last have one.
    expect(texts(model.calls[1]?.messages ?? [])).toEqual(["hi", "", "", "from the background"]);
    await runtime.close();
  });

  it("keeps the runs a task started out of the turn record and its usage", async () => {
    const model = scripted([{ message: assistant("done"), usage: { input: 2 }, finishReason: "stop" }]);
    const helper = scripted([{ message: assistant("helped"), usage: { input: 7 }, finishReason: "stop" }]);
    const runtime = createGoondan({ agents: {
      main: { model: "m", hooks: { conversation: [{ name: "late", agent: "helper", using: "input", mode: "async" }] } },
      helper: { model: "h" },
    } }, { directory: ".", models: { m: model, h: helper } });

    const result = await runtime.run("hi", { sessionId: "c" });
    await runtime.idle();

    expect(result.runs.map((entry) => entry.agent)).toEqual(["main"]);
    expect(result.usage.input).toBe(2);
    expect(helper.calls).toHaveLength(1);
    await runtime.close();
  });
});

describe("the hook context", () => {
  it("exposes the shared public surface, model step, cancellation signal and logger", async () => {
    const surfaces: string[][] = [];
    const steps: Array<number | undefined> = [];
    const cancelled: boolean[] = [];
    const logs: string[] = [];
    const executionSurfaces: string[][] = [];
    const messageSurfaces: string[][] = [];
    const inspect = (_value: unknown, ctx: HookContext): null => {
      surfaces.push(Object.keys(ctx).sort());
      executionSurfaces.push(Object.keys(ctx.execution).sort());
      messageSurfaces.push(Object.keys(ctx.message).sort());
      steps.push(ctx.step);
      cancelled.push(ctx.signal.aborted);
      ctx.log.info("hook", { step: ctx.step ?? null });
      return null;
    };
    const probe = defineExtension({ name: "probe", hooks: ["conversation", "modelResult"], create: () => ({ hooks: {
      conversation: inspect,
      modelResult: inspect,
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} }, hooks: {
      conversation: [{ extension: "probe" }], modelResult: [{ extension: "probe" }],
    } } } }, {
      models: { m: scripted([{ message: assistant("done"), finishReason: "stop" }]) },
      extensions: { probe },
      logger: { info: (message) => { logs.push(message); }, warn() {}, error() {} },
    });

    await runtime.run("hi", { sessionId: "c" });

    const expected = [
      "agent", "agents", "append", "conversation", "execution", "input", "log", "message",
      "model", "render", "retryCount", "sessionId", "signal", "step", "turnId",
    ];
    expect(surfaces).toEqual([expected, expected]);
    expect(executionSurfaces).toEqual([["complete"], ["complete"]]);
    expect(messageSurfaces).toEqual([["system", "user"], ["system", "user"]]);
    expect(steps).toEqual([undefined, 1]);
    expect(cancelled).toEqual([false, false]);
    expect(logs).toEqual(["hook", "hook"]);
    await runtime.close();
  });

  it("updates the hook cancellation signal when the current turn is aborted", async () => {
    let cancelled = false;
    let runtime: ReturnType<typeof createGoondan>;
    const probe = defineExtension({ name: "probe", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (_value, ctx: HookContext) => {
        runtime.abort("c");
        cancelled = ctx.signal.aborted;
        return null;
      },
    } }) });
    runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} }, hooks: {
      conversation: [{ extension: "probe" }],
    } } } }, { models: { m: ok }, extensions: { probe } });

    await expect(runtime.run("hi", { sessionId: "c" })).rejects.toMatchObject({ codes: ["aborted"] });

    expect(cancelled).toBe(true);
    await runtime.close();
  });

  it("carries the agent path, the conversation, a copy of the input and the hook's message source", async () => {
    let captured: { agent: string; conversation: number; input: Message[]; turnId: string } | undefined;
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const probe = defineExtension({ name: "probe", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (_value, ctx: HookContext) => {
        captured = { agent: ctx.agent, conversation: ctx.conversation.length, input: ctx.input, turnId: ctx.turnId };
        return ctx.append(ctx.message.system("from the extension", { key: "note" }));
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} }, hooks: { conversation: [{ name: "memo", extension: "probe" }] } } } },
      { directory: ".", models: { m: model }, extensions: { probe } });

    await runtime.run({ ask: "why" }, { sessionId: "c" });

    expect(captured).toMatchObject({ agent: "main", conversation: 1, input: [{ role: "user", content: [{ type: "text", text: '{"ask":"why"}' }] }] });
    const added = (model.calls[0]?.messages ?? [])[1];
    expect(added).toMatchObject({ role: "system", source: "memo", key: "note" });
    await runtime.close();
  });

  it("calls the model once from a hook without stage hooks or stored messages", async () => {
    const store = new MemoryConversationStore();
    const seen: ModelCall[] = [];
    const model = scripted([{ message: assistant("aside"), finishReason: "stop" }, { message: assistant("done"), finishReason: "stop" }]);
    const probe = defineExtension({ name: "probe", hooks: ["modelInput"], create: () => ({ hooks: {
      modelInput: async (_value, ctx: HookContext) => {
        const result = await ctx.model.run([{ id: "q", role: "user", source: "probe", content: [{ type: "text", text: "quick question" }] }]);
        seen.push({ messages: [result.message], system: [], tools: [], step: 0 });
        return null;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], extensions: { probe: {} }, systemMessage: { text: "S" }, hooks: {
      modelInput: [{ extension: "probe" }, { name: "note", fn: "note" }],
    } } } }, { directory: ".", models: { m: model }, tools: { act: echoTool("act") }, conversationStore: store, extensions: { probe }, functions: { note: () => "added later" } });

    await runtime.run("hi", { sessionId: "c" });

    // The hook's call carries the system blocks and tools from before the modelInput hooks.
    expect(model.calls[0]).toMatchObject({ system: ["S"], tools: ["act"] });
    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["quick question"]);
    expect(texts(seen[0]?.messages ?? [])).toEqual(["aside"]);
    // Nothing the hook's model call produced reaches the conversation.
    expect(texts(await store.load("c", "main"))).toEqual(["hi", "done"]);
    await runtime.close();
  });

  it("schedules the final message of a run from a synchronous toolResult hook", async () => {
    const store = new MemoryConversationStore();
    let late: (() => void) | undefined;
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "act", args: null }, { type: "tool.call", callId: "c2", name: "act", args: null }] }, finishReason: "tool" },
    ]);
    const policy = defineExtension({ name: "policy", hooks: ["toolResult"], create: () => ({ hooks: {
      toolResult: (value, ctx: HookContext) => {
        if (!late) {
          ctx.execution.complete({ id: "final", role: "assistant", source: "policy", content: [{ type: "text", text: "enough" }] });
          late = () => { ctx.execution.complete({ id: "again", role: "assistant", source: "policy", content: [] }); };
        }
        return value;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], extensions: { policy: {} }, hooks: { toolResult: [{ extension: "policy" }] } } } },
      { directory: ".", models: { m: model }, tools: { act: echoTool("act") }, conversationStore: store, extensions: { policy } });

    const result = await runtime.run("go", { sessionId: "c" });

    // The remaining call of the same response is still processed, and the model is not called again.
    expect(model.calls).toHaveLength(1);
    expect(result.finishReason).toBe("tool");
    expect(texts([result.output])).toEqual(["enough"]);
    expect((await store.load("c", "main")).filter((message) => message.role === "tool")).toHaveLength(2);
    // A context kept past its hook can no longer schedule anything.
    expect(() => late?.()).toThrow("execution.complete");
    await runtime.close();
  });

  it("checks execution.complete in an approved operation but leaves the operation unchanged", async () => {
    const calls: string[] = [];
    const act: Tool = { name: "act", description: "act", input: {}, execute: (input, ctx) => ({ callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "acted" }] }) };
    const model = scripted([
      { message: callMessage("c1", "act"), finishReason: "tool" },
      { message: assistant("waiting"), finishReason: "stop" },
      { message: assistant("after"), finishReason: "stop" },
    ]);
    const policy = defineExtension({ name: "policy", hooks: ["toolResult"], create: () => ({ hooks: {
      toolResult: (value, ctx: HookContext) => {
        calls.push("toolResult");
        ctx.execution.complete({ id: "final", role: "assistant", source: "policy", content: [{ type: "text", text: "enough" }] });
        return value;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], extensions: { policy: {} }, hooks: { toolResult: [{ extension: "policy" }] } } } },
      { directory: ".", models: { m: model }, tools: { act }, extensions: { policy } });

    await runtime.run("go", { sessionId: "c" });
    const [operation] = await runtime.listOperations("c");
    await runtime.decideOperation("c", operation?.operationId ?? "", { decision: "approved" });
    await runtime.idle();

    const [settled] = await runtime.listOperations("c");
    expect(settled?.status).toBe("completed");
    // The pending tool result never reaches the stage, so the hook only sees the approved result.
    expect(calls).toEqual(["toolResult"]);
    await runtime.close();
  });

  it("rejects execution.complete outside a synchronous toolResult hook", async () => {
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const probe = defineExtension({ name: "probe", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: (_value, ctx: HookContext) => { ctx.execution.complete({ id: "x", role: "assistant", source: "probe", content: [] }); return null; },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} }, hooks: { conversation: [{ extension: "probe" }] } } } },
      { directory: ".", models: { m: model }, extensions: { probe } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"] });
    await runtime.close();
  });

  it("fails an agents.run that names an agent the configuration does not declare", async () => {
    let message: string | undefined;
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const call = defineExtension({ name: "call", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: async (_value, ctx: HookContext) => {
        try { await ctx.agents.run("nope", "go"); } catch (error) { message = error instanceof Error ? error.message : String(error); }
        return null;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { call: {} }, hooks: { conversation: [{ extension: "call" }] } } } },
      { directory: ".", models: { m: model }, extensions: { call } });

    await runtime.run("hi", { sessionId: "c" });

    expect(message).toBe("Unknown agent: nope");
    await runtime.close();
  });

  it("records a hook run and a model run for the calls a synchronous hook made", async () => {
    const model = scripted([{ message: assistant("probe"), usage: { input: 1, output: 1 }, finishReason: "stop" }, { message: assistant("done"), usage: { input: 1, output: 1 }, finishReason: "stop" }]);
    const helper = scripted([{ message: assistant("helped"), usage: { input: 1, output: 1 }, finishReason: "stop" }]);
    const call = defineExtension({ name: "call", hooks: ["conversation"], create: () => ({ hooks: {
      conversation: async (_value, ctx: HookContext) => {
        await ctx.agents.run("helper", "go");
        await ctx.model.run([{ id: "x", role: "user", source: "hook", content: [{ type: "text", text: "probe" }] }]);
        return null;
      },
    } }) });
    const runtime = createGoondan({ agents: {
      main: { model: "m", extensions: { call: {} }, hooks: { conversation: [{ extension: "call" }] } },
      helper: { model: "h" },
    } }, { directory: ".", models: { m: model, h: helper }, extensions: { call } });

    const result = await runtime.run("hi", { sessionId: "c" });

    expect(result.runs.map((entry) => [entry.agent, entry.kind])).toEqual([["main", "turn"], ["helper", "hook"], ["main", "model"]]);
    expect(result.usage).toEqual({ input: 3, output: 3, cacheRead: 0, cacheWrite: 0 });
    await runtime.close();
  });

  it("rejects an execution.complete argument that is not an assistant message", async () => {
    let message: string | undefined;
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const policy = defineExtension({ name: "policy", hooks: ["toolResult"], create: () => ({ hooks: {
      toolResult: (value, ctx: HookContext) => {
        // Only a message whose role is `assistant` can end the run, so this call schedules nothing.
        const wrong: Message = { id: "final", role: "user", source: "policy", content: [] };
        try { ctx.execution.complete(wrong); }
        catch (error) { message = error instanceof Error ? error.message : String(error); }
        return value;
      },
    } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"], extensions: { policy: {} }, hooks: { toolResult: [{ extension: "policy" }] } } } },
      { directory: ".", models: { m: model }, tools: { act: echoTool("act") }, extensions: { policy } });

    const result = await runtime.run("hi", { sessionId: "c" });

    expect(message).toContain("execution.complete");
    expect(texts([result.output])).toEqual(["done"]);
    await runtime.close();
  });
});

describe("the tool context", () => {
  it("exposes the shared public surface and updates its cancellation state", async () => {
    let surface: string[] = [];
    let cancelled = false;
    let runtime: ReturnType<typeof createGoondan>;
    const act: Tool = {
      name: "act", description: "act", input: {},
      execute: (input, ctx) => {
        surface = Object.keys(ctx).sort();
        runtime.abort("c");
        cancelled = ctx.signal.aborted;
        return { callId: ctx.toolCall.id, name: "act", args: input, content: [] };
      },
    };
    runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"] } } }, {
      models: { m: scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]) }, tools: { act },
    });

    await expect(runtime.run("hi", { sessionId: "c" })).rejects.toMatchObject({ codes: ["aborted"] });

    expect(surface).toEqual(["agent", "agents", "conversation", "execution", "input", "sessionId", "signal", "toolCall", "turnId"]);
    expect(cancelled).toBe(true);
    await runtime.close();
  });
});

describe("extension instances", () => {
  it("keeps one instance per execution scope and disposes them when the runtime closes", async () => {
    const created: string[] = []; const disposed: string[] = [];
    const model = scripted([{ message: assistant("a"), finishReason: "stop" }, { message: assistant("b"), finishReason: "stop" }, { message: assistant("c"), finishReason: "stop" }]);
    const probe = defineExtension({ name: "probe", create: (input): ExtensionInstance => {
      const id = `${input.agent.name}:${String(created.length)}`;
      created.push(id);
      return { dispose: () => { disposed.push(id); } };
    } });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} } } } }, { directory: ".", models: { m: model }, extensions: { probe } });

    await runtime.run("one", { sessionId: "c" });
    await runtime.run("two", { sessionId: "c" });
    await runtime.run("three", { sessionId: "other" });

    expect(created).toEqual(["main:0", "main:1"]);
    await runtime.close();
    expect(disposed).toEqual(["main:0", "main:1"]);
  });

  it("passes only the required ports and the options the validator returned", async () => {
    let received: { options: Json; ports: string[]; params: Json } | undefined;
    const probe = defineExtension({
      name: "probe", requires: ["clock"],
      options: { validate: (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, checked: true } : undefined) },
      create: (input) => { received = { options: input.options, ports: Object.keys(input.ports), params: input.agent.spec.params ?? {} }; return {}; },
    });
    const runtime = createGoondan({ agents: { main: { model: "m", params: { tone: "warm" }, extensions: { probe: { options: { depth: 2 } } } } } },
      { directory: ".", models: { m: ok }, extensions: { probe }, ports: { clock: 1, unused: 2 } });

    await runtime.run("hi", { sessionId: "c" });

    expect(received).toEqual({ options: { depth: 2, checked: true }, ports: ["clock"], params: { tone: "warm" } });
    await runtime.close();
  });

  it("waits for an asynchronous option validator and keeps the original options when it returns nothing", async () => {
    const received: Json[] = [];
    const keep = defineExtension({
      name: "keep",
      options: { validate: async (value) => Promise.resolve(typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, checked: true } : undefined) },
      create: (input) => { received.push(input.options); return {}; },
    });
    const drop = defineExtension({
      name: "drop",
      options: { validate: async () => Promise.resolve(null) },
      create: (input) => { received.push(input.options); return {}; },
    });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { keep: { options: { n: 1 } }, drop: { options: { n: 2 } } } } } },
      { directory: ".", models: { m: ok }, extensions: { keep, drop } });

    await runtime.run("hi", { sessionId: "c" });

    expect(received).toEqual([{ n: 1, checked: true }, { n: 2 }]);
    await runtime.close();
  });

  it("fails the run when an asynchronous option validator rejects, without calling the model", async () => {
    const model = scripted([]);
    let created = 0;
    const guard = defineExtension({
      name: "guard",
      options: { validate: async () => Promise.reject(new Error("options are not valid")) },
      create: () => { created += 1; return {}; },
    });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { guard: {} } } } },
      { directory: ".", models: { m: model }, extensions: { guard } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "runtime", codes: ["runtime_error"], message: "options are not valid" });
    expect(model.calls).toEqual([]);
    expect(created).toBe(0);
    await runtime.close();
  });

  it("disposes what a failed preparation created and prepares again on the next run", async () => {
    const disposed: string[] = [];
    let attempts = 0;
    const first = defineExtension({ name: "first", create: (): ExtensionInstance => ({ dispose: () => { disposed.push("first"); } }) });
    const second = defineExtension({ name: "second", create: () => { attempts += 1; if (attempts === 1) throw new Error("cannot prepare"); return {}; } });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { first: {}, second: {} } } } },
      { directory: ".", models: { m: ok }, extensions: { first, second } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);
    expect(failure(error)).toMatchObject({ where: "runtime", codes: ["runtime_error"], message: "cannot prepare" });
    expect(disposed).toEqual(["first"]);

    // Nothing was cached, so the next run in the same scope prepares from the start.
    await runtime.run("hi", { sessionId: "c" });
    expect(attempts).toBe(2);
    await runtime.close();
    expect(disposed).toEqual(["first", "first"]);
  });

  it("fails the whole turn with a configuration error when an instance provides no hook of a stage", async () => {
    const empty = defineExtension({ name: "empty", create: (): ExtensionInstance => ({}) });
    const model = scripted([{ message: callMessage("c1", "worker"), finishReason: "tool" }, { message: assistant("after"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: {
      main: { model: "m", tools: [{ agent: "worker" }] },
      worker: { model: "m", extensions: { empty: {} }, hooks: { output: [{ extension: "empty" }] } },
    } }, { directory: ".", models: { m: model }, extensions: { empty } });

    // A configuration error of a preparation never becomes a tool failure.
    const error: unknown = await runtime.run("go", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GoondanConfigError);
    expect(error instanceof GoondanConfigError ? error.issues.map((issue) => issue.code) : []).toEqual(["binding.extension_hook"]);
    await runtime.close();
  });

  it("fails the whole turn for an optional hook of an agent tool whose instance provides no stage", async () => {
    const model = scripted([{ message: callMessage("c1", "helper"), finishReason: "tool" }]);
    const empty = defineExtension({ name: "empty", create: (): ExtensionInstance => ({}) });
    const runtime = createGoondan({ agents: {
      main: { model: "m", tools: [{ agent: "helper" }] },
      helper: { model: "m", extensions: { empty: {} }, hooks: { output: [{ extension: "empty", optional: true }] } },
    } }, { directory: ".", models: { m: model }, extensions: { empty } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    // A configuration error never becomes a tool failure and `optional` does not apply to it.
    expect(error).toBeInstanceOf(GoondanConfigError);
    expect(error instanceof GoondanConfigError ? error.issues.map((issue) => issue.code) : []).toEqual(["binding.extension_hook"]);
    await runtime.close();
  });

  it("disposes every instance of a scope even when one clean-up fails", async () => {
    const disposed: string[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const first = defineExtension({ name: "first", create: (): ExtensionInstance => ({ dispose: () => { disposed.push("first"); throw new Error("clean-up failed"); } }) });
    const second = defineExtension({ name: "second", create: (): ExtensionInstance => ({ dispose: () => { disposed.push("second"); } }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { first: {}, second: {} } } } },
      { directory: ".", models: { m: model }, extensions: { first, second } });

    await runtime.run("hi", { sessionId: "c" });
    await runtime.close();

    expect(disposed).toEqual(["first", "second"]);
  });

  it("reports the failure that stopped a preparation, not the failure of its clean-up", async () => {
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const first = defineExtension({ name: "first", create: (): ExtensionInstance => ({ dispose: () => { throw new Error("clean-up failed"); } }) });
    const second = defineExtension({ name: "second", create: (): ExtensionInstance => { throw new Error("creation failed"); } });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { first: {}, second: {} } } } },
      { directory: ".", models: { m: model }, extensions: { first, second } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "runtime", codes: ["runtime_error"], message: "creation failed" });
    await runtime.close();
  });

});

describe("host functions", () => {
  it("takes one JSON argument and treats a missing return value as null", async () => {
    const seen: unknown[] = [];
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", input: { fn: "shape" } } } }, {
      directory: ".", models: { m: model },
      functions: { shape: (...args: unknown[]) => { seen.push(args); return undefined; } },
    });

    await runtime.run({ a: 1 }, { sessionId: "c" });

    expect(seen).toEqual([[{ a: 1 }]]);
    expect(texts(model.calls[0]?.messages ?? [])).toEqual(["null"]);
    await runtime.close();
  });

  it("fails the hook when a function returns a value that is not JSON", async () => {
    const model = scripted([{ message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: { main: { model: "m", hooks: { conversation: [{ name: "odd", fn: "odd" }] } } } }, {
      directory: ".", models: { m: model },
      functions: { odd: () => Number.NaN },
    });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(failure(error)).toMatchObject({ where: "conversation", codes: ["hook_error"] });
    await runtime.close();
  });
});
