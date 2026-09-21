import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGoondan, defineExtension, GoondanConfigError, isGoondanExecutionError, loadConfigSync, sortIssues, validateConfig,
  type ConfigIssue, type Model, type ModelResult, type RuntimeBindings, type Tool,
} from "../src/index.ts";

function issuesOf(action: () => unknown): readonly ConfigIssue[] {
  try {
    action();
  } catch (error) {
    if (error instanceof GoondanConfigError) return error.issues;
    throw error;
  }
  throw new Error("Expected a configuration error");
}

function codes(issues: readonly ConfigIssue[]): string[] {
  return issues.map((issue) => `${issue.path}:${issue.code}`);
}

function workspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "goondan-validate-")));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

const stubModel: Model = {
  async generate(): Promise<ModelResult> {
    return { message: { id: "m", role: "assistant", source: "model", content: [] }, finishReason: "stop" };
  },
};

function bindings(extra: Partial<RuntimeBindings> = {}): RuntimeBindings {
  return { models: { main: stubModel }, ...extra };
}

describe("the effective configuration", () => {
  it("applies the version and name defaults only when the field is absent", () => {
    expect(validateConfig({ agents: { a: { model: "m" } } })).toMatchObject({ version: 1, name: "goondan" });
    expect(issuesOf(() => validateConfig({ name: null, agents: { a: { model: "m" } } })))
      .toMatchObject([{ code: "schema.type", path: "/name" }]);
    expect(issuesOf(() => validateConfig({ routes: null, agents: { a: { model: "m" } } })))
      .toMatchObject([{ code: "schema.oneOf", path: "/routes" }]);
  });

  it("expands serial routes into the object form", () => {
    const config = validateConfig({ agents: { a: { model: "m" }, b: { model: "m" } }, routes: ["a", "b"] });
    expect(config.routes).toEqual([{ from: "$input", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "$output" }]);
  });

  it("leaves omitted fields omitted", () => {
    const config = validateConfig({ agents: { a: { model: "m" } } });
    expect(config.agents.a).toEqual({ model: "m" });
  });

  it("never creates keys that the merged result did not have", () => {
    const config = validateConfig({ agents: { a: { model: "m", remove: { tools: [], extensions: [], hooks: { onOutput: ["x"] } } } } });
    expect(config.agents.a).toEqual({ model: "m" });
  });

  it("removes tools, extensions and hooks by their identifiers", () => {
    const config = validateConfig({
      agents: {
        base: {
          model: "m",
          tools: ["search", { tool: "write" }, { agent: "helper" }],
          extensions: { audit: {}, memory: {} },
          hooks: { onPrompt: [{ agent: ["x", "y"] }], onOutput: [{ agent: "helper" }, { extension: "audit" }], onModelInput: [{ name: "ctx", extension: "memory" }] },
        },
        helper: { model: "m" },
        x: { model: "m" },
        y: { model: "m" },
        child: {
          inherit: "base",
          remove: { tools: ["write", "helper"], extensions: ["audit"], hooks: { onPrompt: ["x+y"], onOutput: ["helper"], onModelInput: ["memory"] } },
        },
      },
    });
    expect(config.agents.child).toEqual({
      model: "m",
      tools: ["search"],
      extensions: { memory: {} },
      hooks: { onPrompt: [], onOutput: [], onModelInput: [{ name: "ctx", extension: "memory" }] },
    });
    expect(config.agents.base?.tools).toHaveLength(3);
  });

  it("removes the hooks of a disabled extension only when building the effective config", () => {
    const config = validateConfig({
      agents: {
        base: { model: "m", extensions: { memo: { enabled: false } }, hooks: { onModelInput: [{ extension: "memo" }] } },
        child: { inherit: "base", extensions: { memo: { enabled: true } } },
      },
    });
    expect(config.agents.base?.hooks?.onModelInput).toEqual([]);
    expect(config.agents.child?.hooks?.onModelInput).toEqual([{ extension: "memo" }]);
    expect(config.agents.base?.extensions).toEqual({ memo: { enabled: false } });
  });

  it("matches a template hook identifier by its path inside the configuration directory", () => {
    const root = workspace({
      "shared/base.yaml": "agents:\n  base: {model: m, hooks: {onOutput: [{template: ./note.md}]}}\n",
      "shared/note.md": "note",
      "goondan.yaml": "resources: [./shared/base.yaml]\nagents:\n  child: {inherit: base, remove: {hooks: {onOutput: [shared/note.md]}}}\n",
    });
    const loaded = loadConfigSync(root);
    expect(loaded.config.agents.child?.hooks?.onOutput).toEqual([]);
    expect(loaded.config.agents.base?.hooks?.onOutput).toHaveLength(1);
  });
});

