import { describe, expect, it } from "vitest";
import {
  createGoondan, defineExtension,
  type Json, type Message, type Model, type ModelResult, type RuntimeEvent, type Tool,
} from "../src/index.ts";

function assistant(text: string, id = "a"): Message {
  return { id, role: "assistant", source: "model", content: [{ type: "text", text }] };
}

function callMessage(callId: string, name: string, args: Json = null): Message {
  return { id: `m-${callId}`, role: "assistant", source: "model", content: [{ type: "tool.call", callId, name, args }] };
}

function scripted(replies: ModelResult[]): Model {
  let call = 0;
  return {
    async generate(): Promise<ModelResult> {
      const reply = replies[call];
      call += 1;
      if (!reply) throw new Error(`no scripted reply for call ${String(call)}`);
      return reply;
    },
  };
}

/** The event names of one agent, with the hook events labelled by the stage they belong to. */
function names(events: readonly RuntimeEvent[], agent: string): string[] {
  return events.filter((event) => event.agent === agent).map((event) => {
    if (!event.name.startsWith("hook.")) return event.name;
    return `${event.name}:${String(event.data.value)}`;
  });
}

const act: Tool = {
  name: "act", description: "act", input: {},
  execute: (input, ctx) => ({ callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "ran" }] }),
};

const watcher = defineExtension({
  name: "watch",
  hooks: ["input", "conversation", "modelInput", "modelResult", "toolCall", "toolResult", "output", "error"],
  create: () => ({
    hooks: {
      input: (value) => value, conversation: (value) => value, modelInput: (value) => value,
      modelResult: (value) => value, toolCall: (value) => value, toolResult: (value) => value,
      output: (value) => value, error: (value) => value,
    },
  }),
});

const everyStage = {
  input: [{ extension: "watch" }], conversation: [{ extension: "watch" }], modelInput: [{ extension: "watch" }],
  modelResult: [{ extension: "watch" }], toolCall: [{ extension: "watch" }], toolResult: [{ extension: "watch" }],
  output: [{ extension: "watch" }], error: [{ extension: "watch" }],
};

