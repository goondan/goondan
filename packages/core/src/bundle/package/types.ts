/**
 * Bundle Package 타입 정의
 * @see /docs/specs/bundle_package.md
 */

import type { Resource } from '../../types/resource.js';

/**
 * 패키지 참조 타입
 */
export type PackageRefType = 'git' | 'local' | 'registry';

/**
 * 패키지 참조 정보
 */
export interface PackageRef {
  /** 참조 타입 */
  type: PackageRefType;
  /** URL 또는 경로 */
  url: string;
  /** Git ref (tag, branch, commit) - git 타입에서 사용 */
  ref?: string;
  /** 패키지 내 하위 경로 */
  path?: string;
  /** 레지스트리 패키지 scope (@org) */
  scope?: string;
  /** 레지스트리 패키지 이름 */
  name?: string;
  /** 레지스트리 패키지 버전 */
  version?: string;
}

/**
 * 패키지 참조 문자열 또는 객체
 */
export type PackageRefLike = string | PackageRef;

/**
 * Package Kind의 spec
 * @see /docs/specs/bundle_package.md - 3. Package 스키마
 */
/**
 * 패키지 접근 수준
 */
export type PackageAccess = 'public' | 'restricted';

export interface PackageSpec {
  /** 접근 수준 (기본값: 'public') */
  access?: PackageAccess;
  /** Bundle Package Ref 목록 */
  dependencies?: string[];
  /** 패키지로 export될 YAML 파일 경로 목록 */
  exports?: string[];
  /** tarball로 export될 폴더 목록 */
  dist: string[];
}

/**
 * 해석된 의존성 정보
 */
export interface ResolvedDependency {
  /** 패키지 이름 */
  name: string;
  /** 패키지 버전 */
  version: string;
  /** 로컬 캐시 경로 */
  localPath: string;
  /** 로드된 리소스 목록 */
  resources: Resource[];
  /** 원본 패키지 참조 */
  ref: PackageRef;
}

/**
 * 패키지 버전 정보 (레지스트리)
 */
export interface PackageVersionInfo {
  /** 버전 */
  version: string;
  /** 의존성 목록 */
  dependencies: string[];
  /** 폐기 메시지 (빈 문자열이면 폐기 해제) */
  deprecated?: string;
  /** 배포 정보 */
  dist: PackageDistInfo;
  /** Bundle 설정 */
  bundle?: {
    include?: string[];
    runtime?: string;
  };
}

/**
 * 패키지 배포 정보
 */
export interface PackageDistInfo {
  /** tarball URL */
  tarball: string;
  /** SHA-1 해시 */
  shasum: string;
  /** SHA-512 무결성 해시 */
  integrity: string;
}

/**
 * 패키지 메타데이터 (레지스트리)
 */
export interface PackageMetadata {
  /** 패키지 이름 */
  name: string;
  /** 설명 */
  description?: string;
  /** 접근 수준 */
  access?: PackageAccess;
  /** 버전별 정보 */
  versions: Record<string, PackageVersionInfo>;
  /** dist-tag 매핑 */
  distTags: Record<string, string>;
}

/**
 * Lockfile 엔트리
 */
export interface LockfileEntry {
  /** 버전 */
  version: string;
  /** 해석된 URL */
  resolved: string;
  /** 무결성 해시 */
  integrity: string;
  /** 의존성 매핑 (이름 -> 버전) */
  dependencies?: Record<string, string>;
}

/**
 * Lockfile 형식
 * @see /docs/specs/bundle_package.md - 11.1 Lockfile 형식
 */
export interface Lockfile {
  /** Lockfile 버전 */
  lockfileVersion: number;
  /** 패키지 엔트리 (ref -> entry) */
  packages: Record<string, LockfileEntry>;
}

/**
 * PackageRef 타입 가드
 */
export function isPackageRef(value: unknown): value is PackageRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return typeof obj['type'] === 'string' && typeof obj['url'] === 'string';
}

/**
 * PackageSpec 타입 가드
 */
export function isPackageSpec(value: unknown): value is PackageSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return Array.isArray(obj['dist']);
}

/**
 * ResolvedDependency 타입 가드
 */
export function isResolvedDependency(value: unknown): value is ResolvedDependency {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj['name'] === 'string' &&
    typeof obj['version'] === 'string' &&
    typeof obj['localPath'] === 'string' &&
    Array.isArray(obj['resources']) &&
    isPackageRef(obj['ref'])
  );
}
