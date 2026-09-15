import { describe, expect, it } from "vitest";
import {
  diffJson,
  isJsonObject,
  jsonEquals,
  jsonText,
  mergeJson,
  pointerGet,
  pointerSet,
  snapshot,
} from "./conformance-json.ts";

describe("json value comparison", () => {
  it("treats booleans and numbers as different kinds", () => {
    expect(jsonEquals(true, 1)).toBe(false);
    expect(jsonEquals(0, false)).toBe(false);
  });

  it("compares numbers numerically", () => {
    expect(jsonEquals(1, 1.0)).toBe(true);
    expect(jsonEquals(1, 1.5)).toBe(false);
  });

  it("compares arrays by length and order", () => {
    expect(jsonEquals([1, 2], [1, 2])).toBe(true);
    expect(jsonEquals([1, 2], [2, 1])).toBe(false);
    expect(jsonEquals([1], [1, null])).toBe(false);
  });

  it("ignores object key order but not the key set", () => {
    expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEquals({ a: 1 }, { a: 1, b: null })).toBe(false);
  });
});

describe("diffJson", () => {
  it("reports a missing key at the key pointer", () => {
    expect(diffJson({}, { a: 1 })).toEqual([{ pointer: "/a", reason: "missing", expected: 1 }]);
  });

  it("reports keys that only the actual value has", () => {
    expect(diffJson({ a: 1, b: 2 }, { a: 1 })).toEqual([{ pointer: "/b", reason: "unexpected", actual: 2 }]);
  });

  it("reports array length and then the shared items", () => {
    const differences = diffJson([1, 9], [1]);
    expect(differences).toEqual([{ pointer: "", reason: "length", expected: 1, actual: 2 }]);
  });

  it("escapes pointer segments", () => {
    expect(diffJson({ "a/b": 1 }, { "a/b": 2 })).toEqual([
      { pointer: "/a~1b", reason: "value", expected: 2, actual: 1 },
    ]);
  });

  it("reports a kind mismatch at the value pointer", () => {
    expect(diffJson({ a: "1" }, { a: 1 })).toEqual([{ pointer: "/a", reason: "kind", expected: 1, actual: "1" }]);
  });

  it("finds nested differences", () => {
    const differences = diffJson({ a: { b: [1, 2] } }, { a: { b: [1, 3] } });
    expect(differences).toEqual([{ pointer: "/a/b/1", reason: "value", expected: 3, actual: 2 }]);
  });
});

describe("JSON Pointer access", () => {
  it("reads object keys and array items", () => {
    const document = { a: { b: [10, 20] } };
    expect(pointerGet(document, "/a/b/1")).toEqual({ found: true, value: 20 });
    expect(pointerGet(document, "")).toEqual({ found: true, value: document });
  });

  it("reports missing locations instead of throwing", () => {
    expect(pointerGet({ a: 1 }, "/b")).toEqual({ found: false, value: null });
    expect(pointerGet({ a: [1] }, "/a/2")).toEqual({ found: false, value: null });
    expect(pointerGet({ a: 1 }, "a")).toEqual({ found: false, value: null });
  });

  it("unescapes ~0 and ~1", () => {
    expect(pointerGet({ "a/b": { "c~d": 1 } }, "/a~1b/c~0d")).toEqual({ found: true, value: 1 });
  });

  it("adds and replaces object keys without touching the input", () => {
    const document = { a: { b: 1 } };
    expect(pointerSet(document, "/a/c", 2)).toEqual({ a: { b: 1, c: 2 } });
    expect(document).toEqual({ a: { b: 1 } });
  });

  it("replaces an array item and appends with -", () => {
    expect(pointerSet({ a: [1, 2] }, "/a/0", 9)).toEqual({ a: [9, 2] });
    expect(pointerSet({ a: [1] }, "/a/-", 2)).toEqual({ a: [1, 2] });
  });

  it("rejects an empty path, a missing parent and a bad array index", () => {
    expect(() => pointerSet({ a: 1 }, "", 1)).toThrow("must not be empty");
    expect(() => pointerSet({ a: 1 }, "/b/c", 1)).toThrow("no parent");
    expect(() => pointerSet({ a: [1] }, "/a/4", 1)).toThrow("existing array item");
  });
});

describe("value merge", () => {
  it("merges objects per key and replaces everything else", () => {
    expect(mergeJson({ a: { b: 1, c: 2 } }, { a: { c: 3, d: 4 } })).toEqual({ a: { b: 1, c: 3, d: 4 } });
    expect(mergeJson({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    expect(mergeJson({ a: 1 }, { a: null })).toEqual({ a: null });
  });

  it("keeps the key order of the first object", () => {
    const merged = mergeJson({ a: 1, b: 2 }, { c: 3, a: 9 });
    expect(isJsonObject(merged) ? Object.keys(merged) : []).toEqual(["a", "b", "c"]);
  });
});

describe("snapshot", () => {
  it("drops undefined object values and marks values JSON cannot hold", () => {
    expect(snapshot({ a: undefined, b: 1 })).toEqual({ b: 1 });
    expect(snapshot({ n: Number.NaN })).toEqual({ n: "<non-json:NaN>" });
    expect(snapshot({ f: () => 1 })).toEqual({ f: "<non-json:function>" });
  });

  it("marks cycles instead of looping", () => {
    const value: Record<string, unknown> = { a: 1 };
    value["self"] = value;
    expect(snapshot(value)).toEqual({ a: 1, self: "<non-json:cycle>" });
  });
});

describe("jsonText", () => {
  it("serializes without spaces and without escaping non-ASCII", () => {
    expect(jsonText({ a: 1.0, b: "군단" })).toBe('{"a":1,"b":"군단"}');
  });
});
