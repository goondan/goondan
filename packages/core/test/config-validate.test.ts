import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRuntime, defineExtension, GoondanConfigError, isGoondanExecutionError, loadConfigSync, sortIssues, validateConfig,
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
    expect(issuesOf(() => validateConfig({ flow: null, agents: { a: { model: "m" } } })))
      .toMatchObject([{ code: "schema.oneOf", path: "/flow" }]);
  });

  it("expands a serial flow into the object form", () => {
    const config = validateConfig({ agents: { a: { model: "m" }, b: { model: "m" } }, flow: ["a", "b"] });
    expect(config.flow).toEqual({ in: "a", routes: [{ from: "a", to: "b" }, { from: "b", to: "out" }] });
  });

  it("leaves omitted fields omitted", () => {
    const config = validateConfig({ agents: { a: { model: "m" } } });
    expect(config.agents.a).toEqual({ model: "m" });
  });

  it("never creates keys that the merged result did not have", () => {
    const config = validateConfig({ agents: { a: { model: "m", remove: { tools: [], extensions: [], hooks: { output: ["x"] } } } } });
    expect(config.agents.a).toEqual({ model: "m" });
  });

  it("removes tools, extensions and hooks by their identifiers", () => {
    const config = validateConfig({
      agents: {
        base: {
          model: "m",
          tools: ["search", { tool: "write" }, { agent: "helper" }],
          extensions: { audit: {}, memory: {} },
          hooks: { input: [{ agent: ["x", "y"] }], output: [{ agent: "helper" }, { extension: "audit" }], modelInput: [{ name: "ctx", extension: "memory" }] },
        },
        helper: { model: "m" },
        x: { model: "m" },
        y: { model: "m" },
        child: {
          inherit: "base",
          remove: { tools: ["write", "helper"], extensions: ["audit"], hooks: { input: ["x+y"], output: ["helper"], modelInput: ["memory"] } },
        },
      },
    });
    expect(config.agents.child).toEqual({
      model: "m",
      tools: ["search"],
      extensions: { memory: {} },
      hooks: { input: [], output: [], modelInput: [{ name: "ctx", extension: "memory" }] },
    });
    expect(config.agents.base?.tools).toHaveLength(3);
  });

  it("removes the hooks of a disabled extension only when building the effective config", () => {
    const config = validateConfig({
      agents: {
        base: { model: "m", extensions: { memo: { enabled: false } }, hooks: { modelInput: [{ extension: "memo" }] } },
        child: { inherit: "base", extensions: { memo: { enabled: true } } },
      },
    });
    expect(config.agents.base?.hooks?.modelInput).toEqual([]);
    expect(config.agents.child?.hooks?.modelInput).toEqual([{ extension: "memo" }]);
    expect(config.agents.base?.extensions).toEqual({ memo: { enabled: false } });
  });

  it("matches a template hook identifier by its path inside the configuration directory", () => {
    const root = workspace({
      "shared/base.yaml": "agents:\n  base: {model: m, hooks: {output: [{template: ./note.md}]}}\n",
      "shared/note.md": "note",
      "goondan.yaml": "resources: [./shared/base.yaml]\nagents:\n  child: {inherit: base, remove: {hooks: {output: [shared/note.md]}}}\n",
    });
    const loaded = loadConfigSync(root);
    expect(loaded.config.agents.child?.hooks?.output).toEqual([]);
    expect(loaded.config.agents.base?.hooks?.output).toHaveLength(1);
  });
});

