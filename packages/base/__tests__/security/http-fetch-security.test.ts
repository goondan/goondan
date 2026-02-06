/**
 * 보안: HTTP Fetch Tool URL 검증 테스트
 *
 * SSRF 방지를 위한 프로토콜 검증 테스트
 */

import { describe, it, expect } from 'vitest';
import { handlers } from '../../src/tools/http-fetch/index.js';
import type { ToolContext, JsonObject } from '@goondan/core';

function createMockContext(): ToolContext {
  return {
    swarmName: 'test-swarm',
    agentName: 'test-agent',
    instanceKey: 'test-instance',
    logger: undefined,
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
