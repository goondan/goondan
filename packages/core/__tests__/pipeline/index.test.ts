/**
 * Pipeline 모듈 통합 테스트
 * @see /docs/specs/pipeline.md
 */
import { describe, it, expect } from 'vitest';
import {
  // Types
  PIPELINE_POINTS,
  MUTATOR_POINTS,
  MIDDLEWARE_POINTS,
  isPipelinePoint,
  isMutatorPoint,
  isMiddlewarePoint,
  // Registry
  PipelineRegistry,
  // Executor
  PipelineExecutor,
  // API
  createPipelineApi,
  // Re-exports
  type PipelinePoint,
  type MutatorPoint,
  type MiddlewarePoint,
  type MutatorHandler,
  type MiddlewareHandler,
  type MutatorOptions,
  type MiddlewareOptions,
  type PipelineApi,
  type BasePipelineContext,
  type TurnContext,
  type StepContext,
  type ToolCallContext,
  type WorkspaceContext,
  type LlmErrorContext,
} from '../../src/pipeline/index.js';

describe('Pipeline 모듈 export', () => {
  describe('Types', () => {
    it('PIPELINE_POINTS가 export되어야 한다', () => {
      expect(PIPELINE_POINTS).toBeDefined();
      expect(Array.isArray(PIPELINE_POINTS)).toBe(true);
    });

    it('MUTATOR_POINTS가 export되어야 한다', () => {
      expect(MUTATOR_POINTS).toBeDefined();
      expect(Array.isArray(MUTATOR_POINTS)).toBe(true);
    });

    it('MIDDLEWARE_POINTS가 export되어야 한다', () => {
      expect(MIDDLEWARE_POINTS).toBeDefined();
      expect(Array.isArray(MIDDLEWARE_POINTS)).toBe(true);
    });

    it('타입 가드 함수들이 export되어야 한다', () => {
      expect(typeof isPipelinePoint).toBe('function');
      expect(typeof isMutatorPoint).toBe('function');
      expect(typeof isMiddlewarePoint).toBe('function');
    });
  });

  describe('Registry', () => {
    it('PipelineRegistry가 export되어야 한다', () => {
      expect(PipelineRegistry).toBeDefined();
      expect(typeof PipelineRegistry).toBe('function');
    });

    it('PipelineRegistry 인스턴스를 생성할 수 있어야 한다', () => {
      const registry = new PipelineRegistry();
      expect(registry).toBeInstanceOf(PipelineRegistry);
    });
  });

  describe('Executor', () => {
    it('PipelineExecutor가 export되어야 한다', () => {
      expect(PipelineExecutor).toBeDefined();
      expect(typeof PipelineExecutor).toBe('function');
    });

    it('PipelineExecutor 인스턴스를 생성할 수 있어야 한다', () => {
      const registry = new PipelineRegistry();
      const executor = new PipelineExecutor(registry);
      expect(executor).toBeInstanceOf(PipelineExecutor);
    });
  });

  describe('API', () => {
    it('createPipelineApi가 export되어야 한다', () => {
      expect(createPipelineApi).toBeDefined();
      expect(typeof createPipelineApi).toBe('function');
    });

    it('createPipelineApi로 PipelineApi를 생성할 수 있어야 한다', () => {
      const registry = new PipelineRegistry();
      const api = createPipelineApi(registry);
      expect(api).toBeDefined();
      expect(typeof api.mutate).toBe('function');
      expect(typeof api.wrap).toBe('function');
    });
  });

  describe('통합 시나리오', () => {
    it('Registry + Executor + API를 함께 사용할 수 있어야 한다', async () => {
      // 1. Registry 생성
      const registry = new PipelineRegistry();

      // 2. API 생성
      const api = createPipelineApi(registry);

      // 3. 핸들러 등록
      const executionOrder: string[] = [];

      api.mutate('step.tools', (ctx) => {
        executionOrder.push('mutator-A');
        return ctx;
      });

      api.mutate('step.tools', (ctx) => {
        executionOrder.push('mutator-B');
        return ctx;
      });

      api.wrap('step.llmCall', async (ctx, next) => {
        executionOrder.push('middleware-before');
        const result = await next(ctx);
        executionOrder.push('middleware-after');
        return result;
      });

      // 4. Executor 생성 및 실행
      const executor = new PipelineExecutor(registry);

      const stepCtx: StepContext = {
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
          messages: [],
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
      };

      // Mutator 실행
      await executor.runMutators('step.tools', stepCtx);

      // Middleware 실행
      await executor.runMiddleware('step.llmCall', stepCtx, async () => {
        executionOrder.push('core');
        return {
          message: { role: 'assistant', content: 'Hello!' },
          toolCalls: [],
        };
      });

      expect(executionOrder).toEqual([
        'mutator-A',
        'mutator-B',
        'middleware-before',
        'core',
        'middleware-after',
      ]);
    });
  });
});
