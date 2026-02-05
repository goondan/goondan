/**
 * Pipeline Registry 테스트
 * @see /docs/specs/pipeline.md - 6. PipelineApi 인터페이스, 11. 구현 예시
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineRegistry } from '../../src/pipeline/registry.js';
import type {
  MutatorHandler,
  MiddlewareHandler,
} from '../../src/pipeline/types.js';
import type {
  TurnContext,
  StepContext,
  ToolCallContext,
  LlmResult,
  ToolResult,
} from '../../src/pipeline/context.js';

describe('PipelineRegistry', () => {
  let registry: PipelineRegistry;

  beforeEach(() => {
    registry = new PipelineRegistry();
  });

  describe('mutate()', () => {
    it('Mutator를 등록할 수 있어야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      // 예외 없이 등록되어야 함
      expect(() => {
        registry.mutate('turn.pre', handler);
      }).not.toThrow();
    });

    it('동일 포인트에 여러 Mutator를 등록할 수 있어야 한다', () => {
      const handler1: MutatorHandler<StepContext> = (ctx) => ctx;
      const handler2: MutatorHandler<StepContext> = (ctx) => ctx;

      registry.mutate('step.tools', handler1);
      registry.mutate('step.tools', handler2);

      const entries = registry.getMutatorEntries('step.tools');
      expect(entries.length).toBe(2);
    });

    it('priority 옵션을 지정할 수 있어야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      registry.mutate('turn.pre', handler, { priority: 10 });

      const entries = registry.getMutatorEntries('turn.pre');
      expect(entries[0]?.priority).toBe(10);
    });

    it('id 옵션을 지정할 수 있어야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      registry.mutate('turn.pre', handler, { id: 'my-mutator' });

      const entries = registry.getMutatorEntries('turn.pre');
      expect(entries[0]?.id).toBe('my-mutator');
    });

    it('priority 기본값은 0이어야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      registry.mutate('turn.pre', handler);

      const entries = registry.getMutatorEntries('turn.pre');
      expect(entries[0]?.priority).toBe(0);
    });
  });

  describe('wrap()', () => {
    it('Middleware를 등록할 수 있어야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      expect(() => {
        registry.wrap('step.llmCall', handler);
      }).not.toThrow();
    });

    it('동일 포인트에 여러 Middleware를 등록할 수 있어야 한다', () => {
      const handler1: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);
      const handler2: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handler1);
      registry.wrap('step.llmCall', handler2);

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries.length).toBe(2);
    });

    it('priority 옵션을 지정할 수 있어야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handler, { priority: 5 });

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries[0]?.priority).toBe(5);
    });

    it('id 옵션을 지정할 수 있어야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handler, { id: 'my-middleware' });

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries[0]?.id).toBe('my-middleware');
    });

    it('priority 기본값은 0이어야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handler);

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries[0]?.priority).toBe(0);
    });
  });

  describe('getSortedMutators()', () => {
    it('priority가 낮을수록 먼저 실행되어야 한다', () => {
      const handlerA: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerB: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerC: MutatorHandler<StepContext> = (ctx) => ctx;

      registry.mutate('step.tools', handlerA, { priority: 10, id: 'A' });
      registry.mutate('step.tools', handlerB, { priority: 5, id: 'B' });
      registry.mutate('step.tools', handlerC, { priority: 15, id: 'C' });

      const sorted = registry.getSortedMutators('step.tools');
      expect(sorted.map((e) => e.id)).toEqual(['B', 'A', 'C']);
    });

    it('동일 priority는 등록 순서를 유지해야 한다 (안정 정렬)', () => {
      const handlerA: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerB: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerC: MutatorHandler<StepContext> = (ctx) => ctx;

      registry.mutate('step.tools', handlerA, { priority: 10, id: 'A' });
      registry.mutate('step.tools', handlerB, { priority: 10, id: 'B' });
      registry.mutate('step.tools', handlerC, { priority: 10, id: 'C' });

      const sorted = registry.getSortedMutators('step.tools');
      expect(sorted.map((e) => e.id)).toEqual(['A', 'B', 'C']);
    });

    it('복합 정렬을 올바르게 수행해야 한다', () => {
      const handlerA: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerB: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerC: MutatorHandler<StepContext> = (ctx) => ctx;
      const handlerD: MutatorHandler<StepContext> = (ctx) => ctx;

      // 등록 순서: A, B, C, D
      registry.mutate('step.tools', handlerA, { priority: 10, id: 'A' });
      registry.mutate('step.tools', handlerB, { priority: 5, id: 'B' });
      registry.mutate('step.tools', handlerC, { priority: 10, id: 'C' });
      registry.mutate('step.tools', handlerD, { priority: 5, id: 'D' });

      // 기대: B(5,1) → D(5,3) → A(10,0) → C(10,2)
      const sorted = registry.getSortedMutators('step.tools');
      expect(sorted.map((e) => e.id)).toEqual(['B', 'D', 'A', 'C']);
    });

    it('등록되지 않은 포인트는 빈 배열을 반환해야 한다', () => {
      const sorted = registry.getSortedMutators('turn.pre');
      expect(sorted).toEqual([]);
    });
  });

  describe('getSortedMiddlewares()', () => {
    it('priority가 낮을수록 바깥 레이어가 되어야 한다', () => {
      const handlerA: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);
      const handlerB: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);
      const handlerC: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handlerA, { priority: 10, id: 'A' });
      registry.wrap('step.llmCall', handlerB, { priority: 5, id: 'B' });
      registry.wrap('step.llmCall', handlerC, { priority: 15, id: 'C' });

      const sorted = registry.getSortedMiddlewares('step.llmCall');
      expect(sorted.map((e) => e.id)).toEqual(['B', 'A', 'C']);
    });

    it('동일 priority는 등록 순서를 유지해야 한다 (안정 정렬)', () => {
      const handlerA: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);
      const handlerB: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);
      const handlerC: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handlerA, { priority: 0, id: 'A' });
      registry.wrap('step.llmCall', handlerB, { priority: 0, id: 'B' });
      registry.wrap('step.llmCall', handlerC, { priority: 0, id: 'C' });

      const sorted = registry.getSortedMiddlewares('step.llmCall');
      expect(sorted.map((e) => e.id)).toEqual(['A', 'B', 'C']);
    });

    it('등록되지 않은 포인트는 빈 배열을 반환해야 한다', () => {
      const sorted = registry.getSortedMiddlewares('step.llmCall');
      expect(sorted).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('모든 등록된 핸들러를 제거해야 한다', () => {
      const mutatorHandler: MutatorHandler<TurnContext> = (ctx) => ctx;
      const middlewareHandler: MiddlewareHandler<StepContext, LlmResult> =
        async (ctx, next) => next(ctx);

      registry.mutate('turn.pre', mutatorHandler);
      registry.wrap('step.llmCall', middlewareHandler);

      registry.clear();

      expect(registry.getMutatorEntries('turn.pre')).toEqual([]);
      expect(registry.getMiddlewareEntries('step.llmCall')).toEqual([]);
    });

    it('특정 포인트만 제거할 수 있어야 한다', () => {
      const handler1: MutatorHandler<TurnContext> = (ctx) => ctx;
      const handler2: MutatorHandler<TurnContext> = (ctx) => ctx;

      registry.mutate('turn.pre', handler1);
      registry.mutate('turn.post', handler2);

      registry.clearPoint('turn.pre');

      expect(registry.getMutatorEntries('turn.pre')).toEqual([]);
      expect(registry.getMutatorEntries('turn.post').length).toBe(1);
    });
  });

  describe('타입 안전성', () => {
    it('MutatorPoint에만 mutate()를 허용해야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      // 이 테스트는 컴파일 타임에 검증됨
      // 잘못된 포인트를 사용하면 타입 에러가 발생해야 함
      registry.mutate('turn.pre', handler);
      registry.mutate('turn.post', handler);
      registry.mutate('step.pre', handler as MutatorHandler<StepContext>);

      // step.llmCall은 MiddlewarePoint이므로 mutate에서 사용하면 안됨
      // 아래 코드는 타입 에러를 발생시켜야 함 (주석 처리)
      // registry.mutate('step.llmCall', handler);

      expect(true).toBe(true);
    });

    it('MiddlewarePoint에만 wrap()을 허용해야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      registry.wrap('step.llmCall', handler);
      registry.wrap(
        'toolCall.exec',
        handler as MiddlewareHandler<ToolCallContext, ToolResult>
      );

      // turn.pre는 MutatorPoint이므로 wrap에서 사용하면 안됨
      // 아래 코드는 타입 에러를 발생시켜야 함 (주석 처리)
      // registry.wrap('turn.pre', handler);

      expect(true).toBe(true);
    });
  });
});
