/**
 * Swarm Spec 타입 정의
 * @see /docs/specs/resources.md - 6.5 Swarm
 */

import type { Resource } from '../resource.js';
import type { ObjectRefLike } from '../object-ref.js';
import type { PipelinePoint } from './agent.js';

/**
 * Swarm 리소스 스펙
 */
export interface SwarmSpec {
  /** 진입점 Agent */
  entrypoint: ObjectRefLike;
  /** 포함된 Agent 목록 */
  agents: ObjectRefLike[];
  /** 실행 정책 */
  policy?: SwarmPolicy;
}

/**
 * Swarm 실행 정책
 */
export interface SwarmPolicy {
  /** Turn당 최대 Step 수 */
  maxStepsPerTurn?: number;
  /** Changeset 정책 */
  changesets?: SwarmChangesetPolicy;
  /** Live Config 정책 */
  liveConfig?: LiveConfigPolicy;
}

/**
 * Swarm 수준 Changeset 정책
 */
export interface SwarmChangesetPolicy {
  /** Changeset 기능 활성화 여부 */
  enabled?: boolean;
  /** 적용 시점 */
  applyAt?: PipelinePoint[];
  /** 허용 범위 */
  allowed?: {
    /** 허용되는 파일 패턴 */
    files?: string[];
  };
  /** revision 변경 이벤트 발행 여부 */
  emitRevisionChangedEvent?: boolean;
}

/**
 * Live Config 정책
 */
export interface LiveConfigPolicy {
  /** Live Config 활성화 여부 */
  enabled?: boolean;
  /** 적용 시점 */
  applyAt?: PipelinePoint[];
  /** 허용되는 patch 경로 */
  allowedPaths?: {
    /** Agent 기준 상대 경로 */
    agentRelative?: string[];
    /** Swarm 기준 상대 경로 */
    swarmRelative?: string[];
  };
}

/**
 * Swarm 리소스 타입
 */
export type SwarmResource = Resource<SwarmSpec>;
