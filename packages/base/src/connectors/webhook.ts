import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorContext, JsonObject } from '../types.js';
import { parseJsonObject } from '../utils.js';

export interface WebhookEmitOptions {
  rawBody?: string;
  signature?: string;
  requireSignature?: boolean;
  defaultEventName?: string;
  defaultInstanceKey?: string;
}

export interface WebhookEmitResult {
  accepted: boolean;
  reason?: string;
  eventName?: string;
  instanceKey?: string;
}

function toProperties(payload: JsonObject): Record<string, string> {
  const value = payload.properties;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, propertyValue] of Object.entries(value)) {
    if (
      typeof propertyValue === 'string' ||
      typeof propertyValue === 'number' ||
      typeof propertyValue === 'boolean'
    ) {
      output[key] = String(propertyValue);
    }
  }
  return output;
}

function getString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function normalizeSignature(signature: string): string {
  if (signature.startsWith('sha256=')) {
    return signature.slice('sha256='.length);
  }
  return signature;
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  signingSecret: string
): boolean {
  const digest = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const normalized = normalizeSignature(signature);

  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(normalized, 'utf8');

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

function parsePayload(rawPayload: string | JsonObject): JsonObject | null {
  if (typeof rawPayload === 'string') {
    return parseJsonObject(rawPayload);
  }
  return rawPayload;
}

export async function emitWebhookPayload(
  ctx: ConnectorContext,
  rawPayload: string | JsonObject,
  options: WebhookEmitOptions = {}
): Promise<WebhookEmitResult> {
  const payload = parsePayload(rawPayload);
  if (!payload) {
    return {
      accepted: false,
      reason: 'invalid_payload',
    };
  }

  const requireSignature = options.requireSignature ?? false;
  const signingSecret = ctx.secrets.signingSecret;
  const signature = options.signature;

  if (requireSignature) {
    if (!signingSecret) {
      ctx.logger.warn('[webhook] signingSecret missing in ConnectorContext.secrets');
      return {
        accepted: false,
        reason: 'missing_signing_secret',
      };
    }

    const rawBody = options.rawBody ?? JSON.stringify(payload);
    if (!signature || !verifyWebhookSignature(rawBody, signature, signingSecret)) {
      ctx.logger.warn('[webhook] invalid signature, event rejected');
      return {
        accepted: false,
        reason: 'invalid_signature',
      };
    }
  }

  const eventName = getString(payload, 'event') ?? getString(payload, 'name') ?? options.defaultEventName ?? 'webhook_message';
  const instanceKey =
    getString(payload, 'instanceKey') ?? options.defaultInstanceKey ?? 'webhook:default';

  const messageText = getString(payload, 'text') ?? getString(payload, 'message') ?? '';

  const properties = toProperties(payload);
  await ctx.emit({
    name: eventName,
    instanceKey,
    message: {
      type: 'text',
      text: messageText,
    },
    properties,
  });

  return {
    accepted: true,
    eventName,
    instanceKey,
  };
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  ctx.logger.info('[webhook] connector skeleton initialized');
}
