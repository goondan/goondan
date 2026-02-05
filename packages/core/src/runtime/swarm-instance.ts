/**
 * SwarmInstance 구현
 * @see /docs/specs/runtime.md - 2.2 SwarmInstance 타입, 3.1 SwarmInstance 생성 규칙
 */

import type { JsonObject } from '../types/json.js';
import type { ObjectRefLike } from '../types/object-ref.js';
import type {
  SwarmBundleRef,
  SwarmInstanceStatus,
} from './types.js';

/**
 * AgentInstance 타입 (순환 참조 방지용 전방 선언)
 */
export interface AgentInstanceRef {
  readonly id: string;
  readonly agentName: string;
}

/**
 * SwarmInstance: Swarm 정의를 바탕으로 만들어지는 long-running 실행체
 *
 * 규칙:
 * - MUST: SwarmInstance는 하나 이상의 AgentInstance를 포함한다
 * - MUST: instanceKey로 고유하게 식별된다
 * - MUST: swarmRef로 Swarm 정의를 참조한다
 */
export interface SwarmInstance {
  /** 인스턴스 고유 ID (내부 식별용, UUID 권장) */
  readonly id: string;

  /** 라우팅 키 (동일 맥락을 같은 인스턴스로 연결) */
  readonly instanceKey: string;

  /** 참조하는 Swarm 정의 */
  readonly swarmRef: ObjectRefLike;

  /** 현재 활성화된 SwarmBundleRef (불변 스냅샷 식별자) */
  activeSwarmBundleRef: SwarmBundleRef;

  /** 포함된 AgentInstance 맵 (agentName -> AgentInstance) */
  readonly agents: Map<string, AgentInstanceRef>;

  /** 인스턴스 생성 시각 */
  readonly createdAt: Date;

  /** 마지막 활동 시각 */
  lastActivityAt: Date;

  /** 인스턴스 상태 */
  status: SwarmInstanceStatus;

  /** 인스턴스 메타데이터 (확장용) */
  metadata: JsonObject;
}

/**
 * 고유 ID 생성
 */
function generateId(): string {
  return `swarm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * SwarmInstance 생성
 *
 * @param swarmRef - Swarm 정의 참조
 * @param instanceKey - 인스턴스 라우팅 키
 * @param activeSwarmBundleRef - 활성 SwarmBundle 참조
 * @returns SwarmInstance
 */
export function createSwarmInstance(
  swarmRef: ObjectRefLike,
  instanceKey: string,
  activeSwarmBundleRef: SwarmBundleRef
): SwarmInstance {
  const now = new Date();

  return {
    id: generateId(),
    instanceKey,
    swarmRef,
    activeSwarmBundleRef,
    agents: new Map(),
    createdAt: now,
    lastActivityAt: now,
    status: 'active',
    metadata: {},
  };
}

/**
 * SwarmInstanceManager: SwarmInstance 조회 또는 생성
 */
export interface SwarmInstanceManager {
  /**
   * SwarmInstance 조회 또는 생성
   *
   * @param swarmRef - Swarm 정의 참조
   * @param instanceKey - 인스턴스 라우팅 키
   * @param activeSwarmBundleRef - 활성 SwarmBundle 참조
   * @returns SwarmInstance
   */
  getOrCreate(
    swarmRef: ObjectRefLike,
    instanceKey: string,
    activeSwarmBundleRef: SwarmBundleRef
  ): Promise<SwarmInstance>;

  /**
   * SwarmInstance 조회
   *
   * @param instanceKey - 인스턴스 라우팅 키
   * @returns SwarmInstance 또는 undefined
   */
  get(instanceKey: string): SwarmInstance | undefined;

  /**
   * SwarmInstance 종료
   *
   * @param instanceKey - 인스턴스 라우팅 키
   */
  terminate(instanceKey: string): Promise<void>;

  /**
   * 모든 활성 인스턴스 목록
   */
  list(): SwarmInstance[];
}

/**
 * SwarmInstanceManager 구현
 */
class SwarmInstanceManagerImpl implements SwarmInstanceManager {
  private readonly instances = new Map<string, SwarmInstance>();

  async getOrCreate(
    swarmRef: ObjectRefLike,
    instanceKey: string,
    activeSwarmBundleRef: SwarmBundleRef
  ): Promise<SwarmInstance> {
    const existing = this.instances.get(instanceKey);

    if (existing && existing.status !== 'terminated') {
      existing.lastActivityAt = new Date();
      return existing;
    }

    const instance = createSwarmInstance(swarmRef, instanceKey, activeSwarmBundleRef);
    this.instances.set(instanceKey, instance);

    return instance;
  }

  get(instanceKey: string): SwarmInstance | undefined {
    const instance = this.instances.get(instanceKey);

    if (instance && instance.status === 'terminated') {
      return undefined;
    }

    return instance;
  }

  async terminate(instanceKey: string): Promise<void> {
    const instance = this.instances.get(instanceKey);

    if (instance) {
      instance.status = 'terminated';
      // terminated된 인스턴스는 맵에서 제거
      this.instances.delete(instanceKey);
    }
  }

  list(): SwarmInstance[] {
    return Array.from(this.instances.values()).filter(
      (instance) => instance.status !== 'terminated'
    );
  }
}

/**
 * SwarmInstanceManager 생성
 */
export function createSwarmInstanceManager(): SwarmInstanceManager {
  return new SwarmInstanceManagerImpl();
}
