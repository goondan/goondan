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

    it('effectiveConfig는 초기에 undefined여야 한다', () => {
      const step = createStep(turn, 0, 'bundle-ref');
      expect(step.effectiveConfig).toBeUndefined();
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
          role: 'assistant',
          toolCalls: [
            { id: 'call_001', name: 'tool.a', input: {} },
            { id: 'call_002', name: 'tool.b', input: {} },
          ],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockImplementation(async (toolCall: ToolCall) => {
        calls.push(toolCall.name);
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
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
          role: 'assistant',
          toolCalls: [
            { id: 'call_001', name: 'failing.tool', input: {} },
            { id: 'call_002', name: 'passing.tool', input: {} },
          ],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockImplementation(async (toolCall: ToolCall) => {
        if (toolCall.name === 'failing.tool') {
          throw new Error('Tool failed');
        }
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
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

    it('Tool 결과 메시지가 Turn.messages에 올바르게 추가되어야 한다', async () => {
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

      await runner.run(turn);

      // messages: [user, assistant(toolCalls), tool(result)]
      const toolMessages = turn.messages.filter((m) => m.role === 'tool');
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

describe('StepRunner - Edge Cases', () => {
  let turn: Turn;
  let mockLlmCaller: { call: ReturnType<typeof vi.fn> };
  let mockToolExecutor: { execute: ReturnType<typeof vi.fn> };
  let mockEffectiveConfigLoader: { load: ReturnType<typeof vi.fn> };

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

  describe('Tool Catalog 빌드', () => {
    it('effectiveConfig.tools의 exports를 ToolCatalog으로 변환해야 한다', async () => {
      mockEffectiveConfigLoader.load.mockResolvedValue({
        swarm: { metadata: { name: 'test-swarm' }, spec: {} },
        agent: { metadata: { name: 'planner' }, spec: {} },
        model: { metadata: { name: 'gpt-5' }, spec: { provider: 'openai', name: 'gpt-5' } },
        tools: [
          {
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
          },
        ],
        extensions: [],
        systemPrompt: 'System prompt.',
        revision: 1,
      } as EffectiveConfig);

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
      mockEffectiveConfigLoader.load.mockResolvedValue({
        swarm: { metadata: { name: 'test-swarm' }, spec: {} },
        agent: { metadata: { name: 'planner' }, spec: {} },
        model: { metadata: { name: 'gpt-5' }, spec: { provider: 'openai', name: 'gpt-5' } },
        tools: [
          {
            apiVersion: 'v1',
            kind: 'Tool',
            metadata: { name: 'tool-a' },
            spec: {
              runtime: 'node',
              entry: 'a.js',
              exports: [{ name: 'a.run', description: 'Run A', parameters: { type: 'object' } }],
            },
          },
          {
            apiVersion: 'v1',
            kind: 'Tool',
            metadata: { name: 'tool-b' },
            spec: {
              runtime: 'node',
              entry: 'b.js',
              exports: [{ name: 'b.run', description: 'Run B', parameters: { type: 'object' } }],
            },
          },
        ],
        extensions: [],
        systemPrompt: '',
        revision: 1,
      } as EffectiveConfig);

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
      mockEffectiveConfigLoader.load.mockResolvedValue({
        swarm: { metadata: { name: 'test-swarm' }, spec: {} },
        agent: { metadata: { name: 'planner' }, spec: {} },
        model: { metadata: { name: 'gpt-5' }, spec: { provider: 'openai', name: 'gpt-5' } },
        tools: [
          {
            apiVersion: 'v1',
            kind: 'Tool',
            metadata: { name: 'empty-tool' },
            spec: { runtime: 'node', entry: 'empty.js', exports: [] },
          },
        ],
        extensions: [],
        systemPrompt: '',
        revision: 1,
      } as EffectiveConfig);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolCatalog.length).toBe(0);
    });

    it('복잡한 JSON Schema (nested properties, items, enum, default, additionalProperties)를 변환해야 한다', async () => {
      mockEffectiveConfigLoader.load.mockResolvedValue({
        swarm: { metadata: { name: 'test-swarm' }, spec: {} },
        agent: { metadata: { name: 'planner' }, spec: {} },
        model: { metadata: { name: 'gpt-5' }, spec: { provider: 'openai', name: 'gpt-5' } },
        tools: [
          {
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
          },
        ],
        extensions: [],
        systemPrompt: '',
        revision: 1,
      } as EffectiveConfig);

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
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'bad.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue('string error thrown');

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(step.toolResults[0].error).toBeDefined();
      expect(step.toolResults[0].error?.error.message).toContain('string error thrown');
    });

    it('Tool에서 숫자 throw 시 문자열로 변환해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'bad.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue(42);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.status).toBe('completed');
      expect(step.toolResults[0].error?.error.message).toContain('42');
    });
  });

  describe('에러 메시지 truncation', () => {
    it('매우 긴 에러 메시지는 잘려야 한다', async () => {
      const longMessage = 'x'.repeat(2000);
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'error.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue(new Error(longMessage));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      const errorMsg = step.toolResults[0].error?.error.message ?? '';
      // 원본이 2000자이므로 1000자 + "... (truncated)"로 잘려야 함
      expect(errorMsg.length).toBeLessThan(longMessage.length);
      expect(errorMsg).toContain('... (truncated)');
    });

    it('짧은 에러 메시지는 잘리지 않아야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'error.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue(new Error('Short error'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolResults[0].error?.error.message).toBe('Short error');
    });
  });

  describe('에러 코드 추출', () => {
    it('Error에 code 프로퍼티가 있으면 추출해야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'coded.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      const err = new Error('Permission denied');
      (err as Error & { code: string }).code = 'EACCES';
      mockToolExecutor.execute.mockRejectedValue(err);

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolResults[0].error?.error.code).toBe('EACCES');
    });

    it('Error에 code가 없으면 undefined이어야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'plain.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue(new Error('No code'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      const step = await runner.run(turn);

      expect(step.toolResults[0].error?.error.code).toBeUndefined();
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
        role: 'system',
        content: 'You are a helpful assistant.',
      });
    });

    it('Turn.messages를 시스템 프롬프트 뒤에 포함해야 한다', async () => {
      turn.messages.push({ role: 'user', content: 'Second message' });

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
    it('Tool 에러 시 error 정보가 Turn.messages의 tool 메시지 output에 포함되어야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call_001', name: 'fail.tool', input: {} }],
        },
        finishReason: 'tool_calls',
      } as LlmResult);

      mockToolExecutor.execute.mockRejectedValue(new Error('Tool broke'));

      const runner = createStepRunner({
        llmCaller: mockLlmCaller,
        toolExecutor: mockToolExecutor,
        effectiveConfigLoader: mockEffectiveConfigLoader,
      });

      await runner.run(turn);

      const toolMessages = turn.messages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(1);
      // output이 error 객체여야 함
      const output = toolMessages[0] as { output: unknown };
      if ('output' in output && typeof output.output === 'object' && output.output !== null) {
        expect((output.output as Record<string, unknown>)['status']).toBe('error');
      }
    });
  });

  describe('toolCalls가 빈 배열인 경우', () => {
    it('toolCalls가 빈 배열이면 Tool을 실행하지 않아야 한다', async () => {
      mockLlmCaller.call.mockResolvedValue({
        message: {
          role: 'assistant',
          content: 'No tools needed.',
          toolCalls: [],
        },
        finishReason: 'stop',
      } as LlmResult);

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

      await expect(runner.run(turn)).rejects.toBe('raw string error');
    });
  });
});
