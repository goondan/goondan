/**
 * GitHub Connector 구현
 *
 * GitHub Webhook 이벤트를 처리하여 canonical event로 변환하고,
 * 에이전트 응답을 GitHub API를 통해 전송한다.
 *
 * @see /docs/specs/connector.md
 * @packageDocumentation
 */

import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  ConnectorTurnAuth,
} from '@goondan/core/connector';
import type { JsonObject } from '@goondan/core';

/**
 * TurnAuth 타입 별칭
 */
type TurnAuth = ConnectorTurnAuth;

// ============================================================================
// Types
// ============================================================================

/**
 * GitHub Webhook 페이로드 공통 필드
 */
export interface GitHubWebhookPayload {
  /** 액션 (opened, closed, created, synchronize 등) */
  action?: string;
  /** 리포지토리 정보 */
  repository?: GitHubRepository;
  /** 이벤트 발생자 */
  sender?: GitHubUser;
  /** Issue 정보 (issues 이벤트) */
  issue?: GitHubIssue;
  /** Pull Request 정보 (pull_request 이벤트) */
  pull_request?: GitHubPullRequest;
  /** 코멘트 정보 (issue_comment, pull_request_review_comment 이벤트) */
  comment?: GitHubComment;
  /** Push 이벤트 정보 */
  ref?: string;
  /** 커밋 목록 (push 이벤트) */
  commits?: GitHubCommit[];
  /** before SHA (push 이벤트) */
  before?: string;
  /** after SHA (push 이벤트) */
  after?: string;
}

/**
 * GitHub 리포지토리 정보
 */
export interface GitHubRepository {
  /** 리포지토리 ID */
  id: number;
  /** 전체 이름 (owner/repo) */
  full_name: string;
  /** 리포지토리 이름 */
  name: string;
  /** 소유자 정보 */
  owner: GitHubUser;
}

/**
 * GitHub 사용자 정보
 */
export interface GitHubUser {
  /** 사용자 ID */
  id: number;
  /** 로그인명 */
  login: string;
  /** 사용자 타입 (User, Bot, Organization) */
  type?: string;
}

/**
 * GitHub Issue 정보
 */
export interface GitHubIssue {
  /** Issue 번호 */
  number: number;
  /** 제목 */
  title: string;
  /** 본문 */
  body?: string;
  /** 상태 (open, closed) */
  state?: string;
  /** 작성자 */
  user?: GitHubUser;
}

/**
 * GitHub Pull Request 정보
 */
export interface GitHubPullRequest {
  /** PR 번호 */
  number: number;
  /** 제목 */
  title: string;
  /** 본문 */
  body?: string;
  /** 상태 (open, closed) */
  state?: string;
  /** head 브랜치 정보 */
  head?: GitHubBranchRef;
  /** base 브랜치 정보 */
  base?: GitHubBranchRef;
  /** 작성자 */
  user?: GitHubUser;
}

/**
 * GitHub 브랜치 참조
 */
export interface GitHubBranchRef {
  /** 브랜치 이름 */
  ref: string;
  /** SHA */
  sha: string;
}

/**
 * GitHub 코멘트
 */
export interface GitHubComment {
  /** 코멘트 ID */
  id: number;
  /** 본문 */
  body: string;
  /** 작성자 */
  user?: GitHubUser;
}

/**
 * GitHub 커밋
 */
export interface GitHubCommit {
  /** SHA */
  id: string;
  /** 커밋 메시지 */
  message: string;
  /** 작성자 */
  author?: { name: string; email: string };
}

/**
 * GitHub API 응답 타입
 */
export interface GitHubApiResponse {
  /** 코멘트/PR ID (성공 시) */
  id?: number;
  /** 에러 메시지 */
  message?: string;
}

// ============================================================================
// Type Guards and Parsers
// ============================================================================

/**
 * object 타입 가드
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * string 타입 가드
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * number 타입 가드
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

/**
 * GitHub User 파싱
 */
