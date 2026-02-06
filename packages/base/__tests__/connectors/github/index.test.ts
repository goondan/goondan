/**
 * GitHub Connector 테스트
 *
 * @see /packages/base/src/connectors/github/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  onGitHubEvent,
  createIssueComment,
  createPRReview,
} from '../../../src/connectors/github/index.js';
import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
} from '@goondan/core/connector';
import type { ConnectorSpec, IngressRule, Resource, JsonObject } from '@goondan/core';

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

interface MockTriggerContext {
  emit: Mock;
  logger: MockLogger;
  connector: Resource<ConnectorSpec>;
}

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockConnector(
  ingress?: IngressRule[]
): Resource<ConnectorSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name: 'github-connector' },
    spec: {
      type: 'github',
      runtime: 'node',
      entry: './connectors/github/index.js',
      ingress: ingress ?? [
        {
          route: {
            swarmRef: { name: 'test-swarm' },
          },
        },
      ],
      triggers: [{ handler: 'onGitHubEvent' }],
    },
  };
}

function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createMockContext(
  connector?: Resource<ConnectorSpec>,
  emittedEvents?: CanonicalEvent[]
): MockTriggerContext & { emittedEvents: CanonicalEvent[] } {
  const events: CanonicalEvent[] = emittedEvents ?? [];
  return {
    emit: vi.fn().mockImplementation((event: CanonicalEvent) => {
      events.push(event);
      return Promise.resolve();
    }),
    logger: createMockLogger(),
    connector: connector ?? createMockConnector(),
    emittedEvents: events,
  };
}

function createMockTriggerEvent(
  payload: JsonObject,
  metadata?: JsonObject
): TriggerEvent {
  const event: TriggerEvent = {
    type: 'webhook',
    payload,
    timestamp: new Date().toISOString(),
  };

  if (metadata) {
    event.metadata = metadata;
  }

  return event;
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
    issueState: string;
    senderLogin: string;
    senderId: number;
    senderType: string;
    repoFullName: string;
    repoName: string;
    ownerId: number;
    ownerLogin: string;
  }> = {}
): JsonObject {
  return {
    action: overrides.action ?? 'opened',
    repository: {
      id: 1,
      full_name: overrides.repoFullName ?? 'owner/repo',
      name: overrides.repoName ?? 'repo',
      owner: {
        id: overrides.ownerId ?? 100,
        login: overrides.ownerLogin ?? 'owner',
      },
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
      state: overrides.issueState ?? 'open',
      user: {
        id: overrides.senderId ?? 200,
        login: overrides.senderLogin ?? 'contributor',
      },
    },
  };
}

/**
 * GitHub PR 이벤트 페이로드 생성
 */
function createPRPayload(
  overrides: Partial<{
    action: string;
    prNumber: number;
    prTitle: string;
    prBody: string;
    prState: string;
    headRef: string;
    headSha: string;
    baseRef: string;
    baseSha: string;
    senderLogin: string;
    senderId: number;
    senderType: string;
    repoFullName: string;
    repoName: string;
  }> = {}
): JsonObject {
  return {
    action: overrides.action ?? 'opened',
    repository: {
      id: 1,
      full_name: overrides.repoFullName ?? 'owner/repo',
      name: overrides.repoName ?? 'repo',
      owner: {
        id: 100,
        login: 'owner',
      },
    },
    sender: {
      id: overrides.senderId ?? 200,
      login: overrides.senderLogin ?? 'contributor',
      type: overrides.senderType ?? 'User',
    },
    pull_request: {
      number: overrides.prNumber ?? 10,
      title: overrides.prTitle ?? 'Fix bug',
      body: overrides.prBody ?? 'This fixes the bug',
      state: overrides.prState ?? 'open',
      head: {
        ref: overrides.headRef ?? 'feature-branch',
        sha: overrides.headSha ?? 'abc123',
      },
      base: {
        ref: overrides.baseRef ?? 'main',
        sha: overrides.baseSha ?? 'def456',
      },
      user: {
        id: overrides.senderId ?? 200,
        login: overrides.senderLogin ?? 'contributor',
      },
    },
  };
}

/**
 * GitHub Push 이벤트 페이로드 생성
 */
