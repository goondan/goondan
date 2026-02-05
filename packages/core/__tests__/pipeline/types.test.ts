/**
 * Pipeline 타입 테스트
 * @see /docs/specs/pipeline.md - 3. 표준 파이프라인 포인트
 */
import { describe, it, expect } from 'vitest';
import type {
  PipelinePoint,
  MutatorPoint,
  MiddlewarePoint,
  MutatorHandler,
  MiddlewareHandler,
  MutatorOptions,
  MiddlewareOptions,
} from '../../src/pipeline/types.js';
import {
  PIPELINE_POINTS,
  MUTATOR_POINTS,
  MIDDLEWARE_POINTS,
  isPipelinePoint,
  isMutatorPoint,
  isMiddlewarePoint,
} from '../../src/pipeline/types.js';

describe('Pipeline 타입', () => {
  describe('PipelinePoint', () => {
    it('모든 파이프라인 포인트가 정의되어야 한다', () => {
      const expectedPoints: PipelinePoint[] = [
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
      ];

      expect(PIPELINE_POINTS).toEqual(expectedPoints);
      expect(PIPELINE_POINTS.length).toBe(14);
    });
  });

  describe('MutatorPoint', () => {
    it('Mutator 타입 포인트들이 정의되어야 한다', () => {
      const expectedMutatorPoints: MutatorPoint[] = [
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
      ];

      expect(MUTATOR_POINTS).toEqual(expectedMutatorPoints);
      expect(MUTATOR_POINTS.length).toBe(12);
    });
  });

  describe('MiddlewarePoint', () => {
    it('Middleware 타입 포인트들이 정의되어야 한다', () => {
      const expectedMiddlewarePoints: MiddlewarePoint[] = [
        'step.llmCall',
        'toolCall.exec',
      ];

      expect(MIDDLEWARE_POINTS).toEqual(expectedMiddlewarePoints);
      expect(MIDDLEWARE_POINTS.length).toBe(2);
    });
  });

  describe('isPipelinePoint 타입 가드', () => {
    it('유효한 PipelinePoint에 대해 true를 반환해야 한다', () => {
      expect(isPipelinePoint('turn.pre')).toBe(true);
      expect(isPipelinePoint('step.llmCall')).toBe(true);
      expect(isPipelinePoint('toolCall.exec')).toBe(true);
      expect(isPipelinePoint('workspace.repoAvailable')).toBe(true);
    });

    it('유효하지 않은 값에 대해 false를 반환해야 한다', () => {
      expect(isPipelinePoint('invalid')).toBe(false);
      expect(isPipelinePoint('')).toBe(false);
      expect(isPipelinePoint(null)).toBe(false);
      expect(isPipelinePoint(undefined)).toBe(false);
      expect(isPipelinePoint(123)).toBe(false);
    });
  });

  describe('isMutatorPoint 타입 가드', () => {
    it('유효한 MutatorPoint에 대해 true를 반환해야 한다', () => {
      expect(isMutatorPoint('turn.pre')).toBe(true);
      expect(isMutatorPoint('step.tools')).toBe(true);
      expect(isMutatorPoint('toolCall.post')).toBe(true);
    });

    it('MiddlewarePoint에 대해 false를 반환해야 한다', () => {
      expect(isMutatorPoint('step.llmCall')).toBe(false);
      expect(isMutatorPoint('toolCall.exec')).toBe(false);
    });

    it('유효하지 않은 값에 대해 false를 반환해야 한다', () => {
      expect(isMutatorPoint('invalid')).toBe(false);
    });
  });

  describe('isMiddlewarePoint 타입 가드', () => {
    it('유효한 MiddlewarePoint에 대해 true를 반환해야 한다', () => {
      expect(isMiddlewarePoint('step.llmCall')).toBe(true);
      expect(isMiddlewarePoint('toolCall.exec')).toBe(true);
    });

    it('MutatorPoint에 대해 false를 반환해야 한다', () => {
      expect(isMiddlewarePoint('turn.pre')).toBe(false);
      expect(isMiddlewarePoint('step.tools')).toBe(false);
    });

    it('유효하지 않은 값에 대해 false를 반환해야 한다', () => {
      expect(isMiddlewarePoint('invalid')).toBe(false);
    });
  });

  describe('MutatorHandler 타입', () => {
    it('동기 함수를 지원해야 한다', () => {
      const handler: MutatorHandler<{ value: number }> = (ctx) => {
        return { ...ctx, value: ctx.value + 1 };
      };

      const result = handler({ value: 1 });
      expect(result).toEqual({ value: 2 });
    });

    it('비동기 함수를 지원해야 한다', async () => {
      const handler: MutatorHandler<{ value: number }> = async (ctx) => {
        return { ...ctx, value: ctx.value + 1 };
      };

      const result = await handler({ value: 1 });
      expect(result).toEqual({ value: 2 });
    });
  });

  describe('MiddlewareHandler 타입', () => {
    it('next()를 호출하여 다음 핸들러를 실행해야 한다', async () => {
      const handler: MiddlewareHandler<{ value: number }, string> = async (
        ctx,
        next
      ) => {
        const result = await next(ctx);
        return `wrapped: ${result}`;
      };

      const result = await handler({ value: 1 }, async () => 'core');
      expect(result).toBe('wrapped: core');
    });

    it('next() 호출 전에 컨텍스트를 수정할 수 있어야 한다', async () => {
      const handler: MiddlewareHandler<{ value: number }, number> = async (
        ctx,
        next
      ) => {
        return next({ ...ctx, value: ctx.value * 2 });
      };

      const result = await handler({ value: 5 }, async (ctx) => ctx.value);
      expect(result).toBe(10);
    });

    it('next()를 호출하지 않으면 내부 실행이 스킵되어야 한다', async () => {
      let coreExecuted = false;
      const handler: MiddlewareHandler<{ value: number }, string> = async () => {
        return 'skipped';
      };

      const result = await handler({ value: 1 }, async () => {
        coreExecuted = true;
        return 'core';
      });
      expect(result).toBe('skipped');
      expect(coreExecuted).toBe(false);
    });
  });

  describe('MutatorOptions', () => {
    it('priority 필드는 선택이다', () => {
      const options: MutatorOptions = {};
      expect(options.priority).toBeUndefined();
    });

    it('priority를 지정할 수 있다', () => {
      const options: MutatorOptions = { priority: 10 };
      expect(options.priority).toBe(10);
    });

    it('id 필드는 선택이다', () => {
      const options: MutatorOptions = {};
      expect(options.id).toBeUndefined();
    });

    it('id를 지정할 수 있다', () => {
      const options: MutatorOptions = { id: 'my-mutator' };
      expect(options.id).toBe('my-mutator');
    });
  });

  describe('MiddlewareOptions', () => {
    it('priority 필드는 선택이다', () => {
      const options: MiddlewareOptions = {};
      expect(options.priority).toBeUndefined();
    });

    it('priority를 지정할 수 있다', () => {
      const options: MiddlewareOptions = { priority: 5 };
      expect(options.priority).toBe(5);
    });

    it('id 필드는 선택이다', () => {
      const options: MiddlewareOptions = {};
      expect(options.id).toBeUndefined();
    });

    it('id를 지정할 수 있다', () => {
      const options: MiddlewareOptions = { id: 'my-middleware' };
      expect(options.id).toBe('my-middleware');
    });
  });
});
