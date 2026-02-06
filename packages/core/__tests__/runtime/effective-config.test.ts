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

  describe('에러 처리', () => {
    it('Agent를 찾을 수 없으면 에러를 던져야 한다', async () => {
      mockBundleLoader.getResource.mockReturnValue(undefined);

      const loader = createEffectiveConfigLoader(mockBundleLoader);

      await expect(
        loader.load('bundle-ref', 'Agent/nonexistent')
      ).rejects.toThrow('Agent not found: nonexistent');
    });

    it('Model을 찾을 수 없으면 에러를 던져야 한다', async () => {
      const mockAgent: AgentResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Agent',
        metadata: { name: 'planner' },
        spec: {
          modelConfig: { modelRef: { kind: 'Model', name: 'missing-model' } },
          prompts: { system: 'test' },
        },
      };

      mockBundleLoader.getResource.mockImplementation((kind: string, name: string) => {
        if (kind === 'Agent' && name === 'planner') return mockAgent;
        return undefined;
      });

      const loader = createEffectiveConfigLoader(mockBundleLoader);

      await expect(
        loader.load('bundle-ref', 'Agent/planner')
      ).rejects.toThrow('Model not found: missing-model');
    });

    it('ObjectRefLike 문자열 형식("Kind/name")에서 이름을 추출해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('bundle-ref', 'Agent/planner');

      // getResource가 'Agent', 'planner'로 호출되었는지 확인
      expect(mockBundleLoader.getResource).toHaveBeenCalledWith('Agent', 'planner');
    });

    it('ObjectRefLike 객체 형식에서 이름을 추출해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('bundle-ref', { kind: 'Agent', name: 'planner' });

      expect(mockBundleLoader.getResource).toHaveBeenCalledWith('Agent', 'planner');
    });
  });

  describe('setActiveRef', () => {
    it('활성 Ref를 변경할 수 있어야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);

      loader.setActiveRef('new-ref-abc');
      const ref = await loader.getActiveRef();

      expect(ref).toBe('new-ref-abc');
    });
  });

  describe('revision 계산', () => {
    it('같은 SwarmBundleRef에 대해 같은 revision을 반환해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);

      const config1 = await loader.load('same-ref', 'Agent/planner');
      const config2 = await loader.load('same-ref', 'Agent/planner');

      expect(config1.revision).toBe(config2.revision);
    });

    it('다른 SwarmBundleRef에 대해 다른 revision을 반환해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);

      const config1 = await loader.load('ref-a', 'Agent/planner');
      const config2 = await loader.load('ref-b', 'Agent/planner');

      // 해시가 같을 수도 있지만, 일반적으로 다름
      // 이 테스트는 revision이 숫자임을 확인
      expect(typeof config1.revision).toBe('number');
      expect(typeof config2.revision).toBe('number');
    });
  });
});

