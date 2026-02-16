import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorContext, ConnectorEvent } from '../types.js';

export interface SlackConnectorConfig {
  port?: number;
  webhookPath?: string;
}

export interface SlackRequestOptions {
  headers?: Headers | Record<string, string | string[] | undefined>;
  nowSeconds?: number;
  requestPath?: string;
  webhookPath?: string;
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

function readPort(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    return undefined;
  }

  return parsed;
}

function resolveSlackPort(config: Record<string, string>): number {
  return readPort(config.SLACK_WEBHOOK_PORT) ?? readPort(config.PORT) ?? 8787;
}

function normalizeWebhookPath(value: unknown): string {
  if (typeof value !== 'string') {
    return '/';
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, '')
    : withLeadingSlash;

  return normalized.length > 0 ? normalized : '/';
}

function resolveSlackWebhookPath(config: Record<string, string>): string {
  return normalizeWebhookPath(config.SLACK_WEBHOOK_PATH);
}

function parseRequestPath(requestPath: string | undefined): string {
  if (typeof requestPath !== 'string' || requestPath.length === 0) {
    return '/';
  }

  try {
    const url = new URL(requestPath, 'http://localhost');
    return normalizeWebhookPath(url.pathname);
  } catch {
    return normalizeWebhookPath(requestPath);
  }
}

function readSigningSecret(ctx: ConnectorContext): string | undefined {
  return (
    readString(ctx.secrets.SLACK_SIGNING_SECRET) ??
    readString(ctx.secrets.signingSecret) ??
    readString(ctx.config.SLACK_SIGNING_SECRET)
  );
}

function readHeaderCandidate(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return readString(value);
  }

  if (Array.isArray(value)) {
    for (const candidate of value) {
      const parsed = readString(candidate);
      if (parsed) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
  headerName: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return readString(headers.get(headerName));
  }

  return (
    readHeaderCandidate(headers[headerName]) ??
    readHeaderCandidate(headers[headerName.toLowerCase()]) ??
    readHeaderCandidate(headers[headerName.toUpperCase()])
  );
}

export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isFinite(nowSeconds) || !/^\d+$/.test(timestamp)) {
    return false;
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(nowSeconds - parsedTimestamp) > 60 * 5) {
    return false;
  }

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
  if (!eventType || (eventType !== 'app_mention' && eventType !== 'message')) {
    return null;
  }

  const subtype = readString(slackEvent.subtype);
  const botId = readString(slackEvent.bot_id);
  if (subtype === 'bot_message' || botId) {
    return null;
  }

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
  rawBody: string,
  options: SlackRequestOptions = {}
): Promise<Response> {
  const webhookPath = normalizeWebhookPath(options.webhookPath);
  if (options.requestPath !== undefined) {
    const requestPath = parseRequestPath(options.requestPath);
    if (requestPath !== webhookPath) {
      return new Response('Not Found', { status: 404 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (!isRecord(body)) {
    return new Response('Bad Request', { status: 400 });
  }

  const signingSecret = readSigningSecret(ctx);
  if (signingSecret) {
    const signature = readHeader(options.headers, 'x-slack-signature');
    const timestamp = readHeader(options.headers, 'x-slack-request-timestamp');

    if (!signature || !timestamp) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (
      !verifySlackSignature(
        rawBody,
        timestamp,
        signature,
        signingSecret,
        options.nowSeconds
      )
    ) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // URL verification challenge
  if (readString(body.type) === 'url_verification') {
    const challenge = readString(body.challenge);
    return new Response(challenge ?? '', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Parse and emit event
  const event = parseSlackEvent(body);
  if (!event) {
    return Response.json({ ok: true, ignored: true });
  }

  await ctx.emit(event);
  return Response.json({ ok: true });
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: string | Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

async function writeNodeResponse(
  res: http.ServerResponse<http.IncomingMessage>,
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = await response.text();
  res.end(body);
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  const port = resolveSlackPort(ctx.config);
  const webhookPath = resolveSlackWebhookPath(ctx.config);
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Method Not Allowed');
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const response = await handleSlackRequest(ctx, rawBody, {
        headers: req.headers,
        requestPath: req.url,
        webhookPath,
      });
      await writeNodeResponse(res, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.warn(`[slack] request failed: ${message}`);

      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      res.end('Internal Server Error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    let closing = false;

    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      server.off('error', onError);
    };

    const shutdown = () => {
      if (closing) {
        return;
      }
      closing = true;
      server.close((error) => {
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        ctx.logger.info('[slack] connector stopped');
        resolve();
      });
    };

    const onSigint = () => {
      ctx.logger.info('[slack] received SIGINT, shutting down');
      shutdown();
    };

    const onSigterm = () => {
      ctx.logger.info('[slack] received SIGTERM, shutting down');
      shutdown();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    server.once('error', onError);

    server.listen(port, () => {
      ctx.logger.info(`[slack] listening on port ${port} path=${webhookPath}`);
    });
  });
}
