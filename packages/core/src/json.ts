import { type ConfigIssue, type Json } from "./types.ts";

/** The JSON shapes the specification compares with `JSON 값 비교`. */
export type JsonType = "null" | "boolean" | "number" | "string" | "array" | "object" | "invalid";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: Json | undefined): value is Record<string, Json> {
  return isRecord(value);
}

/** Converts an already validated host value to a JSON record. */
export function toJsonRecord(value: Record<string, unknown>): Record<string, Json> {
  const result: Record<string, Json> = {};
  for (const key of ownKeys(value)) {
    const child = toJson(value[key]);
    if (child !== undefined) setKey(result, key, child);
  }
  return result;
}

export function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "invalid";
  return isRecord(value) ? "object" : "invalid";
}

/** Structural JSON equality: values of different JSON types are never equal. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  const type = jsonType(left);
  if (type !== jsonType(right)) return false;
  if (type === "array") {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (type === "object") {
    if (!isRecord(left) || !isRecord(right)) return false;
    const keys = ownKeys(left);
    return keys.length === ownKeys(right).length && keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
  }
  return left === right;
}

/** Declared keys whose value is not `undefined`; host objects never contribute inherited names. */
export function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

/**
 * Stores a declared key as an own property. `__proto__` is an ordinary configuration key, so it must
 * never reach the host object's prototype.
 */
export function setKey<T>(target: Record<string, T>, key: string, value: T): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

export type PointerSegment = string | number;

export function pointer(segments: readonly PointerSegment[]): string {
  return segments.map((segment) => `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/** Orders two strings by Unicode code point, the order every sorted list of the specification uses. */
export function compareText(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const first = a[index];
    const second = b[index];
    if (first === undefined || second === undefined) break;
    const delta = (first.codePointAt(0) ?? 0) - (second.codePointAt(0) ?? 0);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

function splitPointer(path: string): string[] {
  if (path === "") return [];
  return path.split("/").slice(1).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

const indexPattern = /^(?:0|[1-9][0-9]*)$/u;

function comparePointerSegments(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const first = left[index];
    const second = right[index];
    if (first === undefined || second === undefined) break;
    if (indexPattern.test(first) && indexPattern.test(second)) {
      const delta = Number(first) - Number(second);
      if (delta !== 0) return delta;
      continue;
    }
    const delta = compareText(first, second);
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

/**
 * `구성 오류`의 정렬: items with the same `path` and `code` collapse to the one the phase made first,
 * and what is left is ordered by path segments and then by `code`. `message` takes part in neither
 * step, so two hosts whose wording differs still report the same items in the same order.
 */
export function sortIssues(issues: readonly ConfigIssue[]): ConfigIssue[] {
  const seen = new Set<string>();
  const unique: ConfigIssue[] = [];
  for (const issue of issues) {
    const key = JSON.stringify([issue.path, issue.code]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique.sort((left, right) =>
    comparePointerSegments(splitPointer(left.path), splitPointer(right.path))
    || compareText(left.code, right.code));
}

/** Serializes a JSON value to the specification's compact `JSON 텍스트`. */
export function jsonText(value: Json): string {
  return JSON.stringify(value) ?? "null";
}

/**
 * The indented form the `json` filter without an argument produces: the same string, number and key
 * order as `JSON 텍스트`, with every member on its own line and two spaces per nesting level.
 */
export function jsonPrettyText(value: Json): string {
  return JSON.stringify(value, undefined, 2) ?? "null";
}

/** Reports `config.not_json` for every value the composed document cannot serialize as JSON. */
export function jsonIssues(value: unknown, segments: readonly PointerSegment[] = []): ConfigIssue[] {
  const type = jsonType(value);
  if (type === "invalid") {
    return [{ code: "config.not_json", path: pointer(segments), message: "is not a JSON value" }];
  }
  if (type === "array" && Array.isArray(value)) {
    return value.flatMap((item, index) => jsonIssues(item, [...segments, index]));
  }
  if (type === "object" && isRecord(value)) {
    return ownKeys(value).flatMap((key) => jsonIssues(value[key], [...segments, key]));
  }
  return [];
}

/** Narrows an arbitrary host value to JSON, dropping `undefined` members. */
export function toJson(value: unknown): Json | undefined {
  const type = jsonType(value);
  if (type === "invalid") return undefined;
  if (type === "array" && Array.isArray(value)) {
    return value.map((item) => toJson(item) ?? null);
  }
  if (type === "object" && isRecord(value)) {
    const result: Record<string, Json> = {};
    for (const key of ownKeys(value)) {
      const child = toJson(value[key]);
      if (child !== undefined) setKey(result, key, child);
    }
    return result;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  return undefined;
}