describe("the reference phase", () => {
  it("collects every reference error at once", () => {
    const issues = issuesOf(() => validateConfig({
      agents: {
        a: { model: "m", tools: ["x", { tool: "x" }, { agent: "nope" }], extensions: { keep: {} }, hooks: { onOutput: [{ extension: "gone" }, { agent: "missing" }] } },
      },
      routes: [{ from: "$input", to: "a" }, { from: "a", to: "ghost" }, { from: "a", to: "$output" }],
    }));
    expect(codes(issues)).toEqual([
      "/agents/a/hooks/onOutput/0/extension:reference.extension",
      "/agents/a/hooks/onOutput/1/agent:reference.agent",
      "/agents/a/tools/1:reference.duplicate_tool",
      "/agents/a/tools/2/agent:reference.agent",
      "/routes/1/to:reference.agent",
    ]);
  });

  it("checks references of serial routes at the declared position", () => {
    expect(issuesOf(() => validateConfig({ agents: { a: { model: "m" } }, routes: ["a", "b"] })))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "reference.agent", path: "/routes/1" })]));
  });

  it("reports only the inheritance error for agents that cannot resolve", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { inherit: "missing" }, b: { inherit: "a", tools: [{ agent: "nope" }] } },
    })))).toEqual(["/agents/a/inherit:reference.inherit"]);
  });

  it("reports a merge that leaves the schema", () => {
    expect(issuesOf(() => validateConfig({
      agents: { base: { model: "m", systemMessage: { text: "a" } }, child: { inherit: "base", systemMessage: { template: "t.md" } } },
    }))).toMatchObject([{ code: "schema.oneOf", path: "/agents/child/systemMessage" }]);
  });

  it("keeps duplicate asynchronous hook identifiers in declaration order", () => {
    const config = validateConfig({
      agents: { a: { model: "m", hooks: { onPrompt: [{ fn: "note", mode: "async" }, { fn: "note", mode: "async" }] } } },
    });
    expect(config.agents.a?.hooks?.onPrompt).toHaveLength(2);
  });

  it("does not run the reference phase when the schema phase failed", () => {
    expect(codes(issuesOf(() => validateConfig({ agents: { a: { model: "m", extra: 1, tools: [{ agent: "nope" }] } } }))))
      .toEqual(["/agents/a/extra:schema.additionalProperties"]);
  });
});

