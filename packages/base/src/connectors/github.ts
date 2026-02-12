import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorContext, ConnectorEvent } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

export function verifyGithubSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}

export function parseGithubWebhook(
  eventType: string,
  body: unknown
): ConnectorEvent | null {
  if (!isRecord(body)) {
    return null;
  }

  const action = readString(body.action) ?? '';
  const properties: Record<string, string> = {
    event: eventType,
  };

  if (action) {
    properties.action = action;
  }

  // Extract repository info
  const repo = isRecord(body.repository) ? body.repository : undefined;
  const repoFullName = repo ? readString(repo.full_name) : undefined;
  if (repoFullName) {
    properties.repo = repoFullName;
  }

  // Extract sender info
  const sender = isRecord(body.sender) ? body.sender : undefined;
  const senderLogin = sender ? readString(sender.login) : undefined;
  if (senderLogin) {
    properties.sender = senderLogin;
  }

  let text = '';
  let eventName = `github_${eventType}`;

  // Extract event-specific info
  switch (eventType) {
    case 'push': {
      const ref = readString(body.ref);
      if (ref) {
        properties.ref = ref;
      }
      const headCommit = isRecord(body.head_commit) ? body.head_commit : undefined;
      text = headCommit ? (readString(headCommit.message) ?? `push to ${ref ?? 'unknown'}`) : `push to ${ref ?? 'unknown'}`;
      break;
    }
    case 'pull_request': {
      const pr = isRecord(body.pull_request) ? body.pull_request : undefined;
      const prNumber = pr ? readNumber(pr.number) : undefined;
      const prTitle = pr ? readString(pr.title) : undefined;
      if (prNumber !== undefined) {
        properties.number = String(prNumber);
      }
      text = prTitle ?? `PR ${action}`;
      eventName = 'github_pull_request';
      break;
    }
    case 'issues': {
      const issue = isRecord(body.issue) ? body.issue : undefined;
      const issueNumber = issue ? readNumber(issue.number) : undefined;
      const issueTitle = issue ? readString(issue.title) : undefined;
      if (issueNumber !== undefined) {
        properties.number = String(issueNumber);
      }
      text = issueTitle ?? `Issue ${action}`;
      eventName = 'github_issue';
      break;
    }
    case 'issue_comment': {
      const comment = isRecord(body.comment) ? body.comment : undefined;
      const commentBody = comment ? readString(comment.body) : undefined;
      const issue = isRecord(body.issue) ? body.issue : undefined;
      const issueNumber = issue ? readNumber(issue.number) : undefined;
      if (issueNumber !== undefined) {
        properties.number = String(issueNumber);
      }
      text = commentBody ?? 'comment';
      eventName = 'github_issue_comment';
      break;
    }
    default: {
      text = `${eventType}${action ? ` ${action}` : ''}`;
      break;
    }
  }

  const instanceKey = repoFullName
    ? `github:${repoFullName}`
    : `github:${eventType}`;

  return {
    name: eventName,
    message: { type: 'text', text },
    properties,
    instanceKey,
  };
}

export async function handleGithubRequest(
  ctx: ConnectorContext,
  eventType: string,
  rawBody: string,
  signature?: string
): Promise<Response> {
  // Signature verification
  const signingSecret = ctx.secrets.signingSecret;
  if (signingSecret && signature) {
    if (!verifyGithubSignature(rawBody, signature, signingSecret)) {
      ctx.logger.warn('[github] signature verification failed');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const event = parseGithubWebhook(eventType, body);
  if (!event) {
    return new Response('OK');
  }

  await ctx.emit(event);
  return new Response('OK');
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  ctx.logger.info('[github] connector skeleton initialized');
}
