/**
 * AgentInstance 구현
 * @see /docs/specs/runtime.md - 2.3 AgentInstance 타입, 3.2 AgentInstance 생성 규칙
 */

import type { JsonObject } from '../types/json.js';
import type { ObjectRefLike } from '../types/object-ref.js';
import type { AgentInstanceStatus, AgentEvent } from './types.js';
import type { SwarmInstance } from './swarm-instance.js';

/**
 * Turn 타입 (순환 참조 방지용 전방 선언)
 */
export interface TurnRef {
  readonly id: string;
}

/**
 * AgentEventQueue: AgentInstance의 이벤트 큐
 */
export interface AgentEventQueue {
  /** 이벤트 추가 (FIFO) */
  enqueue(event: AgentEvent): void;

  /** 다음 이벤트 꺼내기 (없으면 null) */
  dequeue(): AgentEvent | null;

  /** 대기 중인 이벤트 수 */
  readonly length: number;

  /** 대기 중인 이벤트 목록 (읽기 전용) */
  peek(): readonly AgentEvent[];
}

/**
 * AgentEventQueue 구현
 */
class AgentEventQueueImpl implements AgentEventQueue {
  private readonly queue: AgentEvent[] = [];

  enqueue(event: AgentEvent): void {
    this.queue.push(event);
  }

  dequeue(): AgentEvent | null {
    if (this.queue.length === 0) {
      return null;
    }
    // shift()는 undefined를 반환할 수 있지만, length 체크로 보장됨
    const event = this.queue.shift();
    return event ?? null;
  }

  get length(): number {
    return this.queue.length;
  }

  peek(): readonly AgentEvent[] {
    return [...this.queue];
  }
}

/**
 * AgentEventQueue 생성
 */
export function createAgentEventQueue(): AgentEventQueue {
  return new AgentEventQueueImpl();
}

/**
 * AgentInstance: Agent 정의를 바탕으로 만들어지는 long-running 실행체
 *
 * 규칙:
 * - MUST: 이벤트 큐를 보유하고 FIFO 순서로 처리한다
 * - MUST: agentName으로 SwarmInstance 내에서 고유하게 식별된다
 */
export interface AgentInstance {
  /** 인스턴스 고유 ID */
  readonly id: string;

  /** Agent 이름 (SwarmInstance 내 고유) */
  readonly agentName: string;

  /** 소속된 SwarmInstance 참조 */
  readonly swarmInstance: SwarmInstance;

  /** 참조하는 Agent 정의 */
  readonly agentRef: ObjectRefLike;

  /** 이벤트 큐 */
  readonly eventQueue: AgentEventQueue;

  /** 현재 진행 중인 Turn (없으면 null) */
  currentTurn: TurnRef | null;

  /** 완료된 Turn 수 */
  completedTurnCount: number;

  /** Extension별 상태 저장소 */
  readonly extensionStates: Map<string, JsonObject>;

  /** 인스턴스 공유 상태 (모든 Extension이 접근 가능) */
  readonly sharedState: JsonObject;

  /** 인스턴스 생성 시각 */
  readonly createdAt: Date;

  /** 마지막 활동 시각 */
  lastActivityAt: Date;

  /** 인스턴스 상태 */
  status: AgentInstanceStatus;
}

/**
 * 고유 ID 생성
 */
function generateId(): string {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * ObjectRefLike에서 이름 추출
 */
function resolveRefName(ref: ObjectRefLike): string {
  if (typeof ref === 'string') {
    // "Kind/name" 형식에서 name 추출
    const parts = ref.split('/');
    if (parts.length === 2 && parts[1] !== undefined) {
      return parts[1];
    }
    return ref;
  }
  return ref.name;
}

/**
 * AgentInstance 생성
 *
 * @param swarmInstance - 소속된 SwarmInstance
 * @param agentRef - Agent 정의 참조
 * @returns AgentInstance
 */
export function createAgentInstance(
  swarmInstance: SwarmInstance,
  agentRef: ObjectRefLike
): AgentInstance {
  const now = new Date();
  const agentName = resolveRefName(agentRef);

  return {
    id: generateId(),
    agentName,
    swarmInstance,
    agentRef,
    eventQueue: createAgentEventQueue(),
    currentTurn: null,
    completedTurnCount: 0,
    extensionStates: new Map(),
    sharedState: {},
    createdAt: now,
    lastActivityAt: now,
    status: 'idle',
  };
}
