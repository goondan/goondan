/**
 * JSON helpers for the conformance runner: value kinds, the spec's JSON value
 * comparison, JSON Pointer access and the spec's value merge rule.
 *
 * See fixtures/conformance/README.md ("비교", "연산") and spec/goondan.md
 * ("JSON 값 비교", "값 병합").
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: Json | undefined): value is Json[] {
  return Array.isArray(value);
}

export function isString(value: Json | undefined): value is string {
  return typeof value === "string";
}

export function isNumber(value: Json | undefined): value is number {
  return typeof value === "number";
}

export function isBoolean(value: Json | undefined): value is boolean {
  return typeof value === "boolean";
}

export function isStringArray(value: Json | undefined): value is string[] {
  return isJsonArray(value) && value.every((item) => typeof item === "string");
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObjectLike(value) && typeof value.then === "function";
}

export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

export function cloneJson<T extends Json>(value: T): T {
  return structuredClone(value);
}

/** JSON kind name used in comparison messages. */
export function kindOf(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    default:
      return "object";
  }
}

/** JSON 값 비교: same kind and same value; booleans and numbers never match. */
export function jsonEquals(left: Json, right: Json): boolean {
  if (kindOf(left) !== kindOf(right)) return false;
  if (left === null) return true;
  if (typeof left === "number" && typeof right === "number") return left === right;
  if (typeof left === "boolean" || typeof left === "string") return left === right;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => {
      const other = right[index];
      return other !== undefined && jsonEquals(item, other);
    });
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
    return leftKeys.every((key) => {
      const a = left[key];
      const b = right[key];
      return a !== undefined && b !== undefined && jsonEquals(a, b);
    });
  }
  return false;
}

export interface Difference {
  pointer: string;
  reason: "value" | "kind" | "length" | "missing" | "unexpected";
  expected?: Json;
  actual?: Json;
}

export function escapeSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapeSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function joinPointer(pointer: string, segment: string | number): string {
  return `${pointer}/${escapeSegment(String(segment))}`;
}

/** Compares an actual document against an expected document, exactly. */
export function diffJson(actual: Json, expected: Json, pointer = ""): Difference[] {
  if (kindOf(actual) !== kindOf(expected)) {
    return [{ pointer, reason: "kind", expected, actual }];
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const differences: Difference[] = [];
    if (actual.length !== expected.length) {
      differences.push({ pointer, reason: "length", expected: expected.length, actual: actual.length });
    }
    const shared = Math.min(actual.length, expected.length);
    for (let index = 0; index < shared; index += 1) {
      const actualItem = actual[index];
      const expectedItem = expected[index];
      if (actualItem === undefined || expectedItem === undefined) continue;
      differences.push(...diffJson(actualItem, expectedItem, joinPointer(pointer, index)));
    }
    return differences;
  }
  if (isJsonObject(actual) && isJsonObject(expected)) {
    const differences: Difference[] = [];
    for (const key of Object.keys(expected)) {
      const expectedValue = expected[key];
      if (expectedValue === undefined) continue;
      if (!Object.hasOwn(actual, key)) {
        differences.push({ pointer: joinPointer(pointer, key), reason: "missing", expected: expectedValue });
        continue;
      }
      const actualValue = actual[key];
      if (actualValue === undefined) continue;
      differences.push(...diffJson(actualValue, expectedValue, joinPointer(pointer, key)));
    }
    for (const key of Object.keys(actual)) {
      if (Object.hasOwn(expected, key)) continue;
      const actualValue = actual[key];
      if (actualValue === undefined) continue;
      differences.push({ pointer: joinPointer(pointer, key), reason: "unexpected", actual: actualValue });
    }
    return differences;
  }
  return jsonEquals(actual, expected) ? [] : [{ pointer, reason: "value", expected, actual }];
}

export function formatDifferences(differences: readonly Difference[]): string {
  return differences
    .map((difference) => {
      const at = difference.pointer === "" ? "(root)" : difference.pointer;
      switch (difference.reason) {
        case "missing":
          return `${at}: missing, expected ${stringify(difference.expected)}`;
        case "unexpected":
          return `${at}: unexpected ${stringify(difference.actual)}`;
        case "length":
          return `${at}: length ${stringify(difference.actual)}, expected ${stringify(difference.expected)}`;
        default:
          return `${at}: ${stringify(difference.actual)}, expected ${stringify(difference.expected)}`;
      }
    })
    .join("\n");
}

