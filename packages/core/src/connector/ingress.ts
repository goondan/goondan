/**
 * Ingress 라우팅 로직
 * @see /docs/specs/connector.md - 4. Ingress 규칙
 */

import type { IngressRule, IngressMatch } from '../types/specs/connector.js';
import type { JsonObject } from '../types/index.js';
import type { CanonicalEvent, TurnAuth } from './types.js';
import { readJsonPath } from './jsonpath.js';

/**
 * Ingress 매칭 클래스
 * 외부 이벤트가 IngressRule의 match 조건에 부합하는지 검사한다.
 */
export class IngressMatcher {
  /**
   * match 조건과 payload를 비교한다.
   *
   * @param match - IngressMatch 조건
   * @param payload - 외부 이벤트 페이로드
   * @returns 매칭 여부
   */
  match(match: IngressMatch, payload: JsonObject): boolean {
    // command 매칭
    if (match.command !== undefined) {
      const payloadCommand = this.extractValue(payload, 'command');
      if (payloadCommand !== match.command) {
        return false;
      }
    }

    // eventType 매칭
    if (match.eventType !== undefined) {
      const payloadType = this.extractValue(payload, 'type');
      if (payloadType !== match.eventType) {
        return false;
      }
    }

    // channel 매칭
    if (match.channel !== undefined) {
      const payloadChannel = this.extractValue(payload, 'channel');
      if (payloadChannel !== match.channel) {
        return false;
      }
    }

    return true;
  }

  /**
   * 페이로드에서 값을 추출한다.
   * 최상위와 event 하위 모두 검색한다.
   */
  private extractValue(payload: JsonObject, key: string): unknown {
    // 최상위에서 먼저 검색
    if (key in payload) {
      return payload[key];
    }

    // event 하위에서 검색 (Slack 등 중첩 구조 지원)
    const event = payload['event'];
    if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
      const eventObj = event as JsonObject;
      if (key in eventObj) {
        return eventObj[key];
      }
    }

    return undefined;
  }
}

/**
 * IngressRule이 payload에 매칭되는지 검사한다.
 *
 * @param rule - Ingress 규칙
 * @param payload - 외부 이벤트 페이로드
 * @returns 매칭 여부
 */
export function matchIngressRule(rule: IngressRule, payload: JsonObject): boolean {
  // match가 없거나 빈 객체면 모든 이벤트 매칭
  if (!rule.match) {
    return true;
  }

  const matchKeys = Object.keys(rule.match);
  if (matchKeys.length === 0) {
    return true;
  }

  const matcher = new IngressMatcher();
  return matcher.match(rule.match, payload);
}

/**
 * 매칭되는 첫 번째 규칙을 찾아 반환한다.
 *
 * @param rules - Ingress 규칙 배열
 * @param payload - 외부 이벤트 페이로드
 * @returns 매칭된 규칙 또는 null
 */
export function routeEvent(
  rules: IngressRule[],
  payload: JsonObject
): IngressRule | null {
  for (const rule of rules) {
    if (matchIngressRule(rule, payload)) {
      return rule;
    }
  }
  return null;
}

/**
 * CanonicalEvent 생성 옵션
 */
export interface CreateCanonicalEventOptions {
  /** 이벤트 타입 */
  type: string;
  /** Connector 이름 */
  connectorName: string;
  /** 기본 instanceKey (JSONPath 추출 실패 시 사용) */
  defaultInstanceKey?: string;
  /** origin 정보 */
  origin?: JsonObject;
  /** auth 정보 */
  auth?: TurnAuth;
  /** 메타데이터 */
  metadata?: JsonObject;
}

/**
 * IngressRule과 payload로부터 CanonicalEvent를 생성한다.
 *
 * @param rule - Ingress 규칙
 * @param payload - 외부 이벤트 페이로드
 * @param options - 생성 옵션
 * @returns CanonicalEvent
 */
export function createCanonicalEventFromIngress(
  rule: IngressRule,
  payload: JsonObject,
  options: CreateCanonicalEventOptions
): CanonicalEvent {
  const { route } = rule;

  // instanceKey 추출
  let instanceKey: string;
  if (route.instanceKeyFrom) {
    const extracted = readJsonPath(payload, route.instanceKeyFrom);
    instanceKey = extracted !== undefined ? String(extracted) : (options.defaultInstanceKey ?? 'default');
  } else {
    instanceKey = options.defaultInstanceKey ?? 'default';
  }

  // input 추출
  let input: string;
  if (route.inputFrom) {
    const extracted = readJsonPath(payload, route.inputFrom);
    input = extracted !== undefined ? String(extracted) : '';
  } else {
    input = '';
  }

  const event: CanonicalEvent = {
    type: options.type,
    swarmRef: route.swarmRef,
    instanceKey,
    input,
  };

  // 선택 필드 추가
  if (route.agentName) {
    event.agentName = route.agentName;
  }

  if (options.origin) {
    event.origin = options.origin;
  }

  if (options.auth) {
    event.auth = options.auth;
  }

  if (options.metadata) {
    event.metadata = options.metadata;
  }

  return event;
}
