import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGoondan, defineExtension, GoondanConfigError, MemoryConversationStore, TemplateRenderer, validateConfig, type ConfigIssue, type ModelResult } from "../src/index.ts";

function issuesOf(action: () => unknown): readonly ConfigIssue[] {
  try {
    action();
  } catch (error) {
    if (error instanceof GoondanConfigError) return error.issues;
    throw error;
  }
  throw new Error("Expected a configuration error");
}

describe("configuration and execution contracts", () => {
  it("resolves inheritance, overrides and individual removals without mutating the parent", () => {
    const config = validateConfig({ agents: {
      base: { model: "model", params: { a: 1, b: 2 }, tools: ["read", "write"], extensions: { memory: {}, audit: {} }, hooks: { modelInput: [{ extension: "memory" }, { name: "note", fn: "note" }, { extension: "audit" }] } },
      child: { inherit: "base", params: { b: 3 }, extensions: { audit: { enabled: false } }, remove: { tools: ["write"], extensions: ["memory"], hooks: { modelInput: ["note"] } } },
    } });
    expect(config.agents.child).toMatchObject({ model: "model", params: { a: 1, b: 3 }, tools: ["read"], extensions: { audit: { enabled: false } }, hooks: { modelInput: [] } });
    expect(config.agents.base?.tools).toEqual(["read", "write"]);
    expect(config.agents.base?.hooks?.modelInput).toHaveLength(3);
    expect(config).not.toHaveProperty("routes");
    expect(issuesOf(() => validateConfig({ agents: { a: { model: "m" } }, routes: ["a", "a"] })))
      .toMatchObject([{ code: "schema.uniqueItems", path: "/routes/1" }]);
    expect(validateConfig(config)).toEqual(config);
    expect(issuesOf(() => validateConfig({ agents: { a: { inherit: "b" }, b: { inherit: "a" } } })))
      .toMatchObject([{ code: "reference.inherit_cycle", path: "/agents/a/inherit" }]);
    expect(issuesOf(() => validateConfig({ agents: { a: { inherit: "missing" } } })))
      .toMatchObject([{ code: "reference.inherit", path: "/agents/a/inherit" }]);
    expect(issuesOf(() => validateConfig({ agents: { a: { model: "m", hooks: { output: [{ fn: "later", mode: "async" }] } } } })))
      .toMatchObject([{ code: "schema.const", path: "/agents/a/hooks/output/0/mode" }]);
    expect(validateConfig({ agents: { a: { model: "m", hooks: { conversation: [{ fn: "later", mode: "async" }] } } } }).agents.a?.hooks?.conversation).toHaveLength(1);
  });

  it("accepts only the shared template filters, defined test and static includes", () => {
    const renderer = new TemplateRenderer(new Map([
      ["/cfg/main.md", "{% if value is defined %}{{ value | default('x') | upper }}{% endif %}{% include 'tail.md' %}"],
      ["/cfg/tail.md", "{{ items | join(',') | trim }}"],
    ]), "/cfg");
    expect(renderer.render("/cfg/main.md", { value: "ok", items: ["a", "b"] })).toBe("OKa,b");
    expect(renderer.render("main.md", { value: "ok", items: ["a", "b"] })).toBe("OKa,b");
    for (const source of ["{{ value | safe }}", "{% include target %}", "{% set value = 1 %}"]) {
      expect(() => new TemplateRenderer(new Map([["/cfg/bad.md", source]]), "/cfg").render("/cfg/bad.md", {})).toThrow("is not valid");
    }
  });

  it("reads the templates of a configuration document once, relative to the configuration directory", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-runtime-")));
    writeFileSync(join(root, "greeting.md"), "Hi {{ params.who }}");
    const document = { agents: { main: { model: "m", params: { who: "you" }, systemMessage: { template: "./greeting.md" } } } };
    let system = "";
    const runtime = createGoondan(document, { directory: root, models: {
      m: { async generate(input): Promise<ModelResult> {
        system = input.system[0]?.text ?? "";
        return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "ok" }] }, finishReason: "stop" };
      } },
    } });
    expect(runtime.loaded.templates.get(join(root, "greeting.md"))).toBe("Hi {{ params.who }}");
    writeFileSync(join(root, "greeting.md"), "changed");
    await runtime.run("x", { sessionId: "c" });
    expect(system).toBe("Hi you");
    await runtime.close();
    expect(issuesOf(() => createGoondan({ agents: { main: { model: "m", systemMessage: { template: "./nowhere.md" } } } }, { directory: root, models: {} })))
      .toMatchObject([{ code: "template.not_found", path: "/agents/main/systemMessage/template" }]);
  });

  it("connects serial routes with only the last output", async () => {
    const config = validateConfig({ agents: { analyst: { model: "a" }, editor: { inherit: "analyst", model: "e" } }, routes: ["analyst", "editor"] });
    const runtime = createGoondan({ config, directory: ".", templates: new Map() }, { models: {
      a: { async generate(): Promise<ModelResult> { return { message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "analysis" }] }, finishReason: "stop" }; } },
      e: { async generate(input): Promise<ModelResult> { expect(input.messages[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "analysis" }], meta: { from: "analyst", instance: "serial/analyst" } }); return { message: { id: "e", role: "assistant", source: "model", content: [{ type: "text", text: "edited" }] }, finishReason: "stop" }; } },
    } });
    expect((await runtime.run("input", { sessionId: "serial" })).output.content).toEqual([{ type: "text", text: "edited" }]);
    await runtime.close();
  });

  it("allows more than 32 model steps and completes after saving every result in the current tool batch", async () => {
    const store = new MemoryConversationStore(); let generations = 0; let toolCalls = 0;
    const config = validateConfig({ agents: { main: { model: "model", tools: ["work"], extensions: { policy: {} }, hooks: { toolResult: [{ extension: "policy" }] } } } });
    const runtime = createGoondan({ config, directory: ".", templates: new Map() }, { conversationStore: store, models: {
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
    const result = await runtime.run("input", { sessionId: "long" });
    expect(generations).toBe(34); expect(toolCalls).toBe(68);
    expect(result.output.content).toEqual([{ type: "text", text: "complete" }]);
    expect((await store.load("long", "main")).flatMap((m) => m.content).filter((p) => p.type === "tool.result")).toHaveLength(68);
    await runtime.close();
  });
});
