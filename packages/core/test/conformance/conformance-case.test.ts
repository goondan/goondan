import { describe, expect, it } from "vitest";
import type { Json } from "./conformance-json.ts";
import { parseCase, parseExpected, parseOp } from "./conformance-case.ts";

const minimal: Json = { description: "설명", spec: ["에이전트"], steps: [] };

describe("parseCase", () => {
  it("fills the default config and empty bindings", () => {
    const parsed = parseCase(minimal);
    expect(parsed.config).toEqual({ mode: "file", path: "config", variants: [] });
    expect(parsed.bindings.models.size).toBe(0);
    expect(parsed.steps).toEqual([]);
  });

  it("rejects unknown keys and empty citations", () => {
    expect(() => parseCase({ ...minimal, extra: 1 })).toThrow("/extra");
    expect(() => parseCase({ ...minimal, spec: [] })).toThrow("at least one");
    expect(() => parseCase({ ...minimal, spec: ["a", "a"] })).toThrow("repeats a");
  });

  it("rejects path together with document", () => {
    expect(() => parseCase({ ...minimal, config: { path: "config", document: {} } })).toThrow("both path and document");
    expect(() => parseCase({ ...minimal, config: { document: {}, variants: [] } })).toThrow("/config/variants");
    expect(() => parseCase({ ...minimal, config: { path: "c", directory: "d" } })).toThrow("/config/directory");
  });

  it("reads the document mode with its default directory", () => {
    const parsed = parseCase({ ...minimal, config: { document: { agents: {} } } });
    expect(parsed.config).toEqual({ mode: "document", document: { agents: {} }, directory: "config" });
  });

  it("parses steps and keeps optional keys out when absent", () => {
    const parsed = parseCase({
      ...minimal,
      steps: [
        { run: { sessionId: "c1", input: "hi" } },
        { decide: { operation: "<op:a>", value: { decision: "approved" } }, settle: false },
        { release: "gate" },
        { reach: "gate" },
        { parallel: [[{ run: { sessionId: "c1", input: "a" } }]] },
      ],
    });
    expect(parsed.steps[0]).toEqual({ action: "run", settle: true, sessionId: "c1", input: "hi" });
    expect(parsed.steps[1]).toMatchObject({ action: "decide", settle: false, operation: "<op:a>" });
    expect(parsed.steps[3]).toEqual({ action: "reach", settle: false, gate: "gate" });
    expect(parsed.steps[4]).toMatchObject({ action: "parallel" });
  });

  it("parses steer targets and session deletion", () => {
    const parsed = parseCase({
      ...minimal,
      steps: [
        { steer: { sessionId: "c1", value: "추가", agent: "main" } },
        { deleteSession: { sessionId: "c1" } },
      ],
    });
    expect(parsed.steps).toEqual([
      { action: "steer", settle: true, sessionId: "c1", value: "추가", agent: "main" },
      { action: "deleteSession", settle: true, sessionId: "c1" },
    ]);
  });

  it("rejects two action keys, an unknown action and the reserved gate", () => {
    expect(() => parseCase({ ...minimal, steps: [{ close: {}, restart: {} }] })).toThrow("only one action key");
    expect(() => parseCase({ ...minimal, steps: [{ sleep: 1 }] })).toThrow("one action key");
    expect(() => parseCase({ ...minimal, steps: [{ release: "never" }] })).toThrow("never");
  });

  it("accepts close and rejects restart, parallel and settle inside a branch", () => {
    expect(parseCase({ ...minimal, steps: [{ parallel: [[{ close: {} }]] }] }).steps).toEqual([
      { action: "parallel", settle: true, branches: [[{ action: "close", settle: true }]] },
    ]);
    expect(() =>
      parseCase({ ...minimal, steps: [{ parallel: [[{ release: "g", settle: false }]] }] }),
    ).toThrow("inside a parallel branch");
  });

  it("rejects a hook operation in a function binding", () => {
    expect(() =>
      parseCase({ ...minimal, bindings: { functions: { f: { op: "append", messages: [] } } } }),
    ).toThrow("only allowed in extension instance hooks");
  });

  it("accepts a hook operation in an extension instance hook", () => {
    const parsed = parseCase({
      ...minimal,
      bindings: {
        extensions: {
          memory: {
            definition: { hooks: ["modelInput"] },
            instance: { hooks: { modelInput: { op: "append", messages: [{ role: "user", text: "기억" }] } } },
          },
        },
      },
    });
    expect(parsed.bindings.extensions.get("memory")?.instance?.hooks.get("modelInput")).toMatchObject({ op: "append" });
  });

  it("rejects an unknown value stage", () => {
    expect(() =>
      parseCase({ ...minimal, bindings: { extensions: { m: { instance: { hooks: { nope: { op: "identity" } } } } } } }),
    ).toThrow("is not a value stage");
  });

  it("reads model scripts with exactly one response key", () => {
    const parsed = parseCase({
      ...minimal,
      bindings: { models: { m: { responses: [{ text: "hi", usage: { input: 1 } }] } } },
    });
    expect(parsed.bindings.models.get("m")?.responses[0]).toEqual({
      kind: "text",
      text: "hi",
      extras: { usage: { input: 1 } },
    });
    expect(() => parseCase({ ...minimal, bindings: { models: { m: { responses: [{ text: "a", raw: 1 }] } } } })).toThrow(
      "only one of",
    );
    expect(() => parseCase({ ...minimal, bindings: { models: { m: { responses: [{ await: "g" }] } } } })).toThrow(
      "await requires then",
    );
  });

  it("fills tool script defaults", () => {
    const parsed = parseCase({ ...minimal, bindings: { tools: { lookup: { results: [{ text: "결과" }] } } } });
    expect(parsed.bindings.tools.get("lookup")).toMatchObject({ description: "", input: { type: "object" } });
  });

  it("rejects an unknown host callback", () => {
    expect(() => parseCase({ ...minimal, bindings: { host: { nope: true } } })).toThrow("is not a host callback");
  });
});

