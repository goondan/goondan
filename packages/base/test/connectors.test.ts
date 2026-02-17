import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  emitWebhookPayload,
  normalizeCliLine,
  pollTelegramUpdates,
  runCliConnector,
  sendTelegramMessage,
  verifyWebhookSignature,
} from '../src/connectors/index.js';
import type { ConnectorContext, ConnectorEvent } from '../src/types.js';

async function* createLines(lines: string[]): AsyncIterable<string> {
  for (const line of lines) {
    yield line;
  }
}

function createConnectorContext(events: ConnectorEvent[], signingSecret?: string): ConnectorContext {
  return {
    async emit(event: ConnectorEvent): Promise<void> {
      events.push(event);
    },
    logger: console,
    secrets: signingSecret
      ? { signingSecret }
      : {},
  };
}

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('cli connector', () => {
  it('normalizes plain text and json lines into ConnectorEvent', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);

    const lines = [
      'hello',
      '{"event":"user_message","text":"hi","instanceKey":"user-1","properties":{"room":"dev"}}',
      '',
    ];

    await runCliConnector(ctx, createLines(lines), {
      skipEmptyLines: true,
      defaultInstanceKey: 'cli',
    });

    expect(events.length).toBe(2);
    const firstEvent = events[0];
    const secondEvent = events[1];
    if (!firstEvent || !secondEvent) {
      throw new Error('Expected two connector events');
    }

    expect(firstEvent.message.type).toBe('text');
    expect(firstEvent.name).toBe('stdin_message');
    expect(secondEvent.name).toBe('user_message');
    expect(secondEvent.instanceKey).toBe('user-1');
    expect(secondEvent.properties.room).toBe('dev');
  });

  it('normalizeCliLine returns null for empty lines by default', () => {
    const normalized = normalizeCliLine('   ', 0);
    expect(normalized).toBeNull();
  });
});

