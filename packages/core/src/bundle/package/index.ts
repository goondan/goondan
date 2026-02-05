/**
 * Bundle Package 시스템
 * @see /docs/specs/bundle_package.md
 *
 * Goondan 패키지 시스템은 Bundle Package를 레지스트리, Git, 로컬 경로로
 * 참조하고 다운로드/캐싱/의존성 해석을 수행합니다.
 */

// Types
export type {
  PackageRefType,
  PackageRef,
  PackageRefLike,
  PackageSpec,
  ResolvedDependency,
  PackageVersionInfo,
  PackageDistInfo,
  PackageMetadata,
  LockfileEntry,
  Lockfile,
} from './types.js';

export {
  isPackageRef,
  isPackageSpec,
  isResolvedDependency,
} from './types.js';

// Errors
export {
  PackageError,
  PackageRefParseError,
  PackageFetchError,
  PackageIntegrityError,
  PackageNotFoundError,
  DependencyResolutionError,
  isPackageError,
} from './errors.js';

export type {
  PackageRefParseErrorOptions,
  PackageFetchErrorOptions,
  PackageIntegrityErrorOptions,
  PackageNotFoundErrorOptions,
  DependencyResolutionErrorOptions,
} from './errors.js';

// Ref Parser
export {
  parsePackageRef,
  formatPackageRef,
  normalizePackageRef,
  isGitRef,
  isLocalRef,
  isRegistryRef,
  parseScope,
  parseVersion,
} from './ref-parser.js';

// Cache
export type { PackageCacheOptions, PackageCache } from './cache.js';

export {
  createPackageCache,
  getCacheDir,
  getPackageCachePath,
  cleanPackageCache,
  computeFileHash,
  createIntegrity,
  verifyIntegrity,
} from './cache.js';

// Git
export type { GitUrlInfo, BuildGitCloneArgsOptions, GitFetcherOptions, GitFetcher } from './git.js';

export {
  parseGitUrl,
  buildGitCloneArgs,
  isCommitHash,
  createGitFetcher,
} from './git.js';

// Manager
export type { PackageManagerOptions, PackageFetchOptions, PackageManager } from './manager.js';

export { createPackageManager } from './manager.js';

// Resolver
export type { DependencyResolver } from './resolver.js';

export { createDependencyResolver, ResolutionOrder } from './resolver.js';
