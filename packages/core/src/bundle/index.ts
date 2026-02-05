/**
 * Bundle Parser 시스템
 *
 * Bundle YAML 파싱, 검증, 참조 해석을 담당합니다.
 *
 * @see /docs/specs/bundle.md
 *
 * @example
 * ```typescript
 * import { loadBundleFromFile, loadBundleFromDirectory } from '@goondan/core/bundle';
 *
 * // 파일에서 로드
 * const result = await loadBundleFromFile('./goondan.yaml');
 * if (result.isValid()) {
 *   console.log('Loaded resources:', result.resources.length);
 * } else {
 *   console.error('Errors:', result.errors);
 * }
 *
 * // 디렉토리에서 로드
 * const dirResult = await loadBundleFromDirectory('./config');
 * const models = dirResult.getResourcesByKind('Model');
 * const agent = dirResult.getResource('Agent', 'planner');
 * ```
 */

// Errors
export {
  BundleError,
  ParseError,
  ValidationError,
  ReferenceError,
  isBundleError,
  type ParseErrorOptions,
  type ValidationErrorOptions,
  type ReferenceErrorOptions,
} from './errors.js';

// Parser
export {
  parseYaml,
  parseMultiDocument,
  DEFAULT_API_VERSION,
} from './parser.js';

// Validator
export {
  validateResource,
  validateResources,
  validateNameUniqueness,
  validateObjectRef,
  validateValueSource,
  validateScopesSubset,
} from './validator.js';

// Resolver
export {
  resolveObjectRef,
  resolveAllReferences,
  detectCircularReferences,
  createResourceIndex,
  type ResourceIndex,
} from './resolver.js';

// Loader
export {
  loadBundleFromString,
  loadBundleFromFile,
  loadBundleFromDirectory,
  type BundleLoadResult,
  type LoadDirectoryOptions,
} from './loader.js';

// Package
export * from './package/index.js';
