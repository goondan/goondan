import { describe, expect, it } from "vitest";
import {
  createGoondan, GoondanConfigError, GoondanExecutionError, validateConfig,
  type Message, type Model, type ModelInput, type ModelResult,
} from "../src/index.ts";

function assistant(text: string, extra: Message["content"] = []): Message {
  return { id: crypto.randomUUID(), role: "assistant", source: "model", content: [{ type: "text", text }, ...extra] };
}

function model(run: (input: ModelInput, signal: AbortSignal) => Promise<Message> | Message): Model {
  return { async generate(input, ctx): Promise<ModelResult> { return { message: await run(input, ctx.signal), finishReason: "stop" }; } };
}

function issueCodes(action: () => unknown): string[] {
  try { action(); return []; } catch (error) { return error instanceof GoondanConfigError ? error.issues.map((issue) => `${issue.path}:${issue.code}`) : []; }
}

describe("routes configuration", () => {
  it("expands the serial shorthand and preserves an omitted routes field", () => {
    expect(validateConfig({ agents: { a: { model: "m" }, b: { model: "m" } }, routes: ["a", "b"] }).routes).toEqual([
      { from: "$input", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "$output" },
    ]);
    expect(validateConfig({ agents: { a: { model: "m" } } })).not.toHaveProperty("routes");
  });

  it("reports reserved endpoints and missing entry and exit routes", () => {
    expect(issueCodes(() => validateConfig({ agents: { a: { model: "m" } }, routes: [{ from: "$input", to: "$output" }] }))).toEqual([
      "/routes:routes.no_input", "/routes:routes.no_output", "/routes/0:routes.reserved",
    ]);
    const endpoints = issueCodes(() => validateConfig({ agents: { a: { model: "m" } }, routes: [
      { from: "$output", to: "a" }, { from: "$input", to: "a" },
      { from: "a", to: "$input" }, { from: "a", to: "$output" },
    ] }));
    expect(endpoints).toContain("/routes/0/from:routes.reserved");
    expect(endpoints).toContain("/routes/2/to:routes.reserved");
    expect(issueCodes(() => validateConfig({ agents: { a: { model: "m" } }, routes: ["a", "$output"] })))
      .toContain("/routes/1:routes.reserved");
  });

  it("reports unreachable and unconditional-cycle routes", () => {
    const issues = issueCodes(() => validateConfig({ agents: { a: { model: "m" }, b: { model: "m" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "$output" }, { from: "b", to: "b" },
    ] }));
    expect(issues).toContain("/routes/2/from:routes.unreachable");
    expect(issues).toContain("/routes/2:routes.cycle");
  });

  it("reports only a real stateful wait cycle", () => {
    expect(issueCodes(() => validateConfig({ agents: { a: { model: "m" }, b: { model: "m" } }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" },
      { from: "a", to: "b", when: { output: "a" } }, { from: "b", to: "a", when: { output: "b" } },
      { from: "a", to: "$output" }, { from: "b", to: "$output" },
    ] }))).toContain("/routes:routes.wait_cycle");

    expect(issueCodes(() => validateConfig({ agents: { a: { model: "m" }, b: { model: "m" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "b" },
      { from: "b", to: "a", when: { output: "again" } }, { from: "a", to: "$output" },
    ] }))).not.toContain("/routes:routes.wait_cycle");
  });
});

