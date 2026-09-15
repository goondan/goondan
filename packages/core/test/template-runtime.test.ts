import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime, defineExtension, loadConfigSync, type Json, type ModelResult } from "../src/index.ts";
import { executionError } from "./execution-error.ts";

const roots: string[] = [];

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-tpl-run-")));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

/** The execution error a failed turn throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[] } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes } : undefined;
}

const echo = { async generate(): Promise<ModelResult> {
  return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "ok" }] }, finishReason: "stop" };
} };

afterEach(() => { roots.length = 0; });

/** Records the system blocks and the first user message of the single model call a turn makes. */
function recorder(): { system: string[]; user: string; model: { generate(input: { system: { text: string }[]; messages: { content: Json }[] }): Promise<ModelResult> } } {
  const seen = { system: [] as string[], user: "" };
  return {
    get system(): string[] { return seen.system; },
    get user(): string { return seen.user; },
    model: { async generate(input): Promise<ModelResult> {
      seen.system = input.system.map((block) => block.text);
      const content = input.messages[0]?.content;
      const part = Array.isArray(content) ? content[0] : undefined;
      seen.user = typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "";
      return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "ok" }] }, finishReason: "stop" };
    } },
  };
}

describe("template variables of each declaration site", () => {
  it("gives a system block params, tools, agent and model", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    params: {k: v}\n    tools: [echo]\n    systemMessage: {template: ./sys.md}\n",
      "sys.md": "{{ params.k }}|{{ tools | length }}|{{ tools[0].name }}|{{ tools[0].description }}|{{ agent.name }}|{{ model }}",
    });
    const seen = recorder();
    const runtime = createRuntime(loadConfigSync(root), {
      models: { m: seen.model },
      tools: { echo: { name: "echo", description: "d", input: {}, async run(): Promise<Json> { return null; } } },
    });
    await runtime.runTurn("x", { conversationId: "c" });
    expect(seen.system).toEqual(["v|1|echo|d|main|m"]);
    await runtime.close();
  });

  it("gives an input template the keys of an object input, or text for anything else", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, input: {template: ./in.md}}\n",
      "in.md": "[{{ text | default('-') }}|{{ a | default('-') }}]",
    });
    const seen = recorder();
    const runtime = createRuntime(loadConfigSync(root), { models: { m: seen.model } });
    await runtime.runTurn({ a: 1 }, { conversationId: "c" });
    expect(seen.user).toBe("[-|1]");
    await runtime.runTurn("plain", { conversationId: "d" });
    expect(seen.user).toBe("[plain|-]");
    await runtime.close();
  });

  it("gives an inline hook template the previous value, the input and the params", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main:\n    model: m\n    params: {k: v}\n    hooks: {input: [{template: ./hook.md}]}\n",
      "hook.md": "{{ text }}-{{ input }}-{{ params.k }}",
    });
    const seen = recorder();
    const runtime = createRuntime(loadConfigSync(root), { models: { m: seen.model } });
    await runtime.runTurn("in", { conversationId: "c" });
    expect(seen.user).toBe("in-in-v");
    await runtime.close();
  });

  it("prints the assistant message an output hook template receives", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, hooks: {output: [{template: ./out.md}]}}\n",
      "out.md": "{{ text.content[0].text }}|{{ text.role }}",
    });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo } });
    const result = await runtime.runTurn("x", { conversationId: "c" });
    const part = result.outputs[0]?.content[0];
    expect(part && "text" in part ? part.text : "").toBe("ok|assistant");
    await runtime.close();
  });

  it("fails the hook stage when an inline hook template cannot render", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, hooks: {input: [{template: ./hook.md}]}}\n",
      "hook.md": "{{ missing }}",
    });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo } });
    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((reason: unknown) => reason);
    expect(failure(error)).toEqual({ where: "input", codes: ["hook_error"] });
    await runtime.close();
  });

  it("gives a carry template the output, the input and the conversation", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  a: {model: m}\n  b: {model: m}\n"
        + "flow:\n  in: a\n  routes:\n    - {from: a, to: b, carry: {message: {template: ./carry.md}}}\n    - {from: b, to: out}\n",
      "carry.md": "{{ output }}|{{ input }}|{{ conversation | length }}|{{ conversation[0].role }}",
    });
    const seen = recorder();
    const runtime = createRuntime(loadConfigSync(root), { models: { m: seen.model } });
    await runtime.runTurn("start", { conversationId: "c" });
    expect(seen.user).toBe("ok|start|2|user");
    await runtime.close();
  });

  it("reads the templates of a plain document from the directory the host names", async () => {
    const root = workspace({ "templates/sys.md": "from {{ agent.name }}" });
    const document = { agents: { main: { model: "m", systemMessage: { template: "./templates/sys.md" } } } };
    const seen = recorder();
    const runtime = createRuntime(document, { models: { m: seen.model }, directory: root });
    await runtime.runTurn("x", { conversationId: "c" });
    expect(seen.system).toEqual(["from main"]);
    await runtime.close();
  });
});

