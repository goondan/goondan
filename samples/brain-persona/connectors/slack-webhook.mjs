import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function parsePort(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 8787;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function verifySlackSignature(rawBody, timestamp, signature, signingSecret) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 60 * 5) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function writeJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function writeText(res, status, text) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(text);
}

function parseSlackEvent(body) {
  if (!isRecord(body)) {
    return undefined;
  }

  const event = body.event;
  if (!isRecord(event)) {
    return undefined;
  }

  const eventType = readString(event.type);
  const channelId = readString(event.channel);
  const ts = readString(event.ts);
  const text = readString(event.text) ?? '';
  const threadTs = readString(event.thread_ts);
  const userId = readString(event.user);
  const subtype = readString(event.subtype);
  const botId = readString(event.bot_id);
  if (!channelId || !ts) {
    return undefined;
  }

  if (subtype === 'bot_message' || botId) {
    return undefined;
  }

  const name = eventType === 'app_mention' ? 'slack_app_mention' : 'slack_message';
  const properties = {
    channel_id: channelId,
    ts,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(userId ? { user_id: userId } : {}),
  };

  return {
    name,
    instanceKey: `slack:${channelId}:${threadTs ?? ts}`,
    message: {
      type: 'text',
      text,
    },
    properties,
  };
}

export default async function run(ctx) {
  const port = parsePort(ctx.config.SLACK_WEBHOOK_PORT ?? ctx.config.PORT);
  const signingSecret =
    ctx.secrets.SLACK_SIGNING_SECRET ??
    ctx.config.SLACK_SIGNING_SECRET ??
    undefined;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        writeText(res, 405, 'Method Not Allowed');
        return;
      }

      const rawBody = await readRequestBody(req);

      if (signingSecret) {
        const signature = readString(req.headers['x-slack-signature']);
        const timestamp = readString(req.headers['x-slack-request-timestamp']);
        if (!signature || !timestamp || !verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
          writeText(res, 401, 'Unauthorized');
          return;
        }
      }

      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        writeText(res, 400, 'Bad Request');
        return;
      }

      if (!isRecord(body)) {
        writeText(res, 400, 'Bad Request');
        return;
      }

      if (body.type === 'url_verification') {
        const challenge = readString(body.challenge) ?? '';
        writeText(res, 200, challenge);
        return;
      }

      const event = parseSlackEvent(body);
      if (!event) {
        writeJson(res, 200, { ok: true, ignored: true });
        return;
      }

      await ctx.emit(event);
      writeJson(res, 200, { ok: true });
    } catch (error) {
      ctx.logger.warn(`[slack-webhook] request failed: ${error instanceof Error ? error.message : String(error)}`);
      writeText(res, 500, 'Internal Server Error');
    }
  });

  await new Promise((resolve, reject) => {
    const onSignal = () => {
      server.close(() => {
        resolve();
      });
    };

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    server.on('error', (error) => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      reject(error);
    });

    server.listen(port, () => {
      ctx.logger.info(`[slack-webhook] listening on port ${port}`);
    });
  });
}
