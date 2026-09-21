import { describe, expect, it } from "vitest";
import type { ObservationSection } from "./conformance-case.ts";
import type { Json } from "./conformance-json.ts";
import {
  type ResultDocument,
  collectTurnIds,
  compareCodePoints,
  messagesWithoutId,
  normalizeDocument,
  numberStatelessInstances,
  numberTurnIds,
  replaceStrings,
  scanIdentifiers,
  stripMessageIds,
  traverseStrings,
} from "./conformance-normalize.ts";

function document(steps: Json[], observations: Array<[ObservationSection, Json]> = []): ResultDocument {
  return { steps, observations: new Map(observations) };
}

describe("string replacement", () => {
  it("rewrites object keys as well as values", () => {
    const value = replaceStrings({ "c1:t-1:worker": ["t-1"] }, (text) => text.replaceAll("t-1", "<turn:1>"));
    expect(value).toEqual({ "c1:<turn:1>:worker": ["<turn:1>"] });
  });
});

describe("message identifiers", () => {
  it("removes id from message objects only", () => {
    const value = stripMessageIds({
      messages: [{ id: "m1", role: "user", content: [{ type: "tool.call", id: "c1" }] }],
      other: { id: "keep" },
    });
    expect(value).toEqual({
      messages: [{ role: "user", content: [{ type: "tool.call", id: "c1" }] }],
      other: { id: "keep" },
    });
  });

  it("reports messages without a non-empty string id", () => {
    const pointers = messagesWithoutId([{ role: "user", content: [] }, { id: "", role: "user", content: [] }], "/steps");
    expect(pointers).toEqual(["/steps/0", "/steps/1"]);
  });
});

describe("turn numbering", () => {
  it("collects every turnId value", () => {
    expect([...collectTurnIds({ a: { turnId: "t-1" }, b: [{ turnId: "t-2" }] })]).toEqual(["t-1", "t-2"]);
  });

  it("walks steps first and then observation sections in table order", () => {
    const visited: string[] = [];
    traverseStrings(
      document(
        ["step"],
        [
          ["conversations", "late"],
          ["events", "early"],
        ],
      ),
      (text) => visited.push(text),
    );
    expect(visited).toEqual(["step", "early", "late"]);
  });

  it("walks object keys in code point order, key before value", () => {
    const visited: string[] = [];
    traverseStrings(document([{ b: "second", a: "first" }]), (text) => visited.push(text));
    expect(visited).toEqual(["a", "first", "b", "second"]);
  });

  it("numbers identifiers by first appearance", () => {
    const labels = numberTurnIds(
      document([{ turnId: "t-b" }, { turnId: "t-a" }]),
      new Set(["t-a", "t-b"]),
    );
    expect(labels.get("t-b")).toBe("<turn:1>");
    expect(labels.get("t-a")).toBe("<turn:2>");
  });

  it("counts several identifiers inside one string from left to right", () => {
    expect(scanIdentifiers("x:t-2:y:t-1", ["t-1", "t-2"])).toEqual(["t-2", "t-1"]);
  });

  it("prefers the longest identifier at the same position", () => {
    expect(scanIdentifiers("abcd", ["ab", "abcd"])).toEqual(["abcd"]);
  });
});

describe("stateless instance numbering", () => {
  it("numbers only instances of stateless agents in document order", () => {
    const input = document(
      [{ result: { runs: [{ agent: "worker", instance: "s#t2#worker" }] } }],
      [["effectiveConfig", { agents: { main: { model: "m" }, worker: { model: "m", stateful: false } } }]],
    );
    expect(numberStatelessInstances(input)).toEqual(new Map([["s#t2#worker", "<instance:1>"]]));
  });
});

describe("code point order", () => {
  it("orders by code point and then by length", () => {
    expect(["b", "a", "A", "ab"].sort(compareCodePoints)).toEqual(["A", "a", "ab", "b"]);
  });
});

describe("normalizeDocument", () => {
  it("applies the five steps in order", () => {
    const result = normalizeDocument(
      document(
        [
          {
            result: {
              output: { id: "m-1", role: "assistant", content: [{ type: "text", text: "/tmp/case/config/a.md" }] },
              runs: [{ turnId: "turn-9", executionId: "execution-7", inputId: "input-3" }],
            },
          },
        ],
        [["operations", [{ operationId: "op-1", deliveryId: "operation:op-1:completion", turnId: "turn-9", parentExecutionId: "execution-7", inputId: "input-3" }]]],
      ),
      { casePaths: ["/tmp/case"], operationAliases: new Map([["op-1", "<op:danger-1>"]]) },
    );
    expect(result.document.steps).toEqual([
      {
        result: {
          output: { role: "assistant", content: [{ type: "text", text: "<case>/config/a.md" }] },
          runs: [{ turnId: "<turn:1>", executionId: "<execution:1>", inputId: "<input:1>" }],
        },
      },
    ]);
    expect(result.document.observations.get("operations")).toEqual([
      {
        operationId: "<op:danger-1>", deliveryId: "operation:<op:danger-1>:completion",
        turnId: "<turn:1>", parentExecutionId: "<execution:1>", inputId: "<input:1>",
      },
    ]);
  });

  it("keeps null apart from a missing key", () => {
    const result = normalizeDocument(document([{ result: { a: null } }]), {
      casePaths: [],
      operationAliases: new Map(),
    });
    expect(result.document.steps).toEqual([{ result: { a: null } }]);
  });
});
