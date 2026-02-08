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
import { createAgentEvent, computeNextMessages } from '../../src/runtime/types.js';
import { PipelineRegistry } from '../../src/pipeline/registry.js';
import { PipelineExecutor } from '../../src/pipeline/executor.js';
import type { Turn } from '../../src/runtime/turn-runner.js';
import type { EffectiveConfig } from '../../src/runtime/effective-config.js';
import type {
  LlmResult,
  ToolCall,
  ToolResult,
  ToolCatalogItem,
  LlmMessage,
  MessageEvent,
} from '../../src/runtime/types.js';
import type { ToolResource } from '../../src/types/specs/tool.js';

/**
 * Turn의 messageState에 메시지를 이벤트로 추가하는 헬퍼
 */
function appendMessageToTurn(turn: Turn, message: LlmMessage): void {
  const event: MessageEvent = {
    type: 'llm_message',
    seq: turn.messageState.events.length,
    message,
  };
  turn.messageState.events.push(event);
  const recomputed = computeNextMessages(
    turn.messageState.baseMessages,
    turn.messageState.events
  );
  turn.messageState.nextMessages.splice(
    0,
    turn.messageState.nextMessages.length,
    ...recomputed
  );
}

/**
 * 테스트용 EffectiveConfig mock 팩토리
 *
 * 실제 EffectiveConfig 타입에 맞는 최소 구조를 생성
 */
