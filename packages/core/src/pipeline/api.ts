/**
 * Pipeline API - Extension에 제공되는 API
 * @see /docs/specs/pipeline.md - 6. PipelineApi 인터페이스
 */

import type {
  MutatorPoint,
  MiddlewarePoint,
  MutatorHandler,
  MiddlewareHandler,
  MutatorOptions,
  MiddlewareOptions,
} from './types.js';
import type { ContextForPoint, ResultForPoint } from './context.js';
import type { PipelineRegistry } from './registry.js';

/**
 * Extension에 제공되는 Pipeline API
 */
export interface PipelineApi {
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
  ): void;

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
  ): void;
}

/**
 * PipelineApi 구현체 생성
 * @param registry - 파이프라인 레지스트리
 * @returns PipelineApi 인터페이스
 */
export function createPipelineApi(registry: PipelineRegistry): PipelineApi {
  return {
    mutate<T extends MutatorPoint>(
      point: T,
      fn: MutatorHandler<ContextForPoint<T>>,
      options?: MutatorOptions
    ): void {
      registry.mutate(point, fn, options);
    },

    wrap<T extends MiddlewarePoint>(
      point: T,
      fn: MiddlewareHandler<ContextForPoint<T>, ResultForPoint<T>>,
      options?: MiddlewareOptions
    ): void {
      registry.wrap(point, fn, options);
    },
  };
}
