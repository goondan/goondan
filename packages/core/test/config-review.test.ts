import { expect, it } from "vitest";
import { validateConfig } from "../src/index.ts";

it("rejects ambiguous tool targets before a host can interpret them differently", () => {
  expect(() => validateConfig({ agents: { main: { model: "m", tools: [{ tool: "lookup", agent: "worker" }] }, worker: { model: "m" } } })).toThrow("exactly one");
  const config = validateConfig({ agents: { main: { model: "m", tools: ["lookup", { agent: "worker" }] }, worker: { model: "m" } } });
  expect(config.agents.main?.tools).toEqual(["lookup", { agent: "worker" }]);
});

it("validates tool object fields and approval values", () => {
  expect(() => validateConfig({ agents: { main: { model: "m", tools: [{ tool: "lookup", unknownField: true }] } } })).toThrow("unknownField");
  expect(() => validateConfig({ agents: { main: { model: "m", tools: [{ tool: "publish", approval: "optional" }] } } })).toThrow("approval");
});


it("validates extension settings while preserving custom options", () => {
  for (const use of [{ unknownField: true }, { enabled: "false" }, { options: [] }]) {
    expect(() => validateConfig({ agents: { main: { model: "m", extensions: { memory: use } } } })).toThrow();
  }
  const use = { enabled: true, options: { custom: { nested: [1, true, null] } } };
  expect(validateConfig({ agents: { main: { model: "m", extensions: { memory: use } } } }).agents.main?.extensions?.memory).toEqual(use);
});
