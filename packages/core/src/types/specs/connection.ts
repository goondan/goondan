/**
 * Connection Spec 타입 정의
 * @see /docs/specs/resources.md - 6.10 Connection
 *
 * Connection은 Connector(프로토콜 구현체)를 특정 Swarm에 바인딩하는 배포 설정 리소스이다.
 * 인증, 라우팅(ingress rules), Egress 설정을 포함한다.
 */

import type { Resource } from '../resource.js';
import type { ObjectRefLike } from '../object-ref.js';
import type {
  ConnectorAuth,
  IngressRule,
  EgressConfig,
} from './connector.js';

/**
 * Connection 리소스 스펙
 */
export interface ConnectionSpec {
  /** 바인딩할 Connector 참조 (필수) */
  connectorRef: ObjectRefLike;
  /** 인증 설정 (ConnectorAuth 재사용) */
  auth?: ConnectorAuth;
  /** 라우팅 규칙 (IngressRule과 동일 구조) */
  rules?: ConnectionRule[];
  /** Egress 설정 */
  egress?: EgressConfig;
}

/**
 * Connection 라우팅 규칙
 * IngressRule과 동일한 구조
 */
export type ConnectionRule = IngressRule;

/**
 * Connection 리소스 타입
 */
export type ConnectionResource = Resource<ConnectionSpec>;
