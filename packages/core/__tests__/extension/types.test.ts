/**
 * Extension 타입 테스트
 * @see /docs/specs/extension.md - 4. ExtensionApi 인터페이스
 */
import { describe, it, expect } from 'vitest';
import type {
  ExtensionApi,
  EventBus,
  EventHandler,
  PipelineApi,
  ToolRegistryApi,
  DynamicToolDefinition,
  SwarmBundleApi,
  LiveConfigApi,
  OAuthApi,
  PipelinePoint,
  MutatorPoint,
  MiddlewarePoint,
  MutatorHandler,
  MiddlewareHandler,
  TurnContext,
  StepContext,
  ToolCallContext,
  WorkspaceContext,
} from '../../src/extension/types.js';
import { createExtensionApi } from '../../src/extension/api.js';
import { createEventBus } from '../../src/extension/event-bus.js';
import { createStateStore } from '../../src/extension/state-store.js';
import type { JsonObject } from '../../src/types/json.js';

describe('Extension 타입 정의', () => {
  describe('ExtensionApi 인터페이스', () => {
    it('ExtensionApi 타입이 올바른 구조를 갖는다', () => {
      // 실제 구현체로 테스트
      const api = createExtensionApi({
        extension: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'test' },
          spec: { runtime: 'node', entry: './test.js' },
        },
        eventBus: createEventBus(),
        stateStore: createStateStore(),
      });

      // extension 속성
      expect('extension' in api).toBe(true);

      // pipelines 속성
      expect('pipelines' in api).toBe(true);

      // tools 속성
      expect('tools' in api).toBe(true);

      // events 속성
      expect('events' in api).toBe(true);

      // swarmBundle 속성
      expect('swarmBundle' in api).toBe(true);

      // liveConfig 속성
      expect('liveConfig' in api).toBe(true);

      // oauth 속성
      expect('oauth' in api).toBe(true);

      // state 속성
      expect('state' in api).toBe(true);

      // getState/setState 속성
      expect('getState' in api).toBe(true);
      expect('setState' in api).toBe(true);

      // instance 속성
      expect('instance' in api).toBe(true);
    });

    it('제네릭 타입 파라미터로 State와 Config를 지정할 수 있다', () => {
      interface MyState {
        count: number;
        items: string[];
      }

      interface MyConfig {
        maxItems: number;
        enabled: boolean;
      }

      // 실제 구현체로 테스트
      const api = createExtensionApi<MyState, MyConfig>({
        extension: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'test' },
          spec: {
            runtime: 'node',
            entry: './test.js',
            config: { maxItems: 10, enabled: true },
          },
        },
        eventBus: createEventBus(),
        stateStore: createStateStore(),
      });

      // state.get/state.set이 함수인지 확인
      expect(typeof api.state.get).toBe('function');
      expect(typeof api.state.set).toBe('function');
      expect(typeof api.getState).toBe('function');
      expect(typeof api.setState).toBe('function');
    });
  });

  describe('EventBus 인터페이스', () => {
    it('EventBus가 emit, on, once, off 메서드를 갖는다', () => {
      const eventBus = createEventBus();

      expect(typeof eventBus.emit).toBe('function');
      expect(typeof eventBus.on).toBe('function');
      expect(typeof eventBus.once).toBe('function');
      expect(typeof eventBus.off).toBe('function');
    });
  });

  describe('PipelineApi 인터페이스', () => {
    it('PipelineApi가 mutate, wrap 메서드를 갖는다', () => {
      const api = createExtensionApi({
        extension: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'test' },
          spec: { runtime: 'node', entry: './test.js' },
        },
        eventBus: createEventBus(),
        stateStore: createStateStore(),
      });

      expect(typeof api.pipelines.mutate).toBe('function');
      expect(typeof api.pipelines.wrap).toBe('function');
    });
  });

  describe('ToolRegistryApi 인터페이스', () => {
    it('ToolRegistryApi가 register, unregister 메서드를 갖는다', () => {
      const api = createExtensionApi({
        extension: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'test' },
          spec: { runtime: 'node', entry: './test.js' },
        },
        eventBus: createEventBus(),
        stateStore: createStateStore(),
      });

      expect(typeof api.tools.register).toBe('function');
      expect(typeof api.tools.unregister).toBe('function');
    });
  });

  describe('DynamicToolDefinition 인터페이스', () => {
    it('DynamicToolDefinition이 필수 속성을 갖는다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'my.tool',
        description: 'Test tool',
        handler: async () => ({ result: 'ok' }),
      };

      expect(toolDef.name).toBe('my.tool');
      expect(toolDef.description).toBe('Test tool');
      expect(typeof toolDef.handler).toBe('function');
    });

    it('DynamicToolDefinition에 선택적 속성을 지정할 수 있다', () => {
      const toolDef: DynamicToolDefinition = {
        name: 'my.tool',
        description: 'Test tool',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        handler: async () => ({ result: 'ok' }),
        metadata: {
          source: 'test-extension',
          version: '1.0.0',
        },
      };

      expect(toolDef.parameters).toBeDefined();
      expect(toolDef.metadata?.source).toBe('test-extension');
    });
  });

  describe('PipelinePoint 타입', () => {
    it('모든 파이프라인 포인트가 정의되어 있다', () => {
      const turnPoints: PipelinePoint[] = ['turn.pre', 'turn.post'];
      const stepPoints: PipelinePoint[] = [
        'step.pre',
        'step.config',
        'step.tools',
        'step.blocks',
        'step.llmInput',
        'step.llmCall',
        'step.llmError',
        'step.post',
      ];
      const toolCallPoints: PipelinePoint[] = [
        'toolCall.pre',
        'toolCall.exec',
        'toolCall.post',
      ];
      const workspacePoints: PipelinePoint[] = [
        'workspace.repoAvailable',
        'workspace.worktreeMounted',
      ];

      const allPoints = [
        ...turnPoints,
        ...stepPoints,
        ...toolCallPoints,
        ...workspacePoints,
      ];

      expect(allPoints).toHaveLength(15);
    });
  });

  describe('MutatorPoint 타입', () => {
    it('Mutator 포인트가 올바르게 정의되어 있다', () => {
      const mutatorPoints: MutatorPoint[] = [
        'turn.pre',
        'turn.post',
        'step.pre',
        'step.config',
        'step.tools',
        'step.blocks',
        'step.llmInput',
        'step.llmError',
        'step.post',
        'toolCall.pre',
        'toolCall.post',
        'workspace.repoAvailable',
        'workspace.worktreeMounted',
      ];

      expect(mutatorPoints).toHaveLength(13);
    });
  });

  describe('MiddlewarePoint 타입', () => {
    it('Middleware 포인트가 올바르게 정의되어 있다', () => {
      const middlewarePoints: MiddlewarePoint[] = [
        'step.llmCall',
        'toolCall.exec',
      ];

      expect(middlewarePoints).toHaveLength(2);
    });
  });

  describe('Context 타입들', () => {
    it('TurnContext가 필수 속성을 갖는다', () => {
      // 타입 레벨 테스트 - 인스턴스 생성 후 속성 확인
      const ctx: TurnContext = {
        turn: {
          id: 'turn-1',
          input: 'test',
          messageState: {
            baseMessages: [],
            events: [],
            nextMessages: [],
          },
          toolResults: [],
        },
        swarm: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: { entrypoint: { kind: 'Agent', name: 'test' }, agents: [] },
        },
        agent: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'test-agent' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-4' } },
            prompts: { system: 'test' },
          },
        },
        effectiveConfig: {
          swarm: {} as never,
          agents: new Map(),
          models: new Map(),
          tools: new Map(),
          extensions: new Map(),
          connectors: new Map(),
          connections: new Map(),
          oauthApps: new Map(),
          revision: 1,
          swarmBundleRef: 'git:HEAD',
        },
      };

      expect(ctx.turn).toBeDefined();
      expect(ctx.swarm).toBeDefined();
      expect(ctx.agent).toBeDefined();
      expect(ctx.effectiveConfig).toBeDefined();
    });

    it('StepContext가 TurnContext를 확장한다', () => {
      const ctx: StepContext = {
        turn: {
          id: 'turn-1',
          input: 'test',
          messageState: {
            baseMessages: [],
            events: [],
            nextMessages: [],
          },
          toolResults: [],
        },
        swarm: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: { entrypoint: { kind: 'Agent', name: 'test' }, agents: [] },
        },
        agent: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'test-agent' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-4' } },
            prompts: { system: 'test' },
          },
        },
        effectiveConfig: {
          swarm: {} as never,
          agents: new Map(),
          models: new Map(),
          tools: new Map(),
          extensions: new Map(),
          connectors: new Map(),
          connections: new Map(),
          oauthApps: new Map(),
          revision: 1,
          swarmBundleRef: 'git:HEAD',
        },
        step: {
          id: 'step-1',
          index: 0,
          startedAt: new Date(),
        },
        blocks: [],
        toolCatalog: [],
        activeSwarmRef: 'git:HEAD',
      };

      // TurnContext 속성
      expect(ctx.turn).toBeDefined();
      expect(ctx.swarm).toBeDefined();

      // StepContext 추가 속성
      expect(ctx.step).toBeDefined();
      expect(ctx.blocks).toBeDefined();
      expect(ctx.toolCatalog).toBeDefined();
    });

    it('ToolCallContext가 StepContext를 확장한다', () => {
      const ctx: ToolCallContext = {
        turn: {
          id: 'turn-1',
          input: 'test',
          messageState: {
            baseMessages: [],
            events: [],
            nextMessages: [],
          },
          toolResults: [],
        },
        swarm: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: { entrypoint: { kind: 'Agent', name: 'test' }, agents: [] },
        },
        agent: {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'test-agent' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-4' } },
            prompts: { system: 'test' },
          },
        },
        effectiveConfig: {
          swarm: {} as never,
          agents: new Map(),
          models: new Map(),
          tools: new Map(),
          extensions: new Map(),
          connectors: new Map(),
          connections: new Map(),
          oauthApps: new Map(),
          revision: 1,
          swarmBundleRef: 'git:HEAD',
        },
        step: {
          id: 'step-1',
          index: 0,
          startedAt: new Date(),
        },
        blocks: [],
        toolCatalog: [],
        activeSwarmRef: 'git:HEAD',
        toolCall: {
          id: 'call-1',
          name: 'test-tool',
          args: {},
        },
      };

      // StepContext 속성
      expect(ctx.step).toBeDefined();

      // ToolCallContext 추가 속성
      expect(ctx.toolCall).toBeDefined();
    });

    it('WorkspaceContext가 필수 속성을 갖는다', () => {
      const ctx: WorkspaceContext = {
        path: '/path/to/workspace',
        type: 'repo',
      };

      expect(ctx.path).toBeDefined();
      expect(ctx.type).toBeDefined();
    });
  });
});
