import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { ConfigRegistry } from '../src/config/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { LiveConfigManager } from '../src/live-config/manager.js';
import { AgentInstance } from '../src/runtime/agent-instance.js';
import type { LlmAdapter } from '../src/runtime/runtime.js';
import type { AgentSpec, JsonObject, Resource, ToolHandler, ToolSpec } from '../src/sdk/types.js';

const apiVersion = 'agents.example.io/v1alpha1';

type ToolExportFixture = {
  name: string;
  handler: ToolHandler;
  toolResource?: Resource<ToolSpec>;
};

describe('runtime message loop', () => {
  it('appends assistant/tool messages and logs jsonl', async () => {
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'goondan-runtime-msg-'));
    const toolResource: Resource<ToolSpec> = {
      apiVersion,
      kind: 'Tool',
      metadata: { name: 'echoTool' },
      spec: {
        entry: './noop',
        exports: [{ name: 'tool.echo' }],
      },
    };

    let llmCalls = 0;
    const llmAdapter: LlmAdapter = async (input) => {
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          content: 'call tool',
          toolCalls: [{ id: 'call-1', name: 'tool.echo', input: { text: 'hi' } }],
        };
      }
      const toolMessage = findMessageByRole(input.blocks, 'tool');
      expect(toolMessage).toBe(true);
      return { content: 'done', toolCalls: [] };
    };

    const { instance } = await createAgentInstance({
      stateDir: tempDir,
      agentSpec: { modelConfig: { modelRef: { kind: 'Model', name: 'test-model' } } },
      llmAdapter,
      toolExports: [
        {
          name: 'tool.echo',
          toolResource,
          handler: (_ctx, input) => ({ status: 'ok', input }),
        },
      ],
    });

    const turn = await instance.runTurn({ input: 'hello', origin: {}, auth: {}, metadata: {} });

    expect(turn.messages.map((msg) => msg.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    const logPath = path.join(tempDir, 'test-instance', 'agents', 'agent', 'messages', 'llm.jsonl');
    const log = await fs.readFile(logPath, 'utf8');
    const lines = log.split('\n').filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(turn.messages.length);
  });
});

function findMessageByRole(blocks: Array<{ type: string; items?: unknown[] }>, role: string): boolean {
  const block = blocks.find((item) => item.type === 'messages');
  if (!block || !Array.isArray(block.items)) return false;
  return block.items.some((item) => isRecord(item) && item.role === role);
}

async function createAgentInstance({
  agentSpec,
  toolExports = [],
  llmAdapter,
  stateDir,
}: {
  agentSpec: AgentSpec;
  toolExports?: ToolExportFixture[];
  llmAdapter: LlmAdapter;
  stateDir: string;
}) {
  const swarm: Resource = {
    apiVersion,
    kind: 'Swarm',
    metadata: { name: 'default' },
    spec: {
      entrypoint: { kind: 'Agent', name: 'agent' },
      agents: [{ kind: 'Agent', name: 'agent' }],
    },
  };

  const agent: Resource = {
    apiVersion,
    kind: 'Agent',
    metadata: { name: 'agent' },
    spec: agentSpec,
  };

  const model: Resource = {
    apiVersion,
    kind: 'Model',
    metadata: { name: 'test-model' },
    spec: { provider: 'openai', name: 'gpt-5' },
  };

  const toolResources = toolExports
    .map((tool) => tool.toolResource)
    .filter((resource): resource is Resource<ToolSpec> => Boolean(resource));

  const registry = new ConfigRegistry([swarm, agent, model, ...toolResources]);
  const toolRegistry = new ToolRegistry({ registry, baseDir: process.cwd(), logger: console });

  for (const tool of toolExports) {
    toolRegistry.exports.set(tool.name, {
      tool: tool.toolResource || null,
      definition: { name: tool.name },
      handler: tool.handler,
    });
  }

  const liveConfigManager = new LiveConfigManager({
    instanceId: 'test-instance',
    swarmConfig: swarm,
    registry,
    stateDir,
    logger: console,
  });

  await liveConfigManager.initAgent('agent', agent);

  const runtime = createRuntimeStub(llmAdapter, stateDir);
  const instance = new AgentInstance({
    name: 'agent',
    instanceId: 'test-instance',
    instanceKey: 'test-key',
    agentConfig: agent,
    swarmConfig: swarm,
    registry,
    toolRegistry,
    liveConfigManager,
    runtime,
    logger: console,
  });

  await instance.init();

  return { instance };
}

function createRuntimeStub(llmAdapter: LlmAdapter, stateDir: string): AgentInstance['runtime'] {
  return {
    llm: llmAdapter,
    emitProgress: async () => {},
    emitFinal: async () => {},
    stateDir,
    oauth: {
      withContext: () => ({
        getAccessToken: async () => ({ status: 'error', error: { code: 'authUnavailable', message: 'auth not configured' } }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
