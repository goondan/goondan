import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createRuntime, defineExtension, loadConfigSync, MemoryConversationStore, MemoryOperationStore,
  type ConversationStore, type Json, type Message, type Model, type ModelResult, type RuntimeEvent, type Tool,
} from "../src/index.ts";

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-scope-")));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

/** The execution error a failed run throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[] } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes } : undefined;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => { resolve = () => { settle(); }; });
  return { promise, resolve };
}

function text(value: string): Message {
  return { id: "m", role: "assistant", source: "model", content: [{ type: "text", text: value }] };
}

interface ModelCall { agent: string; conversationId: string; turnId: string; messages: Message[] }

/** A model that answers with the next scripted reply and records the context of every call. */
function scripted(replies: ModelResult[]): Model & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    calls,
    async generate(input, ctx): Promise<ModelResult> {
      calls.push({ agent: ctx.agent, conversationId: ctx.conversationId, turnId: ctx.turnId, messages: input.messages });
      const reply = replies[calls.length - 1];
      if (!reply) throw new Error(`no scripted reply for call ${String(calls.length)}`);
      return reply;
    },
  };
}

const echo: Model = { async generate(): Promise<ModelResult> { return { message: text("ok"), finishReason: "stop" }; } };

/** A model that records the text of every message it receives. */
function recording(seen: string[]): Model {
  return {
    async generate(input): Promise<ModelResult> {
      seen.push(JSON.stringify(input.messages.map((message) => [message.source, message.content])));
      return { message: text("ok"), finishReason: "stop" };
    },
  };
}

/** A memory store that holds up the first append of a turn, so a test can abort inside it. */
function gatedStore(gate: { open: () => void; wait: Promise<void>; armed: boolean }): ConversationStore {
  const inner = new MemoryConversationStore();
  return {
    load: (conversationId, agent) => inner.load(conversationId, agent),
    append: async (conversationId, agent, messages) => {
      await inner.append(conversationId, agent, messages);
      if (!gate.armed) return;
      gate.armed = false;
      gate.open();
      await gate.wait;
    },
    replace: (conversationId, agent, messages) => inner.replace(conversationId, agent, messages),
  };
}

