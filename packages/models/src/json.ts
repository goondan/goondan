import type { Json } from "@goondan/core";

export type JsonObject = { [key: string]: Json };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads an own property so that keys such as `__proto__` never resolve to the prototype. */
export function own(target: JsonObject, key: string): Json | undefined {
  return Object.hasOwn(target, key) ? target[key] : undefined;
}

/** Defines an own enumerable property, including keys such as `__proto__`. */
export function setKey(target: JsonObject, key: string, value: Json): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Converts a parsed or host-provided value into a JSON value.
 * Object keys whose value is `undefined` are dropped, as `JSON.stringify` does.
 */
export function toJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => toJson(item));
  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) setKey(result, key, toJson(item));
    }
    return result;
  }
  throw new TypeError(`A value of type ${typeof value} is not JSON`);
}

/** Merges objects key by key; every other value, arrays included, is replaced by the overlay. */
export function mergeJson(base: Json | undefined, overlay: Json): Json {
  if (!isJsonObject(base) || !isJsonObject(overlay)) return overlay;
  return mergeObjects(base, overlay);
}

export function mergeObjects(base: JsonObject, overlay: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(base)) setKey(result, key, value);
  for (const [key, value] of Object.entries(overlay)) setKey(result, key, mergeJson(own(result, key), value));
  return result;
}

/** Removes keys whose value is `null` from an object and from the objects nested in it. Arrays are kept as they are. */
export function stripNulls(value: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null) continue;
    setKey(result, key, isJsonObject(item) ? stripNulls(item) : item);
  }
  return result;
}

/** JSON value equality: object key order is ignored, array order and value types are not. */
export function jsonEqual(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => {
      const other = right[index];
      return other !== undefined && jsonEqual(item, other);
    });
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const leftValue = own(left, key);
    const rightValue = own(right, key);
    return leftValue !== undefined && rightValue !== undefined && jsonEqual(leftValue, rightValue);
  });
}

export function cloneJson(value: JsonObject): JsonObject {
  const copy = toJson(structuredClone(value));
  if (!isJsonObject(copy)) throw new TypeError("Cloned value is not a JSON object");
  return copy;
}
