/**
 * Pipeline Executor 테스트
 * @see /docs/specs/pipeline.md - 2.1 Mutator, 2.2 Middleware, 11. 구현 예시
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor } from '../../src/pipeline/executor.js';
import { PipelineRegistry } from '../../src/pipeline/registry.js';
import type {
  MutatorHandler,
  MiddlewareHandler,
} from '../../src/pipeline/types.js';
import type {
  StepContext,
  LlmResult,
  ToolCallContext,
  ToolResult,
} from '../../src/pipeline/context.js';

// 테스트용 간단한 컨텍스트 생성 헬퍼
function createStepContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    instance: { id: 'inst-1', key: 'test-key' },
    swarm: {
      apiVersion: 'goondan.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: {},
    },
    agent: {
      apiVersion: 'goondan.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: {},
    },
    effectiveConfig: {},
    events: { emit: () => {}, on: () => () => {} },
    logger: console,
    turn: {
      id: 'turn-1',
      input: 'Hello',
      messageState: {
        baseMessages: [],
        events: [],
        nextMessages: [],
      },
      toolResults: [],
    },
    step: {
      id: 'step-0',
      index: 0,
      startedAt: new Date(),
    },
    toolCatalog: [],
    blocks: [],
    activeSwarmRef: 'default',
    ...overrides,
  };
}

describe('PipelineExecutor', () => {
  let registry: PipelineRegistry;
  let executor: PipelineExecutor;

  beforeEach(() => {
    registry = new PipelineRegistry();
    executor = new PipelineExecutor(registry);
  });

  describe('runMutators()', () => {
    it('등록된 Mutator가 없으면 원본 컨텍스트를 반환해야 한다', async () => {
      const ctx = createStepContext();

      const result = await executor.runMutators('step.tools', ctx);

      expect(result).toEqual(ctx);
    });

    it('Mutator를 순차적으로 실행해야 한다', async () => {
      const executionOrder: string[] = [];

      const handlerA: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('A');
        return ctx;
      };
      const handlerB: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('B');
        return ctx;
      };
      const handlerC: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('C');
        return ctx;
      };

      registry.mutate('step.tools', handlerA, { id: 'A' });
      registry.mutate('step.tools', handlerB, { id: 'B' });
      registry.mutate('step.tools', handlerC, { id: 'C' });

      const ctx = createStepContext();
      await executor.runMutators('step.tools', ctx);

      expect(executionOrder).toEqual(['A', 'B', 'C']);
    });

    it('각 Mutator는 이전 Mutator의 출력을 입력으로 받아야 한다', async () => {
      const handlerA: MutatorHandler<StepContext> = (ctx) => {
        return {
          ...ctx,
          toolCatalog: [...ctx.toolCatalog, { name: 'tool-a' }],
        };
      };
      const handlerB: MutatorHandler<StepContext> = (ctx) => {
        return {
          ...ctx,
          toolCatalog: [...ctx.toolCatalog, { name: 'tool-b' }],
        };
      };

      registry.mutate('step.tools', handlerA);
      registry.mutate('step.tools', handlerB);

      const ctx = createStepContext();
      const result = await executor.runMutators('step.tools', ctx);

      expect(result.toolCatalog).toEqual([{ name: 'tool-a' }, { name: 'tool-b' }]);
    });

    it('비동기 Mutator를 지원해야 한다', async () => {
      const asyncHandler: MutatorHandler<StepContext> = async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ...ctx,
          toolCatalog: [...ctx.toolCatalog, { name: 'async-tool' }],
        };
      };

      registry.mutate('step.tools', asyncHandler);

      const ctx = createStepContext();
      const result = await executor.runMutators('step.tools', ctx);

      expect(result.toolCatalog).toEqual([{ name: 'async-tool' }]);
    });

    it('priority 순서대로 실행해야 한다', async () => {
      const executionOrder: string[] = [];

      const handlerA: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('A');
        return ctx;
      };
      const handlerB: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('B');
        return ctx;
      };
      const handlerC: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('C');
        return ctx;
      };

      // 등록 순서: A(10), B(5), C(15)
      // 실행 순서: B(5) → A(10) → C(15)
      registry.mutate('step.tools', handlerA, { priority: 10, id: 'A' });
      registry.mutate('step.tools', handlerB, { priority: 5, id: 'B' });
      registry.mutate('step.tools', handlerC, { priority: 15, id: 'C' });

      const ctx = createStepContext();
      await executor.runMutators('step.tools', ctx);

      expect(executionOrder).toEqual(['B', 'A', 'C']);
    });

    it('Mutator에서 예외가 발생하면 파이프라인 실행이 중단되어야 한다', async () => {
      const executionOrder: string[] = [];

      const handlerA: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('A');
        return ctx;
      };
      const handlerB: MutatorHandler<StepContext> = () => {
        executionOrder.push('B');
        throw new Error('Mutator error');
      };
      const handlerC: MutatorHandler<StepContext> = (ctx) => {
        executionOrder.push('C');
        return ctx;
      };

      registry.mutate('step.tools', handlerA);
      registry.mutate('step.tools', handlerB);
      registry.mutate('step.tools', handlerC);

      const ctx = createStepContext();

      await expect(executor.runMutators('step.tools', ctx)).rejects.toThrow(
        'Mutator error'
      );
      expect(executionOrder).toEqual(['A', 'B']);
    });
  });

  describe('runMiddleware()', () => {
    it('등록된 Middleware가 없으면 core 함수만 실행해야 한다', async () => {
      const ctx = createStepContext();
      const coreFn = vi.fn().mockResolvedValue({
        message: { id: 'msg-1', role: 'assistant', content: 'Hello!' },
        toolCalls: [],
      } satisfies LlmResult);

      const result = await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(coreFn).toHaveBeenCalledWith(ctx);
      expect(result.message.content).toBe('Hello!');
    });

    it('Middleware가 onion 구조로 실행되어야 한다', async () => {
      const executionOrder: string[] = [];

      const middlewareA: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        executionOrder.push('A-before');
        const result = await next(ctx);
        executionOrder.push('A-after');
        return result;
      };

      const middlewareB: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        executionOrder.push('B-before');
        const result = await next(ctx);
        executionOrder.push('B-after');
        return result;
      };

      const middlewareC: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        executionOrder.push('C-before');
        const result = await next(ctx);
        executionOrder.push('C-after');
        return result;
      };

      // 등록 순서: A, B, C
      // Onion 순서: A(바깥) → B → C(안쪽) → core → C → B → A
      registry.wrap('step.llmCall', middlewareA, { id: 'A' });
      registry.wrap('step.llmCall', middlewareB, { id: 'B' });
      registry.wrap('step.llmCall', middlewareC, { id: 'C' });

      const ctx = createStepContext();
      const coreFn = vi.fn().mockImplementation(async () => {
        executionOrder.push('core');
        return {
          message: { role: 'assistant', content: 'Hello!' },
          toolCalls: [],
        } satisfies LlmResult;
      });

      await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(executionOrder).toEqual([
        'A-before',
        'B-before',
        'C-before',
        'core',
        'C-after',
        'B-after',
        'A-after',
      ]);
    });

    it('Middleware가 컨텍스트를 수정하여 next()에 전달할 수 있어야 한다', async () => {
      const middleware: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        const modifiedCtx = {
          ...ctx,
          toolCatalog: [...ctx.toolCatalog, { name: 'injected-tool' }],
        };
        return next(modifiedCtx);
      };

      registry.wrap('step.llmCall', middleware);

      const ctx = createStepContext();
      const coreFn = vi.fn().mockImplementation(async (c: StepContext) => {
        return {
          message: { id: 'msg-1', role: 'assistant', content: 'Hello!' },
          toolCalls: [],
          receivedToolCount: c.toolCatalog.length,
        } as LlmResult & { receivedToolCount: number };
      });

      const result = await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(coreFn).toHaveBeenCalled();
      const calledCtx = coreFn.mock.calls[0]?.[0] as StepContext;
      expect(calledCtx.toolCatalog.length).toBe(1);
      expect(calledCtx.toolCatalog[0]?.name).toBe('injected-tool');
    });

    it('Middleware가 결과를 수정하여 반환할 수 있어야 한다', async () => {
      const middleware: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        const result = await next(ctx);
        return {
          ...result,
          message: {
            ...result.message,
            content: `Modified: ${result.message.content}`,
          },
        };
      };

      registry.wrap('step.llmCall', middleware);

      const ctx = createStepContext();
      const coreFn = vi.fn().mockResolvedValue({
        message: { id: 'msg-1', role: 'assistant', content: 'Original' },
        toolCalls: [],
      } satisfies LlmResult);

      const result = await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(result.message.content).toBe('Modified: Original');
    });

    it('Middleware가 next()를 호출하지 않으면 core가 실행되지 않아야 한다', async () => {
      const middleware: MiddlewareHandler<StepContext, LlmResult> = async () => {
        return {
          message: { id: 'msg-intercepted', role: 'assistant', content: 'Intercepted' },
          toolCalls: [],
        };
      };

      registry.wrap('step.llmCall', middleware);

      const ctx = createStepContext();
      const coreFn = vi.fn().mockResolvedValue({
        message: { id: 'msg-core', role: 'assistant', content: 'Core' },
        toolCalls: [],
      } satisfies LlmResult);

      const result = await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(coreFn).not.toHaveBeenCalled();
      expect(result.message.content).toBe('Intercepted');
    });

    it('priority에 따라 Middleware 레이어 순서가 결정되어야 한다', async () => {
      const executionOrder: string[] = [];

      const middlewareA: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        executionOrder.push('A-before');
        const result = await next(ctx);
        executionOrder.push('A-after');
        return result;
      };

      const middlewareB: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        executionOrder.push('B-before');
        const result = await next(ctx);
        executionOrder.push('B-after');
        return result;
      };

      // A(priority: 10), B(priority: 5)
      // B가 더 바깥 레이어가 되어야 함
      registry.wrap('step.llmCall', middlewareA, { priority: 10, id: 'A' });
      registry.wrap('step.llmCall', middlewareB, { priority: 5, id: 'B' });

      const ctx = createStepContext();
      const coreFn = vi.fn().mockImplementation(async () => {
        executionOrder.push('core');
        return {
          message: { id: 'msg-1', role: 'assistant', content: 'Hello!' },
          toolCalls: [],
        } satisfies LlmResult;
      });

      await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(executionOrder).toEqual([
        'B-before', // 바깥 레이어 (낮은 priority)
        'A-before',
        'core',
        'A-after',
        'B-after',
      ]);
    });

    it('Middleware에서 예외가 발생하면 전파되어야 한다', async () => {
      const middleware: MiddlewareHandler<StepContext, LlmResult> = async () => {
        throw new Error('Middleware error');
      };

      registry.wrap('step.llmCall', middleware);

      const ctx = createStepContext();
      const coreFn = vi.fn().mockResolvedValue({
        message: { id: 'msg-1', role: 'assistant', content: 'Hello!' },
        toolCalls: [],
      } satisfies LlmResult);

      await expect(
        executor.runMiddleware('step.llmCall', ctx, coreFn)
      ).rejects.toThrow('Middleware error');
    });

    it('core 함수에서 예외가 발생하면 Middleware에서 catch할 수 있어야 한다', async () => {
      const middleware: MiddlewareHandler<StepContext, LlmResult> = async (
        ctx,
        next
      ) => {
        try {
          return await next(ctx);
        } catch {
          return {
            message: { id: 'msg-err', role: 'assistant', content: 'Error handled' },
            toolCalls: [],
          };
        }
      };

      registry.wrap('step.llmCall', middleware);

      const ctx = createStepContext();
      const coreFn = vi.fn().mockRejectedValue(new Error('Core error'));

      const result = await executor.runMiddleware('step.llmCall', ctx, coreFn);

      expect(result.message.content).toBe('Error handled');
    });
  });

  describe('toolCall.exec Middleware', () => {
    it('toolCall.exec 파이프라인이 작동해야 한다', async () => {
      const executionOrder: string[] = [];

      const middleware: MiddlewareHandler<ToolCallContext, ToolResult> = async (
        ctx,
        next
      ) => {
        executionOrder.push('middleware-before');
        const result = await next(ctx);
        executionOrder.push('middleware-after');
        return result;
      };

      registry.wrap('toolCall.exec', middleware);

      const ctx: ToolCallContext = {
        ...createStepContext(),
        toolCall: {
          id: 'call-1',
          name: 'readFile',
          args: { path: '/tmp/test.txt' },
        },
      };

      const coreFn = vi.fn().mockImplementation(async () => {
        executionOrder.push('core');
        return {
          toolCallId: 'call-1',
          toolName: 'readFile',
          output: 'file contents',
          status: 'ok',
        } satisfies ToolResult;
      });

      const result = await executor.runMiddleware('toolCall.exec', ctx, coreFn);

      expect(executionOrder).toEqual([
        'middleware-before',
        'core',
        'middleware-after',
      ]);
      expect(result.status).toBe('ok');
    });
  });
});