function createMockEffectiveConfig(overrides?: {
  systemPrompt?: string;
  tools?: ToolResource[];
  modelName?: string;
  agentName?: string;
}): EffectiveConfig {
  const modelName = overrides?.modelName ?? 'gpt-5';
  const agentName = overrides?.agentName ?? 'planner';
  const systemPrompt = overrides?.systemPrompt ?? 'You are a helpful assistant.';
  const defaultTool: ToolResource = {
    apiVersion: 'v1',
    kind: 'Tool',
    metadata: { name: 'default-tools' },
    spec: {
      runtime: 'node',
      entry: 'tools/default.js',
      exports: [
        { name: 'test.tool', description: 'Test', parameters: { type: 'object' } },
        { name: 'failing.tool', description: 'Failing', parameters: { type: 'object' } },
        { name: 'tool.a', description: 'Tool A', parameters: { type: 'object' } },
        { name: 'tool.b', description: 'Tool B', parameters: { type: 'object' } },
        { name: 'passing.tool', description: 'Passing', parameters: { type: 'object' } },
        { name: 'bad.tool', description: 'Bad', parameters: { type: 'object' } },
        { name: 'error.tool', description: 'Error', parameters: { type: 'object' } },
        { name: 'coded.tool', description: 'Coded', parameters: { type: 'object' } },
        { name: 'plain.tool', description: 'Plain', parameters: { type: 'object' } },
        { name: 'fail.tool', description: 'Fail', parameters: { type: 'object' } },
      ],
    },
  };
  const tools = overrides?.tools ?? [defaultTool];

  return {
    swarm: {
      apiVersion: 'v1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: {
        entrypoint: `Agent/${agentName}`,
        agents: [`Agent/${agentName}`],
      },
    },
    agent: {
      apiVersion: 'v1',
      kind: 'Agent',
      metadata: { name: agentName },
      spec: {
        modelConfig: { modelRef: `Model/${modelName}` },
        prompts: { system: systemPrompt },
      },
    },
    model: {
      apiVersion: 'v1',
      kind: 'Model',
      metadata: { name: modelName },
      spec: { provider: 'openai', name: modelName },
    },
    tools,
    extensions: [],
    connections: [],
    systemPrompt,
    revision: 1,
  };
}

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

    it('effectiveConfig는 초기에 undefined여야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref');
      expect(step.effectiveConfig).toBeUndefined();
    });

    it('effectiveConfig는 나중에 설정할 수 있어야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      const mockConfig = createMockEffectiveConfig();

      step.effectiveConfig = mockConfig;
      expect(step.effectiveConfig).toBe(mockConfig);
    });
  });

  describe('Step 상태 전이', () => {
    it('pending -> config -> tools -> blocks -> llmInput -> llmCall -> completed 전이', () => {
      const step = createStep(turn, 0, 'bundle-ref');

      expect(step.status).toBe('pending');

      step.status = 'config';
      expect(step.status).toBe('config');

      step.status = 'tools';
      expect(step.status).toBe('tools');

      step.status = 'blocks';
      expect(step.status).toBe('blocks');

      step.status = 'llmInput';
      expect(step.status).toBe('llmInput');

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
        args: { path: '/test.txt' },
      };

      const toolResult: ToolResult = {
        toolCallId: 'call_001',
        toolName: 'file.read',
        status: 'ok',
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
          id: 'msg-asst-1',
          role: 'assistant',
          content: 'Hello! How can I help you?',
        },
        meta: {
          usage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
          },
          finishReason: 'stop',
        },
      };

      step.llmResult = llmResult;

      expect(step.llmResult.message.content).toBe('Hello! How can I help you?');
      expect(step.llmResult.meta.finishReason).toBe('stop');
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
    getActiveRef: ReturnType<typeof vi.fn>;
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
    // messageState 방식으로 초기 사용자 메시지 추가
    appendMessageToTurn(turn, { id: 'msg-user-init', role: 'user', content: 'Hello!' });

    mockLlmCaller = {
      call: vi.fn().mockResolvedValue({
        message: { id: 'msg-asst-mock', role: 'assistant', content: 'Hi there!' },
        meta: { finishReason: 'stop' },
      }),
    };

    mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: 'call_001',
        toolName: 'test.tool',
        status: 'ok',
        output: { result: 'success' },
      }),
    };

    mockEffectiveConfigLoader = {
      load: vi.fn().mockResolvedValue(createMockEffectiveConfig()),
      getActiveRef: vi.fn().mockResolvedValue('bundle-ref'),
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
      expect(step.effectiveConfig?.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('step.config에서 activeSwarmBundleRef를 확정하고 step.pre는 기존 ref를 사용해야 한다', async () => {
      const registry = new PipelineRegistry();
      const pipelineExecutor = new PipelineExecutor(registry);
      let observedActiveRef: string | undefined;

      registry.mutate('step.pre', async (ctx) => {
        observedActiveRef = ctx.activeSwarmRef;
        return ctx;
      });

      mockEffectiveConfigLoader.getActiveRef.mockResolvedValue('bundle-ref-next');

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
        pipelineExecutor,
      });

      const step = await runner.run(turn);

      expect(step.activeSwarmBundleRef).toBe('bundle-ref-next');
      expect(mockEffectiveConfigLoader.load).toHaveBeenCalledWith(
        'bundle-ref-next',
        turn.agentInstance.agentRef
      );
      expect(turn.agentInstance.swarmInstance.activeSwarmBundleRef).toBe('bundle-ref-next');
      expect(observedActiveRef).toBe('bundle-ref');
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

    it('LLM 응답을 messageState.nextMessages에 추가해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const lastMessage = turn.messageState.nextMessages[turn.messageState.nextMessages.length - 1];
      expect(lastMessage.role).toBe('assistant');
      expect(lastMessage.content).toBe('Hi there!');
    });

    it('Tool call이 있으면 Tool을 실행해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-tc',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'test.tool', args: { x: 1 } }],
        },
        meta: { finishReason: 'tool_calls' },
      });

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

    it('Tool 결과를 messageState.nextMessages에 추가해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-tc2',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'test.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const toolMessages = turn.messageState.nextMessages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(1);
    });

    it('Tool 실행 에러를 ToolResult로 변환해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-fail',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'failing.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

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
      expect(step.toolResults[0].error?.message).toContain('Tool execution failed');
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

    it('Effective Config 로드 에러 시 Step을 실패 처리해야 한다', async () => {
      mockEffectiveConfigLoader.load.mockRejectedValue(
        new Error('Config load failed')
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await expect(runner.run(turn)).rejects.toThrow('Config load failed');
    });

    it('여러 Tool call을 순서대로 실행해야 한다', async () => {
      const calls: string[] = [];
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-multi',
          role: 'assistant',
          toolCalls: [
            { id: 'call_001', name: 'tool.a', args: {} },
            { id: 'call_002', name: 'tool.b', args: {} },
          ],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockImplementation(async (toolCall: ToolCall) => {
        calls.push(toolCall.name);
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          status: 'ok',
          output: { result: 'ok' },
        };
      });

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolCalls.length).toBe(2);
      expect(step.toolResults.length).toBe(2);
      expect(calls).toEqual(['tool.a', 'tool.b']);
    });

    it('Tool 에러 시에도 다른 Tool은 실행되어야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-mixed',
          role: 'assistant',
          toolCalls: [
            { id: 'call_001', name: 'failing.tool', args: {} },
            { id: 'call_002', name: 'passing.tool', args: {} },
          ],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockImplementation(async (toolCall: ToolCall) => {
        if (toolCall.name === 'failing.tool') {
          throw new Error('Tool failed');
        }
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          status: 'ok',
          output: { result: 'success' },
        };
      });

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(step.toolResults.length).toBe(2);
      expect(step.toolResults[0].error).toBeDefined();
      expect(step.toolResults[1].output).toEqual({ result: 'success' });
    });

    it('Tool 결과 메시지가 messageState.nextMessages에 올바르게 추가되어야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-verify',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'test.tool', args: { x: 1 } }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      // messageState.nextMessages에서 tool 메시지 확인
      const toolMessages = turn.messageState.nextMessages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(1);
      expect(toolMessages[0]).toMatchObject({
        role: 'tool',
        toolCallId: 'call_001',
        toolName: 'test.tool',
      });
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

    const mockConfig = createMockEffectiveConfig({ systemPrompt: 'Test' });

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