function createPushPayload(
  overrides: Partial<{
    ref: string;
    before: string;
    after: string;
    senderLogin: string;
    senderId: number;
    repoFullName: string;
    commits: Array<{ id: string; message: string; author?: { name: string; email: string } }>;
  }> = {}
): JsonObject {
  return {
    ref: overrides.ref ?? 'refs/heads/main',
    before: overrides.before ?? '000000',
    after: overrides.after ?? 'abc123',
    repository: {
      id: 1,
      full_name: overrides.repoFullName ?? 'owner/repo',
      name: 'repo',
      owner: {
        id: 100,
        login: 'owner',
      },
    },
    sender: {
      id: overrides.senderId ?? 200,
      login: overrides.senderLogin ?? 'contributor',
      type: 'User',
    },
    commits: overrides.commits ?? [
      {
        id: 'abc123',
        message: 'Initial commit',
        author: { name: 'Contributor', email: 'contrib@example.com' },
      },
    ],
  };
}

/**
 * GitHub Issue Comment 이벤트 페이로드 생성
 */
function createIssueCommentPayload(
  overrides: Partial<{
    action: string;
    issueNumber: number;
    issueTitle: string;
    commentId: number;
    commentBody: string;
    senderLogin: string;
    senderId: number;
    repoFullName: string;
  }> = {}
): JsonObject {
  return {
    action: overrides.action ?? 'created',
    repository: {
      id: 1,
      full_name: overrides.repoFullName ?? 'owner/repo',
      name: 'repo',
      owner: {
        id: 100,
        login: 'owner',
      },
    },
    sender: {
      id: overrides.senderId ?? 200,
      login: overrides.senderLogin ?? 'commenter',
      type: 'User',
    },
    issue: {
      number: overrides.issueNumber ?? 42,
      title: overrides.issueTitle ?? 'Bug report',
    },
    comment: {
      id: overrides.commentId ?? 1001,
      body: overrides.commentBody ?? 'This is a comment',
      user: {
        id: overrides.senderId ?? 200,
        login: overrides.senderLogin ?? 'commenter',
      },
    },
  };
}

// ============================================================================
// Fetch Mock
// ============================================================================

let originalFetch: typeof global.fetch;

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<JsonObject>;
  text: () => Promise<string>;
  headers: Headers;
}

