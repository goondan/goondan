import type { ConnectorContext, ConnectorEvent } from '../types.js';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';

export type TelegramFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TelegramPollingOptions {
  token: string;
  initialOffset?: number;
  timeoutSeconds?: number;
  requestTimeoutMs?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: TelegramFetch;
  apiBaseUrl?: string;
  maxRequests?: number;
}

export interface TelegramSendMessageOptions {
  fetchImpl?: TelegramFetch;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  apiBaseUrl?: string;
}

interface TelegramParsedMessage {
  chatId: string;
  chatType?: string;
  chatTitle?: string;
  chatUsername?: string;
  fromId?: string;
  fromUsername?: string;
  fromFirstName?: string;
  fromLastName?: string;
  messageId?: number;
  date?: number;
  text?: string;
  caption?: string;
}

interface TelegramParsedUpdate {
  updateId: number;
  message?: TelegramParsedMessage;
}

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  errorCode?: number;
  retryAfterSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function readInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

function toIdentifier(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return undefined;
}

function isAbortRequested(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

function createAbortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError';
  }

  if (!isRecord(error)) {
    return false;
  }

  return error.name === 'AbortError';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  if (apiBaseUrl.endsWith('/')) {
    return apiBaseUrl.slice(0, -1);
  }
  return apiBaseUrl;
}

function buildTelegramApiUrl(
  apiBaseUrl: string,
  token: string,
  method: 'getUpdates' | 'sendMessage'
): string {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/bot${token}/${method}`;
}

function parseTelegramMessage(value: unknown): TelegramParsedMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const chatValue = value.chat;
  if (!isRecord(chatValue)) {
    return null;
  }

  const chatId = toIdentifier(chatValue.id);
  if (!chatId) {
    return null;
  }

  const fromValue = value.from;
  const from = isRecord(fromValue) ? fromValue : undefined;

  return {
    chatId,
    chatType: readString(chatValue.type),
    chatTitle: readString(chatValue.title),
    chatUsername: readString(chatValue.username),
    fromId: from ? toIdentifier(from.id) : undefined,
    fromUsername: from ? readString(from.username) : undefined,
    fromFirstName: from ? readString(from.first_name) : undefined,
    fromLastName: from ? readString(from.last_name) : undefined,
    messageId: readInteger(value.message_id),
    date: readInteger(value.date),
    text: readString(value.text),
    caption: readString(value.caption),
  };
}

function parseTelegramUpdate(value: unknown): TelegramParsedUpdate | null {
  if (!isRecord(value)) {
    return null;
  }

  const updateId = readInteger(value.update_id);
  if (updateId === undefined) {
    return null;
  }

  const message = parseTelegramMessage(value.message);
  if (!message) {
    return {
      updateId,
    };
  }

  return {
    updateId,
    message,
  };
}

function parseTelegramApiResponse(value: unknown): TelegramApiResponse {
  if (!isRecord(value)) {
    return {
      ok: false,
      description: 'Invalid Telegram API response payload',
    };
  }

  let retryAfterSeconds: number | undefined;
  const parametersValue = value.parameters;
  if (isRecord(parametersValue)) {
    const retryAfter = readInteger(parametersValue.retry_after);
    if (retryAfter !== undefined && retryAfter >= 0) {
      retryAfterSeconds = retryAfter;
    }
  }

  return {
    ok: value.ok === true,
    result: value.result,
    description: readString(value.description),
    errorCode: readInteger(value.error_code),
    retryAfterSeconds,
  };
}

async function readJsonBody(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) {
    return !isAbortRequested(signal);
  }

  if (isAbortRequested(signal)) {
    return false;
  }

  return await new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(false);
    };

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(true);
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function fetchWithTimeout(
  fetchImpl: TelegramFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  if (isAbortRequested(signal)) {
    throw createAbortError();
  }

  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

function toTelegramConnectorEvent(update: TelegramParsedUpdate): ConnectorEvent | null {
  const message = update.message;
  if (!message) {
    return null;
  }

  const properties: Record<string, string> = {
    update_id: String(update.updateId),
    chat_id: message.chatId,
  };

  if (message.chatType) {
    properties.chat_type = message.chatType;
  }
  if (message.chatTitle) {
    properties.chat_title = message.chatTitle;
  }
  if (message.chatUsername) {
    properties.chat_username = message.chatUsername;
  }
  if (message.messageId !== undefined) {
    properties.message_id = String(message.messageId);
  }
  if (message.date !== undefined) {
    properties.date = String(message.date);
  }
  if (message.fromId) {
    properties.from_id = message.fromId;
  }
  if (message.fromUsername) {
    properties.from_username = message.fromUsername;
  }
  if (message.fromFirstName) {
    properties.from_first_name = message.fromFirstName;
  }
  if (message.fromLastName) {
    properties.from_last_name = message.fromLastName;
  }

  const text = message.text ?? message.caption ?? '';

  return {
    name: 'telegram_message',
    instanceKey: `telegram:${message.chatId}`,
    message: {
      type: 'text',
      text,
    },
    properties,
  };
}

export async function pollTelegramUpdates(
  ctx: ConnectorContext,
  options: TelegramPollingOptions
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? TELEGRAM_API_BASE_URL;
  const timeoutSeconds = options.timeoutSeconds ?? 30;
  const requestTimeoutMs = options.requestTimeoutMs ?? (timeoutSeconds + 5) * 1000;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const maxRequests = options.maxRequests;
  let offset = options.initialOffset ?? 0;
  let requestCount = 0;

  while (!isAbortRequested(options.signal)) {
    if (maxRequests !== undefined && requestCount >= maxRequests) {
      return;
    }
    requestCount += 1;

    const updatesUrl = new URL(buildTelegramApiUrl(apiBaseUrl, options.token, 'getUpdates'));
    updatesUrl.searchParams.set('timeout', String(timeoutSeconds));
    if (offset > 0) {
      updatesUrl.searchParams.set('offset', String(offset));
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        updatesUrl.toString(),
        {
          method: 'GET',
        },
        requestTimeoutMs,
        options.signal
      );
    } catch (error) {
      if (isAbortRequested(options.signal) || isAbortError(error)) {
        return;
      }

      ctx.logger.warn(
        `[telegram-polling] getUpdates request failed: ${toErrorMessage(error)}`
      );
      const canContinue = await waitWithAbort(retryDelayMs, options.signal);
      if (!canContinue) {
        return;
      }
      continue;
    }

    const parsedBody = parseTelegramApiResponse(await readJsonBody(response));
    const isRateLimited = response.status === 429 || parsedBody.errorCode === 429;
    if (!response.ok || !parsedBody.ok) {
      if (isRateLimited) {
        const retryAfterMs =
          parsedBody.retryAfterSeconds !== undefined
            ? parsedBody.retryAfterSeconds * 1000
            : retryDelayMs;
        ctx.logger.warn(
          `[telegram-polling] rate limited, retrying in ${retryAfterMs}ms`
        );
        const canContinue = await waitWithAbort(retryAfterMs, options.signal);
        if (!canContinue) {
          return;
        }
        continue;
      }

      const description =
        parsedBody.description ??
        `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
      ctx.logger.warn(`[telegram-polling] getUpdates failed: ${description}`);
      const canContinue = await waitWithAbort(retryDelayMs, options.signal);
      if (!canContinue) {
        return;
      }
      continue;
    }

    if (!Array.isArray(parsedBody.result)) {
      ctx.logger.warn('[telegram-polling] getUpdates returned a non-array result');
      const canContinue = await waitWithAbort(retryDelayMs, options.signal);
      if (!canContinue) {
        return;
      }
      continue;
    }

    for (const rawUpdate of parsedBody.result) {
      const update = parseTelegramUpdate(rawUpdate);
      if (!update) {
        continue;
      }

      if (update.updateId >= offset) {
        offset = update.updateId + 1;
      }

      const event = toTelegramConnectorEvent(update);
      if (!event) {
        continue;
      }

      await ctx.emit(event);
    }
  }
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  options: TelegramSendMessageOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? TELEGRAM_API_BASE_URL;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      buildTelegramApiUrl(apiBaseUrl, token, 'sendMessage'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      },
      requestTimeoutMs,
      options.signal
    );
  } catch (error) {
    if (isAbortRequested(options.signal) || isAbortError(error)) {
      throw createAbortError();
    }
    throw new Error(
      `[telegram-polling] sendMessage request failed: ${toErrorMessage(error)}`
    );
  }

  const parsedBody = parseTelegramApiResponse(await readJsonBody(response));
  if (!response.ok || !parsedBody.ok) {
    const description =
      parsedBody.description ??
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    throw new Error(`[telegram-polling] sendMessage failed: ${description}`);
  }
}

