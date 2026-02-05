/**
 * PipelineRegistry 테스트
 * @see /docs/specs/pipeline.md - 파이프라인 시스템
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineRegistry } from '../../src/extension/pipeline-registry.js';
import type {
  StepContext,
  ToolCallContext,
  TurnContext,
  MutatorHandler,
  MiddlewareHandler,
} from '../../src/extension/types.js';

// 테스트용 컨텍스트 생성 헬퍼
function createStepContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    turn: {
      id: 'turn-1',
      input: 'test input',
      messages: [],
      toolResults: [],
    },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { entrypoint: { kind: 'Agent', name: 'test' }, agents: [] },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: {
        modelConfig: { modelRef: { kind: 'Model', name: 'gpt-4' } },
        prompts: { system: 'test' },
      },
    },
    effectiveConfig: {
      swarm: {} as never,
      agents: new Map(),
      models: new Map(),
      tools: new Map(),
      extensions: new Map(),
      connectors: new Map(),
      oauthApps: new Map(),
      revision: 1,
      swarmBundleRef: 'git:HEAD',
    },
    step: {
      id: 'step-1',
      index: 0,
      startedAt: new Date(),
    },
    blocks: [],
    toolCatalog: [],
    activeSwarmRef: 'git:HEAD',
    ...overrides,
  };
}

describe('PipelineRegistry', () => {
  let registry: PipelineRegistry;

  beforeEach(() => {
    registry = new PipelineRegistry();
  });

  describe('mutate', () => {
    it('Mutator를 등록할 수 있다', () => {
      expect(() => {
        registry.mutate('step.blocks', async (ctx) => ctx);
      }).not.toThrow();
    });

    it('동일 포인트에 여러 Mutator를 등록할 수 있다', () => {
      registry.mutate('step.blocks', async (ctx) => ctx);
      registry.mutate('step.blocks', async (ctx) => ctx);

      const handlers = registry.getMutators('step.blocks');
      expect(handlers).toHaveLength(2);
    });
  });

  describe('wrap', () => {
    it('Middleware를 등록할 수 있다', () => {
      expect(() => {
        registry.wrap('step.llmCall', async (ctx, next) => next(ctx));
      }).not.toThrow();
    });

    it('동일 포인트에 여러 Middleware를 등록할 수 있다', () => {
      registry.wrap('step.llmCall', async (ctx, next) => next(ctx));
      registry.wrap('step.llmCall', async (ctx, next) => next(ctx));

      const handlers = registry.getMiddlewares('step.llmCall');
      expect(handlers).toHaveLength(2);
    });
  });

  describe('runMutators', () => {
    it('등록된 순서대로 Mutator를 실행한다', async () => {
      const order: number[] = [];

      registry.mutate('step.blocks', async (ctx) => {
        order.push(1);
        return ctx;
      });
      registry.mutate('step.blocks', async (ctx) => {
        order.push(2);
        return ctx;
      });
      registry.mutate('step.blocks', async (ctx) => {
        order.push(3);
        return ctx;
      });

      const ctx = createStepContext();
      await registry.runMutators('step.blocks', ctx);

      expect(order).toEqual([1, 2, 3]);
    });

    it('Mutator가 컨텍스트를 변형할 수 있다', async () => {
      registry.mutate('step.blocks', async (ctx) => {
        return {
          ...ctx,
          blocks: [...ctx.blocks, { type: 'custom.block', data: { added: true } }],
        };
      });

      const ctx = createStepContext();
      const result = await registry.runMutators('step.blocks', ctx);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]?.type).toBe('custom.block');
    });

    it('이전 Mutator의 결과가 다음 Mutator의 입력이 된다', async () => {
      registry.mutate('step.blocks', async (ctx) => {
        return {
          ...ctx,
          blocks: [...ctx.blocks, { type: 'block-1' }],
        };
      });
      registry.mutate('step.blocks', async (ctx) => {
        return {
          ...ctx,
          blocks: [...ctx.blocks, { type: 'block-2' }],
        };
      });

      const ctx = createStepContext();
      const result = await registry.runMutators('step.blocks', ctx);

      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0]?.type).toBe('block-1');
      expect(result.blocks[1]?.type).toBe('block-2');
    });

    it('등록된 Mutator가 없으면 원본 컨텍스트를 반환한다', async () => {
      const ctx = createStepContext();
      const result = await registry.runMutators('step.blocks', ctx);

      expect(result).toBe(ctx);
    });

    it('priority가 낮은 Mutator가 먼저 실행된다', async () => {
      const order: number[] = [];

      registry.mutate('step.blocks', async (ctx) => {
        order.push(10);
        return ctx;
      }, { priority: 10 });

      registry.mutate('step.blocks', async (ctx) => {
        order.push(5);
        return ctx;
      }, { priority: 5 });

      registry.mutate('step.blocks', async (ctx) => {
        order.push(15);
        return ctx;
      }, { priority: 15 });

      const ctx = createStepContext();
      await registry.runMutators('step.blocks', ctx);

      expect(order).toEqual([5, 10, 15]);
    });

    it('동일 priority는 등록 순서를 유지한다 (안정 정렬)', async () => {
      const order: string[] = [];

      registry.mutate('step.blocks', async (ctx) => {
        order.push('a');
        return ctx;
      }, { priority: 10 });

      registry.mutate('step.blocks', async (ctx) => {
        order.push('b');
        return ctx;
      }, { priority: 10 });

      registry.mutate('step.blocks', async (ctx) => {
        order.push('c');
        return ctx;
      }, { priority: 10 });

      const ctx = createStepContext();
      await registry.runMutators('step.blocks', ctx);

      expect(order).toEqual(['a', 'b', 'c']);
    });
  });

  describe('runMiddleware', () => {
    it('Middleware가 코어 실행을 래핑한다', async () => {
      const order: string[] = [];

      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('before');
        const result = await next(ctx);
        order.push('after');
        return result;
      });

      const ctx = createStepContext();
      const coreResult = { message: { role: 'assistant' as const, content: 'test' }, toolCalls: [] };

      await registry.runMiddleware('step.llmCall', ctx, async () => {
        order.push('core');
        return coreResult;
      });

      expect(order).toEqual(['before', 'core', 'after']);
    });

    it('먼저 등록된 Middleware가 바깥 레이어를 형성한다 (onion 구조)', async () => {
      const order: string[] = [];

      // 첫 번째 등록 (가장 바깥)
      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('A-before');
        const result = await next(ctx);
        order.push('A-after');
        return result;
      });

      // 두 번째 등록 (중간)
      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('B-before');
        const result = await next(ctx);
        order.push('B-after');
        return result;
      });

      // 세 번째 등록 (가장 안쪽)
      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('C-before');
        const result = await next(ctx);
        order.push('C-after');
        return result;
      });

      const ctx = createStepContext();
      const coreResult = { message: { role: 'assistant' as const, content: 'test' }, toolCalls: [] };

      await registry.runMiddleware('step.llmCall', ctx, async () => {
        order.push('CORE');
        return coreResult;
      });

      expect(order).toEqual([
        'A-before',
        'B-before',
        'C-before',
        'CORE',
        'C-after',
        'B-after',
        'A-after',
      ]);
    });

    it('Middleware가 없으면 코어만 실행된다', async () => {
      const ctx = createStepContext();
      const coreResult = { message: { role: 'assistant' as const, content: 'test' }, toolCalls: [] };

      const result = await registry.runMiddleware('step.llmCall', ctx, async () => coreResult);

      expect(result).toEqual(coreResult);
    });

    it('Middleware가 next를 호출하지 않으면 내부 실행이 스킵된다', async () => {
      const coreCalled = vi.fn();

      registry.wrap('step.llmCall', async (ctx, _next) => {
        // next를 호출하지 않음
        return { message: { role: 'assistant' as const, content: 'intercepted' }, toolCalls: [] };
      });

      const ctx = createStepContext();
      const result = await registry.runMiddleware('step.llmCall', ctx, async () => {
        coreCalled();
        return { message: { role: 'assistant' as const, content: 'core' }, toolCalls: [] };
      });

      expect(coreCalled).not.toHaveBeenCalled();
      expect(result.message.content).toBe('intercepted');
    });

    it('Middleware가 컨텍스트를 수정할 수 있다', async () => {
      interface ModifiedContext extends StepContext {
        modified?: boolean;
      }

      registry.wrap('step.llmCall', async (ctx, next) => {
        const modifiedCtx = { ...ctx, modified: true };
        return next(modifiedCtx);
      });

      let receivedCtx: ModifiedContext | undefined;
      const ctx = createStepContext();

      await registry.runMiddleware('step.llmCall', ctx, async (ctx) => {
        receivedCtx = ctx;
        return { message: { role: 'assistant' as const, content: 'test' }, toolCalls: [] };
      });

      expect(receivedCtx?.modified).toBe(true);
    });
  });

  describe('priority 기반 Middleware 정렬', () => {
    it('priority가 낮은 Middleware가 바깥 레이어를 형성한다', async () => {
      const order: string[] = [];

      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('P10-before');
        const result = await next(ctx);
        order.push('P10-after');
        return result;
      }, { priority: 10 });

      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('P5-before');
        const result = await next(ctx);
        order.push('P5-after');
        return result;
      }, { priority: 5 });

      registry.wrap('step.llmCall', async (ctx, next) => {
        order.push('P15-before');
        const result = await next(ctx);
        order.push('P15-after');
        return result;
      }, { priority: 15 });

      const ctx = createStepContext();
      await registry.runMiddleware('step.llmCall', ctx, async () => {
        order.push('CORE');
        return { message: { role: 'assistant' as const, content: 'test' }, toolCalls: [] };
      });

      // priority 순서: 5 (바깥) -> 10 (중간) -> 15 (안쪽) -> CORE
      expect(order).toEqual([
        'P5-before',
        'P10-before',
        'P15-before',
        'CORE',
        'P15-after',
        'P10-after',
        'P5-after',
      ]);
    });
  });

  describe('clear', () => {
    it('모든 핸들러를 초기화한다', () => {
      registry.mutate('step.blocks', async (ctx) => ctx);
      registry.wrap('step.llmCall', async (ctx, next) => next(ctx));

      registry.clear();

      expect(registry.getMutators('step.blocks')).toHaveLength(0);
      expect(registry.getMiddlewares('step.llmCall')).toHaveLength(0);
    });
  });
});
