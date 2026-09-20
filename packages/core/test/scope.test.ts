import { describe, expect, it } from "vitest";
import {
  createGoondan, defineExtension, MemoryConversationStore,
  type ExtensionInstance, type Message, type Model, type ModelInput, type ModelResult, type RuntimeEvent,
} from "../src/index.ts";

function output(text: string): Message { return { id: crypto.randomUUID(), role: "assistant", source: "model", content: [{ type: "text", text }] }; }
function model(run: (input: ModelInput, context: Parameters<Model["generate"]>[1]) => Promise<string> | string): Model {
  return { async generate(input, context): Promise<ModelResult> { return { message: output(await run(input, context)), finishReason: "stop" }; } };
}

describe("sessions and instances", () => {
  it("isolates stateful conversations and gives stable instance ids", async () => {
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { models: { m: model((input) => String(input.messages.length)) } });
    const first = await runtime.run("a", { sessionId: "s1" });
    const second = await runtime.run("b", { sessionId: "s1" });
    const isolated = await runtime.run("c", { sessionId: "s2" });
    expect([first.runs[0]?.instance, second.runs[0]?.instance, isolated.runs[0]?.instance]).toEqual(["s1/main", "s1/main", "s2/main"]);
    expect(second.output.content[0]).toEqual({ type: "text", text: "3" });
    expect(isolated.output.content[0]).toEqual({ type: "text", text: "1" });
    await runtime.close();
  });

  it("does not store stateless conversations and uses a new instance each time", async () => {
    const store = new MemoryConversationStore();
    const runtime = createGoondan({ agents: { main: { model: "m", stateful: false } } }, { conversationStore: store, models: { m: model((input) => String(input.messages.length)) } });
    const a = await runtime.run("a", { sessionId: "s" });
    const b = await runtime.run("b", { sessionId: "s" });
    expect(a.output.content[0]).toEqual({ type: "text", text: "1" });
    expect(b.output.content[0]).toEqual({ type: "text", text: "1" });
    expect(a.runs[0]?.instance).not.toBe(b.runs[0]?.instance);
    expect(await store.load("s", "main")).toEqual([]);
    await runtime.close();
  });

  it("creates and disposes stateless extension instances for every run", async () => {
    let created = 0; let disposed = 0;
    const probe = defineExtension({ name: "probe", create: (): ExtensionInstance => {
      created += 1;
      return { dispose: () => { disposed += 1; } };
    } });
    const runtime = createGoondan({ agents: { main: { model: "m", stateful: false, extensions: { probe: {} } } } }, {
      models: { m: model(() => "ok") }, extensions: { probe },
    });

    await runtime.run("a", { sessionId: "s" });
    await runtime.run("b", { sessionId: "s" });

    expect({ created, disposed }).toEqual({ created: 2, disposed: 2 });
    await runtime.close();
  });

  it("serializes turns in one session and allows different sessions concurrently", async () => {
    const started: string[] = []; const releases = new Map<string, () => void>();
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { models: { m: model(async (_input, context) => {
      started.push(context.sessionId);
      await new Promise<void>((resolve) => { releases.set(context.sessionId, resolve); });
      return context.sessionId;
    }) } });
    const first = runtime.run("1", { sessionId: "same" });
    const second = runtime.run("2", { sessionId: "same" });
    const other = runtime.run("3", { sessionId: "other" });
    while (started.length < 2) await Promise.resolve();
    expect(started.sort()).toEqual(["other", "same"]);
    releases.get("other")?.(); releases.get("same")?.(); await first; await other;
    while (started.filter((id) => id === "same").length < 2) await Promise.resolve();
    releases.get("same")?.(); await second; await runtime.close();
  });

  it("uses a per-parent-turn derived session for agent tools", async () => {
    const store = new MemoryConversationStore();
    const sessions: string[] = []; let parentTurn = "";
    const worker = model((_input, context) => { sessions.push(context.sessionId); return "worker"; });
    let call = 0;
    const main: Model = { async generate(_input, context) {
      parentTurn = context.turnId;
      if (call++ === 0) return { message: { id: "m1", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "worker", args: {} }] }, finishReason: "tool" };
      return { message: output("done"), finishReason: "stop" };
    } };
    const runtime = createGoondan({ agents: { main: { model: "main", tools: [{ agent: "worker" }] }, worker: { model: "worker" } } }, { conversationStore: store, models: { main, worker } });
    await runtime.run("go", { sessionId: "s" });
    expect(sessions).toEqual([`s#${parentTurn}#worker`]);
    expect(await store.load(sessions[0] ?? "", "worker")).not.toEqual([]);
    await runtime.sessions.delete("s");
    expect(await store.load(sessions[0] ?? "", "worker")).toEqual([]);
    await runtime.close();
  });

  it("serializes the same derived stateful instance and overlaps stateless instances", async () => {
    const maximum = async (stateful: boolean): Promise<{ active: number; sessions: string[] }> => {
      let active = 0; let high = 0; const sessions: string[] = [];
      const worker = model(async (_input, context) => {
        sessions.push(context.sessionId);
        active += 1; high = Math.max(high, active);
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        active -= 1;
        return "worker";
      });
      const call = defineExtension({ name: "call", hooks: ["conversation"], create: () => ({ hooks: {
        conversation: async (value, context) => {
          await Promise.all([context.agents.run("worker", { n: 1 }), context.agents.run("worker", { n: 2 })]);
          return value;
        },
      } }) });
      const runtime = createGoondan({ agents: {
        main: { model: "main", extensions: { call: {} }, hooks: { conversation: [{ extension: "call" }] } },
        worker: { model: "worker", stateful },
      } }, { models: { main: model(() => "done"), worker }, extensions: { call } });
      await runtime.run("go", { sessionId: "s" });
      await runtime.close();
      return { active: high, sessions };
    };

    const stateful = await maximum(true);
    const stateless = await maximum(false);
    expect(stateful.active).toBe(1);
    expect(stateless.active).toBe(2);
    expect(new Set(stateful.sessions).size).toBe(1);
    expect(new Set(stateless.sessions).size).toBe(1);
  });

  it("deletes a session and rejects host ids containing #", async () => {
    const store = new MemoryConversationStore();
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { conversationStore: store, models: { m: model(() => "ok") } });
    await runtime.run("a", { sessionId: "s" });
    expect(await store.load("s", "main")).not.toEqual([]);
    await runtime.sessions.delete("s");
    expect(await store.load("s", "main")).toEqual([]);
    await expect(runtime.run("x", { sessionId: "bad#id" })).rejects.toMatchObject({ codes: ["runtime_error"] });
    expect(() => runtime.steer("bad#id", "x")).toThrow();
    expect(() => runtime.abort("bad#id")).toThrow();
    await runtime.close();
  });

  it("rejects deletion while a turn is active", async () => {
    let started: (() => void) | undefined; let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { models: { m: model(async () => { started?.(); await gate; return "done"; }) } });
    const turn = runtime.run("go", { sessionId: "s" });
    await ready;
    await expect(runtime.sessions.delete("s")).rejects.toMatchObject({ codes: ["runtime_error"] });
    release?.(); await turn; await runtime.close();
  });

  it("cancels asynchronous hooks and disposes instances when deleting a session", async () => {
    let cancelled = false; let disposed = 0; let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const probe = defineExtension({ name: "probe", hooks: ["conversation"], create: (): ExtensionInstance => ({
      hooks: { conversation: async (_value, context) => await new Promise<undefined>((resolve) => {
        started?.();
        context.signal.addEventListener("abort", () => { cancelled = true; resolve(undefined); }, { once: true });
      }) },
      dispose: () => { disposed += 1; },
    }) });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { probe: {} }, hooks: { conversation: [{ extension: "probe", mode: "async" }] } } } }, {
      models: { m: model(() => "done") }, extensions: { probe },
    });

    await runtime.run("go", { sessionId: "s" });
    await ready;
    await runtime.sessions.delete("s");
    await runtime.idle();

    expect({ cancelled, disposed }).toEqual({ cancelled: true, disposed: 1 });
    await runtime.close();
  });

  it("fails a queued turn with runtime_error when the object closes", async () => {
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { models: { m: model(async (_input, context) => await new Promise<string>((_resolve, reject) => {
      started?.();
      context.signal.addEventListener("abort", () => { reject(new Error("stopped")); }, { once: true });
    })) } });
    const first = runtime.run("one", { sessionId: "s" }).catch((error: unknown) => error);
    const queued = runtime.run("two", { sessionId: "s" }).catch((error: unknown) => error);
    await ready;
    await runtime.close();

    await expect(first).resolves.toMatchObject({ codes: ["aborted"] });
    await expect(queued).resolves.toMatchObject({ codes: ["runtime_error"] });
  });
});

