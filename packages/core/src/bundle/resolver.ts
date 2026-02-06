/**
 * Bundle 참조 해석
 * @see /docs/specs/bundle.md - 2. ObjectRef 상세
 */

import { ReferenceError, ValidationError } from './errors.js';
import { validateScopesSubset } from './validator.js';
import type { Resource, ObjectRefLike, ObjectRef } from '../types/index.js';
import { normalizeObjectRef, isSelectorWithOverrides, getSpec } from '../types/index.js';

/**
 * 리소스 인덱스 타입
 * key: "Kind/name" 형식
 */
export type ResourceIndex = Map<string, Resource>;

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
    return index.get(key);
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

  for (const resource of resources) {
    const resourceErrors = validateResourceReferences(resource, index);
    errors.push(...resourceErrors);
  }

  return errors;
}

/**
 * 단일 리소스의 참조 검증
 */
function validateResourceReferences(
  resource: Resource,
  index: ResourceIndex
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const ctx = {
    sourceKind: resource.kind,
    sourceName: resource.metadata.name,
  };

  switch (resource.kind) {
    case 'Agent':
      errors.push(...validateAgentReferences(resource, index, ctx));
      break;
    case 'Swarm':
      errors.push(...validateSwarmReferences(resource, index, ctx));
      break;
    case 'Tool':
      errors.push(...validateToolReferences(resource, index, ctx));
      break;
    case 'Connector':
      errors.push(...validateConnectorReferences(resource, index, ctx));
      break;
    case 'Connection':
      errors.push(...validateConnectionReferences(resource, index, ctx));
      break;
    case 'ResourceType':
      errors.push(...validateResourceTypeReferences(resource, index, ctx));
      break;
  }

  return errors;
}

/**
 * Agent 참조 검증
 */
function validateAgentReferences(
  resource: Resource,
  index: ResourceIndex,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // modelConfig.modelRef 검증
  const modelConfig = spec.modelConfig as Record<string, unknown> | undefined;
  if (modelConfig?.modelRef) {
    const ref = modelConfig.modelRef;
    const error = validateSingleRef(ref, 'Model', index, ctx);
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
      const error = validateSingleRef(item, 'Tool', index, ctx);
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
      const error = validateSingleRef(item, 'Extension', index, ctx);
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
  index: ResourceIndex,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // entrypoint 검증
  if (spec.entrypoint) {
    const error = validateSingleRef(spec.entrypoint, 'Agent', index, ctx);
    if (error) errors.push(error);
  }

  // agents 검증
  const agents = spec.agents as unknown[] | undefined;
  if (Array.isArray(agents)) {
    for (const item of agents) {
      const error = validateSingleRef(item, 'Agent', index, ctx);
      if (error) errors.push(error);
    }
  }

  // entrypoint가 agents에 포함되어 있는지 검증
  if (spec.entrypoint && Array.isArray(agents)) {
    const entrypointNormalized = safeNormalizeRef(spec.entrypoint);
    const agentsNormalized = agents
      .map((a) => safeNormalizeRef(a))
      .filter((a): a is ObjectRef => a !== null);

    if (entrypointNormalized) {
      const isIncluded = agentsNormalized.some(
        (a) =>
          a.kind === entrypointNormalized.kind &&
          a.name === entrypointNormalized.name
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
  index: ResourceIndex,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // auth.oauthAppRef 검증
  const auth = spec.auth as Record<string, unknown> | undefined;
  if (auth?.oauthAppRef) {
    const error = validateSingleRef(auth.oauthAppRef, 'OAuthApp', index, ctx);
    if (error) {
      errors.push(error);
    } else {
      // scopes 부분집합 검증
      const oauthApp = resolveObjectRef(
        auth.oauthAppRef as ObjectRefLike,
        index
      );
      if (oauthApp && auth.scopes && Array.isArray(auth.scopes)) {
        const oauthAppSpec = oauthApp.spec as Record<string, unknown>;
        const parentScopes = oauthAppSpec.scopes as string[] | undefined;
        if (parentScopes) {
          const scopeErrors = validateScopesSubset(
            auth.scopes as string[],
            parentScopes,
            '/spec/auth/scopes'
          );
          errors.push(...scopeErrors);
        }
      }
    }
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
  _ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  return [];
}

/**
 * Connection 참조 검증
 */
function validateConnectionReferences(
  resource: Resource,
  index: ResourceIndex,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // connectorRef → Connector 참조 검증
  if (spec.connectorRef) {
    const error = validateSingleRef(spec.connectorRef, 'Connector', index, ctx);
    if (error) errors.push(error);
  }

  // auth.oauthAppRef → OAuthApp 참조 검증
  const auth = spec.auth as Record<string, unknown> | undefined;
  if (auth?.oauthAppRef) {
    const error = validateSingleRef(auth.oauthAppRef, 'OAuthApp', index, ctx);
    if (error) errors.push(error);
  }

  // rules[].route.swarmRef → Swarm 참조 검증
  const rules = spec.rules as unknown[] | undefined;
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (rule && typeof rule === 'object') {
        const route = (rule as Record<string, unknown>).route as
          | Record<string, unknown>
          | undefined;
        if (route?.swarmRef) {
          const error = validateSingleRef(route.swarmRef, 'Swarm', index, ctx);
          if (error) errors.push(error);
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
  index: ResourceIndex,
  ctx: { sourceKind: string; sourceName: string }
): (ReferenceError | ValidationError)[] {
  const errors: (ReferenceError | ValidationError)[] = [];
  const spec = getSpec(resource);

  // handlerRef 검증
  if (spec.handlerRef) {
    const error = validateSingleRef(
      spec.handlerRef,
      'ExtensionHandler',
      index,
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
  _expectedKind: string,
  index: ResourceIndex,
  ctx: { sourceKind: string; sourceName: string }
): ReferenceError | null {
  // null/undefined 체크
  if (ref === null || ref === undefined) {
    return null;
  }

  try {
    const normalized = normalizeObjectRef(ref as ObjectRefLike);
    const key = `${normalized.kind}/${normalized.name}`;

    if (!index.has(key)) {
      return new ReferenceError(
        `Referenced resource not found: ${key}`,
        {
          ...ctx,
          targetKind: normalized.kind,
          targetName: normalized.name,
        }
      );
    }

    return null;
  } catch {
    // 잘못된 형식의 참조
    const refStr = typeof ref === 'string' ? ref : JSON.stringify(ref);
    return new ReferenceError(
      `Invalid reference format: ${refStr}`,
      ctx
    );
  }
}

/**
 * 안전한 ObjectRef 정규화 (오류 시 null 반환)
 */
function safeNormalizeRef(ref: unknown): ObjectRef | null {
  try {
    return normalizeObjectRef(ref as ObjectRefLike);
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
