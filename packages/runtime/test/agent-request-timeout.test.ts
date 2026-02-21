import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_REQUEST_TIMEOUT_MS,
  resolveAgentRequestTimeoutMs,
} from '../src/runner/agent-request-timeout.js';

describe('agent request timeout defaults', () => {
  it('기본 타임아웃은 60000ms다', () => {
    expect(DEFAULT_AGENT_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it('양의 정수 timeoutMs는 그대로 사용한다', () => {
    expect(resolveAgentRequestTimeoutMs(1)).toBe(1);
    expect(resolveAgentRequestTimeoutMs(45_000)).toBe(45_000);
  });

  it('미지정/잘못된 timeoutMs는 기본값으로 보정한다', () => {
    expect(resolveAgentRequestTimeoutMs(undefined)).toBe(DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
    expect(resolveAgentRequestTimeoutMs(0)).toBe(DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
    expect(resolveAgentRequestTimeoutMs(-1)).toBe(DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
    expect(resolveAgentRequestTimeoutMs(1.5)).toBe(DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
    expect(resolveAgentRequestTimeoutMs(Number.NaN)).toBe(DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
    expect(resolveAgentRequestTimeoutMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
  });
});