describe("steer", () => {
  it("queues untagged and agent-tagged values while no turn is running", async () => {
    let seen: Message[] = [];
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { models: { m: model((input) => { seen = input.messages; return "done"; }) } });

    runtime.steer("s", { queued: true });
    runtime.steer("s", "tagged", { agent: "main" });
    await runtime.run("input", { sessionId: "s" });

    expect(seen.map((message) => message.content[0])).toEqual([
      { type: "text", text: "input" },
      { type: "text", text: '{"queued":true}' },
      { type: "text", text: "tagged" },
    ]);
    await runtime.close();
  });

  it("requires an agent while several route executions are running", async () => {
    const events: RuntimeEvent[] = []; let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" } }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" }, { from: "a", to: "$output" }, { from: "b", to: "$output" },
    ] }, { host: { emit(event) { events.push(event); } }, models: { a: model(async () => { await gate; return "a"; }), b: model(async () => { await gate; return "b"; }) } });
    const turn = runtime.run("go", { sessionId: "s" });
    while (events.filter((event) => event.name === "step.start").length < 2) await Promise.resolve();
    expect(() => runtime.steer("s", "x")).toThrowError(expect.objectContaining({ codes: ["steer_invalid"] }));
    runtime.steer("s", "x", { agent: "a" });
    release?.(); await turn; await runtime.close();
  });
});