describe("route execution", () => {
  it("starts matching branches concurrently and sorts outputs by route declaration", async () => {
    let releaseA: (() => void) | undefined;
    let releaseB: (() => void) | undefined;
    const aReady = new Promise<void>((resolve) => { releaseA = resolve; });
    const bReady = new Promise<void>((resolve) => { releaseB = resolve; });
    let aStarted = false; let bStarted = false;
    const runtime = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" } }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" },
      { from: "a", to: "$output" }, { from: "b", to: "$output" },
    ] }, { models: {
      a: model(async () => { aStarted = true; releaseA?.(); await bReady; return assistant("A"); }),
      b: model(async () => { bStarted = true; releaseB?.(); await aReady; return assistant("B"); }),
    } });
    const result = await runtime.run("go", { sessionId: "s" });
    expect([aStarted, bStarted]).toEqual([true, true]);
    expect(result.outputs.map((output) => output.content[0])).toEqual([{ type: "text", text: "A" }, { type: "text", text: "B" }]);
    expect(result.output.source).toBe("goondan");
    await runtime.close();
  });

  it("waits for a stateful fan-in and concatenates inputs in route order", async () => {
    let seen: Message[] = []; let inputHooks = 0;
    const runtime = createGoondan({ agents: { x: { model: "x", hooks: { input: [{ fn: "countInput" }] } }, y: { model: "y" } }, routes: [
      { from: "$input", to: "x" }, { from: "$input", to: "y" }, { from: "y", to: "x" }, { from: "x", to: "$output" },
    ] }, { models: {
      y: model(() => assistant("from-y", [{ type: "image", url: "https://example.test/image.png", mediaType: "image/png" }])),
      x: model((input) => { seen = input.messages; return assistant("done"); }),
    }, functions: { countInput: (value) => { inputHooks += 1; return value; } } });
    const result = await runtime.run("start", { sessionId: "s" });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.content).toEqual([{ type: "text", text: "start" }]);
    expect(seen[1]?.meta).toMatchObject({ from: "y", instance: "s/y" });
    expect(seen[1]?.content).toEqual([
      { type: "text", text: "from-y" },
      { type: "image", url: "https://example.test/image.png", mediaType: "image/png" },
    ]);
    expect(inputHooks).toBe(1);
    expect(result.runs.map((run) => run.agent)).toEqual(["y", "x"]);
    await runtime.close();
  });

  it("runs stateless arrivals independently and records unique instances", async () => {
    const runtime = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" }, x: { model: "x", stateful: false } }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" }, { from: "a", to: "x" }, { from: "b", to: "x" }, { from: "x", to: "$output" },
    ] }, { models: { a: model(() => assistant("a")), b: model(() => assistant("b")), x: model(() => assistant("x")) } });
    const result = await runtime.run("go", { sessionId: "s" });
    const instances = result.runs.filter((run) => run.agent === "x").map((run) => run.instance);
    expect(instances).toHaveLength(2);
    expect(new Set(instances).size).toBe(2);
    await runtime.close();
  });

  it("keeps delivery order when one output route fires more than once", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const runtime = createGoondan({ agents: {
      a: { model: "a" }, b: { model: "b" }, x: { model: "x", stateful: false },
    }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" },
      { from: "a", to: "x" }, { from: "b", to: "x" }, { from: "x", to: "$output" },
    ] }, { models: {
      a: model(() => assistant("slow")),
      b: model(async () => { await Promise.resolve(); return assistant("fast"); }),
      x: model(async (input) => {
        const part = input.messages[0]?.content[0];
        const text = part?.type === "text" ? part.text : "";
        if (text === "slow") await slowGate; else releaseSlow?.();
        return assistant(text);
      }),
    } });

    const result = await runtime.run("go", { sessionId: "s" });

    expect(result.outputs.map((message) => message.content[0])).toEqual([
      { type: "text", text: "fast" }, { type: "text", text: "slow" },
    ]);
    await runtime.close();
  });

  it("supports function and object output conditions", async () => {
    const runtime = createGoondan({ agents: { a: { model: "a" } }, routes: [
      { from: "$input", to: "a", when: { fn: "inputOk" } },
      { from: "a", to: "$output", when: { output: { ok: true } } },
    ] }, { models: { a: model(() => assistant('{"ok":true,"more":1}', [{ type: "json", value: "ignored" }])) }, functions: {
      inputOk(value) { return typeof value === "object" && value !== null && !Array.isArray(value) && value.text === "go"; },
    } });
    expect((await runtime.run("go", { sessionId: "s" })).outputs).toHaveLength(1);
    await runtime.close();
  });

  it("passes the original turn input to a downstream route function", async () => {
    let received: unknown;
    const runtime = createGoondan({ agents: { a: { model: "a" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "$output", when: { fn: "remember" } },
    ] }, { models: { a: model(() => assistant("done")) }, functions: { remember: (value) => { received = value; return true; } } });

    await runtime.run({ topic: "routes" }, { sessionId: "s" });

    expect(received).toMatchObject({ text: "done", input: [{ role: "user", source: "a", content: [{ type: "json", value: { topic: "routes" } }] }] });
    await runtime.close();
  });

  it("aborts another running branch after the first branch fails", async () => {
    let aborted = false;
    const runtime = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" } }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" }, { from: "a", to: "$output" }, { from: "b", to: "$output" },
    ] }, { models: {
      a: model(() => { throw new Error("branch failed"); }),
      b: model(async (_input, signal) => await new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(new Error("stopped")); }, { once: true });
      })),
    } });

    await expect(runtime.run("go", { sessionId: "s" })).rejects.toMatchObject({ codes: ["model_error"] });
    expect(aborted).toBe(true);
    await runtime.close();
  });

  it("aborts a running branch when another branch's route condition fails", async () => {
    let aborted = false;
    const runtime = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" } }, routes: [
      { from: "$input", to: "a" }, { from: "$input", to: "b" },
      { from: "a", to: "$output", when: { fn: "broken" } }, { from: "b", to: "$output" },
    ] }, { functions: { broken: () => { throw new Error("condition failed"); } }, models: {
      a: model(() => assistant("a")),
      b: model(async (_input, signal) => await new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(new Error("stopped")); }, { once: true });
      })),
    } });

    await expect(runtime.run("go", { sessionId: "s" })).rejects.toMatchObject({ codes: ["route_error"] });
    expect(aborted).toBe(true);
    await runtime.close();
  });

  it("reports invalid condition results and a source with no matching route", async () => {
    const invalid = createGoondan({ agents: { a: { model: "a" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "$output", when: { fn: "bad" } },
    ] }, { models: { a: model(() => assistant("x")) }, functions: { bad: () => 1 } });
    await expect(invalid.run("go", { sessionId: "s" })).rejects.toMatchObject({ codes: ["route_error"] });
    await invalid.close();

    const noMatch = createGoondan({ agents: { a: { model: "a" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "$output", when: { output: "other" } },
    ] }, { models: { a: model(() => assistant("x")) } });
    await expect(noMatch.run("go", { sessionId: "s" })).rejects.toBeInstanceOf(GoondanExecutionError);
    await noMatch.close();
  });

  it("runs startAgent through routes and agent without routes", async () => {
    const runtime = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "$output" },
    ] }, { models: { a: model(() => assistant("a")), b: model(() => assistant("b")) } });
    expect((await runtime.run("go", { sessionId: "s1", startAgent: "b" })).output.content[0]).toEqual({ type: "text", text: "b" });
    expect((await runtime.run("go", { sessionId: "s2", agent: "a" })).runs.map((run) => run.agent)).toEqual(["a"]);
    await expect(runtime.run("go", { sessionId: "s3", startAgent: "a" })).resolves.toMatchObject({ status: "done" });
    await runtime.close();

    const stopped = createGoondan({ agents: { a: { model: "a" }, b: { model: "b" } }, routes: [
      { from: "$input", to: "a" }, { from: "a", to: "$output" },
    ] }, { models: { a: model(() => assistant("a")), b: model(() => assistant("b")) } });
    await expect(stopped.run("go", { sessionId: "s", startAgent: "b" })).rejects.toMatchObject({ codes: ["route_error"] });
    await stopped.close();
  });
});
