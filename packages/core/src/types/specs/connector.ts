/**
 * Connector Spec 타입 정의 (v1.0)
 * @see /docs/specs/connector.md
 * @see /docs/specs/resources.md - 6.6 Connector
 *
 * Connector는 외부 프로토콜 이벤트에 반응하여 정규화된 ConnectorEvent를 발행하는 실행 패키지이다.
 * 인증, 라우팅, 서명 검증 시크릿은 Connection 리소스에서 관리한다.
 */

import type { Resource } from '../resource.js';

/**
 * Connector 리소스 스펙
 *
 * @see /docs/specs/connector.md - 2.2 ConnectorSpec TypeScript 인터페이스
 */
export interface ConnectorSpec {
  /** 런타임 환경 */
  runtime: 'node';
  /** 엔트리 파일 경로 (단일 default export) */
  entry: string;
  /** Trigger 프로토콜 선언 목록 */
  triggers: TriggerDeclaration[];
  /** 커넥터가 emit할 수 있는 이벤트 스키마 */
  events?: EventSchema[];
}

/**
 * Trigger 프로토콜 선언
 */
export type TriggerDeclaration =
  | HttpTrigger
  | CronTrigger
  | CliTrigger;

/**
 * HTTP Trigger
 * HTTP Webhook을 통해 이벤트를 수신한다.
 */
export interface HttpTrigger {
  type: 'http';
  endpoint: {
    /** Webhook 수신 경로. '/'로 시작해야 한다(MUST) */
    path: string;
    /** HTTP 메서드 */
    method: 'POST' | 'GET' | 'PUT' | 'DELETE';
  };
}

/**
 * Cron Trigger
 * 주기적 스케줄에 따라 이벤트를 생성한다.
 */
export interface CronTrigger {
  type: 'cron';
  /** cron 표현식 (5-field 또는 6-field) */
  schedule: string;
}

/**
 * CLI Trigger
 * CLI 입력을 통해 이벤트를 수신한다.
 */
export interface CliTrigger {
  type: 'cli';
}

/**
 * 이벤트 스키마 선언
 * Connector가 emit할 수 있는 이벤트의 이름과 속성 타입을 선언한다.
 */
export interface EventSchema {
  /** 이벤트 이름 (Connector 내 고유, MUST) */
  name: string;
  /** 이벤트 속성 타입 선언 */
  properties?: Record<string, EventPropertyType>;
}

/**
 * 이벤트 속성 타입
 */
export interface EventPropertyType {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}

/**
 * Connector 리소스 타입
 */
export type ConnectorResource = Resource<ConnectorSpec>;
