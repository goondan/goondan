/**
 * Connector 시스템 타입 정의
 * @see /docs/specs/connector.md
 */

import type { JsonObject, ObjectRefLike, Resource } from '../types/index.js';
import type { ConnectorSpec } from '../types/specs/connector.js';

/**
 * 에이전트 응답 전송 입력
 */
export interface ConnectorSendInput {
  /** 전송할 텍스트 */
  text: string;
  /** 호출 맥락 (채널, 스레드 등) */
  origin?: JsonObject;
  /** 인증 컨텍스트 */
  auth?: JsonObject;
  /** 추가 메타데이터 */
  metadata?: JsonObject;
  /** 메시지 종류: progress(진행중) 또는 final(최종) */
  kind?: 'progress' | 'final';
}

/**
 * Connector 어댑터 인터페이스
 * Runtime과 Connector 간의 표준 인터페이스
 */
export interface ConnectorAdapter {
  /**
   * 외부 이벤트를 처리하여 Runtime에 전달
   */
  handleEvent(payload: JsonObject): Promise<void>;

  /**
   * 에이전트 응답을 외부 채널로 전송 (선택)
   */
  send?(input: ConnectorSendInput): Promise<unknown>;

  /**
   * Connector 종료 (선택)
   */
  shutdown?(): Promise<void>;
}

/**
 * Runtime 이벤트 핸들러
 */
export interface RuntimeEventHandler {
  handleEvent(event: RuntimeEventInput): Promise<void>;
}

/**
 * Connector 생성 옵션
 */
export interface ConnectorOptions {
  /** Runtime 이벤트 핸들러 */
  runtime: RuntimeEventHandler;
  /** Connector 리소스 설정 */
  connectorConfig: Resource<ConnectorSpec>;
  /** 로거 (선택) */
  logger?: Console;
}

/**
 * Connector 팩토리 함수 타입
 */
export type ConnectorFactory = (options: ConnectorOptions) => ConnectorAdapter;

/**
 * Trigger 이벤트
 */
export interface TriggerEvent {
  /** 이벤트 타입 */
  type: 'webhook' | 'cron' | 'queue' | 'message' | string;
  /** 이벤트 페이로드 */
  payload: JsonObject;
  /** 이벤트 발생 시각 (ISO 8601) */
  timestamp: string;
  /** 추가 메타데이터 */
  metadata?: JsonObject;
}

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
 * LiveConfig 패치 요청
 */
export interface LiveConfigPatch {
  /** 대상 리소스 참조 */
  resourceRef: string;
  /** 적용할 패치 */
  patch: JsonObject;
}

/**
 * Trigger 컨텍스트
 */
export interface TriggerContext {
  /**
   * Canonical event 발행
   */
  emit(event: CanonicalEvent): Promise<void>;

  /** 로깅 */
  logger: Console;

  /** OAuth 토큰 접근 (OAuthApp 기반 모드인 경우) */
  oauth?: {
    getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
  };

  /** LiveConfig 제안 (선택) */
  liveConfig?: {
    proposePatch(patch: LiveConfigPatch): Promise<void>;
  };

  /** Connector 설정 */
  connector: Resource<ConnectorSpec>;
}

/**
 * Trigger Handler 함수 타입
 */
export type TriggerHandler = (
  event: TriggerEvent,
  connection: JsonObject,
  ctx: TriggerContext
) => Promise<void>;

/**
 * Turn 인증 정보
 */
export interface TurnAuth {
  /** 액터 정보 */
  actor: {
    /** 액터 타입 (user, system 등) */
    type: string;
    /** 액터 식별자 */
    id: string;
    /** 표시 이름 (선택) */
    display?: string;
  };
  /** Subject 식별자들 */
  subjects: {
    /** 글로벌 subject (subjectMode=global 토큰 조회용) */
    global?: string;
    /** 사용자 subject (subjectMode=user 토큰 조회용) */
    user?: string;
  };
}

/**
 * Canonical Event
 * Trigger handler가 외부 이벤트를 변환하여 Runtime에 전달하는 표준 이벤트
 */
export interface CanonicalEvent {
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
  /** 호출 맥락 */
  origin?: JsonObject;
  /** 인증 컨텍스트 */
  auth?: TurnAuth;
  /** 추가 메타데이터 */
  metadata?: JsonObject;
}

/**
 * Runtime이 받는 이벤트 입력
 */
export interface RuntimeEventInput {
  /** 대상 Swarm 참조 */
  swarmRef: ObjectRefLike;
  /** 인스턴스 식별자 */
  instanceKey: string;
  /** LLM 입력 텍스트 */
  input: string;
  /** 대상 에이전트 이름 (선택) */
  agentName?: string;
  /** 호출 맥락 */
  origin?: JsonObject;
  /** 인증 컨텍스트 */
  auth?: TurnAuth;
  /** 추가 메타데이터 */
  metadata?: JsonObject;
}
