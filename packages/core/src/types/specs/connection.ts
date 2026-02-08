/**
 * Connection Spec 타입 정의 (v1.0)
 * @see /docs/specs/connection.md
 * @see /docs/specs/resources.md - 6.10 Connection
 *
 * Connection은 Connector(프로토콜 구현체)와 Swarm(에이전트 집합) 사이의
 * 배포 바인딩을 정의하는 리소스이다.
 * 인증, 라우팅(ingress rules), 서명 검증 시크릿을 포함한다.
 */

import type { Resource } from '../resource.js';
import type { ObjectRef } from '../object-ref.js';
import type { ObjectRefLike } from '../object-ref.js';
import type { ValueSource } from '../value-source.js';

/**
 * Connection 리소스 스펙
 */
export interface ConnectionSpec {
  /** 바인딩할 Connector 참조 (필수) */
  connectorRef: ObjectRefLike;
  /** 인증 설정 */
  auth?: ConnectorAuth;
  /** 서명 검증 시크릿 설정 */
  verify?: ConnectionVerify;
  /** Ingress 라우팅 규칙 */
  ingress?: IngressConfig;
}

/**
 * Connector 인증 설정
 * - oauthAppRef: OAuth 앱 참조
 * - staticToken: 정적 토큰
 *
 * MUST: oauthAppRef와 staticToken은 동시에 존재할 수 없음
 */
export type ConnectorAuth =
  | { oauthAppRef: ObjectRef; staticToken?: never }
  | { oauthAppRef?: never; staticToken: ValueSource };

/**
 * 서명 검증 설정
 */
export interface ConnectionVerify {
  /** Webhook 서명 검증 설정 */
  webhook?: {
    /** 서명 시크릿 (ValueSource 패턴) */
    signingSecret: ValueSource;
  };
}

/**
 * Ingress 설정
 */
export interface IngressConfig {
  /** 라우팅 규칙 */
  rules?: IngressRule[];
}

/**
 * Ingress 라우팅 규칙
 */
export interface IngressRule {
  /** 매칭 조건 */
  match?: IngressMatch;
  /** 라우팅 설정 */
  route: IngressRoute;
}

/**
 * 이벤트 매칭 조건
 * Connector의 events 스키마를 기반으로 매칭
 */
export interface IngressMatch {
  /** ConnectorEvent.name과 매칭할 이벤트 이름 */
  event?: string;
  /** ConnectorEvent.properties의 값과 매칭할 키-값 쌍 */
  properties?: Record<string, string | number | boolean>;
}

/**
 * 라우팅 설정
 */
export interface IngressRoute {
  /** 대상 Agent (선택, 생략 시 Swarm entrypoint로 라우팅) */
  agentRef?: ObjectRefLike;
}

/**
 * Connection 리소스 타입
 */
export type ConnectionResource = Resource<ConnectionSpec>;
