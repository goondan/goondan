/**
 * Resource 타입 정의
 * @see /docs/specs/resources.md - 1. 리소스 공통 형식, 2. Metadata 구조
 */

/**
 * 리소스 메타데이터
 */
export interface ResourceMetadata {
  /** 리소스 이름 (동일 Kind 내 고유) */
  name: string;

  /** 버전 (선택) - Package 등에서 사용 */
  version?: string;

  /** 라벨 (선택) - Selector 매칭에 사용 */
  labels?: Record<string, string>;

  /** 어노테이션 (선택) - 임의의 메타데이터 저장 */
  annotations?: Record<string, string>;

  /** 네임스페이스 (선택, 향후 확장) */
  namespace?: string;
}

/**
 * 모든 리소스의 기본 형태
 */
export interface Resource<T = unknown> {
  /** API 버전 (예: "agents.example.io/v1alpha1") */
  apiVersion: string;
  /** 리소스 종류 */
  kind: string;
  /** 메타데이터 */
  metadata: ResourceMetadata;
  /** Kind별 스펙 */
  spec: T;
}

/**
 * 알려진 Kind의 유니온 타입
 */
export type KnownKind =
  | 'Model'
  | 'Tool'
  | 'Extension'
  | 'Agent'
  | 'Swarm'
  | 'Connector'
  | 'Connection'
  | 'OAuthApp'
  | 'ResourceType'
  | 'ExtensionHandler'
  | 'Bundle'
  | 'Package';
