import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createRuntime, defineExtension, loadConfigSync,
  type AgentRunRecord, type Json, type Message, type Model, type ModelResult, type RuntimeEvent, type Tool,
} from "../src/index.ts";

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-result-")));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

/** The execution error a failed turn throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[]; attempt: number } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes, attempt: detail.attempt } : undefined;
}

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

const ok: Model = { async generate(): Promise<ModelResult> { return { message: assistant("ok"), finishReason: "stop" }; } };

/** The agent path and kind of each run record, which is what the ordering rules are about. */
function shape(runs: readonly AgentRunRecord[]): string[] {
  return runs.map((run) => `${run.agent}:${run.kind}`);
}

describe("the agent run records of a turn", () => {
  it("places a sub-run after the run that started it and a nested flow at the config agent", async () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  helper: {model: h}\nflow: [helper]\n",
      "goondan.yaml": [
        "agents:",
        "  main:",
        "    model: m",
        "    tools:",
        "      - agent: worker",
        "    hooks:",
        "      output:",
        "        - agent: [reviewer, checker]",
        "  worker: {model: w}",
        "  reviewer: {model: w}",
        "  checker: {model: w}",
        "  wrap: {config: ./inner}",
        "flow: [main, wrap]",
        "",
      ].join("\n"),
    });
    const main = scripted([{ message: callMessage("c1", "worker"), finishReason: "tool" }, { message: assistant("done"), finishReason: "stop" }]);
    const runtime = createRuntime(loadConfigSync(root), { models: { m: main, w: ok, h: ok } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(shape(result.runs)).toEqual([
      "main:flow", "worker:tool", "reviewer:hook", "checker:hook", "wrap/helper:nested",
    ]);
    expect(result.runs.every((run) => run.status === "done" && typeof run.finishReason === "string")).toBe(true);
    await runtime.close();
  });

  it("adds a model entry for a model call a synchronous hook requested", async () => {
    const asked = defineExtension({
      name: "asked",
      hooks: ["conversation"],
      create: () => ({ hooks: { conversation: async (value, ctx) => { await ctx.model.run([]); return value; } } }),
    });
    const model = scripted([
      { message: assistant("side"), finishReason: "length", usage: { input: 2 } },
      { message: assistant("done"), finishReason: "stop", usage: { output: 5 } },
    ]);
    const runtime = createRuntime({
      agents: { main: { model: "m", extensions: { asked: {} }, hooks: { conversation: [{ extension: "asked" }] } } },
    }, { directory: ".", models: { m: model }, extensions: { asked } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(shape(result.runs)).toEqual(["main:flow", "main:model"]);
    expect(result.runs[1]).toMatchObject({ kind: "model", finishReason: "length", status: "done", usage: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 } });
    expect(result.usage).toEqual({ input: 2, output: 5, cacheRead: 0, cacheWrite: 0 });
    await runtime.close();
  });

  it("records a failed model call with zero usage and no finish reason", async () => {
    const asked = defineExtension({
      name: "asked",
      hooks: ["conversation"],
      create: () => ({ hooks: { conversation: async (value, ctx) => { await ctx.model.run([]).catch(() => undefined); return value; } } }),
    });
    let call = 0;
    const model: Model = {
      async generate(): Promise<ModelResult> {
        call += 1;
        if (call === 1) throw new Error("down");
        return { message: assistant("done"), finishReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
      },
    };
    const runtime = createRuntime({
      agents: { main: { model: "m", extensions: { asked: {} }, hooks: { conversation: [{ extension: "asked" }] } } },
    }, { directory: ".", models: { m: model }, extensions: { asked } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.runs[1]).toEqual({ agent: "main", turnId: result.runs[1]?.turnId ?? "", kind: "model", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, status: "failed" });
    await runtime.close();
  });

  it("records a failed optional hook agent and keeps the turn going", async () => {
    const broken: Model = { async generate(): Promise<ModelResult> { throw new Error("down"); } };
    const runtime = createRuntime({
      agents: { main: { model: "m", hooks: { output: [{ agent: "helper" }] } }, helper: { model: "h" } },
      flow: { in: "main" },
    }, { directory: ".", models: { m: ok, h: broken } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(shape(result.runs)).toEqual(["main:flow", "helper:hook"]);
    expect(result.runs[1]?.status).toBe("failed");
    expect(result.runs[1]?.finishReason).toBeUndefined();
    await runtime.close();
  });

  it("keeps the usage a failed run received and counts it in the turn", async () => {
    const helper = scripted([{ message: callMessage("g1", "ghost"), finishReason: "tool", usage: { output: 4 } }]);
    const model = scripted([{ message: assistant("done"), finishReason: "stop", usage: { input: 1 } }]);
    const runtime = createRuntime({
      agents: { main: { model: "m", hooks: { output: [{ agent: "helper" }] } }, helper: { model: "h" } },
      flow: { in: "main" },
    }, { directory: ".", models: { m: model, h: helper } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(shape(result.runs)).toEqual(["main:flow", "helper:hook"]);
    expect(result.runs[1]).toMatchObject({ status: "failed", usage: { input: 0, output: 4, cacheRead: 0, cacheWrite: 0 } });
    expect(result.runs[1]?.finishReason).toBeUndefined();
    expect(result.usage).toEqual({ input: 1, output: 4, cacheRead: 0, cacheWrite: 0 });
    await runtime.close();
  });

  it("leaves out the run of an agent it could not start", async () => {
    const asked = defineExtension({
      name: "asked",
      hooks: ["conversation"],
      create: () => ({ hooks: { conversation: async (value, ctx) => { await ctx.agents.run("ghost", "x").catch(() => undefined); return value; } } }),
    });
    const runtime = createRuntime({
      agents: { main: { model: "m", extensions: { asked: {} }, hooks: { conversation: [{ extension: "asked" }] } } },
    }, { directory: ".", models: { m: ok }, extensions: { asked } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(shape(result.runs)).toEqual(["main:flow"]);
    await runtime.close();
  });
});

describe("the usage of a turn", () => {
  it("counts a missing usage key as zero and sums every record", async () => {
    const helper: Model = { async generate(): Promise<ModelResult> { return { message: assistant("helped"), finishReason: "stop", usage: { cacheRead: 7 } }; } };
    const model = scripted([
      { message: callMessage("c1", "helper"), finishReason: "tool", usage: { input: 1 } },
      { message: assistant("done"), finishReason: "stop" },
    ]);
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: [{ agent: "helper" }] }, helper: { model: "h" } },
      flow: { in: "main" },
    }, { directory: ".", models: { m: model, h: helper } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.runs[0]?.usage).toEqual({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(result.runs[1]?.usage).toEqual({ input: 0, output: 0, cacheRead: 7, cacheWrite: 0 });
    expect(result.usage).toEqual({ input: 1, output: 0, cacheRead: 7, cacheWrite: 0 });
    await runtime.close();
  });

  it("reports a usage value that is not a number of zero or more as an invalid model result", async () => {
    const model: Model = { async generate(): Promise<ModelResult> { return { message: assistant("done"), finishReason: "stop", usage: { input: -1 } }; } };
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "modelResult", codes: ["value_invalid"], attempt: 1 });
    await runtime.close();
  });

  it("announces the usage of the run itself in turn.done", async () => {
    const helper: Model = { async generate(): Promise<ModelResult> { return { message: assistant("helped"), finishReason: "stop", usage: { input: 3 } }; } };
    const model = scripted([
      { message: callMessage("c1", "helper"), finishReason: "tool", usage: { input: 1 } },
      { message: assistant("done"), finishReason: "stop" },
    ]);
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: [{ agent: "helper" }] }, helper: { model: "h" } },
      flow: { in: "main" },
    }, { directory: ".", models: { m: model, h: helper }, host: { emit: (event) => { events.push(event); } } });

    await runtime.runTurn("hi", { conversationId: "c" });

    const done = events.filter((event) => event.name === "turn.done" && event.agent === "main");
    expect(done[0]?.data.usage).toEqual({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0 });
    await runtime.close();
  });
});

describe("the finish reason of a turn", () => {
  it("uses the value of the single output", async () => {
    const model: Model = { async generate(): Promise<ModelResult> { return { message: assistant("done"), finishReason: "length" }; } };
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: model } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.finishReason).toBe("length");
    expect(result.status).toBe("done");
    await runtime.close();
  });

  it("uses other when several outputs did not end the same way", async () => {
    const stop: Model = { async generate(): Promise<ModelResult> { return { message: assistant("a"), finishReason: "stop" }; } };
    const length: Model = { async generate(): Promise<ModelResult> { return { message: assistant("b"), finishReason: "length" }; } };
    const runtime = createRuntime({
      agents: { split: { model: "s" }, a: { model: "a" }, b: { model: "b" } },
      flow: { in: "split", routes: [{ from: "split", to: "a" }, { from: "split", to: "b" }, { from: "a", to: "out" }, { from: "b", to: "out" }] },
    }, { directory: ".", models: { s: stop, a: stop, b: length } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.finishReason).toBe("other");
    await runtime.close();
  });

  it("uses tool for a run a toolResult hook completed", async () => {
    const finish = defineExtension({
      name: "finish",
      hooks: ["toolResult"],
      create: () => ({ hooks: { toolResult: (value, ctx) => { ctx.execution.complete({ id: "end", role: "assistant", source: "hook", content: [{ type: "text", text: "bye" }] }); return value; } } }),
    });
    const act: Tool = { name: "act", description: "act", input: { type: "object" }, execute: (input, ctx) => ({ callId: ctx.toolCall.id, name: "act", args: input, content: [{ type: "text", text: "acted" }] }) };
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]);
    const runtime = createRuntime({
      agents: { main: { model: "m", tools: ["act"], extensions: { finish: {} }, hooks: { toolResult: [{ extension: "finish" }] } } },
    }, { directory: ".", models: { m: model }, tools: { act }, extensions: { finish } });

    const result = await runtime.runTurn("hi", { conversationId: "c" });

    expect(result.finishReason).toBe("tool");
    expect(result.runs[0]?.finishReason).toBe("tool");
    await runtime.close();
  });
});
