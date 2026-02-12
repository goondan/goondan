import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  handleSlackRequest,
  verifySlackSignature,
} from '../src/connectors/slack.js';
import {
  handleDiscordRequest,
  parseDiscordInteraction,
} from '../src/connectors/discord.js';
import {
  handleGithubRequest,
  parseGithubWebhook,
  verifyGithubSignature,
} from '../src/connectors/github.js';
import type { ConnectorContext, ConnectorEvent } from '../src/types.js';

function createConnectorContext(events: ConnectorEvent[], secrets: Record<string, string> = {}): ConnectorContext {
  return {
    async emit(event: ConnectorEvent): Promise<void> {
      events.push(event);
    },
    logger: console,
    secrets,
  };
}

describe('slack connector', () => {
  it('verifySlackSignature validates correctly', () => {
    const secret = 'test-secret';
    const timestamp = '1234567890';
    const body = '{"hello":"world"}';
    const baseString = `v0:${timestamp}:${body}`;
    const expected = 'v0=' + createHmac('sha256', secret).update(baseString).digest('hex');

    expect(verifySlackSignature(body, timestamp, expected, secret)).toBe(true);
    expect(verifySlackSignature(body, timestamp, 'v0=invalid', secret)).toBe(false);
  });

  it('handles url_verification challenge', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const body = JSON.stringify({
      type: 'url_verification',
      challenge: 'test-challenge-token',
    });

    const response = await handleSlackRequest(ctx, body);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('test-challenge-token');
    expect(events.length).toBe(0);
  });

  it('parses app_mention event and emits connector event', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const body = JSON.stringify({
      type: 'event_callback',
      event: {
        type: 'app_mention',
        text: 'hello bot',
        channel: 'C123',
        ts: '1234.5678',
        user: 'U456',
      },
    });

    await handleSlackRequest(ctx, body);
    expect(events.length).toBe(1);

    const event = events[0];
    if (!event) throw new Error('Expected event');

    expect(event.name).toBe('app_mention');
    expect(event.properties.channel_id).toBe('C123');
    expect(event.properties.ts).toBe('1234.5678');
    expect(event.properties.user_id).toBe('U456');
    if (event.message.type !== 'text') throw new Error('Expected text');
    expect(event.message.text).toBe('hello bot');
  });

  it('parses message_im event with thread_ts', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const body = JSON.stringify({
      type: 'event_callback',
      event: {
        type: 'message',
        text: 'direct message',
        channel: 'D789',
        ts: '5678.1234',
        thread_ts: '5678.0001',
      },
    });

    await handleSlackRequest(ctx, body);
    expect(events.length).toBe(1);

    const event = events[0];
    if (!event) throw new Error('Expected event');

    expect(event.name).toBe('message_im');
    expect(event.properties.thread_ts).toBe('5678.0001');
    expect(event.instanceKey).toBe('slack:D789:5678.0001');
  });
});

describe('discord connector', () => {
  it('parseDiscordInteraction handles slash command', () => {
    const event = parseDiscordInteraction({
      id: 'int-1',
      type: 2,
      token: 'tok-1',
      channel_id: 'ch-1',
      guild_id: 'guild-1',
      data: { name: 'deploy' },
      member: {
        user: { id: 'u-1', username: 'alice' },
      },
    });

    expect(event).not.toBeNull();
    if (!event) return;

    expect(event.name).toBe('slash_command');
    expect(event.properties.command_name).toBe('deploy');
    expect(event.properties.channel_id).toBe('ch-1');
    expect(event.properties.username).toBe('alice');
    if (event.message.type !== 'text') throw new Error('Expected text');
    expect(event.message.text).toBe('/deploy');
  });

  it('parseDiscordInteraction returns null for ping', () => {
    const event = parseDiscordInteraction({ type: 1 });
    expect(event).toBeNull();
  });

  it('handleDiscordRequest returns pong for ping interaction', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const body = JSON.stringify({ type: 1 });
    const response = await handleDiscordRequest(ctx, body);

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ type: 1 });
    expect(events.length).toBe(0);
  });

  it('handleDiscordRequest emits event for slash command', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const body = JSON.stringify({
      id: 'int-2',
      type: 2,
      token: 'tok-2',
      channel_id: 'ch-2',
      data: { name: 'status' },
      user: { id: 'u-2', username: 'bob' },
    });

    await handleDiscordRequest(ctx, body);
    expect(events.length).toBe(1);
    const event = events[0];
    if (!event) throw new Error('Expected event');
    expect(event.name).toBe('slash_command');
  });
});

describe('github connector', () => {
  it('verifyGithubSignature validates correctly', () => {
    const secret = 'gh-secret';
    const body = '{"ref":"refs/heads/main"}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyGithubSignature(body, sig, secret)).toBe(true);
    expect(verifyGithubSignature(body, 'sha256=invalid', secret)).toBe(false);
  });

  it('parseGithubWebhook handles push event', () => {
    const event = parseGithubWebhook('push', {
      ref: 'refs/heads/main',
      repository: { full_name: 'org/repo', name: 'repo' },
      sender: { login: 'alice' },
      head_commit: { message: 'fix bug' },
    });

    expect(event).not.toBeNull();
    if (!event) return;

    expect(event.name).toBe('github_push');
    expect(event.properties.repo).toBe('org/repo');
    expect(event.properties.ref).toBe('refs/heads/main');
    expect(event.properties.sender).toBe('alice');
    if (event.message.type !== 'text') throw new Error('Expected text');
    expect(event.message.text).toBe('fix bug');
    expect(event.instanceKey).toBe('github:org/repo');
  });

  it('parseGithubWebhook handles pull_request event', () => {
    const event = parseGithubWebhook('pull_request', {
      action: 'opened',
      pull_request: { number: 42, title: 'Add feature X' },
      repository: { full_name: 'org/repo', name: 'repo' },
      sender: { login: 'bob' },
    });

    expect(event).not.toBeNull();
    if (!event) return;

    expect(event.name).toBe('github_pull_request');
    expect(event.properties.action).toBe('opened');
    expect(event.properties.number).toBe('42');
    if (event.message.type !== 'text') throw new Error('Expected text');
    expect(event.message.text).toBe('Add feature X');
  });

  it('parseGithubWebhook handles issue_comment event', () => {
    const event = parseGithubWebhook('issue_comment', {
      action: 'created',
      issue: { number: 10, title: 'Bug report' },
      comment: { body: 'LGTM' },
      repository: { full_name: 'org/repo', name: 'repo' },
      sender: { login: 'carol' },
    });

    expect(event).not.toBeNull();
    if (!event) return;

    expect(event.name).toBe('github_issue_comment');
    expect(event.properties.number).toBe('10');
    if (event.message.type !== 'text') throw new Error('Expected text');
    expect(event.message.text).toBe('LGTM');
  });

  it('handleGithubRequest verifies signature and emits event', async () => {
    const secret = 'gh-secret';
    const payload = { ref: 'refs/heads/main', repository: { full_name: 'org/repo', name: 'repo' }, sender: { login: 'x' } };
    const rawBody = JSON.stringify(payload);
    const signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events, { signingSecret: secret });

    const response = await handleGithubRequest(ctx, 'push', rawBody, signature);
    expect(response.status).toBe(200);
    expect(events.length).toBe(1);
  });

  it('handleGithubRequest rejects invalid signature', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events, { signingSecret: 'secret' });

    const response = await handleGithubRequest(ctx, 'push', '{}', 'sha256=bad');
    expect(response.status).toBe(401);
    expect(events.length).toBe(0);
  });
});
