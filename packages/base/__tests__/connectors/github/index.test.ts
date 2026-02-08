/**
 * GitHub Connector 테스트 (v1.0)
 *
 * @see /packages/base/src/connectors/github/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createHmac } from 'node:crypto';
import githubConnector, {
  createIssueComment,
  createPRReview,
} from '../../../src/connectors/github/index.js';
import type {
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEvent,
  Resource,
  ConnectionSpec,
  ConnectorSpec,
  JsonObject,
} from '@goondan/core';

// ============================================================================
// Mock 타입 정의
// ============================================================================

interface MockLogger {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  log: Mock;
}

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createMockConnectorContext(
  body: JsonObject,
  headers: Record<string, string> = {},
  rawBody?: string,
): { context: ConnectorContext; emittedEvents: ConnectorEvent[] } {
  const emittedEvents: ConnectorEvent[] = [];
  const triggerEvent: ConnectorTriggerEvent = {
    type: 'connector.trigger',
    trigger: {
      type: 'http',
      payload: {
        request: {
          method: 'POST',
          path: '/github/webhook',
          headers,
          body,
          rawBody,
        },
      },
    },
    timestamp: new Date().toISOString(),
  };

  const context: ConnectorContext = {
    event: triggerEvent,
    connection: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connection',
      metadata: { name: 'github-connection' },
      spec: {
        connectorRef: { name: 'github' },
      },
    } as Resource<ConnectionSpec>,
    connector: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connector',
      metadata: { name: 'github-connector' },
      spec: {
        runtime: 'node',
        entry: './connectors/github/index.js',
        triggers: [{ type: 'http', endpoint: { path: '/github/webhook', method: 'POST' } }],
        events: [
          { name: 'github.push', properties: { repository: { type: 'string' }, ref: { type: 'string' }, action: { type: 'string', optional: true } } },
          { name: 'github.pull_request', properties: { repository: { type: 'string' }, action: { type: 'string', optional: true } } },
          { name: 'github.issues', properties: { repository: { type: 'string' }, action: { type: 'string', optional: true } } },
          { name: 'github.issue_comment', properties: { repository: { type: 'string' }, action: { type: 'string', optional: true } } },
        ],
      },
    } as Resource<ConnectorSpec>,
    emit: vi.fn().mockImplementation((event: ConnectorEvent) => {
      emittedEvents.push(event);
      return Promise.resolve();
    }),
    logger: createMockLogger() as unknown as Console,
  };

  return { context, emittedEvents };
}

function createGithubSignatureHeader(rawBody: string, signingSecret: string): string {
  return `sha256=${createHmac('sha256', signingSecret).update(rawBody).digest('hex')}`;
}

/**
 * GitHub Issue 이벤트 페이로드 생성
 */
function createIssuePayload(
  overrides: Partial<{
    action: string;
    issueNumber: number;
    issueTitle: string;
    issueBody: string;
    senderLogin: string;
    senderId: number;
    senderType: string;
    repoFullName: string;
  }> = {}
): JsonObject {
  return {
    action: overrides.action ?? 'opened',
    repository: {
      id: 1,
      full_name: overrides.repoFullName ?? 'owner/repo',
      name: 'repo',
      owner: { id: 100, login: 'owner' },
    },
    sender: {
      id: overrides.senderId ?? 200,
      login: overrides.senderLogin ?? 'contributor',
      type: overrides.senderType ?? 'User',
    },
    issue: {
      number: overrides.issueNumber ?? 42,
      title: overrides.issueTitle ?? 'Bug report',
      body: overrides.issueBody ?? 'Something is broken',
      state: 'open',
      user: { id: overrides.senderId ?? 200, login: overrides.senderLogin ?? 'contributor' },
    },
  };
}

