/**
 * Connector Spec 타입 정의
 * @see /docs/specs/resources.md - 6.6 Connector
 */

import type { Resource } from '../resource.js';
import type { ObjectRef } from '../object-ref.js';
import type { ObjectRefLike } from '../object-ref.js';
import type { ValueSource } from '../value-source.js';

/**
 * Connector 리소스 스펙
 *
 * Connector는 순수 프로토콜 구현체(패키지 배포 단위)이다.
 * 인증, 라우팅, Egress 설정은 Connection 리소스에서 관리한다.
 * @see /docs/specs/connection.md
 */
export interface ConnectorSpec {
  /** Connector 타입 (slack, cli, github, custom 등) */
  type: string;
  /** 런타임 환경 (custom 타입용) */
  runtime?: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (custom 타입용) */
  entry?: string;
  /** Trigger 핸들러 목록 (custom 타입용) */
  triggers?: TriggerConfig[];
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
 * Ingress 규칙
 */
export interface IngressRule {
  /** 매칭 조건 */
  match?: IngressMatch;
  /** 라우팅 설정 */
  route: IngressRoute;
}

/**
 * Ingress 매칭 조건
 */
export interface IngressMatch {
  /** 명령어 매칭 (예: "/swarm") */
  command?: string;
  /** 이벤트 타입 매칭 */
  eventType?: string;
  /** 채널 매칭 */
  channel?: string;
}

/**
 * Ingress 라우팅 설정
 */
export interface IngressRoute {
  /** 대상 Swarm */
  swarmRef: ObjectRefLike;
  /** instanceKey 추출 표현식 (JSONPath) */
  instanceKeyFrom?: string;
  /** 입력 텍스트 추출 표현식 (JSONPath) */
  inputFrom?: string;
  /** 대상 에이전트 이름 (선택) */
  agentName?: string;
}

/**
 * Egress 설정
 */
export interface EgressConfig {
  /** 업데이트 정책 */
  updatePolicy?: UpdatePolicy;
}

/**
 * 업데이트 정책
 */
export interface UpdatePolicy {
  /** 업데이트 모드 */
  mode: 'replace' | 'updateInThread' | 'newMessage';
  /** 디바운스 시간 (밀리초) */
  debounceMs?: number;
}

/**
 * Trigger 설정
 */
export interface TriggerConfig {
  /** 핸들러 함수 이름 */
  handler: string;
}

/**
 * Connector 리소스 타입
 */
export type ConnectorResource = Resource<ConnectorSpec>;
