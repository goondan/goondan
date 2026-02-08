/**
 * Agent Spec 타입 정의
 * @see /docs/specs/resources.md - 6.4 Agent
 */

import type { Resource } from '../resource.js';
import type { ObjectRefLike } from '../object-ref.js';
import type { RefOrSelector } from '../selector.js';

/**
 * Agent 리소스 스펙
 */
export interface AgentSpec {
  /** 모델 설정 */
  modelConfig: AgentModelConfig;
  /** 프롬프트 설정 */
  prompts: AgentPrompts;
  /** 사용할 Tool 목록 */
  tools?: RefOrSelector[];
  /** 사용할 Extension 목록 */
  extensions?: RefOrSelector[];
  /** 훅 목록 */
  hooks?: HookSpec[];
  /** Changeset 정책 (선택) */
  changesets?: AgentChangesetPolicy;
}

/**
 * 모델 설정
 */
export interface AgentModelConfig {
  /** Model 리소스 참조 */
  modelRef: ObjectRefLike;
  /** 모델 파라미터 */
  params?: ModelParams;
}

/**
 * 모델 파라미터
 */
export interface ModelParams {
  /** 샘플링 온도 (0.0 ~ 2.0) */
  temperature?: number;
  /** 최대 토큰 수 */
  maxTokens?: number;
  /** Top-P 샘플링 */
  topP?: number;
  /** 추가 파라미터 */
  [key: string]: unknown;
}

/**
 * 프롬프트 설정
 */
export interface AgentPrompts {
  /** 시스템 프롬프트 (인라인) */
  system?: string;
  /** 시스템 프롬프트 (파일 참조) */
  systemRef?: string;
}

/**
 * 훅 정의
 */
export interface HookSpec {
  /** 훅 ID (선택, reconcile용) */
  id?: string;
  /** 파이프라인 포인트 */
  point: PipelinePoint;
  /** 실행 우선순위 (낮을수록 먼저 실행) */
  priority?: number;
  /** 실행할 액션 */
  action: HookAction;
}

/**
 * 파이프라인 포인트
 */
export type PipelinePoint =
  | 'turn.pre'
  | 'turn.post'
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * 훅 액션 - 스크립트 실행 기술자
 * toolCall 스키마를 직접 사용하지 않고 런타임 스크립트로 기술한다.
 */
export interface HookAction {
  /** 런타임 환경 */
  runtime: 'node' | 'python' | 'deno';
  /** 엔트리 파일 경로 (Bundle Root 기준) */
  entry: string;
  /** export 함수 이름 */
  export: string;
  /** 입력 파라미터 (정적 값 또는 표현식) */
  input?: Record<string, unknown | ExprValue>;
}

/**
 * JSONPath 표현식 값
 */
export interface ExprValue {
  /** JSONPath 표현식 */
  expr: string;
}

/**
 * Agent 수준 Changeset 정책
 */
export interface AgentChangesetPolicy {
  allowed?: {
    /** 허용되는 파일 패턴 */
    files?: string[];
  };
}

/**
 * Agent 리소스 타입
 */
export type AgentResource = Resource<AgentSpec>;
