/**
 * HTTP Fetch Tool 테스트
 *
 * @see /packages/base/src/tools/http-fetch/AGENTS.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlers } from '../../../src/tools/http-fetch/index.js';
import type { ToolContext, JsonValue, JsonObject } from '@goondan/core';

/**
 * HTTP 응답 결과 타입 가드
 */
interface HttpResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  truncated: boolean;
}

function isHttpResult(value: JsonValue): value is HttpResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value['status'] === 'number' &&
    typeof value['statusText'] === 'string' &&
    typeof value['body'] === 'string' &&
    typeof value['ok'] === 'boolean' &&
    typeof value['truncated'] === 'boolean'
  );
}

/**
 * Mock ToolContext
 */
function createMockContext(): ToolContext {
  return {
    instance: { id: 'test-instance', swarmName: 'test-swarm', status: 'running' },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { agents: [], entrypoint: '' },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: { id: 'test-turn', messages: [], toolResults: [] },
    step: { id: 'test-step', index: 0 },
    toolCatalog: [],
    swarmBundle: {
      openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test' }),
      commitChangeset: vi.fn().mockResolvedValue({ success: true }),
    },
    oauth: {
      getAccessToken: vi.fn().mockResolvedValue({ status: 'error', error: { code: 'not_configured', message: 'Not configured' } }),
    },
    events: {},
    workdir: process.cwd(),
    agents: {
      delegate: vi.fn().mockResolvedValue({ success: false, agentName: '', instanceId: '', error: 'not implemented' }),
      listInstances: vi.fn().mockResolvedValue([]),
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
  };
}

// 원본 fetch 보관
const originalFetch = globalThis.fetch;

describe('http-fetch Tool', () => {
  afterEach(() => {
    // fetch 원복
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('http.get handler', () => {
    const handler = handlers['http.get'];

    it('핸들러가 정의되어 있어야 한다', () => {
      expect(handler).toBeDefined();
    });

    it('url이 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, {})).rejects.toThrow('url은 비어있지 않은 문자열이어야 합니다.');
    });

    it('url이 빈 문자열이면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { url: '' })).rejects.toThrow('url은 비어있지 않은 문자열이어야 합니다.');
    });

    it('url이 공백만 있으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { url: '   ' })).rejects.toThrow('url은 비어있지 않은 문자열이어야 합니다.');
    });

    it('url이 숫자이면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, { url: 123 })).rejects.toThrow('url은 비어있지 않은 문자열이어야 합니다.');
    });

    it('성공적인 GET 요청을 처리해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({ 'content-type': 'application/json' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('{"data":"test"}'),
      });

      const result = await handler(ctx, { url: 'https://api.example.com/data' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.status).toBe(200);
        expect(result.statusText).toBe('OK');
        expect(result.ok).toBe(true);
        expect(result.body).toBe('{"data":"test"}');
        expect(result.truncated).toBe(false);
      }
    });

    it('404 응답을 처리해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: mockHeaders,
        text: () => Promise.resolve('Not found'),
      });

      const result = await handler(ctx, { url: 'https://api.example.com/missing' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.status).toBe(404);
        expect(result.ok).toBe(false);
        expect(result.body).toBe('Not found');
      }
    });

    it('500 서버 에러 응답을 처리해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: mockHeaders,
        text: () => Promise.resolve('Server error'),
      });

      const result = await handler(ctx, { url: 'https://api.example.com/error' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.status).toBe(500);
        expect(result.ok).toBe(false);
      }
    });

    it('커스텀 headers를 전달해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      await handler(ctx, {
        url: 'https://api.example.com/data',
        headers: { Authorization: 'Bearer token123', 'X-Custom': 'value' },
      });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall).toBeDefined();
      if (fetchCall) {
        const options = fetchCall[1];
        if (options && typeof options === 'object' && 'headers' in options) {
          const headers = options.headers as Record<string, string>;
          expect(headers['Authorization']).toBe('Bearer token123');
          expect(headers['X-Custom']).toBe('value');
        }
      }
    });

    it('유효하지 않은 headers는 무시해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      await handler(ctx, {
        url: 'https://api.example.com/data',
        headers: 'not-an-object',
      });

      // 에러 없이 실행되어야 함
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('타임아웃 시 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      globalThis.fetch = vi.fn().mockImplementation(() => {
        const error = new DOMException('The operation was aborted.', 'AbortError');
        return Promise.reject(error);
      });

      await expect(
        handler(ctx, { url: 'https://slow.example.com', timeout: 100 })
      ).rejects.toThrow(/타임아웃/);
    });

    it('네트워크 에러를 적절히 래핑해야 한다', async () => {
      const ctx = createMockContext();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        handler(ctx, { url: 'https://unreachable.example.com' })
      ).rejects.toThrow('HTTP 요청 실패: Network error');
    });

    it('non-Error 예외를 처리해야 한다', async () => {
      const ctx = createMockContext();
      globalThis.fetch = vi.fn().mockRejectedValue('string error');

      await expect(
        handler(ctx, { url: 'https://example.com' })
      ).rejects.toThrow('HTTP 요청 실패: string error');
    });

    it('큰 응답을 잘라야 한다', async () => {
      const ctx = createMockContext();
      const largeBody = 'x'.repeat(200_000);
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve(largeBody),
      });

      const result = await handler(ctx, { url: 'https://api.example.com/large' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.truncated).toBe(true);
        expect(result.body.length).toBeLessThan(largeBody.length);
        expect(result.body).toContain('(response truncated)');
      }
    });

    it('빈 응답 본문을 처리해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: mockHeaders,
        text: () => Promise.resolve(''),
      });

      const result = await handler(ctx, { url: 'https://api.example.com/empty' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.status).toBe(204);
        expect(result.body).toBe('');
        expect(result.truncated).toBe(false);
      }
    });

    it('응답 headers를 올바르게 변환해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({
        'content-type': 'text/html',
        'x-custom-header': 'custom-value',
      });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      const result = await handler(ctx, { url: 'https://example.com' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.headers['content-type']).toBe('text/html');
        expect(result.headers['x-custom-header']).toBe('custom-value');
      }
    });

    it('timeout이 양수가 아니면 기본값을 사용해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      // 음수 timeout
      const result = await handler(ctx, { url: 'https://example.com', timeout: -100 });
      expect(isHttpResult(result)).toBe(true);
    });
  });

  describe('http.post handler', () => {
    const handler = handlers['http.post'];

    it('핸들러가 정의되어 있어야 한다', () => {
      expect(handler).toBeDefined();
    });

    it('url이 없으면 에러를 던져야 한다', async () => {
      const ctx = createMockContext();
      await expect(handler(ctx, {})).rejects.toThrow('url은 비어있지 않은 문자열이어야 합니다.');
    });

    it('성공적인 POST 요청을 처리해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({ 'content-type': 'application/json' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: mockHeaders,
        text: () => Promise.resolve('{"id":1}'),
      });

      const result = await handler(ctx, {
        url: 'https://api.example.com/items',
        body: '{"name":"test"}',
      });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.status).toBe(201);
        expect(result.ok).toBe(true);
        expect(result.body).toBe('{"id":1}');
      }
    });

    it('body가 있으면 Content-Type 기본값을 설정해야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      await handler(ctx, {
        url: 'https://api.example.com/data',
        body: '{"key":"value"}',
      });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      if (fetchCall) {
        const options = fetchCall[1];
        if (options && typeof options === 'object' && 'headers' in options) {
          const headers = options.headers as Record<string, string>;
          expect(headers['Content-Type']).toBe('application/json');
        }
      }
    });

    it('Content-Type이 명시되면 기본값을 덮어쓰지 않아야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      await handler(ctx, {
        url: 'https://api.example.com/data',
        body: 'key=value',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      if (fetchCall) {
        const options = fetchCall[1];
        if (options && typeof options === 'object' && 'headers' in options) {
          const headers = options.headers as Record<string, string>;
          expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        }
      }
    });

    it('body 없이 POST 요청을 보낼 수 있어야 한다', async () => {
      const ctx = createMockContext();
      const mockHeaders = new Headers({});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: () => Promise.resolve('ok'),
      });

      const result = await handler(ctx, { url: 'https://api.example.com/trigger' });

      expect(isHttpResult(result)).toBe(true);
      if (isHttpResult(result)) {
        expect(result.status).toBe(200);
      }
    });

    it('POST 타임아웃을 처리해야 한다', async () => {
      const ctx = createMockContext();
      globalThis.fetch = vi.fn().mockImplementation(() => {
        const error = new DOMException('The operation was aborted.', 'AbortError');
        return Promise.reject(error);
      });

      await expect(
        handler(ctx, { url: 'https://slow.example.com', timeout: 100 })
      ).rejects.toThrow(/타임아웃/);
    });

    it('POST 네트워크 에러를 래핑해야 한다', async () => {
      const ctx = createMockContext();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(
        handler(ctx, { url: 'https://unreachable.example.com', body: '{}' })
      ).rejects.toThrow('HTTP 요청 실패: Connection refused');
    });
  });
});
