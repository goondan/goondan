/**
 * EffectiveConfig 테스트
 * @see /docs/specs/runtime.md - 2.5 Step 타입 (EffectiveConfig), 9. Effective Config 고정 규칙
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EffectiveConfig,
  EffectiveConfigLoader,
  createEffectiveConfigLoader,
  normalizeByIdentity,
} from '../../src/runtime/effective-config.js';
import type { Resource } from '../../src/types/resource.js';
import type { AgentSpec, AgentResource } from '../../src/types/specs/agent.js';
import type { SwarmSpec, SwarmResource } from '../../src/types/specs/swarm.js';
import type { ModelSpec, ModelResource } from '../../src/types/specs/model.js';
import type { ToolSpec, ToolResource } from '../../src/types/specs/tool.js';
import type { ExtensionSpec, ExtensionResource } from '../../src/types/specs/extension.js';

describe('EffectiveConfig', () => {
  describe('EffectiveConfig 구조', () => {
    it('모든 필수 필드를 가져야 한다', () => {
      const config: EffectiveConfig = {
        swarm: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'planner' },
            agents: [{ kind: 'Agent', name: 'planner' }],
          },
        },
        agent: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'planner' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
            prompts: { system: 'You are helpful.' },
          },
        },
        model: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'gpt-5' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        tools: [],
        extensions: [],
        systemPrompt: 'You are helpful.',
        revision: 1,
      };

      expect(config.swarm.kind).toBe('Swarm');
      expect(config.agent.kind).toBe('Agent');
      expect(config.model.kind).toBe('Model');
      expect(config.systemPrompt).toBe('You are helpful.');
      expect(config.revision).toBe(1);
    });

    it('tools 배열은 readonly여야 한다', () => {
      const tool: ToolResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'file-reader' },
        spec: {
          runtime: 'node',
          entry: 'tools/file-reader.js',
          exports: [
            {
              name: 'file.read',
              description: 'Read file contents',
              parameters: { type: 'object' },
            },
          ],
        },
      };

      const config: EffectiveConfig = {
        swarm: {} as SwarmResource,
        agent: {} as AgentResource,
        model: {} as ModelResource,
        tools: [tool],
        extensions: [],
        systemPrompt: '',
        revision: 1,
      };

      expect(config.tools.length).toBe(1);
      expect(config.tools[0].metadata.name).toBe('file-reader');
    });

    it('extensions 배열은 readonly여야 한다', () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'mcp-client' },
        spec: {
          runtime: 'node',
          entry: 'extensions/mcp-client.js',
        },
      };

      const config: EffectiveConfig = {
        swarm: {} as SwarmResource,
        agent: {} as AgentResource,
        model: {} as ModelResource,
        tools: [],
        extensions: [extension],
        systemPrompt: '',
        revision: 1,
      };

      expect(config.extensions.length).toBe(1);
    });
  });
});

describe('normalizeByIdentity', () => {
  it('빈 배열을 처리해야 한다', () => {
    const result = normalizeByIdentity([]);
    expect(result).toEqual([]);
  });

  it('중복 없는 배열을 그대로 반환해야 한다', () => {
    const items: Resource<unknown>[] = [
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'tool-a' }, spec: {} },
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'tool-b' }, spec: {} },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(2);
  });

  it('중복된 identity를 가진 항목은 마지막 것만 유지해야 한다 (last-wins)', () => {
    const items: Resource<{ version: number }>[] = [
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'tool-a' }, spec: { version: 1 } },
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'tool-a' }, spec: { version: 2 } },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(1);
    expect(result[0].spec.version).toBe(2);
  });

  it('다른 Kind는 다른 identity로 취급해야 한다', () => {
    const items: Resource<unknown>[] = [
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'same-name' }, spec: {} },
      { apiVersion: 'v1', kind: 'Extension', metadata: { name: 'same-name' }, spec: {} },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(2);
  });

  it('identity key는 "Kind/name" 형식이어야 한다', () => {
    const items: Resource<unknown>[] = [
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'file.read' }, spec: {} },
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'file.write' }, spec: {} },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(2);
  });
});

describe('EffectiveConfigLoader', () => {
  let mockBundleLoader: {
    getResource: ReturnType<typeof vi.fn>;
    getSwarmForAgent: ReturnType<typeof vi.fn>;
    resolveToolRefs: ReturnType<typeof vi.fn>;
    resolveExtensionRefs: ReturnType<typeof vi.fn>;
    loadSystemPrompt: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockBundleLoader = {
      getResource: vi.fn(),
      getSwarmForAgent: vi.fn(),
      resolveToolRefs: vi.fn().mockResolvedValue([]),
      resolveExtensionRefs: vi.fn().mockResolvedValue([]),
      loadSystemPrompt: vi.fn().mockResolvedValue('You are helpful.'),
    };

    const mockSwarm: SwarmResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: {
        entrypoint: { kind: 'Agent', name: 'planner' },
        agents: [{ kind: 'Agent', name: 'planner' }],
      },
    };

    const mockAgent: AgentResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'planner' },
      spec: {
        modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
        prompts: { system: 'You are helpful.' },
      },
    };

    const mockModel: ModelResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Model',
      metadata: { name: 'gpt-5' },
      spec: { provider: 'openai', name: 'gpt-5' },
    };

    mockBundleLoader.getResource.mockImplementation((kind: string, name: string) => {
      if (kind === 'Agent' && name === 'planner') return mockAgent;
      if (kind === 'Model' && name === 'gpt-5') return mockModel;
      return undefined;
    });
    mockBundleLoader.getSwarmForAgent.mockReturnValue(mockSwarm);
  });

  describe('createEffectiveConfigLoader', () => {
    it('EffectiveConfigLoader 인스턴스를 생성해야 한다', () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      expect(loader).toBeDefined();
      expect(typeof loader.load).toBe('function');
    });
  });

  describe('load', () => {
    it('Effective Config를 로드해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('bundle-ref', 'Agent/planner');

      expect(config).toBeDefined();
      expect(config.agent.metadata.name).toBe('planner');
      expect(config.model.spec.provider).toBe('openai');
      expect(config.systemPrompt).toBe('You are helpful.');
    });

    it('revision을 계산해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('bundle-ref-abc123', 'Agent/planner');

      expect(config.revision).toBeDefined();
      expect(typeof config.revision).toBe('number');
    });

    it('Tools를 정규화해야 한다', async () => {
      const tool1: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'tool-a' },
        spec: { runtime: 'node', entry: 'a.js', exports: [] },
      };
      const tool2: ToolResource = {
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: 'tool-a' },
        spec: { runtime: 'node', entry: 'a-v2.js', exports: [] },
      };

      mockBundleLoader.resolveToolRefs.mockResolvedValue([tool1, tool2]);

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('bundle-ref', 'Agent/planner');

      // 중복은 last-wins로 처리
      expect(config.tools.length).toBe(1);
      expect(config.tools[0].spec.entry).toBe('a-v2.js');
    });

    it('Extensions를 정규화해야 한다', async () => {
      const ext1: ExtensionResource = {
        apiVersion: 'v1',
        kind: 'Extension',
        metadata: { name: 'ext-a' },
        spec: { runtime: 'node', entry: 'ext-a.js' },
      };
      const ext2: ExtensionResource = {
        apiVersion: 'v1',
        kind: 'Extension',
        metadata: { name: 'ext-a' },
        spec: { runtime: 'node', entry: 'ext-a-v2.js' },
      };

      mockBundleLoader.resolveExtensionRefs.mockResolvedValue([ext1, ext2]);

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('bundle-ref', 'Agent/planner');

      // 중복은 last-wins로 처리
      expect(config.extensions.length).toBe(1);
      expect(config.extensions[0].spec.entry).toBe('ext-a-v2.js');
    });
  });

  describe('getActiveRef', () => {
    it('현재 활성 SwarmBundleRef를 반환해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const ref = await loader.getActiveRef();

      expect(ref).toBeDefined();
      expect(typeof ref).toBe('string');
    });
  });
});
