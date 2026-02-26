import type {
  ObjectRef,
  ObjectRefLike,
  RefItem,
  RefOrSelector,
  SelectorWithOverrides,
} from "../types.js";
import { isJsonObject, isObjectRef as isObjectRefTypeGuard } from "../types.js";

export function normalizeObjectRef(ref: ObjectRefLike): ObjectRef {
  if (typeof ref === "string") {
    const slashIndex = ref.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= ref.length - 1) {
      throw new Error(`Invalid ObjectRef string: ${ref}`);
    }

    const kind = ref.slice(0, slashIndex);
    const name = ref.slice(slashIndex + 1);

    if (name.includes("/")) {
      throw new Error(`Invalid ObjectRef string (multiple slashes): ${ref}`);
    }

    return { kind, name };
  }

  if (!isObjectRefTypeGuard(ref)) {
    throw new Error("Invalid ObjectRef object");
  }

  return {
    kind: ref.kind,
    name: ref.name,
    package: ref.package,
    apiVersion: ref.apiVersion,
  };
}

export function extractObjectRefLike(value: unknown): ObjectRefLike | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (isObjectRefTypeGuard(value)) {
    return value;
  }

  if (!isJsonObject(value)) {
    return undefined;
  }

  const ref = value.ref;
  if (typeof ref === "string") {
    return ref;
  }
  if (isObjectRefTypeGuard(ref)) {
    return ref;
  }

  return undefined;
}

export function extractNormalizedObjectRef(value: unknown): ObjectRef | null {
  const ref = extractObjectRefLike(value);
  if (!ref) {
    return null;
  }

  try {
    return normalizeObjectRef(ref);
  } catch {
    return null;
  }
}

export function objectRefToString(ref: ObjectRefLike): string {
  const normalized = normalizeObjectRef(ref);
  return `${normalized.kind}/${normalized.name}`;
}

export function isRefItem(value: unknown): value is RefItem {
  if (!isJsonObject(value)) {
    return false;
  }

  return "ref" in value;
}

export function isSelectorWithOverrides(value: unknown): value is SelectorWithOverrides {
  if (!isJsonObject(value)) {
    return false;
  }

  return "selector" in value && isJsonObject(value.selector);
}

export function normalizeRefOrSelector(value: RefOrSelector): ObjectRef[] {
  if (typeof value === "string") {
    return [normalizeObjectRef(value)];
  }

  if (isObjectRefTypeGuard(value)) {
    return [normalizeObjectRef(value)];
  }

  if (isRefItem(value)) {
    return [normalizeObjectRef(value.ref)];
  }

  return [];
}

export function isObjectRefLikeString(value: string): boolean {
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= value.length - 1) {
    return false;
  }

  return value.indexOf("/", slashIndex + 1) < 0;
}
