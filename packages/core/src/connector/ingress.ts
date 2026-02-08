/**
 * Ingress 라우팅 로직 (v1.0)
 * @see /docs/specs/connection.md - 5. Ingress 라우팅 규칙
 *
 * ConnectorEvent의 name과 properties를 기반으로 IngressRule 매칭을 수행한다.
 */

import type { IngressRule, IngressMatch } from '../types/specs/connection.js';
import type { ConnectorEvent } from './types.js';

/**
 * IngressMatcher
 * ConnectorEvent가 IngressRule의 match 조건에 부합하는지 검사한다.
 */
export class IngressMatcher {
  /**
   * match 조건과 ConnectorEvent를 비교한다.
   *
   * @param match - IngressMatch 조건
   * @param event - ConnectorEvent
   * @returns 매칭 여부
   */
  match(match: IngressMatch, event: ConnectorEvent): boolean {
    // event 이름 매칭
    if (match.event !== undefined) {
      if (event.name !== match.event) {
        return false;
      }
    }

    // properties 매칭 (AND 조건)
    if (match.properties !== undefined) {
      const eventProps = event.properties;
      if (!eventProps) {
        return false;
      }

      for (const [key, value] of Object.entries(match.properties)) {
        const eventValue = eventProps[key];
        // 값 비교 (문자열, 숫자, boolean)
        if (eventValue !== value) {
          return false;
        }
      }
    }

    return true;
  }
}

/**
 * IngressRule이 ConnectorEvent에 매칭되는지 검사한다.
 *
 * @param rule - Ingress 규칙
 * @param event - ConnectorEvent
 * @returns 매칭 여부
 */
export function matchIngressRule(rule: IngressRule, event: ConnectorEvent): boolean {
  // match가 없거나 빈 객체면 모든 이벤트 매칭 (catch-all)
  if (!rule.match) {
    return true;
  }

  const matchKeys = Object.keys(rule.match);
  if (matchKeys.length === 0) {
    return true;
  }

  const matcher = new IngressMatcher();
  return matcher.match(rule.match, event);
}

/**
 * 매칭되는 첫 번째 규칙을 찾아 반환한다.
 * 규칙 배열은 순서대로 평가하며, 첫 번째 매칭되는 규칙이 적용된다(MUST).
 *
 * @param rules - Ingress 규칙 배열
 * @param event - ConnectorEvent
 * @returns 매칭된 규칙 또는 null
 */
export function routeEvent(
  rules: IngressRule[],
  event: ConnectorEvent
): IngressRule | null {
  for (const rule of rules) {
    if (matchIngressRule(rule, event)) {
      return rule;
    }
  }
  return null;
}
