/**
 * Pipeline 타입 정의
 * @see /docs/specs/pipeline.md - 3. 표준 파이프라인 포인트
 */

/**
 * 모든 파이프라인 포인트 정의
 */
export type PipelinePoint =
  // Turn 레벨
  | 'turn.pre'
  | 'turn.post'
  // Step 레벨
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  // ToolCall 레벨
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  // Workspace 레벨
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * Mutator 타입 파이프라인 포인트
 * 컨텍스트를 순차적으로 변형하는 함수 체인에 사용
 */
export type MutatorPoint =
  | 'turn.pre'
  | 'turn.post'
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmError'
  | 'step.post'
  | 'toolCall.pre'
  | 'toolCall.post'
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

/**
 * Middleware 타입 파이프라인 포인트
 * next() 기반 onion 구조로 핵심 실행을 래핑
 */
export type MiddlewarePoint = 'step.llmCall' | 'toolCall.exec';

/**
 * 파이프라인 포인트 상수 배열
 */
export const PIPELINE_POINTS: readonly PipelinePoint[] = [
  // Turn 레벨
  'turn.pre',
  'turn.post',
  // Step 레벨
  'step.pre',
  'step.config',
  'step.tools',
  'step.blocks',
  'step.llmCall',
  'step.llmError',
  'step.post',
  // ToolCall 레벨
  'toolCall.pre',
  'toolCall.exec',
  'toolCall.post',
  // Workspace 레벨
  'workspace.repoAvailable',
  'workspace.worktreeMounted',
] as const;

/**
 * Mutator 포인트 상수 배열
 */
export const MUTATOR_POINTS: readonly MutatorPoint[] = [
  'turn.pre',
  'turn.post',
  'step.pre',
  'step.config',
  'step.tools',
  'step.blocks',
  'step.llmError',
  'step.post',
  'toolCall.pre',
  'toolCall.post',
  'workspace.repoAvailable',
  'workspace.worktreeMounted',
] as const;

/**
 * Middleware 포인트 상수 배열
 */
export const MIDDLEWARE_POINTS: readonly MiddlewarePoint[] = [
  'step.llmCall',
  'toolCall.exec',
] as const;

/**
 * PipelinePoint 타입 가드
 */
export function isPipelinePoint(value: unknown): value is PipelinePoint {
  return (
    typeof value === 'string' &&
    (PIPELINE_POINTS as readonly string[]).includes(value)
  );
}

/**
 * MutatorPoint 타입 가드
 */
export function isMutatorPoint(value: unknown): value is MutatorPoint {
  return (
    typeof value === 'string' &&
    (MUTATOR_POINTS as readonly string[]).includes(value)
  );
}

/**
 * MiddlewarePoint 타입 가드
 */
export function isMiddlewarePoint(value: unknown): value is MiddlewarePoint {
  return (
    typeof value === 'string' &&
    (MIDDLEWARE_POINTS as readonly string[]).includes(value)
  );
}

/**
 * Mutator 핸들러 함수 시그니처
 * 컨텍스트를 받아 변형된 컨텍스트를 반환
 * @param ctx - 현재 파이프라인 컨텍스트
 * @returns 변형된 컨텍스트 (또는 원본 그대로 반환)
 */
export type MutatorHandler<Ctx> = (ctx: Ctx) => Promise<Ctx> | Ctx;

/**
 * Middleware 핸들러 함수 시그니처
 * next() 기반 onion 구조로 핵심 실행을 래핑
 * @param ctx - 현재 파이프라인 컨텍스트
 * @param next - 다음 레이어(또는 핵심 실행) 호출 함수
 * @returns 실행 결과
 */
export type MiddlewareHandler<Ctx, Result> = (
  ctx: Ctx,
  next: (ctx: Ctx) => Promise<Result>
) => Promise<Result>;

/**
 * Mutator 등록 옵션
 */
export interface MutatorOptions {
  /** 실행 우선순위 (낮을수록 먼저 실행, 기본: 0) */
  priority?: number;
  /** 식별자 (reconcile용) */
  id?: string;
}

/**
 * Middleware 등록 옵션
 */
export interface MiddlewareOptions {
  /** 실행 우선순위 (낮을수록 바깥 레이어, 기본: 0) */
  priority?: number;
  /** 식별자 (reconcile용) */
  id?: string;
}
