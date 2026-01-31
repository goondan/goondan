import type { ConfigRegistry, Resource } from './registry.js';

export interface ObjectRef {
  apiVersion?: string;
  kind?: string;
  name?: string;
}

export function normalizeObjectRef(ref: string | ObjectRef | null, defaultKind?: string): ObjectRef | null {
  if (!ref) return null;
  if (typeof ref === 'string') {
    const [kind, name] = ref.split('/');
    if (!name) {
      if (!defaultKind) throw new Error(`ObjectRef 문자열에 kind가 필요합니다: ${ref}`);
      return { kind: defaultKind, name: kind };
    }
    return { kind, name };
  }
  if (typeof ref === 'object') {
    if (!ref.kind && defaultKind) {
      return { ...ref, kind: defaultKind };
    }
    return { kind: ref.kind, name: ref.name };
  }
  throw new Error(`지원하지 않는 ObjectRef 형식: ${ref}`);
}

export function resolveRef(
  registry: ConfigRegistry,
  ref: string | ObjectRef | null,
  defaultKind?: string
): Resource | null {
  const normalized = normalizeObjectRef(ref, defaultKind);
  if (!normalized) return null;
  if (!normalized.kind || !normalized.name) {
    throw new Error(`ObjectRef에 kind/name이 필요합니다: ${JSON.stringify(normalized)}`);
  }
  return registry.require(normalized.kind, normalized.name);
}
