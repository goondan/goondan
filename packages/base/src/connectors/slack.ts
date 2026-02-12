import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorContext, ConnectorEvent } from '../types.js';

export interface SlackConnectorConfig {
  port?: number;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(baseString).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}

function parseSlackEvent(body: unknown): ConnectorEvent | null {
  if (!isRecord(body)) {
    return null;
  }

  const slackEvent = body.event;
  if (!isRecord(slackEvent)) {
    return null;
  }

  const eventType = readString(slackEvent.type);
  const channelId = readString(slackEvent.channel);
  const ts = readString(slackEvent.ts);
  const threadTs = readString(slackEvent.thread_ts);
  const text = readString(slackEvent.text) ?? '';
  const userId = readString(slackEvent.user);

  if (!channelId || !ts) {
    return null;
  }

  const name = eventType === 'app_mention' ? 'app_mention' : 'message_im';
  const properties: Record<string, string> = {
    channel_id: channelId,
    ts,
  };

  if (threadTs) {
    properties.thread_ts = threadTs;
  }
  if (userId) {
    properties.user_id = userId;
  }

  const instanceKey = `slack:${channelId}:${threadTs ?? ts}`;

  return {
    name,
    message: { type: 'text', text },
    properties,
    instanceKey,
  };
}

export async function handleSlackRequest(
  ctx: ConnectorContext,
  rawBody: string
): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (!isRecord(body)) {
    return new Response('Bad Request', { status: 400 });
  }

  // Signature verification
  // Note: In a real webhook scenario, headers are checked.
  // This helper focuses on body-level processing.

  // URL verification challenge
  if (body.type === 'url_verification') {
    const challenge = readString(body.challenge);
    return new Response(challenge ?? '', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Parse and emit event
  const event = parseSlackEvent(body);
  if (!event) {
    return new Response('OK');
  }

  await ctx.emit(event);
  return new Response('OK');
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  ctx.logger.info('[slack] connector skeleton initialized');
}