describe("agent paths and execution scope", () => {
  it("identifies a nested agent by its path in events, stores and contexts", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m}\n  wrap: {config: ./inner}\nflow:\n  in: main\n",
      "inner/goondan.yaml": "agents:\n  main: {model: m, extensions: {probe: {}}}\n",
    });
    const store = new MemoryConversationStore();
    const events: RuntimeEvent[] = [];
    const paths: string[] = [];
    const model = scripted([{ message: text("inner"), finishReason: "stop" }]);
    const probe = defineExtension({ name: "probe", create: (input) => { paths.push(input.agent.path); return {}; } });
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: model }, extensions: { probe }, conversationStore: store,
      host: { emit: (event) => { events.push(event); } },
    });

    const result = await runtime.runTurn("hi", { conversationId: "c", agent: "wrap" });

    expect(result.output.content).toEqual([{ type: "text", text: "inner" }]);
    expect(model.calls[0]?.agent).toBe("wrap/main");
    expect(paths).toEqual(["wrap/main"]);
    expect(new Set(events.map((event) => event.agent))).toEqual(new Set(["wrap/main"]));
    expect(await store.load("c", "wrap/main")).toHaveLength(2);
    expect(await store.load("c", "main")).toEqual([]);
    await runtime.close();
  });

  it("runs the agent a path names and rejects a path the configuration does not declare", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m}\n  wrap: {config: ./inner}\nflow:\n  in: main\n",
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n  deep: {config: ./leaf}\n",
      "inner/leaf/goondan.yaml": "agents:\n  main: {model: m}\n",
    });
    const model = scripted([{ message: text("leaf"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model } });

    await runtime.runTurn("hi", { conversationId: "c", agent: "wrap/deep/main" });
    expect(model.calls[0]?.agent).toBe("wrap/deep/main");

    for (const path of ["wrap//main", "wrap/missing", "missing/main", "main/extra", ""]) {
      await expect(runtime.runTurn("hi", { conversationId: "c", agent: path })).rejects.toThrow("Unknown agent");
    }
    await runtime.close();
  });

  it("gives a nested runtime the stores and the event receiver of the runtime the host created", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\nflow:\n  in: wrap\n",
      "inner/goondan.yaml": "agents:\n  main:\n    model: m\n    tools:\n      - {tool: act, approval: required}\n",
    });
    const events: RuntimeEvent[] = [];
    const toolAgents: string[] = [];
    const act: Tool = {
      name: "act", description: "act", input: {},
      execute: (_input, ctx) => { toolAgents.push(ctx.agent); return { callId: ctx.toolCall.id, name: "act", args: null, content: [{ type: "text", text: "acted" }] }; },
    };
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "call-1", name: "act", args: null }] }, finishReason: "tool" },
      { message: text("waiting"), finishReason: "stop" },
      { message: text("done"), finishReason: "stop" },
    ]);
    // No store is bound, so the nested runtime must share the ones this runtime resolved.
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, tools: { act }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("go", { conversationId: "c" });
    const [operation] = await runtime.listOperations("c");
    expect(operation?.agent).toBe("wrap/main");
    expect(events.filter((event) => event.name === "humanApproval.created").map((event) => event.agent)).toEqual(["wrap/main"]);

    await runtime.decideOperation("c", operation?.operationId ?? "", { decision: "approved" });
    await runtime.idle();

    expect(toolAgents).toEqual(["wrap/main"]);
    const [settled] = await runtime.listOperations("c");
    expect(settled?.status).toBe("completed");
    expect(settled?.deliveryStatus).toBe("delivered");
    expect(model.calls.map((call) => call.agent)).toEqual(["wrap/main", "wrap/main", "wrap/main"]);
    await runtime.close();
  });

  it("fails an operation whose agent path no longer resolves", async () => {
    const operations = new MemoryOperationStore();
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, tools: [{tool: act, approval: required}]}\n" });
    const act: Tool = { name: "act", description: "act", input: {}, execute: (_input, ctx) => ({ callId: ctx.toolCall.id, name: "act", args: null, content: [] }) };
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "call-1", name: "act", args: null }] }, finishReason: "tool" },
      { message: text("waiting"), finishReason: "stop" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, tools: { act }, operationStore: operations });
    await runtime.runTurn("go", { conversationId: "c" });
    const [operation] = await runtime.listOperations("c");
    if (!operation) throw new Error("expected an operation");
    await runtime.close();

    // A runtime whose configuration no longer declares the stored path cannot run the operation.
    const other = createRuntime(loadConfigSync(workspace({ "goondan.yaml": "agents:\n  other: {model: m}\n" })), { models: { m: echo }, operationStore: operations });
    await other.decideOperation("c", operation.operationId, { decision: "approved" });
    await other.idle();

    const [failed] = await other.listOperations("c");
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("validation_failed");
    expect(failed?.error).toBe("Unknown agent: main");
    await other.close();
  });

  it("keeps hook sub-conversations apart by parent path, stage and hook", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    hooks:\n      input:\n        - {name: advisors, agent: helper}\n  helper: {model: h}\n  wrap: {config: ./inner}\nflow:\n  in: main\n",
      "inner/goondan.yaml": "agents:\n  main:\n    model: m\n    hooks:\n      input:\n        - {name: advisors, agent: helper}\n  helper: {model: h}\n",
    });
    const helper = scripted([{ message: text("h1"), finishReason: "stop" }, { message: text("h2"), finishReason: "stop" }]);
    const main = scripted([{ message: text("a"), finishReason: "stop" }, { message: text("b"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: main, h: helper } });

    await runtime.runTurn("x", { conversationId: "c" });
    await runtime.runTurn("y", { conversationId: "c", agent: "wrap/main" });

    expect(helper.calls.map((call) => call.conversationId)).toEqual(["c:main:input:advisors", "c:wrap/main:input:advisors"]);
    expect(helper.calls.map((call) => call.agent)).toEqual(["helper", "wrap/helper"]);
    await runtime.close();
  });

  it("gives an agent tool and a tool context run the same sub-conversation", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, tools: [call, {agent: worker}]}\n  worker: {model: w}\n" });
    const worker = scripted([{ message: text("w1"), finishReason: "stop" }, { message: text("w2"), finishReason: "stop" }]);
    const contexts: Array<{ agent: string; conversationId: string; execution: Json }> = [];
    const call: Tool = {
      name: "call", description: "call", input: {},
      execute: async (_input, ctx) => {
        contexts.push({ agent: ctx.agent, conversationId: ctx.conversationId, execution: ctx.execution });
        await ctx.agents.run("worker", "from tool");
        return { callId: ctx.toolCall.id, name: "call", args: null, content: [] };
      },
    };
    const main = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "call", args: null }, { type: "tool.call", callId: "c2", name: "worker", args: null }] }, finishReason: "tool" },
      { message: text("done"), finishReason: "stop" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: main, w: worker }, tools: { call } });

    await runtime.runTurn("x", { conversationId: "c" });

    const turnId = main.calls[0]?.turnId ?? "";
    expect(contexts).toEqual([{ agent: "main", conversationId: "c", execution: {} }]);
    expect(worker.calls.map((entry) => entry.conversationId)).toEqual([`c:${turnId}:worker`, `c:${turnId}:worker`]);
    await runtime.close();
  });

  it("fails a tool whose agents.run names an agent the configuration does not declare", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, tools: [call]}\n  worker: {model: w}\n" });
    const events: RuntimeEvent[] = [];
    let started = false;
    const call: Tool = {
      name: "call", description: "call", input: {},
      execute: async (_input, ctx) => {
        await ctx.agents.run("ghost", null);
        started = true;
        return { callId: ctx.toolCall.id, name: "call", args: null, content: [] };
      },
    };
    const main = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "call", args: null }] }, finishReason: "tool" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: main, w: echo }, tools: { call }, host: { emit: (event) => { events.push(event); } },
    });

    await runtime.runTurn("x", { conversationId: "c" }).catch(() => undefined);

    expect(started).toBe(false);
    expect(events.filter((event) => event.name === "tool.error").map((event) => event.data.codes)).toEqual([["tool_error"]]);
    await runtime.close();
  });

  it("steers only into flow steps, at the next safe conversation point", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, tools: [probe]}\n  worker: {model: w}\n" });
    const worker = scripted([{ message: text("w"), finishReason: "stop" }]);
    const probe: Tool = {
      name: "probe", description: "probe", input: {},
      execute: async (_input, ctx) => {
        runtime.steer("c", { late: true });
        await ctx.agents.run("worker", "w");
        return { callId: ctx.toolCall.id, name: "probe", args: null, content: [] };
      },
    };
    const main = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "probe", args: null }] }, finishReason: "tool" },
      { message: text("done"), finishReason: "stop" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: main, w: worker }, tools: { probe } });
    runtime.steer("c", "early");

    await runtime.runTurn("x", { conversationId: "c" });

    const first = main.calls[0]?.messages ?? [];
    expect(first.map((message) => ({ role: message.role, source: message.source, content: message.content })))
      .toEqual([
        { role: "user", source: "main", content: [{ type: "text", text: "x" }] },
        { role: "user", source: "user", content: [{ type: "text", text: "early" }] },
      ]);
    expect(first[1]).not.toHaveProperty("key");
    // The sub-run never takes steered input; the next safe point of the flow step does.
    expect(worker.calls[0]?.messages).toHaveLength(1);
    const second = main.calls[1]?.messages ?? [];
    expect(second[second.length - 1]?.content).toEqual([{ type: "text", text: '{"late":true}' }]);
    await runtime.close();
  });

  it("aborts every run of a conversation and discards what comes back afterwards", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m}\n" });
    const store = new MemoryConversationStore();
    const events: RuntimeEvent[] = [];
    const reached = deferred();
    const release = deferred();
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> {
        reached.resolve();
        await release.promise;
        // The result arrives after the abort and must not be used.
        expect(ctx.signal.aborted).toBe(true);
        return { message: text("late"), finishReason: "stop" };
      },
    };
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, conversationStore: store, host: { emit: (event) => { events.push(event); } } });

    const running = runtime.runTurn("x", { conversationId: "c" });
    await reached.promise;
    expect(runtime.abort("other")).toBe(false);
    expect(runtime.abort("c")).toBe(true);
    release.resolve();

    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });
    expect(events.filter((event) => event.name === "step.error").map((event) => event.data.codes)).toEqual([["aborted"]]);
    const turnError = events.find((event) => event.name === "turn.error");
    expect(turnError?.data).toMatchObject({ where: "runtime", codes: ["aborted"] });
    // Only the input message was stored; nothing is stored after the abort.
    expect(await store.load("c", "main")).toHaveLength(1);
    await runtime.close();
    expect(runtime.abort("c")).toBe(false);
  });

  it("catches an abort requested between two flow steps", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  a: {model: m}\n  b: {model: m}\nflow:\n  in: a\n  routes:\n    - {from: a, to: b, when: {fn: stop}}\n    - {from: b, to: out}\n",
    });
    const model = scripted([{ message: text("a"), finishReason: "stop" }, { message: text("b"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: model },
      // The turn holds its own controller, so an abort between steps is not missed.
      functions: { stop: () => { expect(runtime.abort("c")).toBe(true); return true; } },
    });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((reason: unknown) => reason);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["aborted"] });
    expect(model.calls).toHaveLength(1);
    await runtime.close();
  });

  it("reaches a nested agent and is not swallowed by an optional hook", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\nflow:\n  in: wrap\n",
      "inner/goondan.yaml": "agents:\n  main:\n    model: m\n    hooks:\n      input:\n        - {fn: slow, optional: true}\n",
    });
    const reached = deferred();
    const release = deferred();
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: echo },
      functions: { slow: async (value) => { reached.resolve(); await release.promise; return value; } },
    });

    const running = runtime.runTurn("x", { conversationId: "c" });
    await reached.promise;
    expect(runtime.abort("c")).toBe(true);
    release.resolve();

    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });
    await runtime.close();
  });

  it("never aborts an approved operation with a conversation abort", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, tools: [{tool: act, approval: required}]}\n" });
    const reached = deferred();
    const release = deferred();
    let aborted = false;
    const act: Tool = {
      name: "act", description: "act", input: {},
      execute: async (_input, ctx) => {
        reached.resolve();
        await release.promise;
        aborted = ctx.signal.aborted;
        return { callId: ctx.toolCall.id, name: "act", args: null, content: [{ type: "text", text: "acted" }] };
      },
    };
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "act", args: null }] }, finishReason: "tool" },
      { message: text("waiting"), finishReason: "stop" },
      { message: text("after"), finishReason: "stop" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, tools: { act } });

    await runtime.runTurn("go", { conversationId: "c" });
    const [operation] = await runtime.listOperations("c");
    await runtime.decideOperation("c", operation?.operationId ?? "", { decision: "approved" });
    await reached.promise;
    expect(runtime.abort("c")).toBe(false);
    release.resolve();
    await runtime.idle();

    expect(aborted).toBe(false);
    expect((await runtime.listOperations("c"))[0]?.status).toBe("completed");
    await runtime.close();
  });

  it("waits in idle() for an async hook and ignores a failing event receiver", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    extensions: {probe: {}}\n    hooks:\n      conversation:\n        - {fn: later, mode: async}\n",
    });
    const release = deferred();
    let finished = false;
    const probe = defineExtension({
      name: "probe", hooks: [],
      create: () => ({ on: { "turn.start": () => { throw new Error("receiver failed"); } } }),
    });
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: echo }, extensions: { probe },
      functions: { later: async (value) => { await release.promise; finished = true; return value; } },
      host: { emit: () => { throw new Error("host receiver failed"); } },
    });

    await runtime.runTurn("x", { conversationId: "c" });
    expect(finished).toBe(false);
    release.resolve();
    await runtime.idle();
    expect(finished).toBe(true);
    await runtime.close();
  });

  it("announces turn.done with the output message and turn.error with its stage", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m}\n  broken: {model: m, extensions: {bad: {}}}\n" });
    const events: RuntimeEvent[] = [];
    const bad = defineExtension({ name: "bad", create: () => { throw new Error("cannot prepare"); } });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo }, extensions: { bad }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("x", { conversationId: "c" });
    const done = events.find((event) => event.name === "turn.done");
    expect(done?.data.output).toMatchObject({ role: "assistant", content: [{ type: "text", text: "ok" }] });
    expect(done?.data).toHaveProperty("steps", 1);
    expect(typeof done?.at).toBe("number");

    events.length = 0;
    await expect(runtime.runTurn("x", { conversationId: "c", agent: "broken" })).rejects.toThrow("cannot prepare");
    // A run that cannot prepare its extensions reports turn.error without turn.start.
    expect(events.map((event) => event.name)).toEqual(["turn.error"]);
    expect(events[0]?.data).toMatchObject({ where: "runtime", codes: ["runtime_error"], error: "cannot prepare" });
    expect(events[0]?.agent).toBe("broken");
    await runtime.close();
  });

  it("delivers an event to the host receiver first and then to the scope's extensions in order", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main:\n    model: m\n    extensions: {first: {}, second: {}}\n" });
    const log: string[] = [];
    const listener = (name: string) => defineExtension({
      name,
      create: () => ({ on: { "turn.start": () => { log.push(name); }, "step.textDelta": async (event) => { await Promise.resolve(); log.push(`${name}:${String(event.data.delta)}`); } } }),
    });
    const model: Model = {
      async generate(_input, ctx): Promise<ModelResult> { ctx.onTextDelta("a"); ctx.onTextDelta("b"); return { message: text("ok"), finishReason: "stop" }; },
    };
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: model }, extensions: { first: listener("first"), second: listener("second") },
      host: { emit: async (event) => { await Promise.resolve(); log.push(`host:${event.name}`); } },
    });

    await runtime.runTurn("x", { conversationId: "c" });

    expect(log.slice(0, 3)).toEqual(["host:turn.start", "first", "second"]);
    expect(log.filter((entry) => entry.startsWith("host:"))).toEqual([
      "host:turn.start", "host:step.start", "host:step.textDelta", "host:step.textDelta", "host:step.done", "host:turn.done",
    ]);
    expect(log.filter((entry) => entry.startsWith("first:"))).toEqual(["first:a", "first:b"]);
    await runtime.close();
  });

  it("keeps two conversation and agent pairs apart in the memory store", async () => {
    const store = new MemoryConversationStore();
    const message: Message = { id: "1", role: "user", source: "user", content: [{ type: "text", text: "x" }] };
    await store.append("a:b", "c", [message]);
    await store.append("a", "b:c", [message, message]);
    expect(await store.load("a:b", "c")).toHaveLength(1);
    expect(await store.load("a", "b:c")).toHaveLength(2);
  });

  it("gives every target of a hook agent array the same sub-conversation and its own path", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    hooks:\n      modelInput:\n        - {name: advisors, agent: [left, right]}\n  left: {model: h}\n  right: {model: h}\nflow:\n  in: main\n",
    });
    const helper = scripted([{ message: text("l"), finishReason: "stop" }, { message: text("r"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo, h: helper } });

    await runtime.runTurn("x", { conversationId: "c1" });

    expect(helper.calls.map((call) => `${call.agent}@${call.conversationId}`))
      .toEqual(["left@c1:main:modelInput:advisors", "right@c1:main:modelInput:advisors"]);
    await runtime.close();
  });

  it("continues a hook sub-conversation across turns and starts a new agent tool one every turn", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    tools: [{agent: worker}]\n    hooks:\n      input:\n        - {name: advisors, agent: helper}\n  helper: {model: h}\n  worker: {model: w}\nflow:\n  in: main\n",
    });
    const helper = scripted([{ message: text("h1"), finishReason: "stop" }, { message: text("h2"), finishReason: "stop" }]);
    const worker = scripted([{ message: text("w1"), finishReason: "stop" }, { message: text("w2"), finishReason: "stop" }]);
    const call = (id: string): ModelResult => ({ message: { id, role: "assistant", source: "model", content: [{ type: "tool.call", callId: id, name: "worker", args: null }] }, finishReason: "tool" });
    const main = scripted([call("t1"), { message: text("a"), finishReason: "stop" }, call("t2"), { message: text("b"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: main, h: helper, w: worker } });

    await runtime.runTurn("x", { conversationId: "c" });
    await runtime.runTurn("y", { conversationId: "c" });

    // The hook sub-conversation carries on; the agent tool starts a new one in the next parent turn.
    expect(helper.calls.map((entry) => entry.conversationId)).toEqual(["c:main:input:advisors", "c:main:input:advisors"]);
    expect(helper.calls.map((entry) => entry.messages.length)).toEqual([1, 3]);
    expect(new Set(worker.calls.map((entry) => entry.conversationId)).size).toBe(2);
    expect(worker.calls.map((entry) => entry.messages.length)).toEqual([1, 1]);
    await runtime.close();
  });

  it("keeps two config agents that load the same configuration apart", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  a: {config: ./inner}\n  b: {config: ./inner}\n  main: {model: m}\nflow:\n  in: main\n",
      "inner/goondan.yaml": "agents:\n  main: {model: m, extensions: {probe: {}}}\n",
    });
    const paths: string[] = [];
    const probe = defineExtension({ name: "probe", create: (input) => { paths.push(input.agent.path); return {}; } });
    const model = scripted([
      { message: text("1"), finishReason: "stop" }, { message: text("2"), finishReason: "stop" }, { message: text("3"), finishReason: "stop" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, extensions: { probe } });

    await runtime.runTurn("x", { conversationId: "c", agent: "a" });
    await runtime.runTurn("x", { conversationId: "c", agent: "b" });
    await runtime.runTurn("x", { conversationId: "c", agent: "a" });

    // One extension instance per execution scope, and the two scopes keep separate conversations.
    expect(paths).toEqual(["a/main", "b/main"]);
    expect(model.calls.map((entry) => entry.agent)).toEqual(["a/main", "b/main", "a/main"]);
    expect(model.calls.map((entry) => entry.messages.length)).toEqual([1, 1, 3]);
    await runtime.close();
  });

  it("steers into a nested flow step, which records itself as a nested run", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\nflow:\n  in: wrap\n",
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n",
    });
    const seen: string[] = [];
    const runtime = createRuntime(loadConfigSync(root), { models: { m: recording(seen) } });
    runtime.steer("c", "hello");

    const result = await runtime.runTurn("x", { conversationId: "c" });

    expect(seen.join("|")).toContain("hello");
    expect(result.runs.map((run) => `${run.agent}:${run.kind}`)).toEqual(["wrap/main:nested"]);
    await runtime.close();
  });

  it("aborts a nested flow step and reports every aborted run", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\nflow:\n  in: wrap\n",
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n",
    });
    const events: RuntimeEvent[] = [];
    const reached = deferred();
    const release = deferred();
    const model: Model = {
      async generate(): Promise<ModelResult> { reached.resolve(); await release.promise; return { message: text("late"), finishReason: "stop" }; },
    };
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, host: { emit: (event) => { events.push(event); } } });

    const running = runtime.runTurn("x", { conversationId: "c" });
    await reached.promise;
    expect(runtime.abort("c")).toBe(true);
    release.resolve();

    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });
    // The config agent announces nothing of its own; the nested agent reports the abort.
    expect(events.map((event) => `${event.agent}/${event.name}`)).toEqual([
      "wrap/main/turn.start", "wrap/main/step.start", "wrap/main/step.error", "wrap/main/turn.error",
    ]);
    await runtime.close();
  });

  it("starts no sub-run and announces no hook failure once the abort was signalled", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    hooks:\n      input:\n        - {name: slow, fn: slow}\n        - {name: advisors, agent: helper}\n  helper: {model: h}\nflow:\n  in: main\n",
    });
    const events: RuntimeEvent[] = [];
    const reached = deferred();
    const release = deferred();
    const helper = scripted([{ message: text("h"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: echo, h: helper },
      functions: { slow: async (value) => { reached.resolve(); await release.promise; return value; } },
      host: { emit: (event) => { events.push(event); } },
    });

    const running = runtime.runTurn("x", { conversationId: "c" });
    await reached.promise;
    expect(runtime.abort("c")).toBe(true);
    release.resolve();

    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });
    expect(helper.calls).toHaveLength(0);
    // The hook that returned after the abort is not applied, and the next hook never starts.
    expect(events.map((event) => `${event.agent}/${event.name}`)).toEqual(["main/turn.error"]);
    await runtime.close();
  });

  it("keeps a steered value in the queue when the run is aborted before its safe point", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m}\n" });
    const reached = deferred();
    const release = deferred();
    const seen: string[] = [];
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: recording(seen) },
      conversationStore: gatedStore({ open: reached.resolve, wait: release.promise, armed: true }),
    });

    const running = runtime.runTurn("x", { conversationId: "c" });
    // The input message is stored, so the run has not reached its first safe point yet.
    await reached.promise;
    runtime.steer("c", "late");
    expect(runtime.abort("c")).toBe(true);
    release.resolve();
    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });

    await runtime.runTurn("y", { conversationId: "c" });
    expect(seen.join("|")).toContain("late");
    await runtime.close();
  });

  it("keeps an asynchronous hook result when the run is aborted before its safe point", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    hooks:\n      conversation:\n        - {name: later, fn: later, mode: async}\n",
    });
    const reached = deferred();
    const release = deferred();
    const seen: string[] = [];
    const gate = { open: reached.resolve, wait: release.promise, armed: false };
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: recording(seen) }, conversationStore: gatedStore(gate),
      functions: { later: () => "async note" },
    });

    await runtime.runTurn("a", { conversationId: "c" });
    await runtime.idle();
    gate.armed = true;
    const running = runtime.runTurn("b", { conversationId: "c" });
    await reached.promise;
    expect(runtime.abort("c")).toBe(true);
    release.resolve();
    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });

    await runtime.runTurn("d", { conversationId: "c" });
    expect(seen.join("|")).toContain("async note");
    await runtime.close();
  });

  it("stops every run of every conversation when the runtime is closed", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\nflow:\n  in: wrap\n",
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n",
    });
    const reached = deferred();
    const release = deferred();
    const model: Model = {
      async generate(): Promise<ModelResult> { reached.resolve(); await release.promise; return { message: text("late"), finishReason: "stop" }; },
    };
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model } });

    const running = runtime.runTurn("x", { conversationId: "c" });
    await reached.promise;
    const closed = runtime.close();
    release.resolve();

    expect(failure(await running.catch((error: unknown) => error))).toEqual({ where: "runtime", codes: ["aborted"] });
    await closed;
  });

  it("announces the events of an approved operation with the operation's path, conversation and turn", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  wrap: {config: ./inner}\nflow:\n  in: wrap\n",
      "inner/goondan.yaml": "agents:\n  main:\n    model: m\n    tools:\n      - {tool: act, approval: required}\n",
    });
    const events: RuntimeEvent[] = [];
    const act: Tool = { name: "act", description: "act", input: {}, execute: (_input, ctx) => ({ callId: ctx.toolCall.id, name: "act", args: null, content: [] }) };
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "act", args: null }] }, finishReason: "tool" },
      { message: text("waiting"), finishReason: "stop" },
      { message: text("after"), finishReason: "stop" },
    ]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, tools: { act }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("go", { conversationId: "c" });
    const [operation] = await runtime.listOperations("c");
    if (!operation) throw new Error("expected an operation");
    events.length = 0;
    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    const executed = events.filter((event) => event.name.startsWith("tool."));
    expect(executed.map((event) => `${event.agent}/${event.name}`)).toEqual(["wrap/main/tool.start", "wrap/main/tool.done"]);
    expect(executed.every((event) => event.conversationId === "c" && event.turnId === operation.turnId)).toBe(true);
    expect(executed.every((event) => event.data.operationId === operation.operationId)).toBe(true);
    // An operation execution is not a turn, so it announces no turn event of its own.
    expect(events.filter((event) => event.name === "turn.start").map((event) => event.turnId)).not.toContain(operation.turnId);
    await runtime.close();
  });

  it("aborts the turn the runtime runs to deliver a completion", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m, tools: [{tool: act, approval: required}]}\n" });
    const act: Tool = { name: "act", description: "act", input: {}, execute: (_input, ctx) => ({ callId: ctx.toolCall.id, name: "act", args: null, content: [] }) };
    const reached = deferred();
    const release = deferred();
    let step = 0;
    const model: Model = {
      async generate(): Promise<ModelResult> {
        step += 1;
        if (step === 1) return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "act", args: null }] }, finishReason: "tool" };
        // The third call belongs to the turn that delivers the completion.
        if (step === 3) { reached.resolve(); await release.promise; }
        return { message: text("ok"), finishReason: "stop" };
      },
    };
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model }, tools: { act } });

    await runtime.runTurn("go", { conversationId: "c" });
    const [operation] = await runtime.listOperations("c");
    await runtime.decideOperation("c", operation?.operationId ?? "", { decision: "approved" });
    await reached.promise;

    expect(runtime.abort("c")).toBe(true);
    release.resolve();
    await runtime.idle();
    await runtime.close();
  });

  it("keeps the steering queue across an abort request and drops it at close", async () => {
    const root = workspace({ "goondan.yaml": "agents:\n  main: {model: m}\n" });
    const model = scripted([{ message: text("ok"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: model } });

    runtime.steer("c", "kept");
    expect(runtime.abort("c")).toBe(false);
    await runtime.runTurn("x", { conversationId: "c" });
    expect(model.calls[0]?.messages.map((message) => message.source)).toEqual(["main", "user"]);

    await runtime.close();
    runtime.steer("c", "dropped");
    expect(runtime.abort("c")).toBe(false);
  });
});