function createPRPayload(
  overrides: Partial<{
    action: string;
    prNumber: number;
    prTitle: string;
    prBody: string;
    headRef: string;
    baseRef: string;
    senderLogin: string;
    senderId: number;
    senderType: string;
    repoFullName: string;
  }> = {}
): JsonObject {
  return {
    action: overrides.action ?? 'opened',
    repository: { id: 1, full_name: overrides.repoFullName ?? 'owner/repo', name: 'repo', owner: { id: 100, login: 'owner' } },
    sender: { id: overrides.senderId ?? 200, login: overrides.senderLogin ?? 'contributor', type: overrides.senderType ?? 'User' },
    pull_request: {
      number: overrides.prNumber ?? 10,
      title: overrides.prTitle ?? 'Fix bug',
      body: overrides.prBody ?? 'This fixes the bug',
      state: 'open',
      head: { ref: overrides.headRef ?? 'feature-branch', sha: 'abc123' },
      base: { ref: overrides.baseRef ?? 'main', sha: 'def456' },
      user: { id: overrides.senderId ?? 200, login: overrides.senderLogin ?? 'contributor' },
    },
  };
}

function createPushPayload(
  overrides: Partial<{
    ref: string;
    before: string;
    after: string;
    senderLogin: string;
    senderId: number;
    commits: Array<{ id: string; message: string; author?: { name: string; email: string } }>;
  }> = {}
): JsonObject {
  return {
    ref: overrides.ref ?? 'refs/heads/main',
    before: overrides.before ?? '000000',
    after: overrides.after ?? 'abc123',
    repository: { id: 1, full_name: 'owner/repo', name: 'repo', owner: { id: 100, login: 'owner' } },
    sender: { id: overrides.senderId ?? 200, login: overrides.senderLogin ?? 'contributor', type: 'User' },
    commits: overrides.commits ?? [
      { id: 'abc123', message: 'Initial commit', author: { name: 'Contributor', email: 'contrib@example.com' } },
    ],
  };
}

function createIssueCommentPayload(
  overrides: Partial<{
    action: string;
    issueNumber: number;
    commentBody: string;
    senderLogin: string;
    senderId: number;
    repoFullName: string;
  }> = {}
): JsonObject {
  return {
    action: overrides.action ?? 'created',
    repository: { id: 1, full_name: overrides.repoFullName ?? 'owner/repo', name: 'repo', owner: { id: 100, login: 'owner' } },
    sender: { id: overrides.senderId ?? 200, login: overrides.senderLogin ?? 'commenter', type: 'User' },
    issue: { number: overrides.issueNumber ?? 42, title: 'Bug report' },
    comment: { id: 1001, body: overrides.commentBody ?? 'This is a comment', user: { id: overrides.senderId ?? 200, login: overrides.senderLogin ?? 'commenter' } },
  };
}

// ============================================================================
// Fetch Mock
// ============================================================================

let originalFetch: typeof global.fetch;