function parseSecretInteger(value: string | undefined): number | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function pickTelegramToken(secrets: Record<string, string>): string | undefined {
  const candidateKeys = ['TELEGRAM_BOT_TOKEN', 'BOT_TOKEN', 'TELEGRAM_TOKEN'];
  for (const key of candidateKeys) {
    const value = secrets[key];
    if (value && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function pickConfigValue(config: Record<string, string>, secrets: Record<string, string>, key: string): string | undefined {
  const configValue = config[key];
  if (typeof configValue === 'string' && configValue.length > 0) {
    return configValue;
  }

  return secrets[key];
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  const token = pickTelegramToken(ctx.secrets);
  if (!token) {
    throw new Error(
      '[telegram-polling] missing bot token in secrets (TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN)'
    );
  }

  const controller = new AbortController();
  const handleTerminationSignal = (): void => {
    controller.abort();
  };

  process.once('SIGINT', handleTerminationSignal);
  process.once('SIGTERM', handleTerminationSignal);

  try {
    const timeoutSeconds = parseSecretInteger(
      pickConfigValue(ctx.config, ctx.secrets, 'TELEGRAM_POLL_TIMEOUT_SECONDS')
    );
    const requestTimeoutMs = parseSecretInteger(
      pickConfigValue(ctx.config, ctx.secrets, 'TELEGRAM_REQUEST_TIMEOUT_MS')
    );
    const retryDelayMs = parseSecretInteger(
      pickConfigValue(ctx.config, ctx.secrets, 'TELEGRAM_RETRY_DELAY_MS')
    );
    const initialOffset = parseSecretInteger(
      pickConfigValue(ctx.config, ctx.secrets, 'TELEGRAM_INITIAL_OFFSET')
    );
    const apiBaseUrl = pickConfigValue(ctx.config, ctx.secrets, 'TELEGRAM_API_BASE_URL');

    await pollTelegramUpdates(ctx, {
      token,
      timeoutSeconds,
      requestTimeoutMs,
      retryDelayMs,
      initialOffset,
      signal: controller.signal,
      apiBaseUrl,
    });
  } finally {
    process.off('SIGINT', handleTerminationSignal);
    process.off('SIGTERM', handleTerminationSignal);
  }
}
