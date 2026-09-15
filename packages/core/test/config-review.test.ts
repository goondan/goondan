import { expect, it } from "vitest";
import { GoondanConfigError, validateConfig, type ConfigIssue } from "../src/index.ts";

function issuesOf(action: () => unknown): readonly ConfigIssue[] {
  try {
    action();
  } catch (error) {
    if (error instanceof GoondanConfigError) return error.issues;
    throw error;
  }
  throw new Error("Expected a configuration error");
}

it("rejects ambiguous tool targets before a host can interpret them differently", () => {
  expect(issuesOf(() => validateConfig({ agents: { main: { model: "m", tools: [{ tool: "lookup", agent: "worker" }] }, worker: { model: "m" } } })))
    .toMatchObject([{ code: "schema.oneOf", path: "/agents/main/tools/0" }]);
  const config = validateConfig({ agents: { main: { model: "m", tools: ["lookup", { agent: "worker" }] }, worker: { model: "m" } } });
  expect(config.agents.main?.tools).toEqual(["lookup", { agent: "worker" }]);
});

it("validates tool object fields and approval values", () => {
  expect(issuesOf(() => validateConfig({ agents: { main: { model: "m", tools: [{ tool: "lookup", unknownField: true }] } } })))
    .toMatchObject([{ code: "schema.additionalProperties", path: "/agents/main/tools/0/unknownField" }]);
  expect(issuesOf(() => validateConfig({ agents: { main: { model: "m", tools: [{ tool: "publish", approval: "optional" }] } } })))
    .toMatchObject([{ code: "schema.const", path: "/agents/main/tools/0/approval" }]);
});

it("validates extension settings while preserving custom options", () => {
  expect(issuesOf(() => validateConfig({ agents: { main: { model: "m", extensions: { memory: { unknownField: true } } } } })))
    .toMatchObject([{ code: "schema.additionalProperties", path: "/agents/main/extensions/memory/unknownField" }]);
  expect(issuesOf(() => validateConfig({ agents: { main: { model: "m", extensions: { memory: { enabled: "false" } } } } })))
    .toMatchObject([{ code: "schema.type", path: "/agents/main/extensions/memory/enabled" }]);
  expect(issuesOf(() => validateConfig({ agents: { main: { model: "m", extensions: { memory: { options: [] } } } } })))
    .toMatchObject([{ code: "schema.type", path: "/agents/main/extensions/memory/options" }]);
  const use = { enabled: true, options: { custom: { nested: [1, true, null] } } };
  expect(validateConfig({ agents: { main: { model: "m", extensions: { memory: use } } } }).agents.main?.extensions?.memory).toEqual(use);
});
