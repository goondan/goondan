/**
 * ExtensionApi 구현 테스트
 * @see /docs/specs/extension.md - 4. ExtensionApi 인터페이스
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExtensionApi } from '../../src/extension/api.js';
import { createEventBus } from '../../src/extension/event-bus.js';
import { createStateStore } from '../../src/extension/state-store.js';
import type { ExtensionApi, EventBus, StateStore, StepContext } from '../../src/extension/types.js';
import type { ExtensionResource } from '../../src/types/specs/extension.js';
import type { JsonObject } from '../../src/types/json.js';

describe('createExtensionApi', () => {
  let eventBus: EventBus;
  let stateStore: StateStore;
  let extensionResource: ExtensionResource;

  beforeEach(() => {
    eventBus = createEventBus();
    stateStore = createStateStore();
    extensionResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Extension',
      metadata: {
        name: 'test-extension',
        labels: {
          tier: 'base',
        },
      },
      spec: {
        runtime: 'node',
        entry: './test/index.js',
        config: {
          maxTokens: 8000,
          enableLogging: true,
        },
      },
    };
  });

  describe('extension 속성', () => {
    it('Extension 리소스를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.extension).toBe(extensionResource);
      expect(api.extension.metadata.name).toBe('test-extension');
    });
  });

  describe('state (getState/setState)', () => {
    it('getState로 Extension별 상태를 반환한다', () => {
      interface MyState {
        count: number;
      }

      const api = createExtensionApi<MyState>({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      api.setState({ count: 42 });

      expect(api.getState().count).toBe(42);
    });

    it('state.get/state.set으로 상태를 접근/설정할 수 있다', () => {
      interface MyState {
        count: number;
      }

      const api = createExtensionApi<MyState>({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      api.state.set({ count: 99 });

      expect(api.state.get().count).toBe(99);
      // getState와 state.get은 동일 결과
      expect(api.getState().count).toBe(99);
    });

    it('setState는 상태를 교체한다 (불변 패턴)', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      api.setState({ a: 1 });
      const state1 = api.getState();
      api.setState({ b: 2 });
      const state2 = api.getState();

      expect(state1).not.toBe(state2);
      expect(state2).toEqual({ b: 2 });
    });
  });

  describe('instance.shared', () => {
    it('인스턴스 공유 상태를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      api.instance.shared['testKey'] = 'testValue';

      expect(api.instance.shared['testKey']).toBe('testValue');
    });
  });

  describe('events', () => {
    it('EventBus를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.events).toBe(eventBus);
    });

    it('이벤트를 발행하고 구독할 수 있다', async () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      const handler = vi.fn();
      api.events.on('test.event', handler);
      api.events.emit('test.event', { data: 'value' });

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith({ data: 'value' });
      });
    });
  });

  describe('pipelines', () => {
    it('PipelineApi를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.pipelines).toBeDefined();
      expect(typeof api.pipelines.mutate).toBe('function');
      expect(typeof api.pipelines.wrap).toBe('function');
    });

    it('mutate로 Mutator를 등록할 수 있다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(() => {
        api.pipelines.mutate('step.blocks', async (ctx) => ctx);
      }).not.toThrow();
    });

    it('wrap로 Middleware를 등록할 수 있다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(() => {
        api.pipelines.wrap('step.llmCall', async (ctx, next) => next(ctx));
      }).not.toThrow();
    });
  });

  describe('tools', () => {
    it('ToolRegistryApi를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.tools).toBeDefined();
      expect(typeof api.tools.register).toBe('function');
    });

    it('Tool을 등록할 수 있다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(() => {
        api.tools.register({
          name: 'test.tool',
          description: 'Test tool',
          handler: async () => ({ result: 'ok' }),
        });
      }).not.toThrow();
    });

    it('등록된 Tool을 해제할 수 있다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      api.tools.register({
        name: 'test.tool',
        description: 'Test tool',
        handler: async () => ({ result: 'ok' }),
      });

      expect(() => {
        api.tools.unregister('test.tool');
      }).not.toThrow();
    });

    it('등록된 Tool 목록을 조회할 수 있다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      api.tools.register({
        name: 'tool1',
        description: 'Tool 1',
        handler: async () => ({ result: '1' }),
      });
      api.tools.register({
        name: 'tool2',
        description: 'Tool 2',
        handler: async () => ({ result: '2' }),
      });

      const tools = api.tools.list();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tool1');
      expect(tools.map(t => t.name)).toContain('tool2');
    });
  });

  describe('swarmBundle', () => {
    it('SwarmBundleApi를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.swarmBundle).toBeDefined();
      expect(typeof api.swarmBundle?.openChangeset).toBe('function');
      expect(typeof api.swarmBundle?.commitChangeset).toBe('function');
    });
  });

  describe('liveConfig', () => {
    it('LiveConfigApi를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.liveConfig).toBeDefined();
      expect(typeof api.liveConfig?.proposePatch).toBe('function');
      expect(typeof api.liveConfig?.getEffectiveConfig).toBe('function');
    });
  });

  describe('oauth', () => {
    it('OAuthApi를 반환한다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.oauth).toBeDefined();
      expect(typeof api.oauth.getAccessToken).toBe('function');
    });
  });

  describe('logger', () => {
    it('logger를 설정할 수 있다', () => {
      const mockLogger = {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as Console;

      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
        logger: mockLogger,
      });

      expect(api.logger).toBe(mockLogger);
    });

    it('logger가 없으면 undefined이다', () => {
      const api = createExtensionApi({
        extension: extensionResource,
        eventBus,
        stateStore,
      });

      expect(api.logger).toBeUndefined();
    });
  });
});