function parseGitHubUser(obj: unknown): GitHubUser | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const id = obj['id'];
  const login = obj['login'];
  if (!isNumber(id) || !isString(login)) {
    return undefined;
  }

  const user: GitHubUser = { id, login };

  const type = obj['type'];
  if (isString(type)) {
    user.type = type;
  }

  return user;
}

/**
 * GitHub Repository 파싱
 */
function parseGitHubRepository(obj: unknown): GitHubRepository | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const id = obj['id'];
  const fullName = obj['full_name'];
  const name = obj['name'];
  if (!isNumber(id) || !isString(fullName) || !isString(name)) {
    return undefined;
  }

  const owner = parseGitHubUser(obj['owner']);
  if (!owner) {
    return undefined;
  }

  return { id, full_name: fullName, name, owner };
}

/**
 * GitHub Issue 파싱
 */
function parseGitHubIssue(obj: unknown): GitHubIssue | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const num = obj['number'];
  const title = obj['title'];
  if (!isNumber(num) || !isString(title)) {
    return undefined;
  }

  const issue: GitHubIssue = { number: num, title };

  const body = obj['body'];
  if (isString(body)) {
    issue.body = body;
  }

  const state = obj['state'];
  if (isString(state)) {
    issue.state = state;
  }

  const user = parseGitHubUser(obj['user']);
  if (user) {
    issue.user = user;
  }

  return issue;
}

/**
 * GitHub Branch Ref 파싱
 */
function parseGitHubBranchRef(obj: unknown): GitHubBranchRef | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const ref = obj['ref'];
  const sha = obj['sha'];
  if (!isString(ref) || !isString(sha)) {
    return undefined;
  }

  return { ref, sha };
}

/**
 * GitHub Pull Request 파싱
 */
function parseGitHubPullRequest(obj: unknown): GitHubPullRequest | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const num = obj['number'];
  const title = obj['title'];
  if (!isNumber(num) || !isString(title)) {
    return undefined;
  }

  const pr: GitHubPullRequest = { number: num, title };

  const body = obj['body'];
  if (isString(body)) {
    pr.body = body;
  }

  const state = obj['state'];
  if (isString(state)) {
    pr.state = state;
  }

  const head = parseGitHubBranchRef(obj['head']);
  if (head) {
    pr.head = head;
  }

  const base = parseGitHubBranchRef(obj['base']);
  if (base) {
    pr.base = base;
  }

  const user = parseGitHubUser(obj['user']);
  if (user) {
    pr.user = user;
  }

  return pr;
}

/**
 * GitHub Comment 파싱
 */
function parseGitHubComment(obj: unknown): GitHubComment | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const id = obj['id'];
  const body = obj['body'];
  if (!isNumber(id) || !isString(body)) {
    return undefined;
  }

  const comment: GitHubComment = { id, body };

  const user = parseGitHubUser(obj['user']);
  if (user) {
    comment.user = user;
  }

  return comment;
}

/**
 * GitHub Commit 파싱
 */
function parseGitHubCommit(obj: unknown): GitHubCommit | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const id = obj['id'];
  const message = obj['message'];
  if (!isString(id) || !isString(message)) {
    return undefined;
  }

  const commit: GitHubCommit = { id, message };

  const author = obj['author'];
  if (isObject(author)) {
    const name = author['name'];
    const email = author['email'];
    if (isString(name) && isString(email)) {
      commit.author = { name, email };
    }
  }

  return commit;
}

/**
 * GitHub Webhook 페이로드를 파싱한다.
 *
 * @param obj - 파싱할 객체
 * @param eventType - X-GitHub-Event 헤더에서 추출한 이벤트 타입
 * @returns GitHubWebhookPayload 또는 undefined
 */
