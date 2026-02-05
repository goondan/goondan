/**
 * Step 실행 테스트
 * @see /docs/specs/runtime.md - 2.5 Step 타입, 6. Step 실행 순서
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Step,
  createStep,
  StepRunner,
  createStepRunner,
  StepContext,
} from '../../src/runtime/step-runner.js';
import { createSwarmInstance } from '../../src/runtime/swarm-instance.js';
import { createAgentInstance } from '../../src/runtime/agent-instance.js';
import { createTurn } from '../../src/runtime/turn-runner.js';
import { createAgentEvent } from '../../src/runtime/types.js';
import type { Turn } from '../../src/runtime/turn-runner.js';
import type { EffectiveConfig } from '../../src/runtime/effective-config.js';
import type {
  LlmResult,
  ToolCall,
  ToolResult,
  ToolCatalogItem,
} from '../../src/runtime/types.js';

describe('Step', () => {
  let turn: Turn;

  beforeEach(() => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    const event = createAgentEvent('user.input', 'Hello!');
    turn = createTurn(agentInstance, event);
  });

  describe('createStep', () => {
    it('Step 객체를 생성해야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref-abc');

      expect(step.id).toBeDefined();
      expect(step.turn).toBe(turn);
      expect(step.index).toBe(0);
      expect(step.activeSwarmBundleRef).toBe('bundle-ref-abc');
      expect(step.status).toBe('pending');
      expect(step.toolCatalog).toEqual([]);
      expect(step.blocks).toEqual([]);
      expect(step.toolCalls).toEqual([]);
      expect(step.toolResults).toEqual([]);
      expect(step.startedAt).toBeInstanceOf(Date);
      expect(step.metadata).toEqual({});
    });

    it('effectiveConfig는 나중에 설정할 수 있어야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      const mockConfig = {
        swarm: {},
        agent: {},
        model: {},
        tools: [],
        extensions: [],
        systemPrompt: 'You are helpful.',
        revision: 1,
      } as EffectiveConfig;

      step.effectiveConfig = mockConfig;
      expect(step.effectiveConfig).toBe(mockConfig);
    });
  });

  describe('Step 상태 전이', () => {
    it('pending -> config -> tools -> blocks -> llmCall -> completed 전이', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      expect(step.status).toBe('pending');

      step.status = 'config';
      expect(step.status).toBe('config');

      step.status = 'tools';
      expect(step.status).toBe('tools');

      step.status = 'blocks';
      expect(step.status).toBe('blocks');

      step.status = 'llmCall';
      expect(step.status).toBe('llmCall');

      step.status = 'completed';
      step.completedAt = new Date();
      expect(step.status).toBe('completed');
    });

    it('llmCall -> toolExec -> post -> completed 전이', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      step.status = 'llmCall';
      step.status = 'toolExec';
      expect(step.status).toBe('toolExec');

      step.status = 'post';
      expect(step.status).toBe('post');

      step.status = 'completed';
      expect(step.status).toBe('completed');
    });

    it('어느 단계에서든 failed로 전이 가능', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      step.status = 'tools';
      step.status = 'failed';
      step.completedAt = new Date();
      step.metadata['error'] = { message: 'Tool loading failed' };

      expect(step.status).toBe('failed');
    });
  });

  describe('Step 도구 호출', () => {
    it('toolCalls와 toolResults를 저장할 수 있어야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      const toolCall: ToolCall = {
        id: 'call_001',
        name: 'file.read',
        input: { path: '/test.txt' },
      };

      const toolResult: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'file.read',
        output: { content: 'file contents' },
      };

      step.toolCalls.push(toolCall);
      step.toolResults.push(toolResult);

      expect(step.toolCalls.length).toBe(1);
      expect(step.toolResults.length).toBe(1);
    });
  });

  describe('Step LLM 결과', () => {
    it('llmResult를 저장할 수 있어야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      const llmResult: LlmResult = {
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you?',
        },
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
        finishReason: 'stop',
      };

      step.llmResult = llmResult;

      expect(step.llmResult.message.content).toBe('Hello! How can I help you?');
      expect(step.llmResult.finishReason).toBe('stop');
    });
  });
});

describe('StepRunner', () => {
  let turn: Turn;
  let mockLlmCaller: {
    call: ReturnType<typeof vi.fn>;
  };
  let mockToolExecutor: {
    execute: ReturnType<typeof vi.fn>;
  };
  let mockEffectiveConfigLoader: {
    load: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    const event = createAgentEvent('user.input', 'Hello!');
    turn = createTurn(agentInstance, event);
    turn.messages.push({ role: 'user', content: 'Hello!' });

    mockLlmCaller = {
      call: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Hi there!' },
        finishReason: 'stop',
      } as LlmResult),
    };

    mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: 'call_001',
        toolName: 'test.tool',
        output: { result: 'success' },
      } as ToolResult),
    };

    mockEffectiveConfigLoader = {
      load: vi.fn().mockResolvedValue({
        swarm: { metadata: { name: 'test-swarm' }, spec: {} },
        agent: { metadata: { name: 'planner' }, spec: {} },
        model: { metadata: { name: 'gpt-5' }, spec: { provider: 'openai', name: 'gpt-5' } },
        tools: [],
        extensions: [],
        systemPrompt: 'You are a helpful assistant.',
        revision: 1,
      } as EffectiveConfig),
    };
  });

  describe('createStepRunner', () => {
    it('StepRunner 인스턴스를 생성해야 한다', () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      expect(runner).toBeDefined();
      expect(typeof runner.run).toBe('function');
    });
  });

  describe('run', () => {
    it('Step을 실행하고 완료해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(step.completedAt).toBeInstanceOf(Date);
      expect(step.effectiveConfig).toBeDefined();
      expect(step.llmResult).toBeDefined();
    });

    it('Effective Config를 로드해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(mockEffectiveConfigLoader.load).toHaveBeenCalled();
      expect(step.effectiveConfig.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('LLM을 호출해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      expect(mockLlmCaller.call).toHaveBeenCalled();
    });

    it('LLM 응답을 Turn.messages에 추가해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const lastMessage = turn.messages[turn.messages.length - 1];
      expect(lastMessage.role).toBe('assistant');
      expect(lastMessage.content).toBe('Hi there!');
    });

    it('Tool call이 있으면 Tool을 실행해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'test.tool', input: { x: 1 } }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(mockToolExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'call_001', name: 'test.tool' }),
        expect.anything()
      );
      expect(step.toolCalls.length).toBe(1);
      expect(step.toolResults.length).toBe(1);
    });

    it('Tool 결과를 Turn.messages에 추가해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'test.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const toolMessages = turn.messages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(1);
    });

    it('Tool 실행 에러를 ToolResult로 변환해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'failing.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue(new Error('Tool execution failed'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      // Tool 에러는 ToolResult로 변환되어야 하고, Step은 완료되어야 함
      expect(step.status).toBe('completed');
      expect(step.toolResults[0].error).toBeDefined();
      expect(step.toolResults[0].error?.error.message).toContain('Tool execution failed');
    });

    it('LLM 호출 에러 시 Step을 실패 처리해야 한다', async () => {
      mockLlmCaller.call.mockRejectedValue(new Error('LLM API error'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await expect(runner.run(turn)).rejects.toThrow('LLM API error');
    });
  });
});

describe('StepContext', () => {
  it('Step 실행에 필요한 컨텍스트 정보를 포함해야 한다', () => {
    const swarmInstance = createSwarmInstance(
      'Swarm/test-swarm',
      'instance-key',
      'bundle-ref'
    );
    const agentInstance = createAgentInstance(swarmInstance, 'Agent/planner');
    const event = createAgentEvent('user.input', 'Hello!');
    const turn = createTurn(agentInstance, event);
    const step = createStep(turn, 0, 'bundle-ref');

    const mockConfig = {
      systemPrompt: 'Test',
    } as EffectiveConfig;

    const context: StepContext = {
      turn,
      step,
      effectiveConfig: mockConfig,
      toolCatalog: [],
      blocks: [],
    };

    expect(context.turn).toBe(turn);
    expect(context.step).toBe(step);
    expect(context.effectiveConfig).toBe(mockConfig);
    expect(context.toolCatalog).toEqual([]);
    expect(context.blocks).toEqual([]);
  });
});