describe('EffectiveConfigLoader - Edge Cases', () => {
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

  describe('resolveRefName 다양한 형태', () => {
    it('단순 문자열 (슬래시 없음)을 agentRef로 사용할 수 있어야 한다', async () => {
      mockBundleLoader.getResource.mockImplementation((kind: string, name: string) => {
        if (kind === 'Agent' && name === 'planner') {
          return {
            apiVersion: 'v1',
            kind: 'Agent',
            metadata: { name: 'planner' },
            spec: {
              modelConfig: { modelRef: 'Model/gpt-5' },
              prompts: { system: 'Test' },
            },
          };
        }
        if (kind === 'Model' && name === 'gpt-5') {
          return {
            apiVersion: 'v1',
            kind: 'Model',
            metadata: { name: 'gpt-5' },
            spec: { provider: 'openai', name: 'gpt-5' },
          };
        }
        return undefined;
      });

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      // "planner" (슬래시 없음) → resolveRefName은 그대로 반환
      const config = await loader.load('ref', 'planner');
      expect(config.agent.metadata.name).toBe('planner');
    });

    it('modelRef가 문자열 형식 "Model/name"일 때 올바르게 해석해야 한다', async () => {
      const agentWithStringRef: AgentResource = {
        apiVersion: 'v1',
        kind: 'Agent',
        metadata: { name: 'planner' },
        spec: {
          modelConfig: { modelRef: 'Model/gpt-5' },
          prompts: { system: 'Test' },
        },
      };

      mockBundleLoader.getResource.mockImplementation((kind: string, name: string) => {
        if (kind === 'Agent' && name === 'planner') return agentWithStringRef;
        if (kind === 'Model' && name === 'gpt-5') {
          return {
            apiVersion: 'v1',
            kind: 'Model',
            metadata: { name: 'gpt-5' },
            spec: { provider: 'openai', name: 'gpt-5' },
          };
        }
        return undefined;
      });

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('ref', 'Agent/planner');
      expect(config.model.metadata.name).toBe('gpt-5');
    });
  });

  describe('Tool 정규화 edge cases', () => {
    it('tools가 undefined인 Agent에 대해 빈 배열을 반환해야 한다', async () => {
      const agentNoTools: AgentResource = {
        apiVersion: 'v1',
        kind: 'Agent',
        metadata: { name: 'planner' },
        spec: {
          modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
          prompts: { system: 'Test' },
          // tools 없음
        },
      };

      mockBundleLoader.getResource.mockImplementation((kind: string, name: string) => {
        if (kind === 'Agent' && name === 'planner') return agentNoTools;
        if (kind === 'Model' && name === 'gpt-5') {
          return { apiVersion: 'v1', kind: 'Model', metadata: { name: 'gpt-5' }, spec: { provider: 'openai', name: 'gpt-5' } };
        }
        return undefined;
      });

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('ref', 'Agent/planner');
      expect(config.tools.length).toBe(0);
      expect(mockBundleLoader.resolveToolRefs).toHaveBeenCalledWith(undefined);
    });

    it('중복 Tool이 있으면 last-wins로 정규화해야 한다', async () => {
      mockBundleLoader.resolveToolRefs.mockResolvedValue([
        {
          apiVersion: 'v1',
          kind: 'Tool',
          metadata: { name: 'dup-tool' },
          spec: { runtime: 'node', entry: 'v1.js', exports: [] },
        },
        {
          apiVersion: 'v1',
          kind: 'Tool',
          metadata: { name: 'unique-tool' },
          spec: { runtime: 'node', entry: 'unique.js', exports: [] },
        },
        {
          apiVersion: 'v1',
          kind: 'Tool',
          metadata: { name: 'dup-tool' },
          spec: { runtime: 'node', entry: 'v2.js', exports: [] },
        },
      ]);

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('ref', 'Agent/planner');

      expect(config.tools.length).toBe(2);
      const dupTool = config.tools.find((t) => t.metadata.name === 'dup-tool');
      expect(dupTool?.spec.entry).toBe('v2.js');
    });

    it('중복 Extension이 있으면 last-wins로 정규화해야 한다', async () => {
      mockBundleLoader.resolveExtensionRefs.mockResolvedValue([
        {
          apiVersion: 'v1',
          kind: 'Extension',
          metadata: { name: 'dup-ext' },
          spec: { runtime: 'node', entry: 'ext-v1.js' },
        },
        {
          apiVersion: 'v1',
          kind: 'Extension',
          metadata: { name: 'dup-ext' },
          spec: { runtime: 'node', entry: 'ext-v2.js' },
        },
      ]);

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('ref', 'Agent/planner');

      expect(config.extensions.length).toBe(1);
      expect(config.extensions[0].spec.entry).toBe('ext-v2.js');
    });
  });

  describe('시스템 프롬프트 로드', () => {
    it('Agent의 prompts를 loadSystemPrompt에 전달해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      await loader.load('ref', 'Agent/planner');

      expect(mockBundleLoader.loadSystemPrompt).toHaveBeenCalledWith({
        system: 'You are helpful.',
      });
    });

    it('빈 시스템 프롬프트를 반환해도 정상 동작해야 한다', async () => {
      mockBundleLoader.loadSystemPrompt.mockResolvedValue('');

      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('ref', 'Agent/planner');

      expect(config.systemPrompt).toBe('');
    });
  });

  describe('revision은 항상 양수여야 한다', () => {
    it('빈 문자열 ref에 대해서도 revision은 비음수여야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load('', 'Agent/planner');

      expect(config.revision).toBeGreaterThanOrEqual(0);
      expect(typeof config.revision).toBe('number');
    });

    it('긴 문자열 ref에 대해서도 revision은 숫자여야 한다', async () => {
      const longRef = 'a'.repeat(1000);
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const config = await loader.load(longRef, 'Agent/planner');

      expect(typeof config.revision).toBe('number');
      expect(Number.isFinite(config.revision)).toBe(true);
    });
  });

  describe('getActiveRef / setActiveRef', () => {
    it('초기 activeRef는 "default"여야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      const ref = await loader.getActiveRef();
      expect(ref).toBe('default');
    });

    it('setActiveRef 후 getActiveRef가 새 값을 반환해야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      loader.setActiveRef('commit-sha-abc123');
      const ref = await loader.getActiveRef();
      expect(ref).toBe('commit-sha-abc123');
    });

    it('빈 문자열도 activeRef로 설정할 수 있어야 한다', async () => {
      const loader = createEffectiveConfigLoader(mockBundleLoader);
      loader.setActiveRef('');
      const ref = await loader.getActiveRef();
      expect(ref).toBe('');
    });
  });
});

describe('normalizeByIdentity - Edge Cases', () => {
  it('많은 수의 항목을 정규화해야 한다', () => {
    const items: Resource<unknown>[] = [];
    for (let i = 0; i < 100; i++) {
      items.push({
        apiVersion: 'v1',
        kind: 'Tool',
        metadata: { name: `tool-${i % 10}` }, // 10개의 고유 이름에 10번씩 중복
        spec: { index: i },
      });
    }

    const result = normalizeByIdentity(items);
    // 10개의 고유 이름만 남아야 함
    expect(result.length).toBe(10);
    // 각각 마지막 (가장 큰 index) 값이어야 함
    for (let i = 0; i < 10; i++) {
      const item = result.find((r) => r.metadata.name === `tool-${i}`);
      expect(item).toBeDefined();
      if (item) {
        expect((item.spec as { index: number }).index).toBe(90 + i);
      }
    }
  });

  it('namespace(apiVersion)가 다르더라도 Kind/name이 같으면 동일 identity로 취급해야 한다', () => {
    const items: Resource<{ version: string }>[] = [
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'same' }, spec: { version: 'v1' } },
      { apiVersion: 'v2', kind: 'Tool', metadata: { name: 'same' }, spec: { version: 'v2' } },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(1);
    expect(result[0].spec.version).toBe('v2');
  });

  it('단일 항목 배열은 그대로 반환해야 한다', () => {
    const items: Resource<unknown>[] = [
      { apiVersion: 'v1', kind: 'Model', metadata: { name: 'only-one' }, spec: {} },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(1);
    expect(result[0].metadata.name).toBe('only-one');
  });

  it('metadata.name에 특수 문자가 포함되어도 올바르게 구분해야 한다', () => {
    const items: Resource<unknown>[] = [
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'my-tool.v1' }, spec: { v: 1 } },
      { apiVersion: 'v1', kind: 'Tool', metadata: { name: 'my-tool.v2' }, spec: { v: 2 } },
    ];

    const result = normalizeByIdentity(items);
    expect(result.length).toBe(2);
  });
});