function parseGitHubWebhookPayload(obj: unknown): GitHubWebhookPayload | undefined {
  if (!isObject(obj)) {
    return undefined;
  }

  const payload: GitHubWebhookPayload = {};

  const action = obj['action'];
  if (isString(action)) {
    payload.action = action;
  }

  const repository = parseGitHubRepository(obj['repository']);
  if (repository) {
    payload.repository = repository;
  }

  const sender = parseGitHubUser(obj['sender']);
  if (sender) {
    payload.sender = sender;
  }

  const issue = parseGitHubIssue(obj['issue']);
  if (issue) {
    payload.issue = issue;
  }

  const pullRequest = parseGitHubPullRequest(obj['pull_request']);
  if (pullRequest) {
    payload.pull_request = pullRequest;
  }

  const comment = parseGitHubComment(obj['comment']);
  if (comment) {
    payload.comment = comment;
  }

  const ref = obj['ref'];
  if (isString(ref)) {
    payload.ref = ref;
  }

  const before = obj['before'];
  if (isString(before)) {
    payload.before = before;
  }

  const after = obj['after'];
  if (isString(after)) {
    payload.after = after;
  }

  const commits = obj['commits'];
  if (Array.isArray(commits)) {
    const parsedCommits: GitHubCommit[] = [];
    for (const c of commits) {
      const parsed = parseGitHubCommit(c);
      if (parsed) {
        parsedCommits.push(parsed);
      }
    }
    if (parsedCommits.length > 0) {
      payload.commits = parsedCommits;
    }
  }

  // repository 또는 sender가 있어야 유효한 GitHub Webhook payload
  if (!payload.repository && !payload.sender) {
    return undefined;
  }

  return payload;
}

/**
 * TriggerEvent에서 GitHub 이벤트 타입을 추출한다.
 * metadata.githubEvent에 X-GitHub-Event 헤더 값을 기대한다.
 *
 * @param event - TriggerEvent
 * @returns 이벤트 타입 문자열
 */
function resolveEventType(event: TriggerEvent, payload: GitHubWebhookPayload): string {
  // metadata에서 이벤트 타입 추출 시도
  if (event.metadata) {
    const githubEvent = event.metadata['githubEvent'];
    if (isString(githubEvent)) {
      return githubEvent;
    }
  }

  // payload 구조에서 이벤트 타입 추론
  if (payload.pull_request) {
    return 'pull_request';
  }
  if (payload.issue) {
    if (payload.comment) {
      return 'issue_comment';
    }
    return 'issues';
  }
  if (payload.commits) {
    return 'push';
  }

  return 'unknown';
}

// ============================================================================
// Trigger Handler
// ============================================================================

/**
 * GitHub Webhook 이벤트를 처리하는 트리거 핸들러
 *
 * @param event - 트리거 이벤트
 * @param _connection - 연결 설정 (현재 미사용)
 * @param ctx - 트리거 컨텍스트
 */