describe("the order of the events of one agent run", () => {
  it("follows the stage order through a tool call and ends with turn.done", async () => {
    const events: RuntimeEvent[] = [];
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: ["act"], extensions: { watch: {} }, hooks: everyStage } },
    }, { directory: ".", models: { m: model }, tools: { act }, extensions: { watch: watcher }, host: { emit: (event) => { events.push(event); } } });

    await runtime.run("hi", { sessionId: "c" });

    expect(names(events, "main")).toEqual([
      "hook.applied:input", "turn.start",
      "hook.applied:conversation",
      "hook.applied:modelInput", "step.start", "step.done", "hook.applied:modelResult",
      "hook.applied:toolCall", "tool.start", "hook.applied:toolResult", "tool.done",
      "hook.applied:modelInput", "step.start", "step.done", "hook.applied:modelResult",
      "hook.applied:output", "turn.done",
    ]);
    await runtime.close();
  });

  it("announces step.error and then the error stage, and resumes at the retried position", async () => {
    const events: RuntimeEvent[] = [];
    let attempts = 0;
    const model: Model = {
      async generate(): Promise<ModelResult> {
        attempts += 1;
        if (attempts === 1) throw new Error("model is unwell");
        return { message: assistant("recovered"), finishReason: "stop" };
      },
    };
    const runtime = createGoondan({
      agents: { main: { model: "m", hooks: { error: [{ name: "again", fn: "again" }] } } },
    }, {
      directory: ".", models: { m: model }, host: { emit: (event) => { events.push(event); } },
      functions: { again: () => ({ retry: true, target: "model" }) },
    });

    await runtime.run("hi", { sessionId: "c" });

    expect(names(events, "main")).toEqual([
      "turn.start", "step.start", "step.error", "hook.applied:error",
      "step.start", "step.done", "turn.done",
    ]);
    await runtime.close();
  });

  it("announces tool.start again for every attempt of a retried tool", async () => {
    const events: RuntimeEvent[] = [];
    let attempts = 0;
    const unwell: Tool = {
      name: "act", description: "act", input: {},
      execute: (input, ctx) => {
        attempts += 1;
        if (attempts === 1) throw new Error("tool is unwell");
        return { callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "ran" }] };
      },
    };
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: ["act"], hooks: { error: [{ name: "again", fn: "again" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act: unwell },
      host: { emit: (event) => { events.push(event); } },
      functions: { again: () => ({ retry: true, target: "tool" }) },
    });

    await runtime.run("hi", { sessionId: "c" });

    expect(names(events, "main")).toEqual([
      "turn.start", "step.start", "step.done",
      "tool.start", "tool.error", "hook.applied:error",
      "tool.start", "tool.done",
      "step.start", "step.done", "turn.done",
    ]);
    await runtime.close();
  });

  it("announces no tool event for a call the agent cannot make and still runs the error stage", async () => {
    const events: RuntimeEvent[] = [];
    const seen: Json[] = [];
    const model = scripted([{ message: callMessage("c1", "ghost"), finishReason: "tool" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: ["act"], hooks: { error: [{ name: "watch", fn: "watch" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act },
      host: { emit: (event) => { events.push(event); } },
      functions: { watch: (value) => { seen.push(value); return null; } },
    });

    await runtime.run("hi", { sessionId: "c" }).catch(() => undefined);

    expect(names(events, "main")).toEqual(["turn.start", "step.start", "step.done", "hook.applied:error", "turn.error"]);
    expect(seen[0]).toMatchObject({ where: "tool", codes: ["tool_unavailable"], attempt: 1 });
    await runtime.close();
  });

  it("checks the availability again on every retry of a call the agent cannot make", async () => {
    const events: RuntimeEvent[] = [];
    const model = scripted([{ message: callMessage("c1", "ghost"), finishReason: "tool" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: ["act"], hooks: { error: [{ name: "again", fn: "again" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act }, maxRetries: 2,
      host: { emit: (event) => { events.push(event); } },
      functions: { again: () => ({ retry: true, target: "tool" }) },
    });

    await runtime.run("hi", { sessionId: "c" }).catch(() => undefined);

    expect(names(events, "main").filter((name) => name.startsWith("hook.applied:error"))).toHaveLength(3);
    expect(names(events, "main").some((name) => name.startsWith("tool."))).toBe(false);
    await runtime.close();
  });

  it("reports an aborted agent tool as an abort of the target and of the run that waited", async () => {
    const events: RuntimeEvent[] = [];
    let reached = (): void => {};
    const arrived = new Promise<void>((settle) => { reached = () => { settle(); }; });
    let release = (): void => {};
    const waiting = new Promise<void>((settle) => { release = () => { settle(); }; });
    const helper: Model = {
      async generate(): Promise<ModelResult> { reached(); await waiting; return { message: assistant("helped"), finishReason: "stop" }; },
    };
    const model = scripted([{ message: callMessage("c1", "helper"), finishReason: "tool" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: [{ agent: "helper" }] }, helper: { model: "h" } },
    }, { directory: ".", models: { m: model, h: helper }, host: { emit: (event) => { events.push(event); } } });

    const running = runtime.run("hi", { sessionId: "c" });
    await arrived;
    expect(runtime.abort("c")).toBe(true);
    release();
    await running.catch(() => undefined);

    expect(events.map((event) => `${event.agent}/${event.name}`)).toEqual([
      "main/turn.start", "main/step.start", "main/step.done", "main/tool.start",
      "helper/turn.start", "helper/step.start", "helper/step.error", "helper/turn.error",
      "main/tool.error", "main/turn.error",
    ]);
    // Every failure the abort caused reports the abort, and the error stage never runs.
    for (const event of events.filter((item) => item.name.endsWith(".error"))) expect(event.data.codes).toEqual(["aborted"]);
    await runtime.close();
  });

  it("closes the tool attempt and the waiting run when a sub-run fails its extension preparation", async () => {
    const events: RuntimeEvent[] = [];
    const empty = defineExtension({ name: "empty", create: () => ({}) });
    const model = scripted([{ message: callMessage("c1", "worker"), finishReason: "tool" }]);
    const runtime = createGoondan({
      agents: {
        main: { model: "m", tools: [{ agent: "worker" }] },
        worker: { model: "m", extensions: { empty: {} }, hooks: { output: [{ extension: "empty" }] } },
      },
    }, { directory: ".", models: { m: model }, extensions: { empty }, host: { emit: (event) => { events.push(event); } } });

    await runtime.run("hi", { sessionId: "c" }).catch(() => undefined);

    // The failed preparation announces turn.error without turn.start, and every announced start pairs.
    expect(events.map((event) => `${event.agent}/${event.name}`)).toEqual([
      "main/turn.start", "main/step.start", "main/step.done", "main/tool.start",
      "worker/turn.error", "main/tool.error", "main/turn.error",
    ]);
    for (const event of events.filter((item) => item.name.endsWith(".error"))) {
      expect(event.data.codes).toEqual(["binding.extension_hook"]);
    }
    await runtime.close();
  });

  it("puts the events of a sub-run at the place the parent started it", async () => {
    const events: RuntimeEvent[] = [];
    const helper: Model = { async generate(): Promise<ModelResult> { return { message: assistant("helped"), finishReason: "stop" }; } };
    const model = scripted([{ message: callMessage("c1", "helper"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: [{ agent: "helper" }] }, helper: { model: "h" } },
    }, { directory: ".", models: { m: model, h: helper }, host: { emit: (event) => { events.push(event); } } });

    await runtime.run("hi", { sessionId: "c" });

    expect(events.map((event) => `${event.agent}/${event.name}`)).toEqual([
      "main/turn.start", "main/step.start", "main/step.done", "main/tool.start",
      "helper/turn.start", "helper/step.start", "helper/step.done", "helper/turn.done",
      "main/tool.done", "main/step.start", "main/step.done", "main/turn.done",
    ]);
    await runtime.close();
  });
});
