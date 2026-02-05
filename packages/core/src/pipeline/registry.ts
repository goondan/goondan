/**
 * Pipeline Registry - 핸들러 등록 관리
 * @see /docs/specs/pipeline.md - 11. 구현 예시
 */

import type {
  MutatorPoint,
  MiddlewarePoint,
  MutatorHandler,
  MiddlewareHandler,
  MutatorOptions,
  MiddlewareOptions,
  PipelinePoint,
} from './types.js';
import type {
  ContextForPoint,
  ResultForPoint,
} from './context.js';

/**
 * Mutator 엔트리 (내부 사용)
 */
export interface MutatorEntry<Ctx = unknown> {
  /** Mutator 핸들러 함수 */
  fn: MutatorHandler<Ctx>;
  /** 실행 우선순위 (낮을수록 먼저 실행) */
  priority: number;
  /** 식별자 (reconcile용) */
  id?: string;
  /** 등록 순서 (안정 정렬용) */
  registrationOrder: number;
}

/**
 * Middleware 엔트리 (내부 사용)
 */
export interface MiddlewareEntry<Ctx = unknown, Result = unknown> {
  /** Middleware 핸들러 함수 */
  fn: MiddlewareHandler<Ctx, Result>;
  /** 실행 우선순위 (낮을수록 바깥 레이어) */
  priority: number;
  /** 식별자 (reconcile용) */
  id?: string;
  /** 등록 순서 (안정 정렬용) */
  registrationOrder: number;
}

/**
 * 파이프라인 레지스트리
 * Mutator와 Middleware 핸들러의 등록 및 조회를 관리
 */
export class PipelineRegistry {
  private mutators = new Map<MutatorPoint, MutatorEntry[]>();
  private middlewares = new Map<MiddlewarePoint, MiddlewareEntry[]>();

  /**
   * Mutator 등록
   * @param point - 파이프라인 포인트
   * @param fn - Mutator 함수
   * @param options - 등록 옵션
   */
  mutate<T extends MutatorPoint>(
    point: T,
    fn: MutatorHandler<ContextForPoint<T>>,
    options?: MutatorOptions
  ): void {
    const entries = this.mutators.get(point) ?? [];
    const entry: MutatorEntry = {
      fn: fn as MutatorHandler<unknown>,
      priority: options?.priority ?? 0,
      id: options?.id,
      registrationOrder: entries.length,
    };
    entries.push(entry);
    this.mutators.set(point, entries);
  }

  /**
   * Middleware 등록
   * @param point - 파이프라인 포인트
   * @param fn - Middleware 함수
   * @param options - 등록 옵션
   */
  wrap<T extends MiddlewarePoint>(
    point: T,
    fn: MiddlewareHandler<ContextForPoint<T>, ResultForPoint<T>>,
    options?: MiddlewareOptions
  ): void {
    const entries = this.middlewares.get(point) ?? [];
    const entry: MiddlewareEntry = {
      fn: fn as MiddlewareHandler<unknown, unknown>,
      priority: options?.priority ?? 0,
      id: options?.id,
      registrationOrder: entries.length,
    };
    entries.push(entry);
    this.middlewares.set(point, entries);
  }

  /**
   * 등록된 Mutator 엔트리 조회 (정렬되지 않음)
   * @param point - 파이프라인 포인트
   */
  getMutatorEntries(point: MutatorPoint): MutatorEntry[] {
    return this.mutators.get(point) ?? [];
  }

  /**
   * 등록된 Middleware 엔트리 조회 (정렬되지 않음)
   * @param point - 파이프라인 포인트
   */
  getMiddlewareEntries(point: MiddlewarePoint): MiddlewareEntry[] {
    return this.middlewares.get(point) ?? [];
  }

  /**
   * 정렬된 Mutator 엔트리 조회
   * - priority 오름차순 (낮을수록 먼저 실행)
   * - 동일 priority는 등록 순서 유지 (안정 정렬)
   * @param point - 파이프라인 포인트
   */
  getSortedMutators(point: MutatorPoint): MutatorEntry[] {
    const entries = this.mutators.get(point) ?? [];
    return [...entries].sort((a, b) => {
      // priority 오름차순
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // 동일 priority는 등록 순서 유지 (안정 정렬)
      return a.registrationOrder - b.registrationOrder;
    });
  }

  /**
   * 정렬된 Middleware 엔트리 조회
   * - priority 오름차순 (낮을수록 바깥 레이어)
   * - 동일 priority는 등록 순서 유지 (안정 정렬)
   * @param point - 파이프라인 포인트
   */
  getSortedMiddlewares(point: MiddlewarePoint): MiddlewareEntry[] {
    const entries = this.middlewares.get(point) ?? [];
    return [...entries].sort((a, b) => {
      // priority 오름차순 (낮을수록 바깥 레이어)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // 동일 priority는 등록 순서 유지
      return a.registrationOrder - b.registrationOrder;
    });
  }

  /**
   * 모든 등록된 핸들러 제거
   */
  clear(): void {
    this.mutators.clear();
    this.middlewares.clear();
  }

  /**
   * 특정 포인트의 핸들러 제거
   * @param point - 파이프라인 포인트
   */
  clearPoint(point: PipelinePoint): void {
    this.mutators.delete(point as MutatorPoint);
    this.middlewares.delete(point as MiddlewarePoint);
  }
}