function stringify(value: Json | undefined): string {
  if (value === undefined) return "(none)";
  const text = JSON.stringify(value);
  if (text === undefined) return "(none)";
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/** JSON 텍스트: compact one-line JSON. */
export function jsonText(value: Json): string {
  return JSON.stringify(value) ?? "null";
}

export function parsePointer(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/").map(unescapeSegment);
}

function arrayIndex(segment: string, length: number): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
  const index = Number(segment);
  return index < length ? index : undefined;
}

export interface PointerLookup {
  found: boolean;
  value: Json;
}

export function pointerGet(document: Json, pointer: string): PointerLookup {
  const segments = parsePointer(pointer);
  if (!segments) return { found: false, value: null };
  let current: Json = document;
  for (const segment of segments) {
    if (isJsonArray(current)) {
      const index = arrayIndex(segment, current.length);
      if (index === undefined) return { found: false, value: null };
      const next = current[index];
      if (next === undefined) return { found: false, value: null };
      current = next;
      continue;
    }
    if (isJsonObject(current) && Object.hasOwn(current, segment)) {
      const next = current[segment];
      if (next === undefined) return { found: false, value: null };
      current = next;
      continue;
    }
    return { found: false, value: null };
  }
  return { found: true, value: current };
}

/**
 * Returns a copy of `document` with the value at `pointer` replaced.
 * Throws when the pointer is empty, the parent is missing, or an array parent
 * gets a segment that is neither an existing index nor `-`.
 */
export function pointerSet(document: Json, pointer: string, value: Json): Json {
  const segments = parsePointer(pointer);
  if (!segments) throw new Error(`invalid JSON Pointer: ${pointer}`);
  if (segments.length === 0) throw new Error("set path must not be empty");
  const copy = cloneJson(document);
  return setIn(copy, segments, value, pointer);
}

function setIn(current: Json, segments: readonly string[], value: Json, pointer: string): Json {
  const [segment, ...rest] = segments;
  if (segment === undefined) return value;
  if (isJsonArray(current)) {
    if (rest.length === 0 && segment === "-") return [...current, value];
    const index = arrayIndex(segment, current.length);
    if (index === undefined) throw new Error(`set path ${pointer} does not address an existing array item`);
    const next = current[index];
    if (next === undefined) throw new Error(`set path ${pointer} does not address an existing array item`);
    const items = [...current];
    items[index] = rest.length === 0 ? value : setIn(next, rest, value, pointer);
    return items;
  }
  if (isJsonObject(current)) {
    if (rest.length === 0) return { ...current, [segment]: value };
    if (!Object.hasOwn(current, segment)) throw new Error(`set path ${pointer} has no parent`);
    const next = current[segment];
    if (next === undefined) throw new Error(`set path ${pointer} has no parent`);
    return { ...current, [segment]: setIn(next, rest, value, pointer) };
  }
  throw new Error(`set path ${pointer} has no parent`);
}

/** 값 병합: objects merge per key, every other kind is replaced. */
export function mergeJson(base: Json, patch: Json): Json {
  if (!isJsonObject(base) || !isJsonObject(patch)) return cloneJson(patch);
  const merged: JsonObject = {};
  for (const key of Object.keys(base)) {
    const value = base[key];
    if (value === undefined) continue;
    merged[key] = Object.hasOwn(patch, key) ? mergeJson(value, patch[key] ?? null) : cloneJson(value);
  }
  for (const key of Object.keys(patch)) {
    if (Object.hasOwn(merged, key)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    merged[key] = cloneJson(value);
  }
  return merged;
}

/**
 * Converts an arbitrary host value into JSON for observation. Values that JSON
 * cannot hold are replaced by a marker string so that they show up in a diff
 * instead of disappearing.
 */
export function snapshot(value: unknown): Json {
  return snapshotValue(value, new Set<object>());
}

/** Like {@link snapshot} but keeps "no value" distinct from `null`. */
export function snapshotOptional(value: unknown): Json | undefined {
  return value === undefined ? undefined : snapshot(value);
}

function snapshotValue(value: unknown, seen: Set<object>): Json {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : `<non-json:${String(value)}>`;
    case "bigint":
      return `<non-json:bigint>`;
    case "undefined":
      return "<non-json:undefined>";
    case "function":
      return "<non-json:function>";
    case "symbol":
      return "<non-json:symbol>";
    default:
      break;
  }
  if (!isObjectLike(value)) return "<non-json:unknown>";
  if (seen.has(value)) return "<non-json:cycle>";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => snapshotValue(item, seen));
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      result[key] = snapshotValue(item, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