describe("template rendering inside a runtime", () => {
  it("fails the input stage when the input template cannot render", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, input: {template: ./in.md}}\n",
      "in.md": "{{ nothing }}",
    });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo } });
    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((reason: unknown) => reason);
    expect(failure(error)).toEqual({ where: "input", codes: ["runtime_error"] });
    await runtime.close();
  });

  it("fails the modelInput stage when a system block cannot render", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, systemMessage: {template: ./sys.md}}\n",
      "sys.md": "{{ params.missing }}",
    });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo } });
    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((reason: unknown) => reason);
    expect(failure(error)).toEqual({ where: "modelInput", codes: ["runtime_error"] });
    await runtime.close();
  });

  it("reports a carry template failure as a flow error", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  a: {model: m}\n  b: {model: m}\nflow:\n  in: a\n  routes:\n    - {from: a, to: b, carry: {message: {template: ./carry.md}}}\n    - {from: b, to: out}\n",
      "carry.md": "{{ nothing }}",
    });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo } });
    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((reason: unknown) => reason);
    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    await runtime.close();
  });

  it("renders a loaded template from a hook by absolute or configuration-relative path", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, systemMessage: {template: ./templates/note.md}, extensions: {probe: {}}, hooks: {input: [{extension: probe}]}}\n",
      "templates/note.md": "note:{{ who | default('') }}",
    });
    const rendered: string[] = [];
    let refused = "";
    const probe = defineExtension({ name: "probe", hooks: ["input"], create: () => ({ hooks: { async input(value, ctx): Promise<Json> {
      rendered.push(await ctx.render(join(root, "templates", "note.md"), { who: "a" }));
      rendered.push(await ctx.render("templates/note.md", { who: "b" }));
      refused = await ctx.render("/etc/hosts", {}).then(() => "", (error: unknown) => (error instanceof Error ? error.message : ""));
      return typeof value === "string" || value === null ? value : null;
    } } }) });
    const runtime = createRuntime(loadConfigSync(root), { models: { m: echo }, extensions: { probe } });
    await runtime.runTurn("x", { conversationId: "c" });
    expect(rendered).toEqual(["note:a", "note:b"]);
    expect(refused).toContain("Template not loaded");
    await runtime.close();
  });

  it("reuses the templates of a load result and never reads a file again", async () => {
    const root = workspace({
      "goondan.yaml": "agents:\n  main: {model: m, params: {who: you}, systemMessage: {template: ./templates/hi.md}}\n",
      "templates/hi.md": "Hi {{ params.who }}{% include 'tail.md' %}",
      "templates/tail.md": "!",
    });
    const loaded = loadConfigSync(root);
    rmSync(join(root, "templates"), { recursive: true, force: true });
    let system = "";
    const runtime = createRuntime(loaded, { models: { m: { async generate(input): Promise<ModelResult> {
      system = input.system[0]?.text ?? "";
      return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "ok" }] }, finishReason: "stop" };
    } } } });
    await runtime.runTurn("x", { conversationId: "c" });
    expect(system).toBe("Hi you!");
    await runtime.close();
  });
});
