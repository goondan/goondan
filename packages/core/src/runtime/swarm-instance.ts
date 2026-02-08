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
 * SwarmInstanceInfo: inspect/list용 상태 정보
 * @see /docs/specs/runtime.md - 3.1 SwarmInstanceManager
 */
export interface SwarmInstanceInfo {
  /** 인스턴스 고유 ID */
  readonly id: string;
  /** 라우팅 키 */
  readonly instanceKey: string;
  /** Swarm 참조 */
  readonly swarmRef: ObjectRefLike;
  /** 현재 활성 SwarmBundleRef */
  readonly activeSwarmBundleRef: SwarmBundleRef;
  /** 인스턴스 상태 */
  readonly status: SwarmInstanceStatus;
  /** 포함된 Agent 이름 목록 */
  readonly agentNames: string[];
  /** 생성 시각 */
  readonly createdAt: Date;
  /** 마지막 활동 시각 */
  readonly lastActivityAt: Date;
  /** 메타데이터 */
  readonly metadata: JsonObject;
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
 * SwarmInstance에서 SwarmInstanceInfo 생성
 */
export function toSwarmInstanceInfo(instance: SwarmInstance): SwarmInstanceInfo {
  return {
    id: instance.id,
    instanceKey: instance.instanceKey,
    swarmRef: instance.swarmRef,
    activeSwarmBundleRef: instance.activeSwarmBundleRef,
    status: instance.status,
    agentNames: Array.from(instance.agents.keys()),
    createdAt: instance.createdAt,
    lastActivityAt: instance.lastActivityAt,
    metadata: { ...instance.metadata },
  };
}

/**
 * SwarmInstanceManager: SwarmInstance 라이프사이클 관리
 * @see /docs/specs/runtime.md - 3.1 SwarmInstance 생성 규칙, 9.5 운영 인터페이스 요구사항
 */
export interface SwarmInstanceManager {
  /**
   * SwarmInstance 조회 또는 생성
   */
  getOrCreate(
    swarmRef: ObjectRefLike,
    instanceKey: string,
    activeSwarmBundleRef: SwarmBundleRef
  ): Promise<SwarmInstance>;

  /**
   * SwarmInstance 조회
   */
  get(instanceKey: string): SwarmInstance | undefined;

  /**
   * SwarmInstance 종료
   */
  terminate(instanceKey: string): Promise<void>;

  /**
   * SwarmInstance 상태 조회
   * @see /docs/specs/runtime.md - 9.5 운영 인터페이스
   */
  inspect(instanceKey: string): Promise<SwarmInstanceInfo | undefined>;

  /**
   * SwarmInstance 일시정지
   * - MUST: paused 상태에서는 새 Turn을 실행해서는 안 된다
   */
  pause(instanceKey: string): Promise<void>;

  /**
   * SwarmInstance 처리 재개
   * - MUST: 큐 적재 이벤트를 순서대로 재개해야 한다
   */
  resume(instanceKey: string): Promise<void>;

  /**
   * SwarmInstance 상태 삭제
   * - MUST: 인스턴스 상태를 제거하되 시스템 전역 상태(OAuth grant 등)는 보존한다
   */
  delete(instanceKey: string): Promise<void>;

  /**
   * 전체 SwarmInstance 목록 조회
   */
  list(): Promise<SwarmInstanceInfo[]>;
}

/**
 * 인스턴스 metadata 상태
 */
export type InstanceMetadataStatus = 'running' | 'paused' | 'terminated';

/**
 * SwarmInstance 라이프사이클 훅
 */
export interface SwarmInstanceLifecycleHooks {
  /**
   * 상태 변경 시 호출
   */
  onStatusChange?: (
    instance: SwarmInstance,
    status: InstanceMetadataStatus
  ) => Promise<void> | void;

  /**
   * 인스턴스 삭제 시 호출
   */
  onDelete?: (instanceKey: string, instance?: SwarmInstance) => Promise<void> | void;
}

/**
 * SwarmInstanceManager 생성 옵션
 */
export interface SwarmInstanceManagerOptions {
  lifecycleHooks?: SwarmInstanceLifecycleHooks;
}

/**
 * SwarmInstanceManager 구현
 */
class SwarmInstanceManagerImpl implements SwarmInstanceManager {
  private readonly instances = new Map<string, SwarmInstance>();
  private readonly lifecycleHooks?: SwarmInstanceLifecycleHooks;

  constructor(options: SwarmInstanceManagerOptions) {
    this.lifecycleHooks = options.lifecycleHooks;
  }

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
    await this.notifyStatusChange(instance, 'running');

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
      await this.notifyStatusChange(instance, 'terminated');
      this.instances.delete(instanceKey);
    }
  }

  async inspect(instanceKey: string): Promise<SwarmInstanceInfo | undefined> {
    const instance = this.instances.get(instanceKey);

    if (!instance || instance.status === 'terminated') {
      return undefined;
    }

    return toSwarmInstanceInfo(instance);
  }

  async pause(instanceKey: string): Promise<void> {
    const instance = this.instances.get(instanceKey);

    if (!instance) {
      return;
    }

    if (instance.status === 'terminated') {
      throw new Error(`Cannot pause terminated instance: ${instanceKey}`);
    }

    if (instance.status === 'paused') {
      return; // 이미 paused 상태
    }

    instance.status = 'paused';
    instance.lastActivityAt = new Date();
    await this.notifyStatusChange(instance, 'paused');
  }

  async resume(instanceKey: string): Promise<void> {
    const instance = this.instances.get(instanceKey);

    if (!instance) {
      return;
    }

    if (instance.status !== 'paused') {
      throw new Error(`Cannot resume non-paused instance (status: ${instance.status}): ${instanceKey}`);
    }

    instance.status = 'active';
    instance.lastActivityAt = new Date();
    await this.notifyStatusChange(instance, 'running');
  }

  async delete(instanceKey: string): Promise<void> {
    // MUST: 인스턴스 상태를 제거하되 시스템 전역 상태(OAuth grant 등)는 보존
    const instance = this.instances.get(instanceKey);
    await this.notifyDelete(instanceKey, instance);
    this.instances.delete(instanceKey);
  }

  async list(): Promise<SwarmInstanceInfo[]> {
    const result: SwarmInstanceInfo[] = [];

    for (const instance of this.instances.values()) {
      if (instance.status !== 'terminated') {
        result.push(toSwarmInstanceInfo(instance));
      }
    }

    return result;
  }

  private async notifyStatusChange(
    instance: SwarmInstance,
    status: InstanceMetadataStatus
  ): Promise<void> {
    if (!this.lifecycleHooks?.onStatusChange) {
      return;
    }
    await this.lifecycleHooks.onStatusChange(instance, status);
  }

  private async notifyDelete(
    instanceKey: string,
    instance?: SwarmInstance
  ): Promise<void> {
    if (!this.lifecycleHooks?.onDelete) {
      return;
    }
    await this.lifecycleHooks.onDelete(instanceKey, instance);
  }
}

/**
 * SwarmInstanceManager 생성
 */
export function createSwarmInstanceManager(
  options: SwarmInstanceManagerOptions = {}
): SwarmInstanceManager {
  return new SwarmInstanceManagerImpl(options);
}
