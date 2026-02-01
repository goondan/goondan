type PlainObject = { [key: string]: unknown };

export function deepMerge<T>(base: T, overlay: T): T {
  if (overlay === undefined) return base;
  if (base === undefined) return overlay;

  if (Array.isArray(base) || Array.isArray(overlay)) {
    return (Array.isArray(overlay) ? overlay.slice() : (base as unknown[]).slice()) as T;
  }

  if (isPlainObject(base) && isPlainObject(overlay)) {
    const out: PlainObject = { ...(base as PlainObject) };
    for (const [key, value] of Object.entries(overlay)) {
      out[key] = deepMerge((base as PlainObject)[key], value as PlainObject);
    }
    return out as T;
  }

  return overlay;
}

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') return false;
  return (value as { constructor?: unknown }).constructor === Object;
}
