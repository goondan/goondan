import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configSchema, unsupportedSchemaKeywords, validateSchema } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const specSchema = join(packageRoot, "..", "..", "spec", "goondan.schema.json");
const packagedSchema = join(packageRoot, "src", "goondan.schema.json");
const builtSchema = join(packageRoot, "dist", "goondan.schema.json");

describe("the packaged configuration schema", () => {
  it("is a byte copy of the specification schema", () => {
    expect(readFileSync(packagedSchema)).toEqual(readFileSync(specSchema));
  });

  it("keeps the built copy equal to the specification schema", () => {
    if (!existsSync(builtSchema)) return;
    const built: unknown = JSON.parse(readFileSync(builtSchema, "utf8"));
    const source: unknown = JSON.parse(readFileSync(specSchema, "utf8"));
    expect(built).toEqual(source);
  });

  it("uses only the keywords the interpreter enforces", () => {
    expect(unsupportedSchemaKeywords(configSchema)).toEqual([]);
  });
});

function agents(main: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, name: "test", agents: { main } };
}

describe("the schema keyword interpreter", () => {
  it("reports the version constant by JSON value comparison", () => {
    expect(validateSchema({ ...agents({ model: "m" }), version: 1.0 })).toEqual([]);
    expect(validateSchema({ ...agents({ model: "m" }), version: "1" })).toMatchObject([{ code: "schema.const", path: "/version" }]);
    expect(validateSchema({ ...agents({ model: "m" }), version: true })).toMatchObject([{ code: "schema.const", path: "/version" }]);
  });

  it("rejects unknown top-level fields and composition keys", () => {
    expect(validateSchema({ ...agents({ model: "m" }), extra: 1 })).toMatchObject([{ code: "schema.additionalProperties", path: "/extra" }]);
    expect(validateSchema({ ...agents({ model: "m" }), resources: ["./a.yaml"] })).toMatchObject([{ code: "schema.additionalProperties", path: "/resources" }]);
  });

  it("rejects agent names that the two hosts would order differently", () => {
    for (const name of ["", "a/b", "$input", "0", "12"]) {
      const issues = validateSchema({ version: 1, name: "t", agents: { [name]: { model: "m" } } });
      expect(issues.some((issue) => issue.code === "schema.propertyNames" && issue.path === `/agents/${name.replaceAll("/", "~1")}`)).toBe(true);
    }
    expect(validateSchema({ version: 1, name: "t", agents: { "01": { model: "m" }, "a b": { model: "m" }, out: { model: "m" } } })).toEqual([]);
  });

  it("reduces oneOf branches the way the specification describes", () => {
    expect(validateSchema(agents({ model: "m", input: "raw" }))).toMatchObject([{ code: "schema.oneOf", path: "/agents/main/input" }]);
    expect(validateSchema(agents({ model: "m", input: { tmpl: "x.md" } })))
      .toMatchObject([{ code: "schema.additionalProperties", path: "/agents/main/input/tmpl" }]);
    expect(validateSchema(agents({ model: "m", systemMessage: { text: "a", template: "b.md" } })))
      .toMatchObject([{ code: "schema.oneOf", path: "/agents/main/systemMessage" }]);
    expect(validateSchema(agents({ model: "m", systemMessage: {} })))
      .toMatchObject([{ code: "schema.oneOf", path: "/agents/main/systemMessage" }]);
  });

  it("reports a duplicate serial route at the repeated array position", () => {
    expect(validateSchema({ version: 1, name: "t", agents: { a: { model: "m" }, b: { model: "m" } }, routes: ["a", "b", "a"] }))
      .toMatchObject([{ code: "schema.uniqueItems", path: "/routes/2" }]);
  });

  it("reports a duplicate hook agent at the repeated array position", () => {
    expect(validateSchema(agents({ model: "m", hooks: { conversation: [{ agent: ["helper", "helper"] }] } })))
      .toMatchObject([{ code: "schema.uniqueItems", path: "/agents/main/hooks/conversation/0/agent/1" }]);
  });

  it("keeps route conditions in exactly one supported form", () => {
    const config = (when: unknown): Record<string, unknown> => ({
      version: 1, name: "t", agents: { main: { model: "m" } },
      routes: [{ from: "$input", to: "main", when }, { from: "main", to: "$output" }],
    });
    expect(validateSchema(config({ output: 5 }))).toMatchObject([{ code: "schema.anyOf", path: "/routes/0/when/output" }]);
    expect(validateSchema(config({}))).toMatchObject([{ code: "schema.oneOf", path: "/routes/0/when" }]);
    expect(validateSchema(config({ fn: "choose", output: "yes" }))).toMatchObject([{ code: "schema.oneOf", path: "/routes/0/when" }]);
  });

  it("requires an agent to declare model or inherit", () => {
    expect(validateSchema(agents({ description: "x" }))).toMatchObject([{ code: "schema.anyOf", path: "/agents/main" }]);
    expect(validateSchema(agents({ model: "" }))).toMatchObject([{ code: "schema.minLength", path: "/agents/main/model" }]);
  });

  it("keeps tool entries, hooks and removals inside their declared forms", () => {
    expect(validateSchema(agents({ model: "m", tools: [{ tool: "a", agent: "b" }] })))
      .toMatchObject([{ code: "schema.oneOf", path: "/agents/main/tools/0" }]);
    expect(validateSchema(agents({ model: "m", tools: [{ agent: "b", hint: "x" }] })))
      .toMatchObject([{ code: "schema.false", path: "/agents/main/tools/0/hint" }]);
    expect(validateSchema(agents({ model: "m", tools: [{ tool: "a", approval: "optional" }] })))
      .toMatchObject([{ code: "schema.const", path: "/agents/main/tools/0/approval" }]);
    expect(validateSchema(agents({ model: "m", hooks: { output: [{}] } })))
      .toMatchObject([{ code: "schema.anyOf", path: "/agents/main/hooks/output/0" }]);
    expect(validateSchema(agents({ model: "m", hooks: { output: [{ extension: "e", fn: "f" }] } })))
      .toMatchObject([{ code: "schema.false", path: "/agents/main/hooks/output/0/fn" }]);
    expect(validateSchema(agents({ model: "m", remove: { hooks: { nowhere: ["x"] } } })))
      .toMatchObject([{ code: "schema.propertyNames", path: "/agents/main/remove/hooks/nowhere" }]);
  });

  it("stops at a type mismatch instead of applying the other keywords", () => {
    expect(validateSchema(agents({ model: "m", params: [] }))).toMatchObject([{ code: "schema.type", path: "/agents/main/params" }]);
    expect(validateSchema(agents({ model: "m", tools: {} }))).toMatchObject([{ code: "schema.type", path: "/agents/main/tools" }]);
  });
});