describe("the binding phase", () => {
  it("reports every missing binding of the configuration at once", () => {
    const issues = issuesOf(() => createGoondan({
      version: 1, name: "t",
      agents: { a: { model: "gone", tools: ["search"], input: { fn: "make" }, extensions: { memory: {} } } },
      routes: [{ from: "$input", to: "a" }, { from: "a", to: "$output", when: { fn: "decide" } }],
    }, bindings()));
    expect(codes(issues)).toEqual([
      "/agents/a/extensions/memory:binding.extension",
      "/agents/a/input/fn:binding.function",
      "/agents/a/model:binding.model",
      "/agents/a/tools/0:binding.tool",
      "/routes/1/when/fn:binding.function",
    ]);
  });

  it("reports a port the host did not register and a stage the extension does not declare", () => {
    const memory = defineExtension({ name: "memory", requires: ["store"], hooks: ["onModelInput"], create: () => ({}) });
    const issues = issuesOf(() => createGoondan({
      version: 1, name: "t",
      agents: { a: { model: "main", extensions: { memory: {} }, hooks: { onOutput: [{ extension: "memory" }] } } },
    }, bindings({ extensions: { memory } })));
    expect(codes(issues)).toEqual([
      "/agents/a/extensions/memory:binding.port",
      "/agents/a/hooks/onOutput/0/extension:binding.extension_hook",
    ]);
  });

  it("reports a tool that a host tool and an extension both provide", () => {
    const memory = defineExtension({ name: "memory", tools: ["recall"], create: () => ({}) });
    const issues = issuesOf(() => createGoondan({
      version: 1, name: "t",
      agents: { a: { model: "main", tools: [{ tool: "recall" }], extensions: { memory: {} } } },
    }, bindings({ extensions: { memory }, tools: { recall: { name: "recall", description: "d", input: {}, execute: () => ({ callId: "c", name: "recall", args: null, content: [] }) } } })));
    expect(codes(issues)).toEqual(["/agents/a/tools/0/tool:binding.duplicate_tool"]);
  });

  it("defers the tool check when an enabled extension declares no tools", () => {
    const loose = defineExtension({ name: "loose", create: () => ({}) });
    const runtime = createGoondan({
      version: 1, name: "t",
      agents: { a: { model: "main", tools: ["later"], extensions: { loose: {} } } },
    }, bindings({ extensions: { loose } }));
    expect(runtime.loaded.config.agents.a?.tools).toEqual(["later"]);
  });

});

describe("host language names", () => {
  it("treats __proto__ and toString as ordinary configuration keys", () => {
    const config = validateConfig(JSON.parse(JSON.stringify({
      agents: {
        ["__proto__"]: { model: "m", params: { ["__proto__"]: 1, toString: 2 }, extensions: { ["__proto__"]: { enabled: false } } },
        toString: { inherit: "__proto__" },
      },
    })));
    expect(Object.keys(config.agents)).toEqual(["__proto__", "toString"]);
    expect(Object.hasOwn(config.agents, "__proto__")).toBe(true);
    expect(config.agents.toString?.params).toEqual(JSON.parse('{"__proto__": 1, "toString": 2}'));
    expect(issuesOf(() => validateConfig({ agents: { a: { inherit: "toString" } } })))
      .toMatchObject([{ code: "reference.inherit", path: "/agents/a/inherit" }]);
  });

  it("rejects a runtime retry budget that is not a whole count", () => {
    const document = { version: 1, name: "t", agents: { a: { model: "main" } } };
    expect(() => createGoondan(document, bindings({ maxRetries: -1 }))).toThrow(TypeError);
    expect(() => createGoondan(document, bindings({ maxRetries: 1.5 }))).toThrow(TypeError);
  });
});

describe("template references", () => {
  it("reports a template the reference phase cannot read", () => {
    const root = workspace({ "goondan.yaml": "agents:\n  a: {model: m, systemMessage: {template: ./missing.md}}\n" });
    expect(issuesOf(() => loadConfigSync(root)))
      .toMatchObject([{ code: "template.not_found", path: "/agents/a/systemMessage/template" }]);
  });

});