describe("parseOp", () => {
  it("rejects unknown operations and unknown arguments", () => {
    expect(() => parseOp({ op: "nope" }, "/op", "value", "op")).toThrow("is not a known operation");
    expect(() => parseOp({ op: "identity", extra: 1 }, "/op", "value", "op")).toThrow("/op/extra");
  });

  it("rejects a wrap that repeats its key", () => {
    expect(() => parseOp({ op: "wrap", key: "a", with: { a: 1 } }, "/op", "value", "op")).toThrow("must not repeat");
  });

  it("gives each nested operation its own site", () => {
    const op = parseOp({ op: "chain", ops: [{ op: "identity" }, { op: "text" }] }, "/op", "value", "functions.f");
    expect(op).toMatchObject({ op: "chain", site: "functions.f" });
    if (op.op === "chain") expect(op.ops.map((item) => item.site)).toEqual(["functions.f/ops/0", "functions.f/ops/1"]);
  });
});

describe("parseExpected", () => {
  const caseFile = parseCase({ ...minimal, steps: [{ run: { sessionId: "c1", input: "a" } }] });

  it("requires as many step expectations as steps", () => {
    expect(() => parseExpected({ steps: [] }, caseFile)).toThrow("must have 1 entries");
  });

  it("reads the three step expectation shapes", () => {
    expect(parseExpected({ steps: [{}] }, caseFile).steps[0]).toEqual({ kind: "any" });
    expect(parseExpected({ steps: [{ result: { status: "done" } }] }, caseFile).steps[0]).toEqual({
      kind: "result",
      value: { status: "done" },
    });
    expect(
      parseExpected({ steps: [{ error: { where: "model", codes: ["model_error"], attempt: 1 } }] }, caseFile).steps[0],
    ).toMatchObject({ kind: "error" });
  });

  it("rejects an execution error code outside the closed set", () => {
    expect(() => parseExpected({ steps: [{ error: { where: "model", codes: ["boom"], attempt: 1 } }] }, caseFile)).toThrow(
      "must be an execution error code",
    );
  });

  it("rejects a configuration error code outside the closed set", () => {
    const empty = parseCase(minimal);
    expect(() => parseExpected({ error: { phase: "load", issues: [{ code: "config_bad", path: "" }] } }, empty)).toThrow(
      "is not a configuration error code",
    );
    expect(() =>
      parseExpected({ error: { phase: "load", issues: [{ code: "load.yaml", path: "agents" }] } }, empty),
    ).toThrow("must be a JSON Pointer");
  });

  it("rejects error together with steps or observations", () => {
    const empty = parseCase(minimal);
    expect(() =>
      parseExpected({ error: { phase: "create", invalidArgument: true }, steps: [] }, empty),
    ).toThrow("/steps");
    expect(() => parseExpected({ error: { phase: "create", invalidArgument: true } }, caseFile)).toThrow(
      "requires an empty steps array",
    );
  });

  it("rejects an unknown observation section", () => {
    expect(() => parseExpected({ steps: [{}], observations: { nope: [] } }, caseFile)).toThrow(
      "is not an observation section",
    );
  });

  it("rejects a result expectation on a step without a return value", () => {
    const closing = parseCase({ ...minimal, steps: [{ close: {} }] });
    expect(() => parseExpected({ steps: [{ result: 1 }] }, closing)).toThrow("has no return value");
  });
});
