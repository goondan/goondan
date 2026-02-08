/**
 * basicCompaction Extension 테스트
 *
 * @see /docs/specs/extension.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register } from '../../../src/extensions/basicCompaction/index.js';
import type {
  ExtensionApi,
  ExtStepContext,
  ExtLlmMessage,
  ExtLlmResult,
  ExtMutatorHandler,
  ExtMiddlewareHandler,
  ExtEventBus,
  ExtToolRegistryApi,
  ExtensionSwarmBundleApi,
  ExtensionLiveConfigApi,
  ExtensionOAuthApi,
  ExtEffectiveConfig,
} from '@goondan/core';

// ============================================================================
// Mock 헬퍼 함수
// ============================================================================

interface RegisteredHandlers {
  mutators: Map<string, ExtMutatorHandler<ExtStepContext>>;
  middlewares: Map<string, ExtMiddlewareHandler<ExtStepContext, ExtLlmResult>>;
}

/**
 * Mock ExtensionApi 생성
 */
function createMockExtensionApi(
  config: Record<string, unknown> = {},
  handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() }
): ExtensionApi {
  let state: Record<string, unknown> = {};

  const eventEmitSpy = vi.fn();
  const eventBus: ExtEventBus = {
    emit: eventEmitSpy,
    on: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
    off: vi.fn(),
  };

  const toolRegistry: ExtToolRegistryApi = {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
  };

  const swarmBundleApi: ExtensionSwarmBundleApi = {
    openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test', baseRef: 'git:HEAD', workdir: '/tmp' }),
    commitChangeset: vi.fn().mockResolvedValue({ status: 'ok', changesetId: 'test', baseRef: 'git:HEAD' }),
    getActiveRef: vi.fn(() => 'git:HEAD'),
  };

  const effectiveConfig: ExtEffectiveConfig = {
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { entrypoint: { kind: 'Agent', name: 'test' }, agents: [] },
    },
    agents: new Map(),
    models: new Map(),
    tools: new Map(),
    extensions: new Map(),
    connectors: new Map(),
    oauthApps: new Map(),
    revision: 1,
    swarmBundleRef: 'git:HEAD',
  };

  const liveConfigApi: ExtensionLiveConfigApi = {
    proposePatch: vi.fn().mockResolvedValue(undefined),
    getEffectiveConfig: vi.fn(() => effectiveConfig),
    getRevision: vi.fn(() => 1),
  };

  const oauthApi: ExtensionOAuthApi = {
    getAccessToken: vi.fn().mockResolvedValue({
      status: 'error',
      error: { code: 'NOT_CONFIGURED', message: 'OAuth is not configured' },
    }),
  };

  const pipelinesApi = {
    mutate: vi.fn((point: string, handler: ExtMutatorHandler<ExtStepContext>) => {
      handlers.mutators.set(point, handler);
    }),
    wrap: vi.fn((point: string, handler: ExtMiddlewareHandler<ExtStepContext, ExtLlmResult>) => {
      handlers.middlewares.set(point, handler);
    }),
  };

  const getStateFn = () => state;
  const setStateFn = (next: Record<string, unknown>) => { state = next; };

  return {
    extension: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Extension',
      metadata: { name: 'basicCompaction' },
      spec: {
        runtime: 'node',
        entry: './extensions/basicCompaction/index.js',
        config,
      },
    },
    pipelines: pipelinesApi,
    tools: toolRegistry,
    events: eventBus,
    swarmBundle: swarmBundleApi,
    liveConfig: liveConfigApi,
    oauth: oauthApi,
    getState: getStateFn,
    setState: setStateFn,
    state: { get: getStateFn, set: setStateFn },
    instance: { shared: {} },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console,
  };
}

/**
 * Mock StepContext 생성
 */
