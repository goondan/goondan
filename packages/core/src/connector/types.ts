/**
 * Connector 시스템 런타임 타입 정의 (v1.0)
 * @see /docs/specs/connector.md - 5. Entry Function 실행 모델
 */

import type { JsonObject, Resource } from '../types/index.js';
import type { ConnectorSpec } from '../types/specs/connector.js';
import type { ConnectionSpec } from '../types/specs/connection.js';

/**
 * OAuth 토큰 요청
 */
export interface OAuthTokenRequest {
  /** 토큰 조회 대상 subject */
  subject: string;
}

/**
 * OAuth 토큰 결과
 */
export interface OAuthTokenResult {
  /** 액세스 토큰 */
  accessToken: string;
  /** 토큰 만료 시각 (Unix timestamp) */
  expiresAt?: number;
  /** 리프레시 토큰 (선택) */
  refreshToken?: string;
}

/**
 * ConnectorEvent의 메시지 콘텐츠 타입
 * @see /docs/specs/connector.md - 5.4 ConnectorEvent
 */
export type ConnectorEventMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string }
  | { type: 'file'; data: string; mediaType: string };

/**
 * ConnectorEvent - Entry 함수가 ctx.emit()으로 발행하는 정규화된 이벤트
 * @see /docs/specs/connector.md - 5.4 ConnectorEvent
 */
export interface ConnectorEvent {
  /** 이벤트 타입 (고정) */
  type: 'connector.event';
  /** 이벤트 이름 (connector의 events[]에 선언된 이름) */
  name: string;
  /** 멀티모달 입력 메시지 */
  message: ConnectorEventMessage;
  /** 이벤트 속성 (events[].properties에 선언된 키-값) */
  properties?: JsonObject;
  /** 인증 컨텍스트 */
  auth?: {
    actor: { id: string; name?: string };
    subjects: { global?: string; user?: string };
  };
}

/**
 * HTTP Trigger 페이로드
 */
export interface HttpTriggerPayload {
  type: 'http';
  payload: {
    request: {
      method: string;
      path: string;
      headers: Record<string, string>;
      body: JsonObject;
      rawBody?: string;
    };
  };
}

/**
 * Cron Trigger 페이로드
 */
export interface CronTriggerPayload {
  type: 'cron';
  payload: {
    schedule: string;
    scheduledAt: string;
  };
}

/**
 * CLI Trigger 페이로드
 */
export interface CliTriggerPayload {
  type: 'cli';
  payload: {
    text: string;
    instanceKey?: string;
  };
}

/**
 * Trigger 페이로드 (union)
 */
export type TriggerPayload =
  | HttpTriggerPayload
  | CronTriggerPayload
  | CliTriggerPayload;

/**
 * ConnectorTriggerEvent - 트리거 프로토콜별 페이로드를 캡슐화
 * @see /docs/specs/connector.md - 5.3 ConnectorTriggerEvent
 */
export interface ConnectorTriggerEvent {
  type: 'connector.trigger';
  trigger: TriggerPayload;
  timestamp: string;
}

/**
 * ConnectorContext - Entry 함수에 전달되는 컨텍스트
 * Connection마다 한 번씩 호출된다.
 * @see /docs/specs/connector.md - 5.2 ConnectorContext
 */
export interface ConnectorContext {
  /** 트리거 이벤트 정보 */
  event: ConnectorTriggerEvent;
  /** 현재 Connection 리소스 */
  connection: Resource<ConnectionSpec>;
  /** Connector 리소스 */
  connector: Resource<ConnectorSpec>;
  /** ConnectorEvent 발행 */
  emit: (event: ConnectorEvent) => Promise<void>;
  /** 로깅 */
  logger: Console;
  /** OAuth 토큰 접근 (Connection의 OAuthApp 기반 모드인 경우) */
  oauth?: {
    getAccessToken: (request: OAuthTokenRequest) => Promise<OAuthTokenResult>;
  };
  /** 서명 검증 정보 (Connection의 verify 블록에서 해석) */
  verify?: {
    webhook?: {
      /** 서명 시크릿 (Connection의 verify.webhook.signingSecret에서 해석된 값) */
      signingSecret: string;
    };
  };
}

/**
 * ConnectorEntryFunction - Connector entry 모듈의 단일 default export
 * @see /docs/specs/connector.md - 5.1 단일 Default Export
 */
export type ConnectorEntryFunction = (
  context: ConnectorContext
) => Promise<void>;
