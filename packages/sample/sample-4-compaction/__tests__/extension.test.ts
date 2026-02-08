/**
 * Compaction Extension Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEventBus,
  createStateStore,
  createExtensionApi,
  ExtensionPipelineRegistry,
  ExtensionToolRegistry,
} from '@goondan/core';
import type {
  ExtTurnContext,
  ExtStepContext,
  ExtLlmMessage,
} from '@goondan/core';
import { register } from '../extensions/compaction/index.js';
import type { CompactionConfig } from '../extensions/compaction/types.js';

// Helper to create extension resource
function createExtensionResource(config: CompactionConfig) {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Extension',
    metadata: {
      name: 'compaction',
      labels: {},
    },
    spec: {
      runtime: 'node' as const,
      entry: './extensions/compaction/index.js',
      config,
    },
  };
}

// Helper to create test messages
function createMessages(count: number): ExtLlmMessage[] {
  const messages: ExtLlmMessage[] = [];

  messages.push({
    id: 'msg-sys-0',
    role: 'system',
    content: 'You are a helpful assistant.',
  });

  for (let i = 0; i < count; i++) {
    messages.push({
      id: `msg-user-${i}`,
      role: 'user',
      content: `User message ${i + 1}: ${'x'.repeat(100)}`,
    });
    messages.push({
      id: `msg-asst-${i}`,
      role: 'assistant',
      content: `Assistant response ${i + 1}: ${'y'.repeat(100)}`,
    });
  }

  return messages;
}

// Helper to create turn context
function createTurnContext(messages: ExtLlmMessage[]): ExtTurnContext {
  return {
    turn: {
      id: 'turn-1',
      input: 'test input',
      messageState: {
        baseMessages: messages,
        events: [],
        nextMessages: messages,
      },
      toolResults: [],
    },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: {
        entrypoint: { kind: 'Agent', name: 'main' },
        agents: [],
      },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'main' },
      spec: {
        modelConfig: {
          modelRef: { kind: 'Model', name: 'gpt-4' },
        },
        prompts: {
          system: 'You are a test assistant.',
        },
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
      connections: new Map(),
    },
  };
}

// Helper to create step context
function createStepContext(messages: ExtLlmMessage[]): ExtStepContext {
  return {
    ...createTurnContext(messages),
    step: {
      id: 'step-1',
      index: 0,
      startedAt: new Date(),
    },
    blocks: [],
    toolCatalog: [],
    activeSwarmRef: 'git:HEAD',
  };
}

describe('Compaction Extension', () => {
  let eventBus: ReturnType<typeof createEventBus>;
  let stateStore: ReturnType<typeof createStateStore>;
  let pipelineRegistry: ExtensionPipelineRegistry;
  let toolRegistry: ExtensionToolRegistry;

  beforeEach(() => {
    eventBus = createEventBus();
    stateStore = createStateStore();
    pipelineRegistry = new ExtensionPipelineRegistry();
    toolRegistry = new ExtensionToolRegistry();
  });

  describe('Extension Registration', () => {
    it('should register with token strategy', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 8000,
        enableLogging: false,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      // Check state was initialized
      const state = api.getState()!;
      expect(state.compactionCount).toBe(0);
      expect(state.summaries).toEqual([]);
    });

    it('should register with turn strategy', async () => {
      const extension = createExtensionResource({
        strategy: 'turn',
        maxTurns: 20,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const state = api.getState()!;
      expect(state.compactionCount).toBe(0);
    });

    it('should register with sliding strategy', async () => {
      const extension = createExtensionResource({
        strategy: 'sliding',
        windowSize: 10,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const state = api.getState()!;
      expect(state.compactionCount).toBe(0);
    });

    it('should throw for invalid strategy', async () => {
      const extension = createExtensionResource({
        strategy: 'invalid' as never,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await expect(register(api)).rejects.toThrow('Invalid compaction strategy');
    });

    it('should emit initialization event', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 8000,
      });

      const initHandler = vi.fn();
      eventBus.on('extension.initialized', initHandler);

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      // Give time for async event emission
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(initHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'compaction',
          strategy: 'token',
        })
      );
    });
  });

  describe('Tool Registration', () => {
    it('should register compaction tools', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 8000,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const tools = toolRegistry.list();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('compaction.get-status');
      expect(toolNames).toContain('compaction.get-summaries');
      expect(toolNames).toContain('compaction.force-compact');
    });

    it('get-status should return current state', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 8000,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const statusTool = toolRegistry.get('compaction.get-status');
      expect(statusTool).toBeDefined();

      const result = await statusTool!.handler(createStepContext([]) as never, {});

      expect(result).toEqual(
        expect.objectContaining({
          strategy: 'token',
          compactionCount: 0,
          maxTokens: 8000,
        })
      );
    });
  });

  describe('Pipeline Integration', () => {
    it('should register turn.pre mutator', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 500,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const mutators = pipelineRegistry.getMutators('turn.pre');
      expect(mutators.length).toBe(1);
    });

    it('should register step.blocks mutator', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 500,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const mutators = pipelineRegistry.getMutators('step.blocks');
      expect(mutators.length).toBe(1);
    });

    it('should compact messages when threshold exceeded', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 500,
        preserveRecent: 2,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      // Create context with many messages
      const messages = createMessages(15);
      const ctx = createTurnContext(messages);

      // Run pipeline
      const result = await pipelineRegistry.runMutators('turn.pre', ctx);

      // Should have compacted
      expect(result.turn.messageState.nextMessages.length).toBeLessThan(messages.length);

      // State should be updated
      const state = api.getState()!;
      expect(state.compactionCount).toBe(1);
    });

    it('should not compact when under threshold', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 10000,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const messages = createMessages(3);
      const ctx = createTurnContext(messages);

      const result = await pipelineRegistry.runMutators('turn.pre', ctx);

      // Should not have compacted
      expect(result.turn.messageState.nextMessages.length).toBe(messages.length);

      const state = api.getState()!;
      expect(state.compactionCount).toBe(0);
    });

    it('should add compaction status block after compaction', async () => {
      const extension = createExtensionResource({
        strategy: 'token',
        maxTokens: 500,
        preserveRecent: 2,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      // First, trigger compaction
      const messages = createMessages(15);
      const turnCtx = createTurnContext(messages);
      await pipelineRegistry.runMutators('turn.pre', turnCtx);

      // Then check step.blocks
      const stepCtx = createStepContext([]);
      const result = await pipelineRegistry.runMutators('step.blocks', stepCtx);

      const statusBlock = result.blocks.find((b) => b.type === 'compaction.status');
      expect(statusBlock).toBeDefined();
      expect(statusBlock!.data).toEqual(
        expect.objectContaining({
          strategy: 'token',
          compactionCount: 1,
        })
      );
    });
  });

  describe('Turn-based Strategy Integration', () => {
    it('should compact based on turn count', async () => {
      const extension = createExtensionResource({
        strategy: 'turn',
        maxTurns: 5,
        preserveRecent: 2,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const messages = createMessages(10); // 10 turns
      const ctx = createTurnContext(messages);

      const result = await pipelineRegistry.runMutators('turn.pre', ctx);

      // Should have compacted
      const state = api.getState()!;
      expect(state.compactionCount).toBe(1);
      expect(result.turn.messageState.nextMessages.length).toBeLessThan(messages.length);
    });
  });

  describe('Sliding Window Strategy Integration', () => {
    it('should maintain window size', async () => {
      const extension = createExtensionResource({
        strategy: 'sliding',
        windowSize: 6,
      });

      const api = createExtensionApi({
        extension,
        eventBus,
        stateStore,
        pipelineRegistry,
        toolRegistry,
      });

      await register(api);

      const messages = createMessages(10);
      const ctx = createTurnContext(messages);

      const result = await pipelineRegistry.runMutators('turn.pre', ctx);

      const state = api.getState()!;
      expect(state.compactionCount).toBe(1);

      // Count non-system messages (should be window + summary)
      const nonSystemCount = result.turn.messageState.nextMessages.filter(
        (m) => m.role !== 'system'
      ).length;
      expect(nonSystemCount).toBe(7); // 6 window + 1 summary
    });
  });
});
