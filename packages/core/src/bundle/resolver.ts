/**
 * Bundle 참조 해석
 * @see /docs/specs/bundle.md - 2. ObjectRef 상세
 */

import { ReferenceError, ValidationError } from './errors.js';
import { validateScopesSubset } from './validator.js';
import type { Resource, ObjectRefLike, ObjectRef } from '../types/index.js';
import {
  normalizeObjectRef,
  isSelectorWithOverrides,
  isObjectRefLike,
  getSpec,
} from '../types/index.js';

/** unknown 값이 Record<string, unknown> 형태인지 확인하는 타입 가드 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * 리소스 인덱스 타입
 * key: "Kind/name" 형식
 */
export type ResourceIndex = Map<string, Resource>;

interface ReferenceLookup {
  byKey: Map<string, Resource[]>;
}

/**
 * 리소스 배열을 인덱스로 변환
 *
 * @param resources 리소스 배열
 * @returns kind/name 형식의 인덱스 맵
 */
export function createResourceIndex(resources: Resource[]): ResourceIndex {
  const index = new Map<string, Resource>();

  for (const resource of resources) {
    const key = `${resource.kind}/${resource.metadata.name}`;
    index.set(key, resource);
  }

  return index;
}

function createReferenceLookup(resources: Resource[]): ReferenceLookup {
  const byKey = new Map<string, Resource[]>();

  for (const resource of resources) {
    const key = `${resource.kind}/${resource.metadata.name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.push(resource);
    } else {
      byKey.set(key, [resource]);
    }
  }

  return { byKey };
}

/**
 * ObjectRef를 해석하여 리소스 반환
 *
 * @param ref ObjectRef (문자열 또는 객체)
 * @param index 리소스 인덱스
 * @returns 해석된 리소스 또는 undefined
 */
export function resolveObjectRef(
  ref: ObjectRefLike,
  index: ResourceIndex
): Resource | undefined {
  try {
    const normalized = normalizeObjectRef(ref);
    const key = `${normalized.kind}/${normalized.name}`;
    const resolved = index.get(key);
    if (!resolved) {
      return undefined;
    }
    if (normalized.package && !matchesPackageScope(resolved, normalized.package)) {
      return undefined;
    }
    return resolved;
  } catch {
    return undefined;
  }
}

/**
 * 모든 참조 무결성 검증
 *
 * @param resources 리소스 배열
 * @returns 참조 오류 배열
 */
export function resolveAllReferences(
  resources: Resource[]
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const index = createResourceIndex(resources);
  const lookup = createReferenceLookup(resources);

  for (const resource of resources) {
    const resourceErrors = validateResourceReferences(resource, index, lookup);
    errors.push(...resourceErrors);
  }

  return errors;
}

/**
 * 단일 리소스의 참조 검증
 */
function validateResourceReferences(
  resource: Resource,
  index: ResourceIndex,
  lookup: ReferenceLookup
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const ctx = {
    sourceKind: resource.kind,
    sourceName: resource.metadata.name,
  };

  switch (resource.kind) {
    case 'Agent':
      errors.push(...validateAgentReferences(resource, index, lookup, ctx));
      break;
    case 'Swarm':
      errors.push(...validateSwarmReferences(resource, index, lookup, ctx));
      break;
    case 'Tool':
      errors.push(...validateToolReferences(resource, index, lookup, ctx));
      break;
    case 'Connector':
      errors.push(...validateConnectorReferences(resource, index, lookup, ctx));
      break;
    case 'Connection':
      errors.push(...validateConnectionReferences(resource, index, lookup, ctx));
      break;
    case 'ResourceType':
      errors.push(...validateResourceTypeReferences(resource, index, lookup, ctx));
      break;
  }

  return errors;
}

/**
 * Agent 참조 검증
 */
function validateAgentReferences(
  resource: Resource,
  _index: ResourceIndex,
  lookup: ReferenceLookup,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // modelConfig.modelRef 검증
  const modelConfig = spec.modelConfig as Record<string, unknown> | undefined;
  if (modelConfig?.modelRef) {
    const ref = modelConfig.modelRef;
    const error = validateSingleRef(ref, 'Model', lookup, ctx);
    if (error) errors.push(error);
  }

  // tools 검증
  const tools = spec.tools as unknown[] | undefined;
  if (Array.isArray(tools)) {
    for (const item of tools) {
      // Selector는 참조 검증하지 않음 (런타임에 해석)
      if (isSelectorWithOverrides(item)) {
        continue;
      }
      const error = validateSingleRef(item, 'Tool', lookup, ctx);
      if (error) errors.push(error);
    }
  }

  // extensions 검증
  const extensions = spec.extensions as unknown[] | undefined;
  if (Array.isArray(extensions)) {
    for (const item of extensions) {
      if (isSelectorWithOverrides(item)) {
        continue;
      }
      const error = validateSingleRef(item, 'Extension', lookup, ctx);
      if (error) errors.push(error);
    }
  }

  return errors;
}

/**
 * Swarm 참조 검증
 */
function validateSwarmReferences(
  resource: Resource,
  _index: ResourceIndex,
  lookup: ReferenceLookup,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // entrypoint 검증
  if (spec.entrypoint) {
    const error = validateSingleRef(spec.entrypoint, 'Agent', lookup, ctx);
    if (error) errors.push(error);
  }

  // agents 검증
  const agents = spec.agents as unknown[] | undefined;
  if (Array.isArray(agents)) {
    for (const item of agents) {
      const error = validateSingleRef(item, 'Agent', lookup, ctx);
      if (error) errors.push(error);
    }
  }

  // entrypoint가 agents에 포함되어 있는지 검증
  if (spec.entrypoint && Array.isArray(agents)) {
    const entrypointNormalized = safeNormalizeRef(spec.entrypoint);
    const entrypointResolved = resolveUniqueRef(spec.entrypoint, 'Agent', lookup);
    const resolvedAgents = agents
      .map((agentRef) => resolveUniqueRef(agentRef, 'Agent', lookup))
      .filter((agent): agent is Resource => agent !== null);

    if (entrypointNormalized && entrypointResolved) {
      const isIncluded = resolvedAgents.some(
        (agent) => agent === entrypointResolved
      );

      if (!isIncluded) {
        errors.push(
          new ReferenceError(
            `Swarm entrypoint "${entrypointNormalized.kind}/${entrypointNormalized.name}" must be included in agents array`,
            ctx
          )
        );
      }
    }
  }

  return errors;
}

/**
 * Tool 참조 검증
 */
function validateToolReferences(
  resource: Resource,
  _index: ResourceIndex,
  lookup: ReferenceLookup,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);
  const auth = isRecord(spec.auth) ? spec.auth : undefined;
  const toolAuthScopes =
    auth && isStringArray(auth.scopes) ? auth.scopes : undefined;
  const toolExports = Array.isArray(spec.exports) ? spec.exports : [];

  // auth.oauthAppRef 검증
  if (auth?.oauthAppRef) {
    const error = validateSingleRef(auth.oauthAppRef, 'OAuthApp', lookup, ctx);
    if (error) {
      errors.push(error);
    } else {
      // scopes 부분집합 검증
      const oauthApp = resolveUniqueRef(auth.oauthAppRef, 'OAuthApp', lookup);
      if (oauthApp && toolAuthScopes) {
        const oauthAppSpec = getSpec(oauthApp);
        const parentScopes = isStringArray(oauthAppSpec.scopes)
          ? oauthAppSpec.scopes
          : undefined;
        if (parentScopes && parentScopes.length > 0) {
          const scopeErrors = validateScopesSubset(
            toolAuthScopes,
            parentScopes,
            '/spec/auth/scopes'
          );
          errors.push(...scopeErrors);
        }
      }
    }
  }

  for (let i = 0; i < toolExports.length; i++) {
    const exportSpec = toolExports[i];
    if (!isRecord(exportSpec) || !isRecord(exportSpec.auth)) {
      continue;
    }

    const exportAuthScopes = isStringArray(exportSpec.auth.scopes)
      ? exportSpec.auth.scopes
      : undefined;
    if (!exportAuthScopes || exportAuthScopes.length === 0) {
      continue;
    }

    if (!toolAuthScopes) {
      errors.push(
        new ValidationError(
          'Export auth.scopes requires Tool.auth.scopes to be declared',
          {
            path: `/spec/exports/${i}/auth/scopes`,
          }
        )
      );
      continue;
    }

    const scopeErrors = validateScopesSubset(
      exportAuthScopes,
      toolAuthScopes,
      `/spec/exports/${i}/auth/scopes`
    );
    errors.push(...scopeErrors);
  }

  return errors;
}

/**
 * Connector 참조 검증
 * Connector는 순수 프로토콜 구현체이므로 참조 검증할 대상이 없음
 */
function validateConnectorReferences(
  _resource: Resource,
  _index: ResourceIndex,
  _lookup: ReferenceLookup,
  _ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  return [];
}

/**
 * Connection 참조 검증
 */
function validateConnectionReferences(
  resource: Resource,
  _index: ResourceIndex,
  lookup: ReferenceLookup,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // connectorRef → Connector 참조 검증
  if (spec.connectorRef) {
    const error = validateSingleRef(spec.connectorRef, 'Connector', lookup, ctx);
    if (error) errors.push(error);
  }

  // auth.oauthAppRef → OAuthApp 참조 검증
  const auth = spec.auth as Record<string, unknown> | undefined;
  if (auth?.oauthAppRef) {
    const error = validateSingleRef(auth.oauthAppRef, 'OAuthApp', lookup, ctx);
    if (error) errors.push(error);
  }

  // ingress.rules[].route.agentRef → Agent 참조 검증
  const ingress = spec.ingress;
  if (isRecord(ingress)) {
    const rules = ingress.rules;
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        if (isRecord(rule)) {
          const route = rule.route;
          if (isRecord(route) && route.agentRef) {
            const error = validateSingleRef(route.agentRef, 'Agent', lookup, ctx);
            if (error) errors.push(error);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * ResourceType 참조 검증
 */
function validateResourceTypeReferences(
  resource: Resource,
  _index: ResourceIndex,
  lookup: ReferenceLookup,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // handlerRef 검증
  if (spec.handlerRef) {
    const error = validateSingleRef(
      spec.handlerRef,
      'ExtensionHandler',
      lookup,
      ctx
    );
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * 단일 참조 검증
 */
function validateSingleRef(
  ref: unknown,
  expectedKind: string,
  lookup: ReferenceLookup,
  ctx: { sourceKind: string; sourceName: string }
): ReferenceError | null {
  // null/undefined 체크
  if (ref === null || ref === undefined) {
    return null;
  }

  const normalized = safeNormalizeRef(ref);
  if (!normalized) {
    const refStr = typeof ref === 'string' ? ref : JSON.stringify(ref);
    return new ReferenceError(
      `Invalid reference format: ${refStr}`,
      ctx
    );
  }

  if (normalized.kind !== expectedKind) {
    return new ReferenceError(
      `Invalid reference kind: expected ${expectedKind}, got ${normalized.kind}`,
      {
        ...ctx,
        targetKind: normalized.kind,
        targetName: normalized.name,
      }
    );
  }

  const matches = findReferenceMatches(normalized, lookup);
  if (matches.length === 0) {
    if (normalized.package) {
      return new ReferenceError(
        `Referenced resource not found in package "${normalized.package}": ${normalized.kind}/${normalized.name}`,
        {
          ...ctx,
          targetKind: normalized.kind,
          targetName: normalized.name,
        }
      );
    }

    return new ReferenceError(
      `Referenced resource not found: ${normalized.kind}/${normalized.name}`,
      {
        ...ctx,
        targetKind: normalized.kind,
        targetName: normalized.name,
      }
    );
  }

  if (!normalized.package && matches.length > 1) {
    const namespaces = matches.map((match) => describeResourceNamespace(match));
    return new ReferenceError(
      `Ambiguous reference "${normalized.kind}/${normalized.name}". Multiple resources matched (${namespaces.join(', ')}). Specify ObjectRef.package to disambiguate.`,
      {
        ...ctx,
        targetKind: normalized.kind,
        targetName: normalized.name,
      }
    );
  }

  return null;
}

function findReferenceMatches(
  normalized: ObjectRef,
  lookup: ReferenceLookup
): Resource[] {
  const key = `${normalized.kind}/${normalized.name}`;
  const candidates = lookup.byKey.get(key) ?? [];

  if (!normalized.package) {
    return candidates;
  }

  return candidates.filter((candidate) =>
    matchesPackageScope(candidate, normalized.package ?? '')
  );
}

function getPackageAnnotation(resource: Resource, key: string): string | undefined {
  const annotations = resource.metadata.annotations;
  if (!isRecord(annotations)) {
    return undefined;
  }

  const value = annotations[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function matchesPackageScope(resource: Resource, packageScope: string): boolean {
  const packageName = getPackageAnnotation(resource, 'goondan.io/package');
  if (!packageName) {
    return false;
  }

  if (packageScope === packageName) {
    return true;
  }

  const packageVersion = getPackageAnnotation(
    resource,
    'goondan.io/package-version'
  );
  if (packageVersion) {
    return packageScope === `${packageName}@${packageVersion}`;
  }

  return false;
}

function describeResourceNamespace(resource: Resource): string {
  const packageName = getPackageAnnotation(resource, 'goondan.io/package');
  if (!packageName) {
    return 'root';
  }

  const packageVersion = getPackageAnnotation(
    resource,
    'goondan.io/package-version'
  );
  return packageVersion ? `${packageName}@${packageVersion}` : packageName;
}

function resolveUniqueRef(
  ref: unknown,
  expectedKind: string,
  lookup: ReferenceLookup
): Resource | null {
  const normalized = safeNormalizeRef(ref);
  if (!normalized || normalized.kind !== expectedKind) {
    return null;
  }

  const matches = findReferenceMatches(normalized, lookup);
  if (normalized.package) {
    return matches.length > 0 ? matches[0] ?? null : null;
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

/**
 * 안전한 ObjectRef 정규화 (오류 시 null 반환)
 */
function safeNormalizeRef(ref: unknown): ObjectRef | null {
  if (!isObjectRefLike(ref)) {
    return null;
  }

  try {
    return normalizeObjectRef(ref);
  } catch {
    return null;
  }
}

/**
 * 순환 참조 탐지
 *
 * 현재 Goondan 스펙에서 순환 참조가 발생할 수 있는 구조:
 * - ResourceType -> ExtensionHandler (상호 참조 가능성)
 * - Extension config의 동적 참조 (런타임에 해석)
 *
 * @param resources 리소스 배열
 * @returns 탐지된 순환 참조 경로 배열 (빈 배열이면 순환 없음)
 */
export function detectCircularReferences(
  _resources: Resource[]
): string[][] {
  // 현재 스펙에서는 정적 순환 참조가 발생할 가능성이 낮음
  // 필요 시 DFS 기반 순환 탐지 구현
  const cycles: string[][] = [];

  // ResourceType -> ExtensionHandler 간 순환 체크
  // 현재 스펙에서 ExtensionHandler는 다른 리소스를 참조하지 않으므로
  // 순환 참조가 발생하지 않음

  return cycles;
}
