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

interface SlackAttachmentReference {
  kind: 'image' | 'file';
  url: string;
  name: string;
}

const IMAGE_FILE_TYPES = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
]);

function collectSlackEventRecords(slackEvent: Record<string, unknown>): Record<string, unknown>[] {
  return [slackEvent];
}

function pickFirstString(records: Record<string, unknown>[], key: string): string | undefined {
  for (const record of records) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function isImageReference(record: Record<string, unknown>): boolean {
  const mimeType = readString(record.mimetype);
  if (mimeType && mimeType.toLowerCase().startsWith('image/')) {
    return true;
  }

  const fileType = readString(record.filetype)?.toLowerCase();
  if (fileType && IMAGE_FILE_TYPES.has(fileType)) {
    return true;
  }

  return false;
}

function readAttachmentUrl(record: Record<string, unknown>): string | undefined {
  return (
    readString(record.url_private_download) ??
    readString(record.url_private) ??
    readString(record.permalink_public) ??
    readString(record.permalink) ??
    readString(record.image_url) ??
    readString(record.thumb_url) ??
    readString(record.from_url) ??
    readString(record.original_url)
  );
}

function readAttachmentName(record: Record<string, unknown>, fallback: string): string {
  return (
    readString(record.title) ??
    readString(record.name) ??
    readString(record.alt_text) ??
    readString(record.id) ??
    fallback
  );
}

function pushSlackFileReferences(
  references: SlackAttachmentReference[],
  filesValue: unknown
): void {
  if (!Array.isArray(filesValue)) {
    return;
  }

  for (const rawFile of filesValue) {
    if (!isRecord(rawFile)) {
      continue;
    }
    const url = readAttachmentUrl(rawFile);
    if (!url) {
      continue;
    }

    const kind: SlackAttachmentReference['kind'] = isImageReference(rawFile) ? 'image' : 'file';
    references.push({
      kind,
      url,
      name: readAttachmentName(rawFile, kind === 'image' ? 'image' : 'file'),
    });
  }
}

function pushSlackAttachmentReferences(
  references: SlackAttachmentReference[],
  attachmentsValue: unknown
): void {
  if (!Array.isArray(attachmentsValue)) {
    return;
  }

  for (const rawAttachment of attachmentsValue) {
    if (!isRecord(rawAttachment)) {
      continue;
    }
    const url = readAttachmentUrl(rawAttachment);
    if (!url) {
      continue;
    }

    const hasImageUrl =
      readString(rawAttachment.image_url) !== undefined ||
      readString(rawAttachment.thumb_url) !== undefined;
    const kind: SlackAttachmentReference['kind'] = hasImageUrl ? 'image' : 'file';

    references.push({
      kind,
      url,
      name: readAttachmentName(rawAttachment, kind === 'image' ? 'image' : 'attachment'),
    });
  }
}

function pushSlackBlockImageReferences(
  references: SlackAttachmentReference[],
  blocksValue: unknown
): void {
  if (!Array.isArray(blocksValue)) {
    return;
  }

  for (const rawBlock of blocksValue) {
    if (!isRecord(rawBlock)) {
      continue;
    }
    if (readString(rawBlock.type) !== 'image') {
      continue;
    }

    const directImageUrl = readString(rawBlock.image_url);
    if (directImageUrl) {
      references.push({
        kind: 'image',
        url: directImageUrl,
        name: readAttachmentName(rawBlock, 'image'),
      });
      continue;
    }

    const slackFile = rawBlock.slack_file;
    if (!isRecord(slackFile)) {
      continue;
    }
    const url = readAttachmentUrl(slackFile);
    if (!url) {
      continue;
    }
    references.push({
      kind: 'image',
      url,
      name: readAttachmentName(slackFile, 'image'),
    });
  }
}

function dedupeAttachmentReferences(
  references: SlackAttachmentReference[]
): SlackAttachmentReference[] {
  const seen = new Set<string>();
  const deduped: SlackAttachmentReference[] = [];

  for (const reference of references) {
    const key = `${reference.kind}:${reference.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(reference);
  }

  return deduped;
}

function collectAttachmentReferences(records: Record<string, unknown>[]): SlackAttachmentReference[] {
  const references: SlackAttachmentReference[] = [];
  for (const record of records) {
    pushSlackFileReferences(references, record.files);
    pushSlackAttachmentReferences(references, record.attachments);
    pushSlackBlockImageReferences(references, record.blocks);
  }
  return dedupeAttachmentReferences(references);
}

function formatAttachmentReference(reference: SlackAttachmentReference): string {
  return `[${reference.kind}:${reference.name}] ${reference.url}`;
}

function composeMessageText(
  baseText: string | undefined,
  references: SlackAttachmentReference[]
): string {
  const text = baseText ?? '';
  if (references.length === 0) {
    return text;
  }

  const attachmentText = references.map((reference) => formatAttachmentReference(reference)).join('\n');
  if (text.length === 0) {
    return attachmentText;
  }
  return `${text}\n${attachmentText}`;
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

  const eventRecords = collectSlackEventRecords(slackEvent);
  const subtype = pickFirstString(eventRecords, 'subtype');
  const botId = pickFirstString(eventRecords, 'bot_id');
  if (subtype === 'bot_message' || botId) {
    return null;
  }

  const channelId = pickFirstString(eventRecords, 'channel');
  const ts = pickFirstString(eventRecords, 'ts');
  const threadTs = pickFirstString(eventRecords, 'thread_ts');
  const userId = pickFirstString(eventRecords, 'user');
  const attachmentReferences = collectAttachmentReferences(eventRecords);
  const text = composeMessageText(pickFirstString(eventRecords, 'text'), attachmentReferences);

  if (!channelId || !ts || text.length === 0) {
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
  if (subtype) {
    properties.subtype = subtype;
  }
  if (attachmentReferences.length > 0) {
    properties.attachment_count = String(attachmentReferences.length);
    const firstImage = attachmentReferences.find((reference) => reference.kind === 'image');
    const firstFile = attachmentReferences.find((reference) => reference.kind === 'file');
    if (firstImage) {
      properties.image_url = firstImage.url;
    }
    if (firstFile) {
      properties.file_url = firstFile.url;
      properties.file_name = firstFile.name;
    }
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