describe("the reference phase", () => {
  it("collects every reference error at once", () => {
    const issues = issuesOf(() => validateConfig({
      agents: {
        a: { model: "m", tools: ["x", { tool: "x" }, { agent: "nope" }], extensions: { keep: {} }, hooks: { output: [{ extension: "gone" }, { agent: "missing" }] } },
      },
      flow: { in: "a", routes: [{ from: "a", to: "ghost" }] },
    }));
    expect(codes(issues)).toEqual([
      "/agents/a/hooks/output/0/extension:reference.extension",
      "/agents/a/hooks/output/1/agent:reference.agent",
      "/agents/a/tools/1:reference.duplicate_tool",
      "/agents/a/tools/2/agent:reference.agent",
      "/flow/routes/0/to:reference.agent",
    ]);
  });

  it("checks references of a serial flow at the declared position", () => {
    expect(issuesOf(() => validateConfig({ agents: { a: { model: "m" } }, flow: ["a", "b"] })))
      .toMatchObject([{ code: "reference.agent", path: "/flow/1" }]);
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

  it("rejects two async conversation hooks with the same identifier", () => {
    expect(issuesOf(() => validateConfig({
      agents: { a: { model: "m", hooks: { conversation: [{ fn: "note", mode: "async" }, { fn: "note", mode: "async" }] } } },
    }))).toMatchObject([{ code: "reference.duplicate_hook", path: "/agents/a/hooks/conversation/1" }]);
  });

  it("skips reference checks on config agents", () => {
    const config = validateConfig({ agents: { wrap: { config: "./inner", tools: [{ agent: "nope" }] } } });
    expect(config.agents.wrap).toEqual({ config: "./inner" });
  });

  it("does not run the reference phase when the schema phase failed", () => {
    expect(codes(issuesOf(() => validateConfig({ agents: { a: { model: "m", extra: 1, tools: [{ agent: "nope" }] } } }))))
      .toEqual(["/agents/a/extra:schema.additionalProperties"]);
  });
});

describe("the binding phase", () => {
  it("reports every missing binding of the configuration at once", () => {
    const issues = issuesOf(() => createRuntime({
      version: 1, name: "t",
      agents: { a: { model: "gone", tools: ["search"], input: { fn: "make" }, extensions: { memory: {} } } },
      flow: { in: "a", routes: [{ from: "a", to: "out", when: { fn: "decide" } }] },
    }, bindings()));
    expect(codes(issues)).toEqual([
      "/agents/a/extensions/memory:binding.extension",
      "/agents/a/input/fn:binding.function",
      "/agents/a/model:binding.model",
      "/agents/a/tools/0:binding.tool",
      "/flow/routes/0/when/fn:binding.function",
    ]);
  });

  it("reports a port the host did not register and a stage the extension does not declare", () => {
    const memory = defineExtension({ name: "memory", requires: ["store"], hooks: ["modelInput"], create: () => ({}) });
    const issues = issuesOf(() => createRuntime({
      version: 1, name: "t",
      agents: { a: { model: "main", extensions: { memory: {} }, hooks: { output: [{ extension: "memory" }] } } },
    }, bindings({ extensions: { memory } })));
    expect(codes(issues)).toEqual([
      "/agents/a/extensions/memory:binding.port",
      "/agents/a/hooks/output/0/extension:binding.extension_hook",
    ]);
  });

  it("reports a tool that a host tool and an extension both provide", () => {
    const memory = defineExtension({ name: "memory", tools: ["recall"], create: () => ({}) });
    const issues = issuesOf(() => createRuntime({
      version: 1, name: "t",
      agents: { a: { model: "main", tools: [{ tool: "recall" }], extensions: { memory: {} } } },
    }, bindings({ extensions: { memory }, tools: { recall: { name: "recall", description: "d", input: {}, execute: () => ({ callId: "c", name: "recall", args: null, content: [] }) } } })));
    expect(codes(issues)).toEqual(["/agents/a/tools/0/tool:binding.duplicate_tool"]);
  });

  it("defers the tool check when an enabled extension declares no tools", () => {
    const loose = defineExtension({ name: "loose", create: () => ({}) });
    const runtime = createRuntime({
      version: 1, name: "t",
      agents: { a: { model: "main", tools: ["later"], extensions: { loose: {} } } },
    }, bindings({ extensions: { loose } }));
    expect(runtime.loaded.config.agents.a?.tools).toEqual(["later"]);
  });

  it("skips config agents and checks nested configurations with the same bindings", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  main: {model: missing}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner, model: missing, tools: [gone]}\n",
    });
    const loaded = loadConfigSync(root);
    expect(codes(issuesOf(() => createRuntime(loaded, bindings()))))
      .toEqual(["/agents/wrap/config/agents/main/model:binding.model"]);
  });

  it("reads a plain document's nested configuration relative to the configuration directory", () => {
    const root = workspace({ "inner/goondan.yaml": "agents:\n  main: {model: main}\n" });
    const runtime = createRuntime({ agents: { wrap: { config: "./inner" } } }, bindings({ directory: root }));
    expect(runtime.loaded.config.agents.wrap).toEqual({ config: join(root, "inner") });
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
    expect(() => createRuntime(document, bindings({ maxRetries: -1 }))).toThrow(TypeError);
    expect(() => createRuntime(document, bindings({ maxRetries: 1.5 }))).toThrow(TypeError);
  });
});

describe("template references", () => {
  it("reports a template the reference phase cannot read", () => {
    const root = workspace({ "goondan.yaml": "agents:\n  a: {model: m, systemMessage: {template: ./missing.md}}\n" });
    expect(issuesOf(() => loadConfigSync(root)))
      .toMatchObject([{ code: "template.not_found", path: "/agents/a/systemMessage/template" }]);
  });

  it("never reads the templates left on a config agent", () => {
    const root = workspace({
      "inner/goondan.yaml": "agents:\n  main: {model: m}\n",
      "goondan.yaml": "agents:\n  wrap: {config: ./inner, systemMessage: {template: ./missing.md}}\n",
    });
    expect(loadConfigSync(root).config.agents.wrap).toEqual({ config: join(root, "inner") });
  });
});

describe("extension instance preparation", () => {
  it("fails the turn with a configuration error when an instance lacks a hooked stage", async () => {
    const quiet = defineExtension({ name: "quiet", create: () => ({}) });
    const runtime = createRuntime({
      version: 1, name: "t",
      agents: { a: { model: "main", extensions: { quiet: {} }, hooks: { output: [{ extension: "quiet" }] } } },
    }, bindings({ extensions: { quiet } }));
    const failure: unknown = await runtime.runTurn("hello", { conversationId: "c" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoondanConfigError);
    if (failure instanceof GoondanConfigError) {
      expect(codes(failure.issues)).toEqual(["/agents/a/hooks/output/0/extension:binding.extension_hook"]);
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
      { code: "schema.type", path: "/flow/routes/10", message: "aaa" },
      { code: "schema.type", path: "/flow/routes/2", message: "zzz" },
      { code: "schema.const", path: "/flow/routes/2", message: "zzz" },
      { code: "schema.type", path: "/flow", message: "zzz" },
      { code: "schema.type", path: "", message: "zzz" },
      { code: "schema.type", path: "/flow/in", message: "aaa" },
    ];
    expect(sortIssues(issues).map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      ":schema.type", "/flow:schema.type", "/flow/in:schema.type",
      "/flow/routes/2:schema.const", "/flow/routes/2:schema.type", "/flow/routes/10:schema.type",
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
    const runtime = createRuntime({ agents: { main: { model: "m" } } }, { directory: ".", models: { m: broken } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((cause: unknown) => cause);

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
    const runtime = createRuntime({ agents: { main: { model: "m", tools: ["act"] } } },
      { directory: ".", models: { m: model }, tools: { act } });

    const error: unknown = await runtime.runTurn("hi", { conversationId: "c" }).catch((cause: unknown) => cause);

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
