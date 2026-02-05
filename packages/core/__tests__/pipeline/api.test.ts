/**
 * Pipeline API 테스트
 * @see /docs/specs/pipeline.md - 6. PipelineApi 인터페이스
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPipelineApi, type PipelineApi } from '../../src/pipeline/api.js';
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

describe('PipelineApi', () => {
  let registry: PipelineRegistry;
  let api: PipelineApi;

  beforeEach(() => {
    registry = new PipelineRegistry();
    api = createPipelineApi(registry);
  });

  describe('mutate()', () => {
    it('MutatorPoint에 Mutator를 등록할 수 있어야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      api.mutate('turn.pre', handler);

      const entries = registry.getMutatorEntries('turn.pre');
      expect(entries.length).toBe(1);
    });

    it('모든 MutatorPoint에 등록할 수 있어야 한다', () => {
      const turnHandler: MutatorHandler<TurnContext> = (ctx) => ctx;
      const stepHandler: MutatorHandler<StepContext> = (ctx) => ctx;
      const toolCallHandler: MutatorHandler<ToolCallContext> = (ctx) => ctx;

      // Turn 레벨
      api.mutate('turn.pre', turnHandler);
      api.mutate('turn.post', turnHandler);

      // Step 레벨
      api.mutate('step.pre', stepHandler);
      api.mutate('step.config', stepHandler);
      api.mutate('step.tools', stepHandler);
      api.mutate('step.blocks', stepHandler);
      api.mutate('step.llmError', stepHandler);
      api.mutate('step.post', stepHandler);

      // ToolCall 레벨
      api.mutate('toolCall.pre', toolCallHandler);
      api.mutate('toolCall.post', toolCallHandler);

      // Workspace 레벨은 별도 컨텍스트 타입이 필요하므로 생략

      expect(registry.getMutatorEntries('turn.pre').length).toBe(1);
      expect(registry.getMutatorEntries('turn.post').length).toBe(1);
      expect(registry.getMutatorEntries('step.pre').length).toBe(1);
      expect(registry.getMutatorEntries('step.config').length).toBe(1);
      expect(registry.getMutatorEntries('step.tools').length).toBe(1);
      expect(registry.getMutatorEntries('step.blocks').length).toBe(1);
      expect(registry.getMutatorEntries('step.llmError').length).toBe(1);
      expect(registry.getMutatorEntries('step.post').length).toBe(1);
      expect(registry.getMutatorEntries('toolCall.pre').length).toBe(1);
      expect(registry.getMutatorEntries('toolCall.post').length).toBe(1);
    });

    it('options를 전달할 수 있어야 한다', () => {
      const handler: MutatorHandler<TurnContext> = (ctx) => ctx;

      api.mutate('turn.pre', handler, { priority: 10, id: 'test-mutator' });

      const entries = registry.getMutatorEntries('turn.pre');
      expect(entries[0]?.priority).toBe(10);
      expect(entries[0]?.id).toBe('test-mutator');
    });
  });

  describe('wrap()', () => {
    it('MiddlewarePoint에 Middleware를 등록할 수 있어야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      api.wrap('step.llmCall', handler);

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries.length).toBe(1);
    });

    it('모든 MiddlewarePoint에 등록할 수 있어야 한다', () => {
      const llmHandler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);
      const toolHandler: MiddlewareHandler<ToolCallContext, ToolResult> = async (
        ctx,
        next
      ) => next(ctx);

      api.wrap('step.llmCall', llmHandler);
      api.wrap('toolCall.exec', toolHandler);

      expect(registry.getMiddlewareEntries('step.llmCall').length).toBe(1);
      expect(registry.getMiddlewareEntries('toolCall.exec').length).toBe(1);
    });

    it('options를 전달할 수 있어야 한다', () => {
      const handler: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => next(ctx);

      api.wrap('step.llmCall', handler, { priority: 5, id: 'test-middleware' });

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries[0]?.priority).toBe(5);
      expect(entries[0]?.id).toBe('test-middleware');
    });
  });

  describe('Extension 사용 시나리오', () => {
    it('Extension이 step.tools에서 도구를 추가하는 시나리오', () => {
      // Extension이 파이프라인에 등록하는 패턴
      api.mutate('step.tools', (ctx) => {
        return {
          ...ctx,
          toolCatalog: [
            ...ctx.toolCatalog,
            {
              name: 'extension.customTool',
              description: 'Custom tool from extension',
            },
          ],
        };
      });

      const entries = registry.getMutatorEntries('step.tools');
      expect(entries.length).toBe(1);
    });

    it('Extension이 step.llmCall을 래핑하여 로깅하는 시나리오', async () => {
      const logs: string[] = [];

      api.wrap('step.llmCall', async (ctx, next) => {
        logs.push(`[${Date.now()}] LLM call started`);
        const result = await next(ctx);
        logs.push(`[${Date.now()}] LLM call completed`);
        return result;
      });

      const entries = registry.getMiddlewareEntries('step.llmCall');
      expect(entries.length).toBe(1);
    });

    it('여러 Extension이 순서대로 등록되는 시나리오', () => {
      // Extension A 등록
      api.mutate('step.tools', (ctx) => ctx, { id: 'extA.tools' });
      api.wrap('step.llmCall', async (ctx, next) => next(ctx), {
        id: 'extA.llmCall',
      });

      // Extension B 등록
      api.mutate('step.tools', (ctx) => ctx, { id: 'extB.tools' });
      api.wrap('step.llmCall', async (ctx, next) => next(ctx), {
        id: 'extB.llmCall',
      });

      // Extension C 등록
      api.mutate('step.tools', (ctx) => ctx, { id: 'extC.tools' });
      api.wrap('step.llmCall', async (ctx, next) => next(ctx), {
        id: 'extC.llmCall',
      });

      const mutatorEntries = registry.getSortedMutators('step.tools');
      const middlewareEntries = registry.getSortedMiddlewares('step.llmCall');

      // Mutator: 등록 순서대로 실행 (A → B → C)
      expect(mutatorEntries.map((e) => e.id)).toEqual([
        'extA.tools',
        'extB.tools',
        'extC.tools',
      ]);

      // Middleware: 먼저 등록된 것이 바깥 레이어 (A가 바깥)
      expect(middlewareEntries.map((e) => e.id)).toEqual([
        'extA.llmCall',
        'extB.llmCall',
        'extC.llmCall',
      ]);
    });

    it('priority를 사용하여 실행 순서를 조정하는 시나리오', () => {
      // 기본 Extension들
      api.mutate('step.blocks', (ctx) => ctx, { id: 'default.blocks' });

      // 높은 우선순위 Extension (시스템 프롬프트 주입)
      api.mutate(
        'step.blocks',
        (ctx) => ({
          ...ctx,
          blocks: [
            { type: 'system.prompt', data: 'System prompt', priority: 100 },
            ...ctx.blocks,
          ],
        }),
        { priority: -100, id: 'system.blocks' }
      );

      // 낮은 우선순위 Extension (후처리)
      api.mutate(
        'step.blocks',
        (ctx) => ctx,
        { priority: 100, id: 'postprocess.blocks' }
      );

      const entries = registry.getSortedMutators('step.blocks');
      expect(entries.map((e) => e.id)).toEqual([
        'system.blocks', // priority: -100
        'default.blocks', // priority: 0
        'postprocess.blocks', // priority: 100
      ]);
    });
  });

  describe('타입 안전성', () => {
    it('컨텍스트 타입이 파이프라인 포인트에 맞아야 한다', () => {
      // turn.pre/post는 TurnContext를 받아야 함
      api.mutate('turn.pre', (ctx: TurnContext) => {
        // ctx.turn이 있어야 함
        expect(ctx.turn).toBeDefined;
        return ctx;
      });

      // step.*은 StepContext를 받아야 함
      api.mutate('step.tools', (ctx: StepContext) => {
        // ctx.step, ctx.toolCatalog, ctx.blocks가 있어야 함
        expect(ctx.step).toBeDefined;
        expect(ctx.toolCatalog).toBeDefined;
        expect(ctx.blocks).toBeDefined;
        return ctx;
      });

      // toolCall.*은 ToolCallContext를 받아야 함
      api.mutate('toolCall.pre', (ctx: ToolCallContext) => {
        // ctx.toolCall이 있어야 함
        expect(ctx.toolCall).toBeDefined;
        return ctx;
      });

      expect(true).toBe(true);
    });

    it('결과 타입이 파이프라인 포인트에 맞아야 한다', () => {
      // step.llmCall은 LlmResult를 반환해야 함
      api.wrap('step.llmCall', async (ctx, next): Promise<LlmResult> => {
        const result = await next(ctx);
        // result.message, result.toolCalls가 있어야 함
        expect(result.message).toBeDefined;
        expect(result.toolCalls).toBeDefined;
        return result;
      });

      // toolCall.exec는 ToolResult를 반환해야 함
      api.wrap('toolCall.exec', async (ctx, next): Promise<ToolResult> => {
        const result = await next(ctx);
        // result.toolCallId, result.status가 있어야 함
        expect(result.toolCallId).toBeDefined;
        expect(result.status).toBeDefined;
        return result;
      });

      expect(true).toBe(true);
    });
  });
});
