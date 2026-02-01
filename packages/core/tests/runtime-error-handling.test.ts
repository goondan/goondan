import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { ConfigRegistry } from '../src/config/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { LiveConfigManager } from '../src/live-config/manager.js';
import { AgentInstance } from '../src/runtime/agent-instance.js';
import type { AgentSpec, JsonObject, Resource, StepContext, ToolHandler, ToolSpec } from '../src/sdk/types.js';

const apiVersion = 'agents.example.io/v1alpha1';

type ToolExportFixture = {
  name: string;
  handler: ToolHandler;
  toolResource?: Resource<ToolSpec>;
};

function createRuntimeStub(llmAdapter?: (input: unknown) => Promise<unknown>) {
  return {
    llm: llmAdapter || (async () => ({ content: '', toolCalls: [] })),
    emitProgress: async () => {},
    emitFinal: async () => {},
    oauth: {
      withContext: () => ({
        getAccessToken: async () => ({ status: 'error', error: { message: 'auth not configured' } }),
      }),
    },
    mcpManager: {
      hasTool: () => false,
      executeTool: async () => {
        throw new Error('mcp tool not available');
      },
      getToolsForAgent: () => [],
      syncForAgent: async () => {},
    },
    events: new EventEmitter(),
    unregisterDynamicTools: () => {},
    registerDynamicTool: () => {},
  };
}

async function createAgentInstance({
  agentSpec,
  toolExports = [],
  llmAdapter,
}: {
  agentSpec: AgentSpec;
  toolExports?: ToolExportFixture[];
  llmAdapter?: (input: unknown) => Promise<unknown>;
}) {
  const swarm = {
    apiVersion,
    kind: 'Swarm',
    metadata: { name: 'default' },
    spec: {
      entrypoint: { kind: 'Agent', name: 'agent' },
      agents: [{ kind: 'Agent', name: 'agent' }],
    },
  };

  const agent = {
    apiVersion,
    kind: 'Agent',
    metadata: { name: 'agent' },
    spec: agentSpec,
  };

  const model = {
    apiVersion,
    kind: 'Model',
    metadata: { name: 'test-model' },
    spec: { provider: 'openai', name: 'gpt-5' },
  };

  const toolResources = toolExports.map((tool) => tool.toolResource).filter(Boolean) as Resource<ToolSpec>[];
  const registry = new ConfigRegistry([swarm, agent, model, ...toolResources]);
  const toolRegistry = new ToolRegistry({ registry, baseDir: process.cwd(), logger: console });

  for (const tool of toolExports) {
    toolRegistry.exports.set(tool.name, {
      tool: tool.toolResource || null,
      definition: { name: tool.name },
      handler: tool.handler,
    });
  }

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'goondan-runtime-test-'));
  const liveConfigManager = new LiveConfigManager({
    instanceId: 'test-instance',
    swarmConfig: swarm,
    registry,
    stateDir: tempDir,
    logger: console,
  });

  await liveConfigManager.initAgent('agent', agent);

  const runtime = createRuntimeStub(llmAdapter);
  const instance = new AgentInstance({
    name: 'agent',
    instanceId: 'test-instance',
    instanceKey: 'test-key',
    agentConfig: agent,
    swarmConfig: swarm,
    registry,
    toolRegistry,
    liveConfigManager,
    runtime: runtime as unknown as AgentInstance['runtime'],
    logger: console,
  });

  await instance.init();

  return { instance, agent, swarm };
}

function createStepContext(instance: AgentInstance, agent: JsonObject, swarm: JsonObject): StepContext {
  return {
    instance,
    swarm,
    agent,
    turn: {
      id: 'turn-1',
      input: '',
      origin: {},
      auth: {},
      summary: null,
      toolResults: [],
      metadata: {},
    },
    step: {
      id: 'step-1',
      index: 0,
      toolCalls: [],
      toolResults: [],
      llmResult: null,
    },
    toolCatalog: [],
    blocks: [],
  } as StepContext;
}

describe('runtime error handling', () => {
  it('applies default tool error message limit', async () => {
    const toolResource = {
      apiVersion,
      kind: 'Tool',
      metadata: { name: 'errorToolDefault' },
      spec: {
        entry: './noop',
        exports: [{ name: 'tool.failDefault' }],
      },
    };

    const longMessage = 'a'.repeat(1200);
    const { instance, agent, swarm } = await createAgentInstance({
      agentSpec: { modelConfig: { modelRef: { kind: 'Model', name: 'test-model' } } },
      toolExports: [
        {
          name: 'tool.failDefault',
          toolResource,
          handler: () => {
            throw new Error(longMessage);
          },
        },
      ],
    });

    const ctx = createStepContext(instance, agent, swarm);
    const result = await instance.executeToolCall({ name: 'tool.failDefault', input: {} }, ctx);
    const output = result.output as { status?: string; error?: { message?: string } };

    expect(output.status).toBe('error');
    expect(output.error?.message?.length).toBe(1000);
  });

  it('uses per-tool errorMessageLimit override', async () => {
    const toolResource = {
      apiVersion,
      kind: 'Tool',
      metadata: { name: 'errorToolCustom' },
      spec: {
        entry: './noop',
        errorMessageLimit: 5,
        exports: [{ name: 'tool.failCustom' }],
      },
    };

    const { instance, agent, swarm } = await createAgentInstance({
      agentSpec: { modelConfig: { modelRef: { kind: 'Model', name: 'test-model' } } },
      toolExports: [
        {
          name: 'tool.failCustom',
          toolResource,
          handler: () => {
            throw new Error('too long message');
          },
        },
      ],
    });

    const ctx = createStepContext(instance, agent, swarm);
    const result = await instance.executeToolCall({ name: 'tool.failCustom', input: {} }, ctx);
    const output = result.output as { status?: string; error?: { message?: string } };

    expect(output.status).toBe('error');
    expect(output.error?.message?.length).toBe(5);
  });

  it('runs step.llmError hook on LLM failure and retries', async () => {
    let hookInput: JsonObject | null = null;
    let llmCalls = 0;

    const llmAdapter = async () => {
      llmCalls += 1;
      if (llmCalls === 1) {
        throw new Error('boom');
      }
      return { content: 'ok', toolCalls: [] };
    };

    const toolResource = {
      apiVersion,
      kind: 'Tool',
      metadata: { name: 'hookTools' },
      spec: {
        entry: './noop',
        exports: [{ name: 'hook.onLlmError' }],
      },
    };

    const { instance } = await createAgentInstance({
      agentSpec: {
        modelConfig: { modelRef: { kind: 'Model', name: 'test-model' } },
        hooks: [
          {
            point: 'step.llmError',
            action: {
              toolCall: {
                tool: 'hook.onLlmError',
                input: { message: { expr: '$.llmError.message' } },
              },
            },
          },
        ],
      },
      toolExports: [
        {
          name: 'hook.onLlmError',
          toolResource,
          handler: (_ctx, input) => {
            hookInput = input;
            return { status: 'ok' };
          },
        },
      ],
      llmAdapter,
    });

    const turn = await instance.runTurn({ input: 'hello', origin: {}, auth: {}, metadata: {} });

    expect(hookInput?.message).toBe('boom');
    expect(turn.summary).toBe('ok');
    expect(llmCalls).toBe(2);
  });
});