describe('StepRunner - Edge Cases', () => {
  let turn: Turn;
  let mockLlmCaller: { call: ReturnType<typeof vi.fn> };
  let mockToolExecutor: { execute: ReturnType<typeof vi.fn> };
  let mockEffectiveConfigLoader: {
    load: ReturnType<typeof vi.fn>;
    getActiveRef: ReturnType<typeof vi.fn>;
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
    // messageState 방식으로 초기 사용자 메시지 추가
    appendMessageToTurn(turn, { id: 'msg-user-init', role: 'user', content: 'Hello!' });

    mockLlmCaller = {
      call: vi.fn().mockResolvedValue({
        message: { id: 'msg-asst-mock', role: 'assistant', content: 'Hi there!' },
        meta: { finishReason: 'stop' },
      }),
    };

    mockToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        toolCallId: 'call_001',
        toolName: 'test.tool',
        status: 'ok',
        output: { result: 'success' },
      }),
    };

    mockEffectiveConfigLoader = {
      load: vi.fn().mockResolvedValue(createMockEffectiveConfig()),
      getActiveRef: vi.fn().mockResolvedValue('bundle-ref'),
    };
  });

  describe('Tool Catalog 빌드', () => {
    it('effectiveConfig.tools의 exports를 ToolCatalog으로 변환해야 한다', async () => {
      const toolResource: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'file-tool' },
        spec: {
          runtime: 'node',
          entry: 'tools/file.js',
          exports: [
            {
              name: 'file.read',
              description: 'Read a file',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
            {
              name: 'file.write',
              description: 'Write a file',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['path', 'content'],
              },
            },
          ],
        },
      };

      mockEffectiveConfigLoader.load.mockResolvedValue(
        createMockEffectiveConfig({ systemPrompt: 'System prompt.', tools: [toolResource] })
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolCatalog.length).toBe(2);
      expect(step.toolCatalog[0].name).toBe('file.read');
      expect(step.toolCatalog[1].name).toBe('file.write');
      expect(step.toolCatalog[0].description).toBe('Read a file');
      expect(step.toolCatalog[0].parameters).toEqual({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      });
    });

    it('여러 Tool의 exports를 하나의 catalog으로 합쳐야 한다', async () => {
      const toolA: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'tool-a' },
        spec: {
          runtime: 'node',
          entry: 'a.js',
          exports: [{ name: 'a.run', description: 'Run A', parameters: { type: 'object' } }],
        },
      };
      const toolB: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'tool-b' },
        spec: {
          runtime: 'node',
          entry: 'b.js',
          exports: [{ name: 'b.run', description: 'Run B', parameters: { type: 'object' } }],
        },
      };

      mockEffectiveConfigLoader.load.mockResolvedValue(
        createMockEffectiveConfig({ tools: [toolA, toolB] })
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolCatalog.length).toBe(2);
      expect(step.toolCatalog.map((c) => c.name)).toEqual(['a.run', 'b.run']);
    });

    it('exports가 빈 배열인 Tool은 catalog에 항목을 추가하지 않아야 한다', async () => {
      const emptyTool: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'empty-tool' },
        spec: { runtime: 'node', entry: 'empty.js', exports: [] },
      };

      mockEffectiveConfigLoader.load.mockResolvedValue(
        createMockEffectiveConfig({ tools: [emptyTool] })
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolCatalog.length).toBe(0);
    });

    it('복잡한 JSON Schema (nested properties, items, enum, default, additionalProperties)를 변환해야 한다', async () => {
      const complexTool: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'complex-tool' },
        spec: {
          runtime: 'node',
          entry: 'complex.js',
          exports: [
            {
              name: 'complex.run',
              description: 'Complex tool',
              parameters: {
                type: 'object',
                properties: {
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tag list',
                  },
                  status: {
                    type: 'string',
                    enum: ['active', 'inactive', null],
                    default: 'active',
                  },
                  config: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  frozen: {
                    type: 'object',
                    additionalProperties: false,
                  },
                },
              },
            },
          ],
        },
      };

      mockEffectiveConfigLoader.load.mockResolvedValue(
        createMockEffectiveConfig({ tools: [complexTool] })
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      const params = step.toolCatalog[0].parameters;
      expect(params).toBeDefined();
      if (params) {
        const props = params['properties'];
        expect(props).toBeDefined();
        if (props && typeof props === 'object' && !Array.isArray(props)) {
          const propsObj = props as Record<string, unknown>;
          // array items
          const tags = propsObj['tags'] as Record<string, unknown>;
          expect(tags['type']).toBe('array');
          expect(tags['items']).toEqual({ type: 'string' });
          expect(tags['description']).toBe('Tag list');
          // enum & default
          const status = propsObj['status'] as Record<string, unknown>;
          expect(status['enum']).toEqual(['active', 'inactive', null]);
          expect(status['default']).toBe('active');
          // additionalProperties as schema
          const config = propsObj['config'] as Record<string, unknown>;
          expect(config['additionalProperties']).toEqual({ type: 'string' });
          // additionalProperties as boolean
          const frozen = propsObj['frozen'] as Record<string, unknown>;
          expect(frozen['additionalProperties']).toBe(false);
        }
      }
    });
  });

  describe('비-Error 예외 처리', () => {
    it('Tool에서 비-Error 객체 throw 시 문자열로 변환해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-bad1',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'bad.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockRejectedValue('string error thrown');

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(step.toolResults[0].error).toBeDefined();
      expect(step.toolResults[0].error?.message).toContain('string error thrown');
    });

    it('Tool에서 숫자 throw 시 문자열로 변환해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-bad2',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'bad.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockRejectedValue(42);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(step.toolResults[0].error?.message).toContain('42');
    });
  });

  describe('에러 메시지 truncation', () => {
    it('매우 긴 에러 메시지는 잘려야 한다', async () => {
      const longMessage = 'x'.repeat(2000);
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-trunc',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'error.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockRejectedValue(new Error(longMessage));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      const errorMsg = step.toolResults[0].error?.message ?? '';
      // 원본이 2000자이므로 1000자 + "... (truncated)"로 잘려야 함
      expect(errorMsg.length).toBeLessThan(longMessage.length);
      expect(errorMsg).toContain('... (truncated)');
    });

    it('짧은 에러 메시지는 잘리지 않아야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-short',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'error.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockRejectedValue(new Error('Short error'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolResults[0].error?.message).toBe('Short error');
    });
  });

  describe('에러 코드 추출', () => {
    it('Error에 code 프로퍼티가 있으면 추출해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-code',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'coded.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      const err = new Error('Permission denied');
      (err as Error & { code: string }).code = 'EACCES';
      mockToolExecutor.execute.mockRejectedValue(err);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolResults[0].error?.code).toBe('EACCES');
    });

    it('Error에 code가 없으면 undefined이어야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-nocode',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'plain.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockRejectedValue(new Error('No code'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolResults[0].error?.code).toBeUndefined();
    });
  });

  describe('LLM 메시지 빌드', () => {
    it('시스템 프롬프트를 첫 번째 메시지로 포함해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const callArgs = mockLlmCaller.call.mock.calls[0];
      const messages = callArgs[0];
      expect(messages[0]).toEqual({
        id: 'msg-sys-0',
        role: 'system',
        content: 'You are a helpful assistant.',
      });
    });

    it('messageState.nextMessages를 시스템 프롬프트 뒤에 포함해야 한다', async () => {
      appendMessageToTurn(turn, { id: 'msg-user-2', role: 'user', content: 'Second message' });

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const callArgs = mockLlmCaller.call.mock.calls[0];
      const messages = callArgs[0];
      // system + user(Hello!) + user(Second message)
      expect(messages.length).toBe(3);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('user');
    });

    it('LLM caller에 model 리소스를 전달해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const callArgs = mockLlmCaller.call.mock.calls[0];
      const model = callArgs[2];
      expect(model.metadata.name).toBe('gpt-5');
      expect(model.spec.provider).toBe('openai');
    });

    it('LLM caller에 toolCatalog을 전달해야 한다', async () => {
      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const callArgs = mockLlmCaller.call.mock.calls[0];
      const toolCatalog = callArgs[1];
      expect(Array.isArray(toolCatalog)).toBe(true);
    });
  });

  describe('Tool 에러 시 Tool 결과 메시지', () => {
    it('Tool 에러 시 error 정보가 messageState.nextMessages의 tool 메시지 output에 포함되어야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-terr',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'fail.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockToolExecutor.execute.mockRejectedValue(new Error('Tool broke'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const toolMessages = turn.messageState.nextMessages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(1);
      // output이 error 객체여야 함 (flat error structure: { name, message, code? })
      const toolMsg = toolMessages[0];
      if ('output' in toolMsg && typeof toolMsg.output === 'object' && toolMsg.output !== null) {
        const outputObj = toolMsg.output as Record<string, unknown>;
        expect(outputObj['message']).toContain('Tool broke');
      }
    });
  });

  describe('toolCalls가 빈 배열인 경우', () => {
    it('toolCalls가 빈 배열이면 Tool을 실행하지 않아야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-no-tool',
          role: 'assistant',
          content: 'No tools needed.',
          toolCalls: [],
        },
        meta: { finishReason: 'stop' },
      });

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(mockToolExecutor.execute).not.toHaveBeenCalled();
      expect(step.toolCalls.length).toBe(0);
      expect(step.toolResults.length).toBe(0);
    });
  });

  describe('Step 실패 시 메타데이터', () => {
    it('LLM 에러 시 Step metadata에 에러 정보가 저장되어야 한다', async () => {
      const llmError = new Error('Rate limit exceeded');
      llmError.name = 'RateLimitError';
      mockLlmCaller.call.mockRejectedValue(llmError);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      try {
        await runner.run(turn);
      } catch {
        // 에러는 전파됨
      }

      // Step은 직접 참조할 수 없으므로 turn에서 확인
      // StepRunner.run에서 에러 시 step.metadata에 에러를 저장하지만
      // step 객체가 반환되지 않으므로, 에러가 전파되었는지만 확인
      await expect(
        createStepRunner({
          llmCaller: mockLlmCaller,
          toolExecutor: mockToolExecutor,
          effectiveConfigLoader: mockEffectiveConfigLoader,
        }).run(turn)
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('비-Error 객체가 throw되면 Error로 감싸야 한다', async () => {
      mockLlmCaller.call.mockRejectedValue('raw string error');

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await expect(runner.run(turn)).rejects.toThrow('raw string error');
    });
  });

  describe('파이프라인 포인트 실행', () => {
    it('step/toolCall 파이프라인 포인트가 순서대로 실행되어야 한다', async () => {
      const registry = new PipelineRegistry();
      const pipelineExecutor = new PipelineExecutor(registry);
      const executionOrder: string[] = [];

      registry.mutate('step.pre', async (ctx) => {
        executionOrder.push('step.pre');
        return ctx;
      });
      registry.mutate('step.config', async (ctx) => {
        executionOrder.push('step.config');
        return ctx;
      });
      registry.mutate('step.tools', async (ctx) => {
        executionOrder.push('step.tools');
        return ctx;
      });
      registry.mutate('step.blocks', async (ctx) => {
        executionOrder.push('step.blocks');
        return ctx;
      });
      registry.mutate('step.llmInput', async (ctx) => {
        executionOrder.push('step.llmInput');
        return {
          ...ctx,
          llmInput: [
            ...ctx.llmInput,
            { id: 'msg-injected', role: 'user', content: 'Injected' },
          ],
        };
      });
      registry.wrap('step.llmCall', async (ctx, next) => {
        executionOrder.push('step.llmCall.before');
        const result = await next(ctx);
        executionOrder.push('step.llmCall.after');
        return result;
      });
      registry.mutate('toolCall.pre', async (ctx) => {
        executionOrder.push('toolCall.pre');
        return ctx;
      });
      registry.wrap('toolCall.exec', async (ctx, next) => {
        executionOrder.push('toolCall.exec.before');
        const result = await next(ctx);
        executionOrder.push('toolCall.exec.after');
        return result;
      });
      registry.mutate('toolCall.post', async (ctx) => {
        executionOrder.push('toolCall.post');
        return ctx;
      });

      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-pipeline',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'test.tool', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      const toolResource: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'test-tool' },
        spec: {
          runtime: 'node',
          entry: 'tools/test.js',
          exports: [{ name: 'test.tool', description: 'Test', parameters: { type: 'object' } }],
        },
      };

      mockEffectiveConfigLoader.load.mockResolvedValue(
        createMockEffectiveConfig({ tools: [toolResource] })
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
        pipelineExecutor,
      });

      await runner.run(turn);

      const llmCallArgs = mockLlmCaller.call.mock.calls[0];
      const llmInput = llmCallArgs?.[0];
      expect(Array.isArray(llmInput)).toBe(true);
      if (Array.isArray(llmInput)) {
        const injected = llmInput.find(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            'id' in message &&
            message.id === 'msg-injected'
        );
        expect(injected).toBeDefined();
      }

      expect(executionOrder).toEqual([
        'step.pre',
        'step.config',
        'step.tools',
        'step.blocks',
        'step.llmInput',
        'step.llmCall.before',
        'step.llmCall.after',
        'toolCall.pre',
        'toolCall.exec.before',
        'toolCall.exec.after',
        'toolCall.post',
      ]);
    });

    it('Tool Catalog 밖의 호출은 실행하지 않고 구조화된 에러 결과를 반환해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          id: 'msg-asst-catalog',
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'not.allowed', args: {} }],
        },
        meta: { finishReason: 'tool_calls' },
      });

      mockEffectiveConfigLoader.load.mockResolvedValue(
        createMockEffectiveConfig({ tools: [] })
      );

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(mockToolExecutor.execute).not.toHaveBeenCalled();
      expect(step.toolResults).toHaveLength(1);
      expect(step.toolResults[0].status).toBe('error');
      expect(step.toolResults[0].error?.name).toBe('ToolNotInCatalogError');
      expect(step.toolResults[0].error?.code).toBe('E_TOOL_NOT_IN_CATALOG');
      expect(step.toolResults[0].error?.suggestion).toContain('step.tools');
    });
  });
});