describe("extension instance preparation", () => {
  it("fails the turn with a configuration error when an instance lacks a hooked stage", async () => {
    const quiet = defineExtension({ name: "quiet", create: () => ({}) });
    const runtime = createGoondan({
      version: 1, name: "t",
      agents: { a: { model: "main", extensions: { quiet: {} }, hooks: { onOutput: [{ extension: "quiet" }] } } },
    }, bindings({ extensions: { quiet } }));
    const failure: unknown = await runtime.run("hello", { sessionId: "c" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoondanConfigError);
    if (failure instanceof GoondanConfigError) {
      expect(codes(failure.issues)).toEqual(["/agents/a/hooks/onOutput/0/extension:binding.extension_hook"]);
    }
    await runtime.close();
  });
});

describe("the configuration error", () => {
  it("formats one line per issue in path order", () => {
    try {
      validateConfig({ version: 2, agents: {} });
      throw new Error("Expected a configuration error");
    } catch (error) {
      if (!(error instanceof GoondanConfigError)) throw error;
      expect(error.message).toBe([
        "Invalid Goondan configuration:",
        "- /agents: must not be empty [schema.minProperties]",
        "- /version: must be 1 [schema.const]",
      ].join("\n"));
    }
  });

  it("reports a value that is not JSON", () => {
    expect(issuesOf(() => validateConfig({ agents: { a: { model: "m", params: { ratio: Number.POSITIVE_INFINITY } } } })))
      .toMatchObject([{ code: "config.not_json", path: "/agents/a/params/ratio" }]);
  });

  it("orders issues by path segments and then by code, and never by message", () => {
    const issues: readonly ConfigIssue[] = [
      { code: "schema.type", path: "/routes/10", message: "aaa" },
      { code: "schema.type", path: "/routes/2", message: "zzz" },
      { code: "schema.const", path: "/routes/2", message: "zzz" },
      { code: "schema.type", path: "/routes", message: "zzz" },
      { code: "schema.type", path: "", message: "zzz" },
      { code: "schema.type", path: "/routes/0", message: "aaa" },
    ];
    expect(sortIssues(issues).map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      ":schema.type", "/routes:schema.type", "/routes/0:schema.type",
      "/routes/2:schema.const", "/routes/2:schema.type", "/routes/10:schema.type",
    ]);
  });

  it("keeps the item a phase made first for one path and code, whatever the messages are", () => {
    const issues: readonly ConfigIssue[] = [
      { code: "schema.type", path: "/agents/a", message: "kept wording" },
      { code: "schema.type", path: "/agents/a", message: "another wording" },
      { code: "schema.enum", path: "/agents/a", message: "kept wording" },
    ];
    expect(sortIssues(issues)).toEqual([
      { code: "schema.enum", path: "/agents/a", message: "kept wording" },
      { code: "schema.type", path: "/agents/a", message: "kept wording" },
    ]);
    // The exception reports the same deduplicated list, so its message has one line per pair.
    expect(new GoondanConfigError(issues).issues).toHaveLength(2);
  });
});

describe("the execution error", () => {
  it("throws the exported execution error class with the fields of an execution error", async () => {
    const broken: Model = { async generate(): Promise<ModelResult> { throw new Error("model down"); } };
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: broken } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    expect(isGoondanExecutionError(error)).toBe(true);
    if (!isGoondanExecutionError(error)) throw new Error("Expected an execution error");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GoondanExecutionError");
    expect({ where: error.where, codes: error.codes, message: error.message, attempt: error.attempt })
      .toEqual({ where: "model", codes: ["model_error"], message: "model down", attempt: 1 });
    // `toolCall` belongs to a `tool` failure alone and carries no call anywhere else.
    expect(error.toolCall).toBeUndefined();
    await runtime.close();
  });

  it("carries the failed call of a tool failure", async () => {
    const model: Model = {
      async generate(): Promise<ModelResult> {
        return {
          message: { id: "m", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "c1", name: "act", args: { n: 1 } }] },
          finishReason: "tool",
        };
      },
    };
    const act: Tool = { name: "act", description: "act", input: {}, execute: () => { throw new Error("tool down"); } };
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["act"] } } },
      { directory: ".", models: { m: model }, tools: { act } });

    const error: unknown = await runtime.run("hi", { sessionId: "c" }).catch((cause: unknown) => cause);

    if (!isGoondanExecutionError(error)) throw new Error("Expected an execution error");
    expect({ where: error.where, codes: error.codes, attempt: error.attempt }).toEqual({ where: "tool", codes: ["tool_error"], attempt: 1 });
    expect(error.toolCall).toEqual({ id: "c1", name: "act", args: { n: 1 } });
    await runtime.close();
  });

  it("reports a value that is not an execution error", () => {
    expect(isGoondanExecutionError(new Error("plain"))).toBe(false);
    expect(isGoondanExecutionError({ where: "model", codes: ["model_error"], message: "m", attempt: 1 })).toBe(false);
    expect(isGoondanExecutionError(undefined)).toBe(false);
  });
});
