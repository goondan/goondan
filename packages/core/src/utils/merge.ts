import type { JsonValue } from '../sdk/types.js';

type PlainObject = Record<string, JsonValue>;

export function deepMerge(base: JsonValue, overlay: JsonValue): JsonValue {
  if (overlay === undefined) return base;
  if (base === undefined) return overlay;

  if (Array.isArray(base) || Array.isArray(overlay)) {
    if (Array.isArray(overlay)) return overlay.slice();
    if (Array.isArray(base)) return base.slice();
    return overlay;
  }

  if (isPlainObject(base) && isPlainObject(overlay)) {
    const out: PlainObject = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      out[key] = deepMerge(base[key], value);
    }
    return out;
  }

  return overlay;
}

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return true;
}
