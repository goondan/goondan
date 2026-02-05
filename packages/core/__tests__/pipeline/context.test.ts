/**
 * Pipeline Context 타입 테스트
 * @see /docs/specs/pipeline.md - 4. 컨텍스트 구조
 */
import { describe, it, expect } from 'vitest';
import type {
  BasePipelineContext,
  TurnContext,
  StepContext,
  ToolCallContext,
  WorkspaceContext,
  LlmErrorContext,
  Turn,
  Step,
  TurnAuth,
  ToolCall,
  ToolResult,
  LlmResult,
  ToolCatalogItem,
  ContextBlock,
  PipelineContextMap,
  ContextForPoint,
  ResultForPoint,
} from '../../src/pipeline/context.js';
import type { PipelinePoint } from '../../src/pipeline/types.js';

describe('Pipeline Context 타입', () => {
  describe('BasePipelineContext', () => {
    it('기본 컨텍스트 필드들을 정의해야 한다', () => {
      // 타입 수준 테스트 - 컴파일 통과 여부 확인
      const ctx: BasePipelineContext = {
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
        events: {
          emit: () => {},
          on: () => () => {},
        },
        logger: console,
      };

      expect(ctx.instance.id).toBe('inst-1');
      expect(ctx.swarm.kind).toBe('Swarm');
      expect(ctx.agent.kind).toBe('Agent');
    });
  });

  describe('Turn', () => {
    it('Turn 필드들을 정의해야 한다', () => {
      const turn: Turn = {
        id: 'turn-1',
        input: 'Hello, agent!',
        messages: [],
        toolResults: [],
      };

      expect(turn.id).toBe('turn-1');
      expect(turn.input).toBe('Hello, agent!');
      expect(turn.messages).toEqual([]);
      expect(turn.toolResults).toEqual([]);
    });

    it('선택적 필드들을 지원해야 한다', () => {
      const turn: Turn = {
        id: 'turn-1',
        input: 'Hello',
        messages: [],
        toolResults: [],
        origin: { connector: 'telegram', chatId: '123' },
        auth: {
          actor: { type: 'user', id: 'user-1', display: 'Alice' },
          subjects: { global: 'global-1', user: 'user-1' },
        },
        metadata: { custom: 'value' },
        summary: 'Turn summary',
      };

      expect(turn.origin).toBeDefined();
      expect(turn.auth).toBeDefined();
      expect(turn.metadata).toBeDefined();
      expect(turn.summary).toBe('Turn summary');
    });
  });

  describe('TurnAuth', () => {
    it('actor 정보를 포함할 수 있다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'user',
          id: 'user-123',
          display: 'Alice',
        },
      };

      expect(auth.actor?.type).toBe('user');
      expect(auth.actor?.id).toBe('user-123');
      expect(auth.actor?.display).toBe('Alice');
    });

    it('subjects 정보를 포함할 수 있다', () => {
      const auth: TurnAuth = {
        subjects: {
          global: 'global-subject',
          user: 'user-subject',
        },
      };

      expect(auth.subjects?.global).toBe('global-subject');
      expect(auth.subjects?.user).toBe('user-subject');
    });
  });

  describe('Step', () => {
    it('Step 필드들을 정의해야 한다', () => {
      const step: Step = {
        id: 'step-1',
        index: 0,
        startedAt: new Date(),
      };

      expect(step.id).toBe('step-1');
      expect(step.index).toBe(0);
      expect(step.startedAt).toBeInstanceOf(Date);
    });

    it('선택적 필드들을 지원해야 한다', () => {
      const step: Step = {
        id: 'step-1',
        index: 0,
        startedAt: new Date(),
        endedAt: new Date(),
        llmResult: {
          message: { role: 'assistant', content: 'Hello!' },
          toolCalls: [],
        },
      };

      expect(step.endedAt).toBeInstanceOf(Date);
      expect(step.llmResult).toBeDefined();
    });
  });

  describe('LlmResult', () => {
    it('LLM 응답 결과를 정의해야 한다', () => {
      const result: LlmResult = {
        message: { role: 'assistant', content: 'Hello!' },
        toolCalls: [],
      };

      expect(result.message.role).toBe('assistant');
      expect(result.toolCalls).toEqual([]);
    });

    it('meta 정보를 포함할 수 있다', () => {
      const result: LlmResult = {
        message: { role: 'assistant', content: 'Hello!' },
        toolCalls: [],
        meta: {
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
          model: 'gpt-4',
          finishReason: 'stop',
        },
      };

      expect(result.meta?.usage?.totalTokens).toBe(150);
      expect(result.meta?.model).toBe('gpt-4');
      expect(result.meta?.finishReason).toBe('stop');
    });
  });

  describe('ToolCall', () => {
    it('tool call 정보를 정의해야 한다', () => {
      const toolCall: ToolCall = {
        id: 'call-1',
        name: 'readFile',
        input: { path: '/tmp/test.txt' },
      };

      expect(toolCall.id).toBe('call-1');
      expect(toolCall.name).toBe('readFile');
      expect(toolCall.input).toEqual({ path: '/tmp/test.txt' });
    });
  });

  describe('ToolResult', () => {
    it('성공 결과를 정의해야 한다', () => {
      const result: ToolResult = {
        toolCallId: 'call-1',
        toolName: 'readFile',
        output: 'file contents',
        status: 'success',
      };

      expect(result.status).toBe('success');
      expect(result.output).toBe('file contents');
    });

    it('오류 결과를 정의해야 한다', () => {
      const result: ToolResult = {
        toolCallId: 'call-1',
        toolName: 'readFile',
        output: null,
        status: 'error',
        error: {
          name: 'FileNotFoundError',
          message: 'File not found',
          code: 'ENOENT',
        },
      };

      expect(result.status).toBe('error');
      expect(result.error?.name).toBe('FileNotFoundError');
      expect(result.error?.code).toBe('ENOENT');
    });
  });

  describe('ToolCatalogItem', () => {
    it('도구 카탈로그 항목을 정의해야 한다', () => {
      const item: ToolCatalogItem = {
        name: 'readFile',
        description: 'Reads a file from the filesystem',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      };

      expect(item.name).toBe('readFile');
      expect(item.description).toBeDefined();
      expect(item.parameters).toBeDefined();
    });

    it('source 정보를 포함할 수 있다', () => {
      const item: ToolCatalogItem = {
        name: 'mcpTool',
        source: {
          type: 'mcp',
          mcpServer: 'filesystem-server',
        },
      };

      expect(item.source?.type).toBe('mcp');
      expect(item.source?.mcpServer).toBe('filesystem-server');
    });
  });

  describe('ContextBlock', () => {
    it('컨텍스트 블록을 정의해야 한다', () => {
      const block: ContextBlock = {
        type: 'system.prompt',
        data: 'You are a helpful assistant.',
        priority: 100,
      };

      expect(block.type).toBe('system.prompt');
      expect(block.data).toBe('You are a helpful assistant.');
      expect(block.priority).toBe(100);
    });

    it('items 배열을 지원해야 한다', () => {
      const block: ContextBlock = {
        type: 'skills.catalog',
        items: [
          { name: 'search', description: 'Search the web' },
          { name: 'calculate', description: 'Do math' },
        ],
      };

      expect(block.items?.length).toBe(2);
    });
  });

  describe('TurnContext', () => {
    it('BasePipelineContext를 확장해야 한다', () => {
      const ctx: TurnContext = {
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
      };

      expect(ctx.turn.id).toBe('turn-1');
    });
  });

  describe('StepContext', () => {
    it('TurnContext를 확장해야 한다', () => {
      const ctx: StepContext = {
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

      expect(ctx.step.index).toBe(0);
      expect(ctx.toolCatalog).toEqual([]);
      expect(ctx.blocks).toEqual([]);
    });
  });

  describe('ToolCallContext', () => {
    it('StepContext를 확장해야 한다', () => {
      const ctx: ToolCallContext = {
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
        toolCall: {
          id: 'call-1',
          name: 'readFile',
          input: { path: '/tmp/test.txt' },
        },
      };

      expect(ctx.toolCall.name).toBe('readFile');
    });

    it('toolResult를 선택적으로 포함할 수 있다', () => {
      const ctx: ToolCallContext = {
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
        toolCall: {
          id: 'call-1',
          name: 'readFile',
          input: { path: '/tmp/test.txt' },
        },
        toolResult: {
          toolCallId: 'call-1',
          toolName: 'readFile',
          output: 'contents',
          status: 'success',
        },
      };

      expect(ctx.toolResult?.status).toBe('success');
    });
  });

  describe('WorkspaceContext', () => {
    it('BasePipelineContext를 확장해야 한다', () => {
      const ctx: WorkspaceContext = {
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
        eventType: 'repoAvailable',
        path: '/workspace/repo',
      };

      expect(ctx.eventType).toBe('repoAvailable');
      expect(ctx.path).toBe('/workspace/repo');
    });
  });

  describe('LlmErrorContext', () => {
    it('StepContext를 확장해야 한다', () => {
      const ctx: LlmErrorContext = {
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
        error: new Error('Rate limit exceeded'),
        retryCount: 0,
        shouldRetry: true,
        retryDelayMs: 1000,
      };

      expect(ctx.error.message).toBe('Rate limit exceeded');
      expect(ctx.shouldRetry).toBe(true);
      expect(ctx.retryDelayMs).toBe(1000);
    });
  });

  describe('PipelineContextMap', () => {
    it('각 파이프라인 포인트에 대한 컨텍스트 타입을 매핑해야 한다', () => {
      // 타입 수준 테스트 - 컴파일이 통과하면 타입이 올바르게 매핑된 것
      type TurnPreCtx = PipelineContextMap['turn.pre'];
      type StepToolsCtx = PipelineContextMap['step.tools'];
      type ToolCallExecCtx = PipelineContextMap['toolCall.exec'];
      type WorkspaceCtx = PipelineContextMap['workspace.repoAvailable'];

      // 런타임에서 검증할 수 있는 간단한 테스트
      const turnPreCtx: TurnPreCtx = {} as TurnPreCtx;
      const stepToolsCtx: StepToolsCtx = {} as StepToolsCtx;
      const toolCallExecCtx: ToolCallExecCtx = {} as ToolCallExecCtx;
      const workspaceCtx: WorkspaceCtx = {} as WorkspaceCtx;

      expect(turnPreCtx).toBeDefined();
      expect(stepToolsCtx).toBeDefined();
      expect(toolCallExecCtx).toBeDefined();
      expect(workspaceCtx).toBeDefined();
    });
  });

  describe('ContextForPoint', () => {
    it('PipelinePoint에서 컨텍스트 타입을 추론해야 한다', () => {
      // 타입 수준 테스트
      type Ctx1 = ContextForPoint<'turn.pre'>;
      type Ctx2 = ContextForPoint<'step.llmCall'>;
      type Ctx3 = ContextForPoint<'toolCall.exec'>;
      type Ctx4 = ContextForPoint<'workspace.worktreeMounted'>;

      const ctx1: Ctx1 = {} as Ctx1;
      const ctx2: Ctx2 = {} as Ctx2;
      const ctx3: Ctx3 = {} as Ctx3;
      const ctx4: Ctx4 = {} as Ctx4;

      expect(ctx1).toBeDefined();
      expect(ctx2).toBeDefined();
      expect(ctx3).toBeDefined();
      expect(ctx4).toBeDefined();
    });
  });

  describe('ResultForPoint', () => {
    it('MiddlewarePoint에서 결과 타입을 추론해야 한다', () => {
      // 타입 수준 테스트
      type Result1 = ResultForPoint<'step.llmCall'>;
      type Result2 = ResultForPoint<'toolCall.exec'>;

      const result1: Result1 = {} as Result1;
      const result2: Result2 = {} as Result2;

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
