/**
 * GitHub Connector 구현 (v1.0)
 *
 * GitHub Webhook 이벤트를 처리하여 ConnectorEvent로 변환하고 emit한다.
 * 단일 default export 패턴을 따른다.
 *
 * @see /docs/specs/connector.md - 5. Entry Function 실행 모델
 * @packageDocumentation
 */

import type {
  ConnectorContext,
  ConnectorEvent,
  HttpTriggerPayload,
} from '@goondan/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

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
 * HttpTriggerPayload 타입 가드
 */
function isHttpTrigger(trigger: { type: string }): trigger is HttpTriggerPayload {
  return trigger.type === 'http';
}

/**
 * 헤더 키를 대소문자 구분 없이 조회한다.
 */
function getHeaderValue(
  headers: Record<string, string>,
  headerName: string,
): string | undefined {
  const direct = headers[headerName];
  if (isString(direct)) {
    return direct;
  }

  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName && isString(value)) {
      return value;
    }
  }

  return undefined;
}

/**
 * 요청 본문을 서명 검증용 문자열로 직렬화한다.
 */
function getRequestRawBody(request: HttpTriggerPayload['payload']['request']): string | undefined {
  if (isString(request.rawBody)) {
    return request.rawBody;
  }

  try {
    return JSON.stringify(request.body);
  } catch {
    return undefined;
  }
}

/**
 * GitHub 요청 서명을 검증한다.
 */
function verifyGithubSignature(
  request: HttpTriggerPayload['payload']['request'],
  signingSecret: string,
): boolean {
  const signature = getHeaderValue(request.headers, 'x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const rawBody = getRequestRawBody(request);
  if (rawBody === undefined) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', signingSecret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Connection verify 설정이 있을 때 GitHub 서명을 검증한다.
 *
 * 검증 실패 시 emit을 중단해야 한다.
 */
function runVerifyHook(
  context: ConnectorContext,
  request: HttpTriggerPayload['payload']['request'],
): boolean {
  const signingSecret = context.verify?.webhook?.signingSecret;

  if (!signingSecret) {
    return true;
  }

  const verified = verifyGithubSignature(request, signingSecret);
  if (verified) {
    context.logger.debug('[GitHub] Signature verification passed');
    return true;
  }

  context.logger.warn('[GitHub] Signature verification failed');
  return false;
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
 * 이벤트 타입을 payload 구조에서 추론한다.
 */
function resolveEventType(
  requestHeaders: Record<string, string>,
  payload: GitHubWebhookPayload,
): string {
  // X-GitHub-Event 헤더에서 이벤트 타입 추출
  const githubEvent = getHeaderValue(requestHeaders, 'x-github-event');
  if (githubEvent) {
    return githubEvent;
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

const SUPPORTED_EVENT_TYPES = new Set([
  'issues',
  'issue_comment',
  'pull_request',
  'push',
]);

function isSupportedEventType(eventType: string): boolean {
  return SUPPORTED_EVENT_TYPES.has(eventType);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 이벤트에서 LLM 입력 텍스트를 생성한다.
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

// ============================================================================
// Connector Entry Function (단일 default export)
// ============================================================================

/**
 * GitHub Connector Entry Function
 *
 * GitHub Webhook으로부터 이벤트를 받아
 * ConnectorEvent로 변환하여 emit한다.
 */
const githubConnector = async function (context: ConnectorContext): Promise<void> {
  const { event, emit, logger } = context;

  // connector.trigger 이벤트만 처리
  if (event.type !== 'connector.trigger') {
    return;
  }

  const trigger = event.trigger;

  // HTTP trigger만 처리
  if (!isHttpTrigger(trigger)) {
    logger.debug('[GitHub] Not an HTTP trigger, skipping');
    return;
  }

  const requestBody = trigger.payload.request.body;
  const requestHeaders = trigger.payload.request.headers;

  // verify.webhook.signingSecret이 제공된 경우 서명 검증
  if (!runVerifyHook(context, trigger.payload.request)) {
    return;
  }

  // 페이로드 파싱
  const payload = parseGitHubWebhookPayload(requestBody);
  if (!payload) {
    logger.warn('[GitHub] Invalid webhook payload received');
    return;
  }

  // 이벤트 타입 결정
  const eventType = resolveEventType(requestHeaders, payload);
  if (!isSupportedEventType(eventType)) {
    logger.warn('[GitHub] Unsupported webhook event type');
    return;
  }

  let pushRef: string | undefined;
  if (eventType === 'push') {
    pushRef = payload.ref;
    // github.push events.properties.ref는 필수다.
    if (!pushRef || pushRef.length === 0) {
      logger.warn('[GitHub] Missing ref for push event');
      return;
    }
  }

  // 리포지토리 정보
  const repo = payload.repository;
  if (!repo) {
    logger.warn('[GitHub] No repository info in payload');
    return;
  }

  // 봇 이벤트 무시 (무한 루프 방지)
  if (payload.sender?.type === 'Bot') {
    logger.debug('[GitHub] Ignoring bot event');
    return;
  }

  // 이벤트 이름 결정 (events 스키마에 맞게)
  const eventName = `github.${eventType}`;

  // input 추출
  const input = buildInput(eventType, payload);

  // properties 생성
  const properties: Record<string, string> = {
    repository: repo.full_name,
  };
  if (pushRef) {
    properties['ref'] = pushRef;
  }
  if (payload.action) {
    properties['action'] = payload.action;
  }

  const userId = payload.sender?.login ?? 'unknown';

  // ConnectorEvent 생성 및 발행
  const connectorEvent: ConnectorEvent = {
    type: 'connector.event',
    name: eventName,
    message: {
      type: 'text',
      text: input,
    },
    properties,
    auth: {
      actor: {
        id: `github:${userId}`,
        name: userId,
      },
      subjects: {
        global: `github:repo:${repo.full_name}`,
        user: `github:user:${payload.sender?.id?.toString() ?? 'unknown'}`,
      },
    },
  };

  await emit(connectorEvent);

  logger.info(
    `[GitHub] Emitted connector event: name=${eventName}, ` +
    `repo=${repo.full_name}, action=${payload.action ?? 'none'}`
  );
};

export default githubConnector;

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