export async function onGitHubEvent(
  event: TriggerEvent,
  _connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  // 페이로드 파싱
  const payload = parseGitHubWebhookPayload(event.payload);
  if (!payload) {
    ctx.logger.warn('[GitHub] Invalid webhook payload received');
    return;
  }

  // 이벤트 타입 결정
  const eventType = resolveEventType(event, payload);

  // 리포지토리 정보
  const repo = payload.repository;
  if (!repo) {
    ctx.logger.warn('[GitHub] No repository info in payload');
    return;
  }

  // 봇 이벤트 무시 (무한 루프 방지)
  if (payload.sender?.type === 'Bot') {
    ctx.logger.debug('[GitHub] Ignoring bot event');
    return;
  }

  const connector = ctx.connector;
  const connectorName = connector.metadata?.name ?? 'github';
  const ingressRules = connector.spec?.ingress ?? [];

  // Ingress 규칙 매칭
  for (const rule of ingressRules) {
    const match = rule.match ?? {};
    const route = rule.route;

    if (!route?.swarmRef) {
      ctx.logger.warn('[GitHub] No swarmRef in route');
      continue;
    }

    // eventType 매칭
    if (match.eventType && match.eventType !== eventType) {
      continue;
    }

    // channel 매칭 (repo full_name으로 매칭)
    if (match.channel && match.channel !== repo.full_name) {
      continue;
    }

    // instanceKey 생성
    const instanceKey = buildInstanceKey(eventType, repo, payload);

    // input 추출
    const input = buildInput(eventType, payload);

    // TurnAuth 생성
    const auth = createTurnAuth(payload.sender, repo);

    // Origin 정보 생성
    const origin = createOrigin(eventType, payload, connectorName);

    // metadata 생성
    const metadata = buildMetadata(eventType, payload);

    // Canonical event 생성
    const canonicalEvent: CanonicalEvent = {
      type: eventType,
      swarmRef: route.swarmRef,
      instanceKey,
      input,
      origin,
      auth,
    };

    if (Object.keys(metadata).length > 0) {
      canonicalEvent.metadata = metadata;
    }

    if (route.agentName) {
      canonicalEvent.agentName = route.agentName;
    }

    await ctx.emit(canonicalEvent);

    ctx.logger.info(
      `[GitHub] Emitted canonical event: type=${eventType}, ` +
      `repo=${repo.full_name}, action=${payload.action ?? 'none'}`
    );
    return;
  }

  ctx.logger.debug(
    `[GitHub] No matching ingress rule for event: type=${eventType}, repo=${repo.full_name}`
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * instanceKey를 생성한다.
 *
 * @param eventType - GitHub 이벤트 타입
 * @param repo - 리포지토리 정보
 * @param payload - Webhook 페이로드
 * @returns instanceKey
 */
function buildInstanceKey(
  eventType: string,
  repo: GitHubRepository,
  payload: GitHubWebhookPayload
): string {
  const repoKey = repo.full_name;

  switch (eventType) {
    case 'issues':
    case 'issue_comment':
      if (payload.issue) {
        return `github:${repoKey}:issue:${payload.issue.number}`;
      }
      break;
    case 'pull_request':
      if (payload.pull_request) {
        return `github:${repoKey}:pr:${payload.pull_request.number}`;
      }
      break;
    case 'push':
      if (payload.ref) {
        return `github:${repoKey}:push:${payload.ref}`;
      }
      break;
  }

  return `github:${repoKey}:${eventType}`;
}

/**
 * 이벤트에서 LLM 입력 텍스트를 생성한다.
 *
 * @param eventType - GitHub 이벤트 타입
 * @param payload - Webhook 페이로드
 * @returns 입력 텍스트
 */
function buildInput(eventType: string, payload: GitHubWebhookPayload): string {
  switch (eventType) {
    case 'issues':
      if (payload.issue) {
        const body = payload.issue.body ? `\n\n${payload.issue.body}` : '';
        return `[Issue ${payload.action ?? ''}] #${payload.issue.number}: ${payload.issue.title}${body}`;
      }
      break;
    case 'issue_comment':
      if (payload.comment && payload.issue) {
        return `[Comment on #${payload.issue.number}] ${payload.comment.body}`;
      }
      break;
    case 'pull_request':
      if (payload.pull_request) {
        const body = payload.pull_request.body ? `\n\n${payload.pull_request.body}` : '';
        return `[PR ${payload.action ?? ''}] #${payload.pull_request.number}: ${payload.pull_request.title}${body}`;
      }
      break;
    case 'push':
      if (payload.commits && payload.commits.length > 0) {
        const commitMessages = payload.commits
          .map(c => `- ${c.message}`)
          .join('\n');
        return `[Push to ${payload.ref ?? 'unknown'}] ${payload.commits.length} commit(s):\n${commitMessages}`;
      }
      break;
  }

  return `[${eventType}] ${payload.action ?? 'event'}`;
}

/**
 * TurnAuth를 생성한다.
 *
 * @param sender - 이벤트 발생자
 * @param repo - 리포지토리 정보
 * @returns TurnAuth 객체
 */
function createTurnAuth(
  sender: GitHubUser | undefined,
  repo: GitHubRepository
): TurnAuth {
  const userId = sender?.login ?? 'unknown';
  const userIdNum = sender?.id?.toString() ?? 'unknown';

  return {
    actor: {
      type: 'user',
      id: `github:${userId}`,
      display: userId,
    },
    subjects: {
      global: `github:repo:${repo.full_name}`,
      user: `github:user:${userIdNum}`,
    },
  };
}

/**
 * Origin 정보를 생성한다.
 *
 * @param eventType - GitHub 이벤트 타입
 * @param payload - Webhook 페이로드
 * @param connectorName - Connector 이름
 * @returns Origin 객체
 */
function createOrigin(
  eventType: string,
  payload: GitHubWebhookPayload,
  connectorName: string
): JsonObject {
  const origin: JsonObject = {
    connector: connectorName,
    eventType,
    repository: payload.repository?.full_name ?? '',
  };

  if (payload.action !== undefined) {
    origin['action'] = payload.action;
  }

  if (payload.sender) {
    origin['sender'] = payload.sender.login;
  }

  if (payload.issue) {
    origin['issueNumber'] = payload.issue.number;
  }

  if (payload.pull_request) {
    origin['prNumber'] = payload.pull_request.number;
  }

  if (payload.ref !== undefined) {
    origin['ref'] = payload.ref;
  }

  return origin;
}

/**
 * metadata 정보를 생성한다.
 *
 * @param eventType - GitHub 이벤트 타입
 * @param payload - Webhook 페이로드
 * @returns metadata 객체
 */
function buildMetadata(
  eventType: string,
  payload: GitHubWebhookPayload
): JsonObject {
  const metadata: JsonObject = {};

  if (payload.action !== undefined) {
    metadata['action'] = payload.action;
  }

  if (eventType === 'push') {
    if (payload.before !== undefined) {
      metadata['before'] = payload.before;
    }
    if (payload.after !== undefined) {
      metadata['after'] = payload.after;
    }
    if (payload.commits) {
      metadata['commitCount'] = payload.commits.length;
    }
  }

  if (eventType === 'pull_request' && payload.pull_request) {
    if (payload.pull_request.head) {
      metadata['headRef'] = payload.pull_request.head.ref;
    }
    if (payload.pull_request.base) {
      metadata['baseRef'] = payload.pull_request.base.ref;
    }
  }

  return metadata;
}

// ============================================================================
// GitHub API Helpers (Egress용)
// ============================================================================

/**
 * GitHub Issue에 코멘트를 작성한다.
 *
 * @param token - Personal Access Token 또는 GitHub App Token
 * @param owner - 리포지토리 소유자
 * @param repo - 리포지토리 이름
 * @param issueNumber - Issue/PR 번호
 * @param body - 코멘트 내용
 * @returns API 응답
 */
export async function createIssueComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<{ ok: boolean; id?: number; error?: string }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );

    const result: unknown = await response.json();

    if (!isObject(result)) {
      return { ok: false, error: 'Invalid response format' };
    }

    const id = result['id'];
    if (isNumber(id)) {
      return { ok: true, id };
    }

    const errorMessage = result['message'];
    if (isString(errorMessage)) {
      return { ok: false, error: errorMessage };
    }

    return { ok: false, error: 'Unknown error' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}

/**
 * GitHub에 PR 리뷰 코멘트를 작성한다.
 *
 * @param token - Personal Access Token 또는 GitHub App Token
 * @param owner - 리포지토리 소유자
 * @param repo - 리포지토리 이름
 * @param prNumber - PR 번호
 * @param body - 리뷰 코멘트 내용
 * @param event - 리뷰 이벤트 타입
 * @returns API 응답
 */
export async function createPRReview(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT'
): Promise<{ ok: boolean; id?: number; error?: string }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body, event }),
      }
    );

    const result: unknown = await response.json();

    if (!isObject(result)) {
      return { ok: false, error: 'Invalid response format' };
    }

    const id = result['id'];
    if (isNumber(id)) {
      return { ok: true, id };
    }

    const errorMessage = result['message'];
    if (isString(errorMessage)) {
      return { ok: false, error: errorMessage };
    }

    return { ok: false, error: 'Unknown error' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
}
