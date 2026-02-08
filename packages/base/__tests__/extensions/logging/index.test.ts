/**
 * Logging Extension 테스트
 *
 * @see /packages/base/src/extensions/logging/AGENTS.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fs/promises를 모킹
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeFile } from 'fs/promises';
import { register } from '../../../src/extensions/logging/index.js';
import type {
  ExtensionApi,
  ExtStepContext,
  ExtTurnContext,
  ExtLlmResult,
  ExtLlmMessage,
} from '@goondan/core';

// ============================================================================
// Mock 타입 정의
// ============================================================================

type MutateHandler = (ctx: ExtTurnContext) => Promise<ExtTurnContext>;
type WrapHandler = (ctx: ExtStepContext, next: (ctx: ExtStepContext) => Promise<ExtLlmResult>) => Promise<ExtLlmResult>;

interface RegisteredPipelines {
  mutators: Map<string, MutateHandler[]>;
  wrappers: Map<string, WrapHandler[]>;
}

/**
 * Mock ExtensionApi 생성
 */
function createMockExtensionApi(
  config?: Record<string, unknown>,
): {
  api: ExtensionApi;
  pipelines: RegisteredPipelines;
  emittedEvents: Array<{ type: string; payload: unknown }>;
} {
  const pipelines: RegisteredPipelines = {
    mutators: new Map(),
    wrappers: new Map(),
  };
  const emittedEvents: Array<{ type: string; payload: unknown }> = [];

  const api: ExtensionApi = {
    extension: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Extension',
      metadata: { name: 'logging' },
      spec: {
        runtime: 'node',
        entry: './extensions/logging/index.js',
        config,
      },
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      assert: vi.fn(),
      clear: vi.fn(),
      count: vi.fn(),
      countReset: vi.fn(),
      dir: vi.fn(),
      dirxml: vi.fn(),
      group: vi.fn(),
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      table: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(),
      timeLog: vi.fn(),
      trace: vi.fn(),
      profile: vi.fn(),
      profileEnd: vi.fn(),
      timeStamp: vi.fn(),
      Console: vi.fn(),
    },
    pipelines: {
      mutate: vi.fn().mockImplementation((point: string, handler: MutateHandler) => {
        if (!pipelines.mutators.has(point)) {
          pipelines.mutators.set(point, []);
        }
        pipelines.mutators.get(point)?.push(handler);
      }),
      wrap: vi.fn().mockImplementation((point: string, handler: WrapHandler) => {
        if (!pipelines.wrappers.has(point)) {
          pipelines.wrappers.set(point, []);
        }
        pipelines.wrappers.get(point)?.push(handler);
      }),
    },
    tools: {
      register: vi.fn(),
      unregister: vi.fn(),
    },
    events: {
      emit: vi.fn().mockImplementation((type: string, payload: unknown) => {
        emittedEvents.push({ type, payload });
      }),
      on: vi.fn(),
    },
    state: {
      get: vi.fn(),
      set: vi.fn(),
    },
  };

  return { api, pipelines, emittedEvents };
}

/**
 * Mock ExtStepContext 생성
 */
function createMockStepContext(overrides: Partial<ExtStepContext> = {}): ExtStepContext {
  return {
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: {
      messageState: {
        baseMessages: [],
        events: [],
        nextMessages: [
          { id: 'msg-1', role: 'user', content: 'Hello!' },
        ] as ExtLlmMessage[],
      },
      metadata: {},
    },
    step: {
      index: 0,
      toolCatalog: [],
      blocks: [],
    },
    ...overrides,
  };
}

/**
 * Mock ExtTurnContext 생성
 */