function createMockFetchResponse(body: JsonObject, ok = true) {
  return {
    ok,
    status: ok ? 201 : 400,
    statusText: ok ? 'Created' : 'Bad Request',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('GitHub Connector (v1.0)', () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Entry Function', () => {
    describe('서명 검증', () => {
      it('유효한 x-hub-signature-256 헤더가 있으면 emit을 수행해야 함', async () => {
        const payload = createIssuePayload();
        const rawBody = JSON.stringify(payload);
        const signingSecret = 'github-secret';
        const { context, emittedEvents } = createMockConnectorContext(
          payload,
          {
            'x-github-event': 'issues',
            'x-hub-signature-256': createGithubSignatureHeader(rawBody, signingSecret),
          },
          rawBody,
        );
        context.verify = {
          webhook: { signingSecret },
        };

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
      });

      it('서명이 유효하지 않으면 emit을 중단해야 함', async () => {
        const payload = createIssuePayload();
        const rawBody = JSON.stringify(payload);
        const { context, emittedEvents } = createMockConnectorContext(
          payload,
          {
            'x-github-event': 'issues',
            'x-hub-signature-256': 'sha256=invalid-signature',
          },
          rawBody,
        );
        context.verify = {
          webhook: { signingSecret: 'github-secret' },
        };

        await githubConnector(context);

        expect(emittedEvents.length).toBe(0);
        expect(context.logger.warn).toHaveBeenCalledWith('[GitHub] Signature verification failed');
      });
    });

    describe('Issue 이벤트', () => {
      it('issues 이벤트를 파싱하고 ConnectorEvent를 발행해야 함', async () => {
        const payload = createIssuePayload({ action: 'opened', issueNumber: 42, issueTitle: 'Bug report', issueBody: 'Something is broken', repoFullName: 'myorg/myrepo' });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'issues' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
        const emitted = emittedEvents[0];
        expect(emitted.type).toBe('connector.event');
        expect(emitted.name).toBe('github.issues');
        expect(emitted.message.type).toBe('text');
        if (emitted.message.type === 'text') {
          expect(emitted.message.text).toContain('[Issue opened]');
          expect(emitted.message.text).toContain('#42: Bug report');
          expect(emitted.message.text).toContain('Something is broken');
        }
        expect(emitted.properties?.['repository']).toBe('myorg/myrepo');
      });

      it('이벤트 타입을 payload에서 추론할 수 있어야 함', async () => {
        const payload = createIssuePayload();
        const { context, emittedEvents } = createMockConnectorContext(payload);

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
        expect(emittedEvents[0].name).toBe('github.issues');
      });
    });

    describe('Pull Request 이벤트', () => {
      it('pull_request 이벤트를 파싱하고 ConnectorEvent를 발행해야 함', async () => {
        const payload = createPRPayload({ action: 'opened', prNumber: 10, prTitle: 'Fix bug', prBody: 'This fixes the bug' });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'pull_request' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
        const emitted = emittedEvents[0];
        expect(emitted.name).toBe('github.pull_request');
        if (emitted.message.type === 'text') {
          expect(emitted.message.text).toContain('[PR opened]');
          expect(emitted.message.text).toContain('#10: Fix bug');
        }
      });
    });

    describe('Push 이벤트', () => {
      it('push 이벤트를 파싱하고 ConnectorEvent를 발행해야 함', async () => {
        const payload = createPushPayload({
          ref: 'refs/heads/main',
          commits: [
            { id: 'abc', message: 'feat: new feature' },
            { id: 'def', message: 'fix: bug fix' },
          ],
        });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'push' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
        const emitted = emittedEvents[0];
        expect(emitted.name).toBe('github.push');
        if (emitted.message.type === 'text') {
          expect(emitted.message.text).toContain('[Push to refs/heads/main]');
          expect(emitted.message.text).toContain('2 commit(s)');
        }
        expect(emitted.properties?.['ref']).toBe('refs/heads/main');
      });

      it('push 이벤트에서 ref가 없으면 emit하지 않아야 함', async () => {
        const payload: JsonObject = {
          before: '000000',
          after: 'abc123',
          repository: {
            id: 1,
            full_name: 'owner/repo',
            name: 'repo',
            owner: { id: 100, login: 'owner' },
          },
          sender: { id: 200, login: 'contributor', type: 'User' },
          commits: [
            { id: 'abc123', message: 'Initial commit' },
          ],
        };
        const { context, emittedEvents } = createMockConnectorContext(payload, {
          'x-github-event': 'push',
        });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(0);
        expect(context.logger.warn).toHaveBeenCalledWith('[GitHub] Missing ref for push event');
      });
    });

    describe('Issue Comment 이벤트', () => {
      it('issue_comment 이벤트를 파싱하고 ConnectorEvent를 발행해야 함', async () => {
        const payload = createIssueCommentPayload({ issueNumber: 42, commentBody: 'This is a helpful comment' });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'issue_comment' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
        const emitted = emittedEvents[0];
        expect(emitted.name).toBe('github.issue_comment');
        if (emitted.message.type === 'text') {
          expect(emitted.message.text).toContain('[Comment on #42]');
          expect(emitted.message.text).toContain('This is a helpful comment');
        }
        expect(emitted.properties?.['repository']).toBe('owner/repo');
        expect(emitted.properties?.['action']).toBe('created');
      });
    });

    describe('지원되지 않는 이벤트 처리', () => {
      it('events 스키마에 없는 이벤트는 emit하지 않아야 함', async () => {
        const payload = createIssuePayload();
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'fork' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(0);
      });
    });

    describe('봇 이벤트 무시 로직', () => {
      it('sender.type이 Bot이면 무시해야 함', async () => {
        const payload = createIssuePayload({ senderType: 'Bot' });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'issues' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(0);
      });
    });

    describe('유효하지 않은 페이로드 처리', () => {
      it('빈 페이로드는 경고 로그를 남기고 무시해야 함', async () => {
        const { context, emittedEvents } = createMockConnectorContext({});

        await githubConnector(context);

        expect(emittedEvents.length).toBe(0);
      });

      it('repository가 없으면 경고해야 함', async () => {
        const payload: JsonObject = { sender: { id: 200, login: 'user', type: 'User' } };
        const { context, emittedEvents } = createMockConnectorContext(payload);

        await githubConnector(context);

        expect(emittedEvents.length).toBe(0);
      });
    });

    describe('auth 정보 생성', () => {
      it('올바른 actor 정보를 생성해야 함', async () => {
        const payload = createIssuePayload({ senderLogin: 'alice', senderId: 300 });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'issues' });

        await githubConnector(context);

        expect(emittedEvents.length).toBe(1);
        const auth = emittedEvents[0].auth;
        expect(auth?.actor.id).toBe('github:alice');
        expect(auth?.actor.name).toBe('alice');
      });

      it('올바른 subjects를 생성해야 함', async () => {
        const payload = createIssuePayload({ senderId: 300, repoFullName: 'myorg/myrepo' });
        const { context, emittedEvents } = createMockConnectorContext(payload, { 'x-github-event': 'issues' });

        await githubConnector(context);

        const auth = emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('github:repo:myorg/myrepo');
        expect(auth?.subjects.user).toBe('github:user:300');
      });
    });
  });

  describe('createIssueComment API 함수', () => {
    it('성공적인 코멘트 작성시 ok: true를 반환해야 함', async () => {
      global.fetch = vi.fn().mockResolvedValue(createMockFetchResponse({ id: 1001, body: 'Test comment' }));

      const result = await createIssueComment('ghp_token', 'owner', 'repo', 42, 'Test comment');

      expect(result.ok).toBe(true);
      expect(result.id).toBe(1001);
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockResolvedValue(createMockFetchResponse({ message: 'Not Found' }));

      const result = await createIssueComment('ghp_token', 'owner', 'repo', 9999, 'comment');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not Found');
    });

    it('네트워크 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await createIssueComment('ghp_token', 'owner', 'repo', 42, 'comment');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('createPRReview API 함수', () => {
    it('성공적인 리뷰 작성시 ok: true를 반환해야 함', async () => {
      global.fetch = vi.fn().mockResolvedValue(createMockFetchResponse({ id: 2001, body: 'LGTM' }));

      const result = await createPRReview('ghp_token', 'owner', 'repo', 10, 'LGTM', 'APPROVE');

      expect(result.ok).toBe(true);
      expect(result.id).toBe(2001);
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockResolvedValue(createMockFetchResponse({ message: 'Validation Failed' }));

      const result = await createPRReview('ghp_token', 'owner', 'repo', 10, 'review');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Validation Failed');
    });

    it('네트워크 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Timeout'));

      const result = await createPRReview('ghp_token', 'owner', 'repo', 10, 'review');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Timeout');
    });
  });
});
