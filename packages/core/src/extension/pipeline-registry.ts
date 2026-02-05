/**
 * PipelineRegistry 구현
 * @see /docs/specs/pipeline.md - 파이프라인 시스템
 */

import type {
  MutatorPoint,
  MiddlewarePoint,
  PipelineContext,
  HandlerOptions,
  PipelineApi,
  ContextForPoint,
  ResultForPoint,
} from './types.js';

/**
 * 통합 핸들러 타입 - PipelineContext를 기반으로 함
 * 모든 파이프라인 컨텍스트는 PipelineContext를 확장하므로 안전
 */
type UnifiedMutatorHandler = (ctx: PipelineContext) => Promise<PipelineContext> | PipelineContext;
type UnifiedMiddlewareHandler = (
  ctx: PipelineContext,
  next: (ctx: PipelineContext) => Promise<unknown>
) => Promise<unknown>;

/**
 * Mutator 엔트리
 */
interface MutatorEntry {
  handler: UnifiedMutatorHandler;
  priority: number;
  id?: string;
  registrationOrder: number;
}

/**
 * Middleware 엔트리
 */
interface MiddlewareEntry {
  handler: UnifiedMiddlewareHandler;
  priority: number;
  id?: string;
  registrationOrder: number;
}

/**
 * PipelineRegistry 클래스
 * Mutator와 Middleware를 관리하고 실행
 */
export class PipelineRegistry implements PipelineApi {
  private readonly mutators = new Map<MutatorPoint, MutatorEntry[]>();
  private readonly middlewares = new Map<MiddlewarePoint, MiddlewareEntry[]>();
  private mutatorRegistrationCounter = 0;
  private middlewareRegistrationCounter = 0;

  /**
   * Mutator 등록
   * 핸들러는 특정 컨텍스트 타입을 받지만, 내부 저장은 통합 타입으로 처리
   * 이는 모든 ContextForPoint<T>가 PipelineContext를 확장하기 때문에 안전함
   */
  mutate<T extends MutatorPoint>(
    point: T,
    handler: (ctx: ContextForPoint<T>) => Promise<ContextForPoint<T>> | ContextForPoint<T>,
    options: HandlerOptions = {}
  ): void {
    const entries = this.mutators.get(point) ?? [];
    // 핸들러를 통합 타입으로 변환 (ContextForPoint<T> extends PipelineContext 이므로 안전)
    const unifiedHandler: UnifiedMutatorHandler = (ctx) => {
      return handler(ctx as ContextForPoint<T>) as Promise<PipelineContext> | PipelineContext;
    };
    const entry: MutatorEntry = {
      handler: unifiedHandler,
      priority: options.priority ?? 0,
      id: options.id,
      registrationOrder: this.mutatorRegistrationCounter++,
    };
    entries.push(entry);
    this.mutators.set(point, entries);
  }

  /**
   * Middleware 등록
   */
  wrap<T extends MiddlewarePoint>(
    point: T,
    handler: (
      ctx: ContextForPoint<T>,
      next: (ctx: ContextForPoint<T>) => Promise<ResultForPoint<T>>
    ) => Promise<ResultForPoint<T>>,
    options: HandlerOptions = {}
  ): void {
    const entries = this.middlewares.get(point) ?? [];
    // 핸들러를 통합 타입으로 변환
    const unifiedHandler: UnifiedMiddlewareHandler = (ctx, next) => {
      const typedNext = (typedCtx: ContextForPoint<T>) => {
        return next(typedCtx) as Promise<ResultForPoint<T>>;
      };
      return handler(ctx as ContextForPoint<T>, typedNext);
    };
    const entry: MiddlewareEntry = {
      handler: unifiedHandler,
      priority: options.priority ?? 0,
      id: options.id,
      registrationOrder: this.middlewareRegistrationCounter++,
    };
    entries.push(entry);
    this.middlewares.set(point, entries);
  }

  /**
   * Mutator 목록 조회
   */
  getMutators(point: MutatorPoint): MutatorEntry[] {
    return this.mutators.get(point) ?? [];
  }

  /**
   * Middleware 목록 조회
   */
  getMiddlewares(point: MiddlewarePoint): MiddlewareEntry[] {
    return this.middlewares.get(point) ?? [];
  }

  /**
   * Mutator 실행
   * 등록 순서(priority 정렬 후 안정 정렬)대로 순차 실행
   */
  async runMutators<T extends MutatorPoint>(
    point: T,
    initialCtx: ContextForPoint<T>
  ): Promise<ContextForPoint<T>> {
    const entries = this.getSortedMutators(point);

    if (entries.length === 0) {
      return initialCtx;
    }

    let ctx: PipelineContext = initialCtx;
    for (const entry of entries) {
      ctx = await entry.handler(ctx);
    }

    return ctx as ContextForPoint<T>;
  }

  /**
   * Middleware 실행
   * Onion 구조로 코어 실행을 래핑
   */
  async runMiddleware<T extends MiddlewarePoint>(
    point: T,
    ctx: ContextForPoint<T>,
    core: (ctx: ContextForPoint<T>) => Promise<ResultForPoint<T>>
  ): Promise<ResultForPoint<T>> {
    const entries = this.getSortedMiddlewares(point);

    if (entries.length === 0) {
      return core(ctx);
    }

    // Onion 구조 구성: 먼저 등록된 Middleware가 바깥 레이어
    // core 함수를 통합 타입으로 변환
    let next: (ctx: PipelineContext) => Promise<unknown> = (pipelineCtx) => {
      return core(pipelineCtx as ContextForPoint<T>);
    };

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry) continue;

      const currentNext = next;
      next = (pipelineCtx: PipelineContext) => entry.handler(pipelineCtx, currentNext);
    }

    return next(ctx) as Promise<ResultForPoint<T>>;
  }

  /**
   * priority 기반 Mutator 정렬
   * 낮은 priority가 먼저 실행, 동일 priority는 등록 순서 유지
   */
  private getSortedMutators(point: MutatorPoint): MutatorEntry[] {
    const entries = this.mutators.get(point) ?? [];
    return [...entries].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.registrationOrder - b.registrationOrder;
    });
  }

  /**
   * priority 기반 Middleware 정렬
   * 낮은 priority가 바깥 레이어, 동일 priority는 등록 순서 유지
   */
  private getSortedMiddlewares(point: MiddlewarePoint): MiddlewareEntry[] {
    const entries = this.middlewares.get(point) ?? [];
    return [...entries].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.registrationOrder - b.registrationOrder;
    });
  }

  /**
   * 모든 핸들러 초기화
   */
  clear(): void {
    this.mutators.clear();
    this.middlewares.clear();
    this.mutatorRegistrationCounter = 0;
    this.middlewareRegistrationCounter = 0;
  }
}