describe('telegram polling connector', () => {
  it('polls updates, emits telegram_message, and advances offset', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const requestUrls: string[] = [];
    let callCount = 0;

    const fetchMock = async (input: string): Promise<Response> => {
      requestUrls.push(input);
      callCount += 1;

      if (callCount === 1) {
        return createJsonResponse(200, {
          ok: true,
          result: [
            {
              update_id: 100,
              message: {
                message_id: 9,
                date: 1700000000,
                text: 'hello from telegram',
                chat: {
                  id: 12345,
                  type: 'private',
                  username: 'dev-room',
                },
                from: {
                  id: 77,
                  username: 'alice',
                  first_name: 'Alice',
                },
              },
            },
            {
              update_id: 101,
            },
          ],
        });
      }

      return createJsonResponse(200, {
        ok: true,
        result: [],
      });
    };

    await pollTelegramUpdates(ctx, {
      token: 'bot-token',
      fetchImpl: fetchMock,
      timeoutSeconds: 0,
      requestTimeoutMs: 100,
      retryDelayMs: 0,
      maxRequests: 2,
    });

    expect(events.length).toBe(1);
    const event = events[0];
    if (!event) {
      throw new Error('Expected telegram connector event');
    }

    expect(event.name).toBe('telegram_message');
    expect(event.instanceKey).toBe('telegram:12345');
    expect(event.properties.chat_id).toBe('12345');
    expect(event.properties.from_username).toBe('alice');

    if (event.message.type !== 'text') {
      throw new Error('Expected text message');
    }
    expect(event.message.text).toBe('hello from telegram');

    const firstUrl = requestUrls[0];
    const secondUrl = requestUrls[1];
    if (!firstUrl || !secondUrl) {
      throw new Error('Expected two polling requests');
    }

    const firstRequest = new URL(firstUrl);
    const secondRequest = new URL(secondUrl);
    expect(firstRequest.searchParams.get('offset')).toBeNull();
    expect(secondRequest.searchParams.get('offset')).toBe('102');
  });

  it('emits photo metadata and marker text for image messages', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    let callCount = 0;

    const fetchMock = async (): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return createJsonResponse(200, {
          ok: true,
          result: [
            {
              update_id: 210,
              message: {
                message_id: 99,
                date: 1700002222,
                caption: 'look at this',
                chat: {
                  id: 777,
                  type: 'private',
                },
                from: {
                  id: 8080,
                  username: 'bob',
                },
                photo: [
                  {
                    file_id: 'small-photo',
                    file_unique_id: 'unique-small',
                    width: 90,
                    height: 90,
                    file_size: 1200,
                  },
                  {
                    file_id: 'large-photo',
                    file_unique_id: 'unique-large',
                    width: 1280,
                    height: 720,
                    file_size: 45200,
                  },
                ],
              },
            },
          ],
        });
      }

      return createJsonResponse(200, {
        ok: true,
        result: [],
      });
    };

    await pollTelegramUpdates(ctx, {
      token: 'bot-token',
      fetchImpl: fetchMock,
      timeoutSeconds: 0,
      requestTimeoutMs: 100,
      retryDelayMs: 0,
      maxRequests: 2,
    });

    expect(events.length).toBe(1);
    const event = events[0];
    if (!event) {
      throw new Error('Expected telegram connector event');
    }
    if (event.message.type !== 'text') {
      throw new Error('Expected text message');
    }

    expect(event.message.text).toContain('look at this');
    expect(event.message.text).toContain('[telegram_photo] file_id=large-photo');
    expect(event.properties.photo_file_id).toBe('large-photo');
    expect(event.properties.photo_width).toBe('1280');
    expect(event.properties.photo_height).toBe('720');
    expect(event.properties.has_photo).toBe('true');
  });

  it('ignores bot-originated messages to prevent self-feedback loops', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    let calls = 0;

    const fetchMock = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return createJsonResponse(200, {
          ok: true,
          result: [
            {
              update_id: 501,
              message: {
                message_id: 12,
                date: 1700000001,
                text: 'bot echo',
                chat: {
                  id: 12345,
                  type: 'private',
                },
                from: {
                  id: 999,
                  is_bot: true,
                  username: 'mybot',
                },
              },
            },
          ],
        });
      }

      return createJsonResponse(200, {
        ok: true,
        result: [],
      });
    };

    await pollTelegramUpdates(ctx, {
      token: 'bot-token',
      fetchImpl: fetchMock,
      timeoutSeconds: 0,
      requestTimeoutMs: 100,
      retryDelayMs: 0,
      maxRequests: 2,
    });

    expect(events.length).toBe(0);
  });

  it('handles 429 responses by retrying', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    let calls = 0;

    const fetchMock = async (input: string): Promise<Response> => {
      calls += input.length > 0 ? 1 : 1;
      if (calls === 1) {
        return createJsonResponse(429, {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: {
            retry_after: 0,
          },
        });
      }
      return createJsonResponse(200, {
        ok: true,
        result: [],
      });
    };

    await pollTelegramUpdates(ctx, {
      token: 'bot-token',
      fetchImpl: fetchMock,
      timeoutSeconds: 0,
      requestTimeoutMs: 100,
      retryDelayMs: 0,
      maxRequests: 2,
    });

    expect(calls).toBe(2);
  });

  it('continues polling after non-429 HTTP errors', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    let calls = 0;

    const fetchMock = async (input: string): Promise<Response> => {
      calls += input.length > 0 ? 1 : 1;
      if (calls === 1) {
        return createJsonResponse(500, {
          ok: false,
          description: 'internal error',
        });
      }
      return createJsonResponse(200, {
        ok: true,
        result: [],
      });
    };

    await pollTelegramUpdates(ctx, {
      token: 'bot-token',
      fetchImpl: fetchMock,
      timeoutSeconds: 0,
      requestTimeoutMs: 100,
      retryDelayMs: 0,
      maxRequests: 2,
    });

    expect(calls).toBe(2);
  });

  it('returns immediately when aborted before polling starts', async () => {
    const events: ConnectorEvent[] = [];
    const ctx = createConnectorContext(events);
    const controller = new AbortController();
    controller.abort();
    let called = false;

    const fetchMock = async (input: string): Promise<Response> => {
      called = called || input.length > 0;
      return createJsonResponse(200, {
        ok: true,
        result: [],
      });
    };

    await pollTelegramUpdates(ctx, {
      token: 'bot-token',
      fetchImpl: fetchMock,
      signal: controller.signal,
      maxRequests: 1,
    });

    expect(called).toBe(false);
  });

  it('sendTelegramMessage posts payload to Telegram API', async () => {
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];

    const fetchMock = async (input: string, init?: RequestInit): Promise<Response> => {
      requests.push({ input, init });
      return createJsonResponse(200, {
        ok: true,
        result: {
          message_id: 1,
        },
      });
    };

    await sendTelegramMessage('token-1', '42', 'hello world', {
      fetchImpl: fetchMock,
      apiBaseUrl: 'https://example.test',
      requestTimeoutMs: 100,
    });

    const request = requests[0];
    if (!request) {
      throw new Error('Expected sendMessage request');
    }

    expect(request.input).toBe('https://example.test/bottoken-1/sendMessage');
    expect(request.init?.method).toBe('POST');

    const body = request.init?.body;
    if (typeof body !== 'string') {
      throw new Error('Expected JSON body string');
    }

    expect(JSON.parse(body)).toEqual({
      chat_id: '42',
      text: 'hello world',
    });
  });

  it('sendTelegramMessage throws on API errors', async () => {
    const fetchMock = async (input: string): Promise<Response> => {
      return createJsonResponse(input.length > 0 ? 400 : 400, {
        ok: false,
        description: 'Bad Request: chat not found',
      });
    };

    await expect(
      sendTelegramMessage('token-2', '9999', 'hello', {
        fetchImpl: fetchMock,
        requestTimeoutMs: 100,
      })
    ).rejects.toThrow('chat not found');
  });
});

describe('webhook connector skeleton', () => {
  it('validates signature and emits event', async () => {
    const signingSecret = 'super-secret';
    const payload = {
      event: 'webhook_message',
      text: 'hello webhook',
      instanceKey: 'webhook-1',
      properties: {
        route: 'main',
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
    const ctx = createConnectorContext([], signingSecret);

    const result = await emitWebhookPayload(ctx, rawBody, {
      rawBody,
      signature,
      requireSignature: true,
    });

    expect(result.accepted).toBe(true);
  });

  it('verifyWebhookSignature rejects tampered payloads', () => {
    const secret = 'secret';
    const body = '{"text":"ok"}';
    const validSignature = createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyWebhookSignature(body, validSignature, secret)).toBe(true);
    expect(verifyWebhookSignature(body + 'x', validSignature, secret)).toBe(false);
  });
});
