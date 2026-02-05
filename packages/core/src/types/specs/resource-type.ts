/**
 * ResourceType Spec 타입 정의
 * @see /docs/specs/resources.md - 6.8 ResourceType
 */

import type { Resource } from '../resource.js';
import type { ObjectRef } from '../object-ref.js';

/**
 * ResourceType 리소스 스펙
 */
export interface ResourceTypeSpec {
  /** API 그룹 */
  group: string;
  /** 이름 정의 */
  names: ResourceTypeNames;
  /** 버전 목록 */
  versions: ResourceTypeVersion[];
  /** 핸들러 참조 */
  handlerRef: ObjectRef;
}

/**
 * ResourceType 이름 정의
 */
export interface ResourceTypeNames {
  /** Kind 이름 (단수형) */
  kind: string;
  /** 복수형 이름 */
  plural: string;
  /** 약어 (선택) */
  shortNames?: string[];
}

/**
 * ResourceType 버전 정의
 */
export interface ResourceTypeVersion {
  /** 버전 이름 */
  name: string;
  /** 제공 여부 */
  served: boolean;
  /** 저장 버전 여부 */
  storage: boolean;
}

/**
 * ResourceType 리소스 타입
 */
export type ResourceTypeResource = Resource<ResourceTypeSpec>;