function createMockTurnContext(overrides: Partial<ExtTurnContext> = {}): ExtTurnContext {
  return {
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: {
      messageState: {
        baseMessages: [],
        events: [],
        nextMessages: [
          { id: 'msg-1', role: 'user', content: 'Hello!' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
        ] as ExtLlmMessage[],
      },
      metadata: { turnId: 'turn-123' },
    },
    ...overrides,
  };
}

describe('Logging Extension', () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('register 함수가 존재해야 한다', () => {
      expect(register).toBeDefined();
      expect(typeof register).toBe('function');
    });

    it('파이프라인을 등록해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      expect(api.pipelines.wrap).toHaveBeenCalledWith('step.llmCall', expect.any(Function));
      expect(api.pipelines.mutate).toHaveBeenCalledWith('turn.post', expect.any(Function));
    });

    it('초기화 이벤트를 발행해야 한다', async () => {
      const { api, emittedEvents } = createMockExtensionApi();

      await register(api);

      expect(emittedEvents.length).toBeGreaterThan(0);
      const initEvent = emittedEvents.find(e => e.type === 'extension.initialized');
      expect(initEvent).toBeDefined();
      if (initEvent) {
        const payload = initEvent.payload;
        if (typeof payload === 'object' && payload !== null) {
          expect((payload as Record<string, unknown>)['name']).toBe('logging');
        }
      }
    });
  });

  describe('설정 파싱', () => {
    it('기본 설정을 사용해야 한다 (config 없을 때)', async () => {
      const { api, emittedEvents } = createMockExtensionApi();

      await register(api);

      const initEvent = emittedEvents.find(e => e.type === 'extension.initialized');
      expect(initEvent).toBeDefined();
      if (initEvent) {
        const payload = initEvent.payload as Record<string, unknown>;
        const config = payload['config'] as Record<string, unknown>;
        expect(config['logLevel']).toBe('info');
        expect(config['logDir']).toBe('./logs');
      }
    });

    it('커스텀 설정을 사용해야 한다', async () => {
      const { api, emittedEvents } = createMockExtensionApi({
        logLevel: 'debug',
        logDir: '/custom/logs',
        includeTimestamp: false,
        maxLogFileSizeMB: 50,
      });

      await register(api);

      const initEvent = emittedEvents.find(e => e.type === 'extension.initialized');
      expect(initEvent).toBeDefined();
      if (initEvent) {
        const payload = initEvent.payload as Record<string, unknown>;
        const config = payload['config'] as Record<string, unknown>;
        expect(config['logLevel']).toBe('debug');
        expect(config['logDir']).toBe('/custom/logs');
      }
    });

    it('유효하지 않은 logLevel은 기본값을 사용해야 한다', async () => {
      const { api, emittedEvents } = createMockExtensionApi({
        logLevel: 'invalid-level',
      });

      await register(api);

      const initEvent = emittedEvents.find(e => e.type === 'extension.initialized');
      if (initEvent) {
        const payload = initEvent.payload as Record<string, unknown>;
        const config = payload['config'] as Record<string, unknown>;
        expect(config['logLevel']).toBe('info');
      }
    });
  });

  describe('step.llmCall middleware', () => {
    it('LLM 요청/응답을 로깅해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const wrappers = pipelines.wrappers.get('step.llmCall');
      expect(wrappers).toBeDefined();
      expect(wrappers?.length).toBe(1);

      const middleware = wrappers?.[0];
      if (!middleware) return;

      const ctx = createMockStepContext();
      const mockNext = vi.fn().mockResolvedValue({
        message: { id: 'resp-1', role: 'assistant', content: 'Hello! I can help you.' },
        toolCalls: [],
      });

      const result = await middleware(ctx, mockNext);

      // next가 호출되었는지 확인
      expect(mockNext).toHaveBeenCalledWith(ctx);

      // 결과가 반환되었는지 확인
      expect(result.message.content).toBe('Hello! I can help you.');

      // 로그 파일이 기록되었는지 확인
      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    it('logLevel이 error이면 info 레벨 로그를 기록하지 않아야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi({
        logLevel: 'error',
      });

      await register(api);

      const wrappers = pipelines.wrappers.get('step.llmCall');
      const middleware = wrappers?.[0];
      if (!middleware) return;

      const ctx = createMockStepContext();
      const mockNext = vi.fn().mockResolvedValue({
        message: { id: 'resp-1', role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware(ctx, mockNext);

      // info 레벨이므로 error 설정에서는 기록되지 않아야 함
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('LLM 호출 소요 시간을 측정해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const wrappers = pipelines.wrappers.get('step.llmCall');
      const middleware = wrappers?.[0];
      if (!middleware) return;

      const ctx = createMockStepContext();
      const mockNext = vi.fn().mockImplementation(async () => {
        // 약간의 지연
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          message: { id: 'resp-1', role: 'assistant', content: 'Response' },
        toolCalls: [],
        };
      });

      await middleware(ctx, mockNext);

      // writeFile이 호출되었고, elapsed 정보가 포함되어야 함
      const writeCalls = vi.mocked(writeFile).mock.calls;
      const hasElapsed = writeCalls.some(call => {
        const content = String(call[1]);
        return content.includes('elapsed=');
      });
      expect(hasElapsed).toBe(true);
    });

    it('에이전트 이름이 없으면 unknown을 사용해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const wrappers = pipelines.wrappers.get('step.llmCall');
      const middleware = wrappers?.[0];
      if (!middleware) return;

      const ctx = createMockStepContext({
        agent: undefined,
      });
      const mockNext = vi.fn().mockResolvedValue({
        message: { id: 'resp-1', role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      await middleware(ctx, mockNext);

      const writeCalls = vi.mocked(writeFile).mock.calls;
      const hasUnknown = writeCalls.some(call => {
        const content = String(call[1]);
        return content.includes('agent=unknown');
      });
      expect(hasUnknown).toBe(true);
    });
  });

  describe('turn.post mutator', () => {
    it('Turn 완료 시 요약을 로깅해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      expect(mutators).toBeDefined();
      expect(mutators?.length).toBe(1);

      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      const result = await mutator(ctx);

      // 원본 컨텍스트를 반환해야 함
      expect(result).toBe(ctx);

      // 로그가 기록되었는지 확인
      expect(writeFile).toHaveBeenCalled();

      const writeCalls = vi.mocked(writeFile).mock.calls;
      const hasTurnComplete = writeCalls.some(call => {
        const content = String(call[1]);
        return content.includes('[TURN_COMPLETE]');
      });
      expect(hasTurnComplete).toBe(true);
    });

    it('logLevel이 error이면 Turn 요약을 기록하지 않아야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi({
        logLevel: 'error',
      });

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('turnId를 로그에 포함해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      const writeCalls = vi.mocked(writeFile).mock.calls;
      const hasTurnId = writeCalls.some(call => {
        const content = String(call[1]);
        return content.includes('turnId=turn-123');
      });
      expect(hasTurnId).toBe(true);
    });

    it('메시지 수를 로그에 포함해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      const writeCalls = vi.mocked(writeFile).mock.calls;
      const hasMessageCount = writeCalls.some(call => {
        const content = String(call[1]);
        return content.includes('totalMessages=2');
      });
      expect(hasMessageCount).toBe(true);
    });
  });

  describe('파일 로깅 에러 핸들링', () => {
    it('파일 쓰기 실패 시 메인 로직에 영향이 없어야 한다', async () => {
      vi.mocked(writeFile).mockRejectedValue(new Error('Disk full'));

      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const wrappers = pipelines.wrappers.get('step.llmCall');
      const middleware = wrappers?.[0];
      if (!middleware) return;

      const ctx = createMockStepContext();
      const mockNext = vi.fn().mockResolvedValue({
        message: { id: 'resp-1', role: 'assistant', content: 'Response' },
        toolCalls: [],
      });

      // 에러가 전파되지 않아야 함
      const result = await middleware(ctx, mockNext);
      expect(result.message.content).toBe('Response');
    });

    it('mkdir 실패 시 메인 로직에 영향이 없어야 한다', async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error('Permission denied'));

      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();

      // 에러가 전파되지 않아야 함
      const result = await mutator(ctx);
      expect(result).toBe(ctx);
    });
  });

  describe('로그 파일 경로', () => {
    it('날짜 기반 로그 파일 이름을 사용해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi();

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      const writeCalls = vi.mocked(writeFile).mock.calls;
      if (writeCalls.length > 0) {
        const filePath = String(writeCalls[0]?.[0]);
        expect(filePath).toMatch(/goondan-\d{4}-\d{2}-\d{2}\.log$/);
      }
    });

    it('커스텀 logDir을 사용해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi({
        logDir: '/custom/log/path',
      });

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      const mkdirCalls = vi.mocked(mkdir).mock.calls;
      if (mkdirCalls.length > 0) {
        expect(String(mkdirCalls[0]?.[0])).toBe('/custom/log/path');
      }
    });

    it('includeTimestamp가 false이면 타임스탬프를 포함하지 않아야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi({
        includeTimestamp: false,
      });

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      const writeCalls = vi.mocked(writeFile).mock.calls;
      if (writeCalls.length > 0) {
        const content = String(writeCalls[0]?.[1]);
        // ISO 타임스탬프 패턴이 없어야 함
        expect(content).not.toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('includeTimestamp가 true이면 타임스탬프를 포함해야 한다', async () => {
      const { api, pipelines } = createMockExtensionApi({
        includeTimestamp: true,
      });

      await register(api);

      const mutators = pipelines.mutators.get('turn.post');
      const mutator = mutators?.[0];
      if (!mutator) return;

      const ctx = createMockTurnContext();
      await mutator(ctx);

      const writeCalls = vi.mocked(writeFile).mock.calls;
      if (writeCalls.length > 0) {
        const content = String(writeCalls[0]?.[1]);
        // ISO 타임스탬프 패턴
        expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
      }
    });
  });
});
