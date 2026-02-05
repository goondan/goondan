/**
 * CanonicalEvent 처리
 * @see /docs/specs/connector.md - 7.2 Canonical Event
 */

import type { ObjectRefLike, JsonObject } from '../types/index.js';
import { isObjectRef } from '../types/utils.js';
import type { CanonicalEvent, RuntimeEventInput, TurnAuth } from './types.js';

/**
 * CanonicalEvent 생성 파라미터
 */
export interface CreateCanonicalEventParams {
  /** 이벤트 타입 */
  type: string;
  /** 대상 Swarm 참조 */
  swarmRef: ObjectRefLike;
  /** 인스턴스 식별자 */
  instanceKey: string;
  /** LLM 입력 텍스트 */
  input: string;
  /** 대상 에이전트 이름 (선택) */
  agentName?: string;
  /** 호출 맥락 (선택) */
  origin?: JsonObject;
  /** 인증 컨텍스트 (선택) */
  auth?: TurnAuth;
  /** 추가 메타데이터 (선택) */
  metadata?: JsonObject;
}

/**
 * CanonicalEvent를 생성한다.
 *
 * @param params - 생성 파라미터
 * @returns CanonicalEvent
 *
 * @example
 * ```ts
 * const event = createCanonicalEvent({
 *   type: 'message',
 *   swarmRef: { kind: 'Swarm', name: 'default' },
 *   instanceKey: 'thread-123',
 *   input: 'Hello, agent!',
 * });
 * ```
 */
export function createCanonicalEvent(params: CreateCanonicalEventParams): CanonicalEvent {
  const event: CanonicalEvent = {
    type: params.type,
    swarmRef: params.swarmRef,
    instanceKey: params.instanceKey,
    input: params.input,
  };

  // 선택 필드 추가
  if (params.agentName !== undefined) {
    event.agentName = params.agentName;
  }

  if (params.origin !== undefined) {
    event.origin = params.origin;
  }

  if (params.auth !== undefined) {
    event.auth = params.auth;
  }

  if (params.metadata !== undefined) {
    event.metadata = params.metadata;
  }

  return event;
}

/**
 * 검증 결과
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * CanonicalEvent의 유효성을 검증한다.
 *
 * @param event - 검증할 이벤트
 * @returns 검증 결과
 */
export function validateCanonicalEvent(event: CanonicalEvent): ValidationResult {
  const errors: string[] = [];

  // type 검증
  if (!event.type) {
    errors.push('type is required');
  }

  // swarmRef 검증
  if (!event.swarmRef) {
    errors.push('swarmRef is required');
  } else if (typeof event.swarmRef === 'string') {
    // "Kind/name" 형식 검증
    if (!event.swarmRef.includes('/')) {
      errors.push('swarmRef string must be in "Kind/name" format');
    }
  } else if (isObjectRef(event.swarmRef)) {
    if (!event.swarmRef.kind) {
      errors.push('swarmRef.kind is required');
    }
    if (!event.swarmRef.name) {
      errors.push('swarmRef.name is required');
    }
  }

  // instanceKey 검증
  if (!event.instanceKey) {
    errors.push('instanceKey is required');
  }

  // input 검증 (빈 문자열은 허용)
  if (event.input === undefined || event.input === null) {
    errors.push('input is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * CanonicalEvent를 RuntimeEventInput으로 변환한다.
 *
 * @param event - CanonicalEvent
 * @returns RuntimeEventInput
 */
export function toRuntimeEventInput(event: CanonicalEvent): RuntimeEventInput {
  const input: RuntimeEventInput = {
    swarmRef: event.swarmRef,
    instanceKey: event.instanceKey,
    input: event.input,
  };

  // 선택 필드 복사
  if (event.agentName !== undefined) {
    input.agentName = event.agentName;
  }

  if (event.origin !== undefined) {
    input.origin = event.origin;
  }

  if (event.auth !== undefined) {
    input.auth = event.auth;
  }

  if (event.metadata !== undefined) {
    input.metadata = event.metadata;
  }

  return input;
}