function createMockStepContext(
  messages: ExtLlmMessage[],
  overrides: Partial<ExtStepContext> = {}
): ExtStepContext {
  return {
    turn: {
      id: 'test-turn',
      input: 'test input',
      messageState: {
        baseMessages: [...messages],
        events: [],
        nextMessages: [...messages],
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
      spec: { model: { ref: 'gpt-4' } },
    },
    effectiveConfig: {
      swarm: {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Swarm',
        metadata: { name: 'test-swarm' },
        spec: { entrypoint: { kind: 'Agent', name: 'test' }, agents: [] },
      },
      agents: new Map(),
      models: new Map(),
      tools: new Map(),
      extensions: new Map(),
      connectors: new Map(),
      oauthApps: new Map(),
      revision: 1,
      swarmBundleRef: 'git:HEAD',
    },
    step: {
      id: 'test-step',
      index: 0,
      startedAt: new Date(),
    },
    blocks: [],
    toolCatalog: [],
    activeSwarmRef: 'git:HEAD',
    ...overrides,
  };
}

/**
 * 긴 텍스트 메시지 생성 헬퍼
 */
function createLongMessage(charCount: number): string {
  return 'a'.repeat(charCount);
}

// ============================================================================
// 테스트
// ============================================================================

describe('basicCompaction Extension', () => {
  describe('register 함수', () => {
    it('register 함수가 정의되어 있어야 함', () => {
      expect(register).toBeDefined();
      expect(typeof register).toBe('function');
    });

    it('ExtensionApi를 받아 파이프라인 핸들러를 등록해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({}, handlers);

      await register(api);

      // step.llmCall middleware 등록 확인
      expect(api.pipelines.wrap).toHaveBeenCalledWith('step.llmCall', expect.any(Function));
      expect(handlers.middlewares.has('step.llmCall')).toBe(true);

      // step.blocks mutator 등록 확인
      expect(api.pipelines.mutate).toHaveBeenCalledWith('step.blocks', expect.any(Function));
      expect(handlers.mutators.has('step.blocks')).toBe(true);
    });

    it('초기화 이벤트를 발행해야 함', async () => {
      const api = createMockExtensionApi();

      await register(api);

      expect(api.events.emit).toHaveBeenCalledWith('extension.initialized', expect.objectContaining({
        name: 'basicCompaction',
        config: {
          maxTokens: 8000,
          maxChars: 32000,
        },
      }));
    });

    it('상태를 초기화해야 함', async () => {
      const api = createMockExtensionApi();

      await register(api);

      const state = api.getState();
      expect(state['compactionCount']).toBe(0);
      expect(state['totalMessagesCompacted']).toBe(0);
      expect(state['lastCompactionAt']).toBeNull();
      expect(state['estimatedTokens']).toBe(0);
    });
  });

  describe('설정(config) 처리', () => {
    it('기본 설정을 사용해야 함', async () => {
      const api = createMockExtensionApi();

      await register(api);

      expect(api.events.emit).toHaveBeenCalledWith('extension.initialized', expect.objectContaining({
        config: {
          maxTokens: 8000,
          maxChars: 32000,
        },
      }));
    });

    it('커스텀 설정을 적용해야 함', async () => {
      const api = createMockExtensionApi({
        maxTokens: 4000,
        maxChars: 16000,
        compactionPrompt: 'Custom prompt',
      });

      await register(api);

      expect(api.events.emit).toHaveBeenCalledWith('extension.initialized', expect.objectContaining({
        config: {
          maxTokens: 4000,
          maxChars: 16000,
        },
      }));
    });

    it('잘못된 설정 타입을 무시하고 기본값을 사용해야 함', async () => {
      const api = createMockExtensionApi({
        maxTokens: 'invalid', // 문자열이 아닌 숫자여야 함
        maxChars: null,
      });

      await register(api);

      expect(api.events.emit).toHaveBeenCalledWith('extension.initialized', expect.objectContaining({
        config: {
          maxTokens: 8000, // 기본값 사용
          maxChars: 32000, // 기본값 사용
        },
      }));
    });
  });

  describe('토큰 추정 로직', () => {
    it('메시지의 문자 수 / 4로 토큰을 추정해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 100000, maxTokens: 25000 }, handlers);

      await register(api);

      // 400자 메시지 = 약 100토큰 추정
      const messages: ExtLlmMessage[] = [
        { role: 'user', content: 'a'.repeat(400) },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');
      expect(middleware).toBeDefined();

      const mockNext = vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware!(ctx, mockNext);

      // 토큰 추정값이 업데이트되어야 함
      const state = api.getState();
      expect(state['estimatedTokens']).toBe(100); // 400 / 4 = 100
    });
  });

  describe('압축 트리거 조건', () => {
    it('문자 수가 maxChars 이하이고 토큰이 maxTokens 이하이면 압축하지 않아야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 1000, maxTokens: 500 }, handlers);

      await register(api);

      // 100자 메시지 = 약 25토큰 (압축 필요 없음)
      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Short message' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      const mockNext = vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware!(ctx, mockNext);

      // next가 원본 컨텍스트로 호출되어야 함
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(ctx.turn.messageState.nextMessages).toEqual(messages);
    });

    it('문자 수가 maxChars를 초과하면 압축해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      // 매우 낮은 maxChars 설정
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      // 5개 이상의 메시지를 생성해서 압축 대상 메시지가 있도록 함
      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent message 1' },
        { role: 'assistant', content: 'Recent message 2' },
        { role: 'user', content: 'Recent message 3' },
        { role: 'assistant', content: 'Recent message 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let compactionCallCount = 0;
      const mockNext = vi.fn().mockImplementation((passedCtx: ExtStepContext) => {
        compactionCallCount++;
        // 첫 번째 호출은 압축 요약을 위한 것
        if (compactionCallCount === 1) {
          return Promise.resolve({
            message: { role: 'assistant', content: 'Summarized conversation' },
            toolCalls: [],
          });
        }
        // 두 번째 호출은 실제 LLM 요청
        return Promise.resolve({
          message: { role: 'assistant', content: 'Final response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // next가 2번 호출되어야 함 (압축용 LLM + 실제 LLM)
      expect(mockNext).toHaveBeenCalledTimes(2);

      // 상태가 업데이트되어야 함
      const state = api.getState();
      expect(state['compactionCount']).toBe(1);
      expect(state['totalMessagesCompacted']).toBeGreaterThan(0);
      expect(state['lastCompactionAt']).not.toBeNull();
    });

    it('토큰 수가 maxTokens를 초과하면 압축해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      // 매우 낮은 maxTokens 설정 (4자 = 1토큰이므로 50토큰 = 200자)
      const api = createMockExtensionApi({ maxChars: 100000, maxTokens: 50 }, handlers);

      await register(api);

      // 5개 이상의 메시지 (총 1000자 이상 = 250+ 토큰)
      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(200) },
        { role: 'assistant', content: createLongMessage(200) },
        { role: 'user', content: createLongMessage(200) },
        { role: 'assistant', content: createLongMessage(200) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let callCount = 0;
      const mockNext = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          message: { role: 'assistant', content: callCount === 1 ? 'Summary' : 'Response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // 압축이 실행되어야 함
      expect(mockNext).toHaveBeenCalledTimes(2);
      expect(api.getState()['compactionCount']).toBe(1);
    });
  });

  describe('메시지 압축 로직', () => {
    it('시스템 메시지를 보존해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      const systemContent = 'Important system prompt';
      const messages: ExtLlmMessage[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let finalMessages: ExtLlmMessage[] = [];
      const mockNext = vi.fn().mockImplementation((passedCtx: ExtStepContext) => {
        finalMessages = passedCtx.turn.messageState.nextMessages;
        return Promise.resolve({
          message: { role: 'assistant', content: 'Summary or Response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // 마지막 호출에서 시스템 메시지가 보존되어야 함
      const systemMsg = finalMessages.find((m: ExtLlmMessage) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      if (systemMsg && 'content' in systemMsg) {
        expect(systemMsg.content).toBe(systemContent);
      }
    });

    it('최근 4개 메시지를 보존해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Preserved 1' },
        { role: 'assistant', content: 'Preserved 2' },
        { role: 'user', content: 'Preserved 3' },
        { role: 'assistant', content: 'Preserved 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let secondCallMessages: ExtLlmMessage[] = [];
      let callCount = 0;
      const mockNext = vi.fn().mockImplementation((passedCtx: ExtStepContext) => {
        callCount++;
        if (callCount === 2) {
          secondCallMessages = passedCtx.turn.messageState.nextMessages;
        }
        return Promise.resolve({
          message: { role: 'assistant', content: 'Response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // 두 번째 호출(실제 LLM)의 메시지에서 최근 4개가 보존되어야 함
      const preserved1 = secondCallMessages.find((m: ExtLlmMessage) =>
        'content' in m && m.content === 'Preserved 1'
      );
      const preserved4 = secondCallMessages.find((m: ExtLlmMessage) =>
        'content' in m && m.content === 'Preserved 4'
      );
      expect(preserved1).toBeDefined();
      expect(preserved4).toBeDefined();
    });

    it('압축 후 컨텍스트 메타데이터를 업데이트해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      const mockNext = vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware!(ctx, mockNext);

      // 메타데이터에 압축 정보가 있어야 함
      expect(ctx.turn.metadata).toBeDefined();
      const compactionMeta = ctx.turn.metadata?.['compaction'];
      expect(compactionMeta).toBeDefined();
      if (typeof compactionMeta === 'object' && compactionMeta !== null) {
        const meta = compactionMeta as Record<string, unknown>;
        expect(meta['performed']).toBe(true);
        expect(typeof meta['messageCount']).toBe('number');
        expect(typeof meta['charsSaved']).toBe('number');
        expect(typeof meta['timestamp']).toBe('number');
      }
    });

    it('압축할 메시지가 없으면 압축하지 않아야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      // 낮은 maxChars이지만 메시지가 4개 이하
      const api = createMockExtensionApi({ maxChars: 10, maxTokens: 100000 }, handlers);

      await register(api);

      // 4개 이하의 non-system 메시지
      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      const mockNext = vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware!(ctx, mockNext);

      // next가 1번만 호출되어야 함 (압축 없이 바로 LLM 호출)
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(api.getState()['compactionCount']).toBe(0);
    });

    it('LLM 요약 실패 시 폴백 요약을 사용해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let callCount = 0;
      const mockNext = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // 첫 번째 호출(압축용)에서 에러 발생
          return Promise.reject(new Error('LLM error'));
        }
        return Promise.resolve({
          message: { role: 'assistant', content: 'Response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // 압축이 수행되어야 함 (폴백 사용)
      expect(api.getState()['compactionCount']).toBe(1);
      // next가 2번 호출되어야 함
      expect(mockNext).toHaveBeenCalledTimes(2);
    });
  });

  describe('step.blocks mutator', () => {
    it('압축 수행 전에는 블록을 추가하지 않아야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({}, handlers);

      await register(api);

      const ctx = createMockStepContext([]);
      const mutator = handlers.mutators.get('step.blocks');
      expect(mutator).toBeDefined();

      const result = await mutator!(ctx);

      expect(result.blocks.length).toBe(0);
    });

    it('압축 수행 후 상태 블록을 추가해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      // maxChars: 50으로 압축 트리거, maxTokens: 100000은 그대로 사용
      const configMaxChars = 50;
      const configMaxTokens = 100000;
      const api = createMockExtensionApi({ maxChars: configMaxChars, maxTokens: configMaxTokens }, handlers);

      await register(api);

      // 먼저 압축 수행
      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const llmCtx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');
      const mockNext = vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware!(llmCtx, mockNext);

      // 그 다음 mutator 호출
      const blocksCtx = createMockStepContext([]);
      const mutator = handlers.mutators.get('step.blocks');

      const result = await mutator!(blocksCtx);

      // 상태 블록이 추가되어야 함
      expect(result.blocks.length).toBe(1);
      const statusBlock = result.blocks[0];
      expect(statusBlock.type).toBe('compaction.status');
      expect(statusBlock.priority).toBe(100);
      expect(statusBlock.data).toBeDefined();

      if (typeof statusBlock.data === 'object' && statusBlock.data !== null) {
        const data = statusBlock.data as Record<string, unknown>;
        expect(data['compactionCount']).toBe(1);
        expect(typeof data['totalMessagesCompacted']).toBe('number');
        expect(data['maxTokens']).toBe(configMaxTokens);
        expect(data['maxChars']).toBe(configMaxChars);
      }
    });
  });

  describe('다양한 메시지 타입 처리', () => {
    it('tool 메시지를 올바르게 텍스트로 변환해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: 'Let me check', toolCalls: [{ id: '1', name: 'test_tool', input: {} }] },
        { role: 'tool', toolCallId: '1', toolName: 'test_tool', output: { result: 'success' } },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let firstCallContext: ExtStepContext | null = null;
      let callCount = 0;
      const mockNext = vi.fn().mockImplementation((passedCtx: ExtStepContext) => {
        callCount++;
        if (callCount === 1) {
          firstCallContext = passedCtx;
        }
        return Promise.resolve({
          message: { role: 'assistant', content: 'Response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // 첫 번째 호출(압축용)의 메시지에 tool 결과가 텍스트로 포함되어야 함
      expect(firstCallContext).not.toBeNull();
      const userMessage = firstCallContext!.turn.messageState.nextMessages.find((m: ExtLlmMessage) => m.role === 'user');
      expect(userMessage).toBeDefined();
      if (userMessage && 'content' in userMessage) {
        expect(userMessage.content).toContain('test_tool');
      }
    });

    it('assistant 메시지의 toolCalls를 올바르게 텍스트로 변환해야 함', async () => {
      const handlers: RegisteredHandlers = { mutators: new Map(), middlewares: new Map() };
      const api = createMockExtensionApi({ maxChars: 50, maxTokens: 100000 }, handlers);

      await register(api);

      const messages: ExtLlmMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: createLongMessage(100) },
        {
          role: 'assistant',
          toolCalls: [
            { id: '1', name: 'tool_a', input: {} },
            { id: '2', name: 'tool_b', input: {} },
          ],
        },
        { role: 'tool', toolCallId: '1', toolName: 'tool_a', output: 'result_a' },
        { role: 'tool', toolCallId: '2', toolName: 'tool_b', output: 'result_b' },
        { role: 'user', content: createLongMessage(100) },
        { role: 'assistant', content: createLongMessage(100) },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
        { role: 'assistant', content: 'Recent 4' },
      ];

      const ctx = createMockStepContext(messages);
      const middleware = handlers.middlewares.get('step.llmCall');

      let firstCallContext: ExtStepContext | null = null;
      let callCount = 0;
      const mockNext = vi.fn().mockImplementation((passedCtx: ExtStepContext) => {
        callCount++;
        if (callCount === 1) {
          firstCallContext = passedCtx;
        }
        return Promise.resolve({
          message: { role: 'assistant', content: 'Response' },
          toolCalls: [],
        });
      });

      await middleware!(ctx, mockNext);

      // 첫 번째 호출(압축용)의 메시지에 tool 이름들이 포함되어야 함
      expect(firstCallContext).not.toBeNull();
      const userMessage = firstCallContext!.turn.messageState.nextMessages.find((m: ExtLlmMessage) => m.role === 'user');
      expect(userMessage).toBeDefined();
      if (userMessage && 'content' in userMessage) {
        expect(userMessage.content).toContain('tool_a');
        expect(userMessage.content).toContain('tool_b');
      }
    });
  });
});
