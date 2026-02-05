/**
 * Goondan Core Types
 *
 * Config Plane 리소스 정의 타입들을 export합니다.
 * @see /docs/specs/resources.md
 */

// JSON 기본 타입
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  JsonArray,
} from './json.js';

// JSON Schema
export type { JsonSchema } from './json-schema.js';

// Resource
export type {
  Resource,
  ResourceMetadata,
  KnownKind,
} from './resource.js';

// ObjectRef
export type {
  ObjectRef,
  ObjectRefLike,
} from './object-ref.js';

// Selector
export type {
  Selector,
  SelectorWithOverrides,
  RefOrSelector,
} from './selector.js';

// ValueSource
export type {
  ValueSource,
  ValueFrom,
  SecretRef,
} from './value-source.js';

// Utils
export {
  isResource,
  isResourceOfKind,
  isObjectRef,
  isSelectorWithOverrides,
  normalizeObjectRef,
  deepMerge,
  resolveValueSource,
} from './utils.js';

export type { ValueSourceContext } from './utils.js';

// Kind별 Spec 타입
export * from './specs/index.js';
