/**
 * 보안: HTTP Fetch Tool URL 검증 테스트
 *
 * SSRF 방지를 위한 프로토콜 검증 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import { handlers } from '../../src/tools/http-fetch/index.js';
import type { ToolContext, JsonObject } from '@goondan/core';

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
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(),
      assert: vi.fn(), clear: vi.fn(), count: vi.fn(), countReset: vi.fn(),
      dir: vi.fn(), dirxml: vi.fn(), group: vi.fn(), groupCollapsed: vi.fn(),
      groupEnd: vi.fn(), table: vi.fn(), time: vi.fn(), timeEnd: vi.fn(),
      timeLog: vi.fn(), trace: vi.fn(), profile: vi.fn(), profileEnd: vi.fn(),
      timeStamp: vi.fn(), Console: vi.fn(),
    },
  };
}

describe('Security: HTTP Fetch URL Validation', () => {
  const httpGet = handlers['http.get'];
  const httpPost = handlers['http.post'];
  const ctx = createMockContext();

  describe('프로토콜 검증', () => {
    it('file:// 프로토콜을 거부해야 한다', async () => {
      const input: JsonObject = { url: 'file:///etc/passwd' };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('허용되지 않는 프로토콜');
      }
    });

    it('ftp:// 프로토콜을 거부해야 한다', async () => {
      const input: JsonObject = { url: 'ftp://evil.com/file' };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('허용되지 않는 프로토콜');
      }
    });

    it('data: 프로토콜을 거부해야 한다', async () => {
      const input: JsonObject = { url: 'data:text/html,<script>alert(1)</script>' };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('허용되지 않는 프로토콜');
      }
    });

    it('javascript: 프로토콜을 거부해야 한다', async () => {
      const input: JsonObject = { url: 'javascript:alert(1)' };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('허용되지 않는 프로토콜');
      }
    });

    it('빈 URL을 거부해야 한다', async () => {
      const input: JsonObject = { url: '' };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('비어있지 않은 문자열');
      }
    });

    it('유효하지 않은 URL을 거부해야 한다', async () => {
      const input: JsonObject = { url: 'not-a-url' };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('유효하지 않은 URL');
      }
    });

    it('POST에서도 file:// 프로토콜을 거부해야 한다', async () => {
      const input: JsonObject = { url: 'file:///etc/shadow', body: '{}' };
      if (httpPost) {
        await expect(httpPost(ctx, input)).rejects.toThrow('허용되지 않는 프로토콜');
      }
    });
  });

  describe('URL이 아닌 입력', () => {
    it('URL이 문자열이 아닌 경우 거부해야 한다', async () => {
      const input: JsonObject = { url: 12345 };
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('비어있지 않은 문자열');
      }
    });

    it('URL이 누락된 경우 거부해야 한다', async () => {
      const input: JsonObject = {};
      if (httpGet) {
        await expect(httpGet(ctx, input)).rejects.toThrow('비어있지 않은 문자열');
      }
    });
  });
});