function createMockFetchResponse(body: JsonObject, ok = true): MockResponse {
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

describe('GitHub Connector', () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('onGitHubEvent Trigger Handler', () => {
    describe('Issue 이벤트', () => {
      it('issues 이벤트를 파싱하고 canonical event를 발행해야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssuePayload({
          action: 'opened',
          issueNumber: 42,
          issueTitle: 'Bug report',
          issueBody: 'Something is broken',
          repoFullName: 'myorg/myrepo',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emit).toHaveBeenCalledTimes(1);
        expect(ctx.emittedEvents.length).toBe(1);

        const emitted = ctx.emittedEvents[0];
        expect(emitted.type).toBe('issues');
        expect(emitted.instanceKey).toBe('github:myorg/myrepo:issue:42');
        expect(emitted.input).toContain('[Issue opened]');
        expect(emitted.input).toContain('#42: Bug report');
        expect(emitted.input).toContain('Something is broken');
      });

      it('이벤트 타입을 payload에서 추론할 수 있어야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssuePayload();
        // metadata에 githubEvent 없이 보내기
        const event = createMockTriggerEvent(payload);

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        expect(ctx.emittedEvents[0].type).toBe('issues');
      });
    });

    describe('Pull Request 이벤트', () => {
      it('pull_request 이벤트를 파싱하고 canonical event를 발행해야 함', async () => {
        const ctx = createMockContext();
        const payload = createPRPayload({
          action: 'opened',
          prNumber: 10,
          prTitle: 'Fix bug',
          prBody: 'This fixes the bug',
          headRef: 'feature-branch',
          baseRef: 'main',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'pull_request' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);

        const emitted = ctx.emittedEvents[0];
        expect(emitted.type).toBe('pull_request');
        expect(emitted.instanceKey).toBe('github:owner/repo:pr:10');
        expect(emitted.input).toContain('[PR opened]');
        expect(emitted.input).toContain('#10: Fix bug');
        expect(emitted.input).toContain('This fixes the bug');
      });

      it('PR metadata에 headRef와 baseRef가 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createPRPayload({
          headRef: 'feature',
          baseRef: 'main',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'pull_request' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        const metadata = ctx.emittedEvents[0].metadata;
        expect(metadata?.['headRef']).toBe('feature');
        expect(metadata?.['baseRef']).toBe('main');
      });
    });

    describe('Push 이벤트', () => {
      it('push 이벤트를 파싱하고 canonical event를 발행해야 함', async () => {
        const ctx = createMockContext();
        const payload = createPushPayload({
          ref: 'refs/heads/main',
          commits: [
            { id: 'abc', message: 'feat: new feature' },
            { id: 'def', message: 'fix: bug fix' },
          ],
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'push' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);

        const emitted = ctx.emittedEvents[0];
        expect(emitted.type).toBe('push');
        expect(emitted.instanceKey).toBe('github:owner/repo:push:refs/heads/main');
        expect(emitted.input).toContain('[Push to refs/heads/main]');
        expect(emitted.input).toContain('2 commit(s)');
        expect(emitted.input).toContain('- feat: new feature');
        expect(emitted.input).toContain('- fix: bug fix');
      });

      it('push metadata에 before, after, commitCount가 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createPushPayload({
          before: '000',
          after: 'abc',
          commits: [{ id: 'abc', message: 'commit' }],
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'push' });

        await onGitHubEvent(event, {}, ctx);

        const metadata = ctx.emittedEvents[0].metadata;
        expect(metadata?.['before']).toBe('000');
        expect(metadata?.['after']).toBe('abc');
        expect(metadata?.['commitCount']).toBe(1);
      });
    });

    describe('Issue Comment 이벤트', () => {
      it('issue_comment 이벤트를 파싱하고 canonical event를 발행해야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssueCommentPayload({
          issueNumber: 42,
          commentBody: 'This is a helpful comment',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issue_comment' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);

        const emitted = ctx.emittedEvents[0];
        expect(emitted.type).toBe('issue_comment');
        expect(emitted.instanceKey).toBe('github:owner/repo:issue:42');
        expect(emitted.input).toContain('[Comment on #42]');
        expect(emitted.input).toContain('This is a helpful comment');
      });
    });

    describe('봇 이벤트 무시 로직', () => {
      it('sender.type이 Bot이면 무시해야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssuePayload({
          senderType: 'Bot',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith('[GitHub] Ignoring bot event');
      });
    });

    describe('유효하지 않은 페이로드 처리', () => {
      it('빈 페이로드는 경고 로그를 남기고 무시해야 함', async () => {
        const ctx = createMockContext();
        const event = createMockTriggerEvent({});

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[GitHub] Invalid webhook payload received');
      });

      it('repository가 없으면 경고해야 함', async () => {
        const ctx = createMockContext();
        const payload: JsonObject = {
          sender: {
            id: 200,
            login: 'user',
            type: 'User',
          },
        };
        const event = createMockTriggerEvent(payload);

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledWith('[GitHub] No repository info in payload');
      });
    });

    describe('TurnAuth 생성', () => {
      it('올바른 actor 정보를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssuePayload({
          senderLogin: 'alice',
          senderId: 300,
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.actor.type).toBe('user');
        expect(auth?.actor.id).toBe('github:alice');
        expect(auth?.actor.display).toBe('alice');
      });

      it('올바른 subjects를 생성해야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssuePayload({
          senderId: 300,
          repoFullName: 'myorg/myrepo',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        const auth = ctx.emittedEvents[0].auth;
        expect(auth?.subjects.global).toBe('github:repo:myorg/myrepo');
        expect(auth?.subjects.user).toBe('github:user:300');
      });
    });

    describe('Origin 정보 생성', () => {
      it('Issue 이벤트 origin이 올바르게 생성되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createIssuePayload({
          action: 'opened',
          issueNumber: 42,
          repoFullName: 'myorg/myrepo',
          senderLogin: 'alice',
        });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        const origin = ctx.emittedEvents[0].origin;
        expect(origin?.['connector']).toBe('github-connector');
        expect(origin?.['eventType']).toBe('issues');
        expect(origin?.['repository']).toBe('myorg/myrepo');
        expect(origin?.['action']).toBe('opened');
        expect(origin?.['sender']).toBe('alice');
        expect(origin?.['issueNumber']).toBe(42);
      });

      it('PR 이벤트 origin에 prNumber가 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createPRPayload({ prNumber: 10 });
        const event = createMockTriggerEvent(payload, { githubEvent: 'pull_request' });

        await onGitHubEvent(event, {}, ctx);

        const origin = ctx.emittedEvents[0].origin;
        expect(origin?.['prNumber']).toBe(10);
      });

      it('Push 이벤트 origin에 ref가 포함되어야 함', async () => {
        const ctx = createMockContext();
        const payload = createPushPayload({ ref: 'refs/heads/main' });
        const event = createMockTriggerEvent(payload, { githubEvent: 'push' });

        await onGitHubEvent(event, {}, ctx);

        const origin = ctx.emittedEvents[0].origin;
        expect(origin?.['ref']).toBe('refs/heads/main');
      });
    });

    describe('Ingress 규칙 매칭', () => {
      it('eventType 매칭이 적용되어야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              match: { eventType: 'pull_request' },
              route: { swarmRef: { name: 'pr-swarm' } },
            },
            {
              match: { eventType: 'issues' },
              route: { swarmRef: { name: 'issue-swarm' } },
            },
          ])
        );

        const payload = createIssuePayload();
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents.length).toBe(1);
        expect(ctx.emittedEvents[0].swarmRef).toEqual({ name: 'issue-swarm' });
      });

      it('channel(repo) 매칭이 적용되어야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              match: { channel: 'myorg/specific-repo' },
              route: { swarmRef: { name: 'specific-swarm' } },
            },
            {
              route: { swarmRef: { name: 'default-swarm' } },
            },
          ])
        );

        const payload = createIssuePayload({ repoFullName: 'myorg/specific-repo' });
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents[0].swarmRef).toEqual({ name: 'specific-swarm' });
      });

      it('매칭되는 ingress 규칙이 없으면 debug 로그를 남겨야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              match: { eventType: 'pull_request' },
              route: { swarmRef: { name: 'pr-swarm' } },
            },
          ])
        );

        const payload = createIssuePayload();
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emit).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('[GitHub] No matching ingress rule')
        );
      });

      it('agentName이 지정되면 포함해야 함', async () => {
        const ctx = createMockContext(
          createMockConnector([
            {
              route: {
                swarmRef: { name: 'test-swarm' },
                agentName: 'code-reviewer',
              },
            },
          ])
        );

        const payload = createPRPayload();
        const event = createMockTriggerEvent(payload, { githubEvent: 'pull_request' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.emittedEvents[0].agentName).toBe('code-reviewer');
      });

      it('swarmRef가 없는 route는 경고하고 건너뛰어야 함', async () => {
        const invalidIngressJson = JSON.stringify([
          { route: {} },
        ]);
        const invalidIngress: IngressRule[] = JSON.parse(invalidIngressJson);

        const ctx = createMockContext(createMockConnector(invalidIngress));
        const payload = createIssuePayload();
        const event = createMockTriggerEvent(payload, { githubEvent: 'issues' });

        await onGitHubEvent(event, {}, ctx);

        expect(ctx.logger.warn).toHaveBeenCalledWith('[GitHub] No swarmRef in route');
      });
    });
  });

  describe('createIssueComment API 함수', () => {
    it('성공적인 코멘트 작성시 ok: true를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        id: 1001,
        body: 'Test comment',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await createIssueComment(
        'ghp_token',
        'owner',
        'repo',
        42,
        'Test comment'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'token ghp_token',
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result.ok).toBe(true);
      expect(result.id).toBe(1001);
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        message: 'Not Found',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

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

    it('유효하지 않은 응답 형식 시 에러를 반환해야 함', async () => {
      const invalidMockResponse = {
        ok: true,
        status: 201,
        statusText: 'Created',
        json: () => Promise.resolve('invalid'),
        text: () => Promise.resolve('invalid'),
        headers: new Headers(),
      };
      global.fetch = vi.fn().mockResolvedValue(invalidMockResponse);

      const result = await createIssueComment('ghp_token', 'owner', 'repo', 42, 'comment');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid response format');
    });
  });

  describe('createPRReview API 함수', () => {
    it('성공적인 리뷰 작성시 ok: true를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        id: 2001,
        body: 'LGTM',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await createPRReview(
        'ghp_token',
        'owner',
        'repo',
        10,
        'LGTM',
        'APPROVE'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/pulls/10/reviews',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'token ghp_token',
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result.ok).toBe(true);
      expect(result.id).toBe(2001);
    });

    it('기본 이벤트 타입은 COMMENT여야 함', async () => {
      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          capturedBody = init.body;
        }
        return Promise.resolve(createMockFetchResponse({ id: 2001 }));
      });

      await createPRReview('ghp_token', 'owner', 'repo', 10, 'Review');

      expect(capturedBody).toBeDefined();
      const parsed: unknown = JSON.parse(capturedBody ?? '{}');
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        expect(record['event']).toBe('COMMENT');
      }
    });

    it('API 에러 시 ok: false와 에러 메시지를 반환해야 함', async () => {
      const mockResponse = createMockFetchResponse({
        message: 'Validation Failed',
      });
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

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
