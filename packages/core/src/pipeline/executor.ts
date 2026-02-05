/**
 * Pipeline Executor - 파이프라인 실행 엔진
 * @see /docs/specs/pipeline.md - 2.1 Mutator, 2.2 Middleware
 */

import type { MutatorPoint, MiddlewarePoint } from './types.js';
import type { ContextForPoint, ResultForPoint } from './context.js';
import type { PipelineRegistry } from './registry.js';

/**
 * 파이프라인 실행기
 * Mutator 순차 실행과 Middleware onion 구조 실행을 담당
 */
export class PipelineExecutor {
  constructor(private readonly registry: PipelineRegistry) {}

  /**
   * Mutator 파이프라인 실행
   * - 정렬된 순서대로 순차 실행
   * - 각 Mutator는 이전 Mutator의 출력을 입력으로 받음
   * - 예외 발생 시 파이프라인 실행 중단
   *
   * @param point - 파이프라인 포인트
   * @param initialCtx - 초기 컨텍스트
   * @returns 변형된 컨텍스트
   */
  async runMutators<T extends MutatorPoint>(
    point: T,
    initialCtx: ContextForPoint<T>
  ): Promise<ContextForPoint<T>> {
    const entries = this.registry.getSortedMutators(point);
    let ctx = initialCtx;

    for (const entry of entries) {
      // 각 Mutator는 동기 또는 비동기 함수일 수 있음
      ctx = await Promise.resolve(
        (entry.fn as (ctx: ContextForPoint<T>) => ContextForPoint<T> | Promise<ContextForPoint<T>>)(ctx)
      );
    }

    return ctx;
  }

  /**
   * Middleware 파이프라인 실행 (Onion 구조)
   * - 먼저 등록된(낮은 priority) Middleware가 바깥 레이어
   * - next() 호출로 다음 레이어 또는 core 함수 실행
   * - next()를 호출하지 않으면 내부 실행 스킵
   *
   * @param point - 파이프라인 포인트
   * @param ctx - 컨텍스트
   * @param core - 핵심 실행 함수
   * @returns 실행 결과
   */
  async runMiddleware<T extends MiddlewarePoint>(
    point: T,
    ctx: ContextForPoint<T>,
    core: (ctx: ContextForPoint<T>) => Promise<ResultForPoint<T>>
  ): Promise<ResultForPoint<T>> {
    const entries = this.registry.getSortedMiddlewares(point);

    // Onion 구조 구성
    // 안쪽부터 바깥쪽으로 감싸기
    let next: (ctx: ContextForPoint<T>) => Promise<ResultForPoint<T>> = core;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry) continue;

      const currentNext = next;
      next = (innerCtx: ContextForPoint<T>) => {
        return Promise.resolve(
          (entry.fn as (
            ctx: ContextForPoint<T>,
            next: (ctx: ContextForPoint<T>) => Promise<ResultForPoint<T>>
          ) => Promise<ResultForPoint<T>>)(innerCtx, currentNext)
        );
      };
    }

    return next(ctx);
  }
}
