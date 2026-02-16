import type { JsonObject, JsonValue, ToolContext, ToolHandler } from '../types.js';
import {
  isJsonObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireString,
} from '../utils.js';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const TELEGRAM_TOKEN_ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'BOT_TOKEN',
  'TELEGRAM_TOKEN',
  'BRAIN_TELEGRAM_BOT_TOKEN',
];

const TELEGRAM_CHAT_ACTION_ALIASES: Record<string, string> = {
  typing: 'typing',
  'upload-photo': 'upload_photo',
  'record-video': 'record_video',
  'upload-video': 'upload_video',
  'record-voice': 'record_voice',
  'upload-voice': 'upload_voice',
  'upload-document': 'upload_document',
  'choose-sticker': 'choose_sticker',
  'find-location': 'find_location',
  'record-video-note': 'record_video_note',
  'upload-video-note': 'upload_video_note',
};

const TELEGRAM_PARSE_MODE_ALIASES: Record<string, string> = {
  markdown: 'Markdown',
  markdownv2: 'MarkdownV2',
  'markdown-v2': 'MarkdownV2',
  html: 'HTML',
};

type TelegramMethod =
  | 'sendMessage'
  | 'editMessageText'
  | 'deleteMessage'
  | 'setMessageReaction'
  | 'sendChatAction';

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  errorCode?: number;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  if (apiBaseUrl.endsWith('/')) {
    return apiBaseUrl.slice(0, -1);
  }
  return apiBaseUrl;
}

function normalizeInputToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function buildTelegramApiUrl(apiBaseUrl: string, token: string, method: TelegramMethod): string {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/bot${token}/${method}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^[-]?\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

function requireChatId(input: JsonObject, key = 'chatId'): string {
  const raw = input[key];
  const asString = toNonEmptyString(raw);
  if (asString) {
    return asString;
  }

  const asInteger = toInteger(raw);
  if (asInteger !== undefined) {
    return String(asInteger);
  }

  throw new Error(`'${key}' must be a non-empty string or integer`);
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = toInteger(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function requireMessageId(input: JsonObject, key = 'messageId'): number {
  const messageId = readPositiveInteger(input[key]);
  if (messageId === undefined) {
    throw new Error(`'${key}' must be a positive integer`);
  }
  return messageId;
}

function optionalMessageId(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  const messageId = readPositiveInteger(value);
  if (messageId === undefined) {
    throw new Error(`'${key}' must be a positive integer`);
  }

  return messageId;
}

function resolveTelegramToken(input: JsonObject): string {
  const inputToken = optionalString(input, 'token');
  if (inputToken && inputToken.length > 0) {
    return inputToken;
  }

  for (const envKey of TELEGRAM_TOKEN_ENV_KEYS) {
    const envValue = process.env[envKey];
    if (typeof envValue === 'string' && envValue.length > 0) {
      return envValue;
    }
  }

  throw new Error(
    "Telegram bot token not found. Provide 'token' or set TELEGRAM_BOT_TOKEN/BOT_TOKEN/TELEGRAM_TOKEN."
  );
}

function resolveTimeoutMs(input: JsonObject): number {
  const timeoutMs = optionalNumber(input, 'timeoutMs', DEFAULT_REQUEST_TIMEOUT_MS) ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("'timeoutMs' must be a positive number");
  }
  return Math.trunc(timeoutMs);
}

function resolveApiBaseUrl(input: JsonObject): string {
  const apiBaseUrl = optionalString(input, 'apiBaseUrl');
  if (apiBaseUrl && apiBaseUrl.length > 0) {
    return apiBaseUrl;
  }
  return TELEGRAM_API_BASE_URL;
}

function resolveParseMode(input: JsonObject): string | undefined {
  const rawParseMode = optionalString(input, 'parseMode');
  if (!rawParseMode || rawParseMode.trim().length === 0) {
    return undefined;
  }

  const normalized = normalizeInputToken(rawParseMode);
  const parseMode = TELEGRAM_PARSE_MODE_ALIASES[normalized];
  if (!parseMode) {
    const allowed = Object.keys(TELEGRAM_PARSE_MODE_ALIASES).join(', ');
    throw new Error(`Unsupported parseMode '${rawParseMode}'. Use one of: ${allowed}.`);
  }

  return parseMode;
}

interface ReactionResolution {
  reactions: JsonObject[];
  cleared: boolean;
  emojis: string[];
}

function resolveReactions(input: JsonObject): ReactionResolution {
  const clear = optionalBoolean(input, 'clear', false) ?? false;
  if (clear) {
    return {
      reactions: [],
      cleared: true,
      emojis: [],
    };
  }

  const emojis: string[] = [];
  const singleEmoji = optionalString(input, 'emoji');
  if (singleEmoji && singleEmoji.trim().length > 0) {
    emojis.push(singleEmoji.trim());
  }

  const emojiArray = optionalStringArray(input, 'emojis') ?? [];
  for (const item of emojiArray) {
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      emojis.push(trimmed);
    }
  }

  if (emojis.length === 0) {
    throw new Error("Provide 'emoji' or 'emojis' to set message reaction, or set 'clear=true' to remove reactions.");
  }

  const uniqueEmojis = [...new Set(emojis)];
  const reactions = uniqueEmojis.map((emoji) => ({
    type: 'emoji',
    emoji,
  }));

  return {
    reactions,
    cleared: false,
    emojis: uniqueEmojis,
  };
}

function compactJson(input: Record<string, JsonValue | undefined>): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Telegram API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function defaultHttpDescription(response: Response): string {
  if (response.statusText.length > 0) {
    return `HTTP ${response.status} ${response.statusText}`;
  }
  return `HTTP ${response.status}`;
}

async function parseTelegramApiResponse(response: Response): Promise<TelegramApiResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      description: defaultHttpDescription(response),
    };
  }

  if (!isJsonObject(body)) {
    return {
      ok: false,
      description: defaultHttpDescription(response),
    };
  }

  const description = toNonEmptyString(body.description);
  const errorCode = typeof body.error_code === 'number' && Number.isInteger(body.error_code)
    ? body.error_code
    : undefined;

  return {
    ok: body.ok === true,
    result: body.result,
    description,
    errorCode,
  };
}

async function callTelegramMethod(
  method: TelegramMethod,
  token: string,
  payload: JsonObject,
  input: JsonObject
): Promise<unknown> {
  const timeoutMs = resolveTimeoutMs(input);
  const apiBaseUrl = resolveApiBaseUrl(input);
  const url = buildTelegramApiUrl(apiBaseUrl, token, method);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      timeoutMs
    );
  } catch (error) {
    throw new Error(`[telegram] ${method} request failed: ${toErrorMessage(error)}`);
  }

  const parsed = await parseTelegramApiResponse(response);
  if (!response.ok || !parsed.ok) {
    const description = parsed.description ?? defaultHttpDescription(response);
    const codeSuffix = parsed.errorCode !== undefined ? ` (code ${parsed.errorCode})` : '';
    throw new Error(`[telegram] ${method} failed${codeSuffix}: ${description}`);
  }

  return parsed.result;
}

function extractMessageSummary(result: unknown): {
  messageId: number | null;
  date: number | null;
  text: string | null;
} {
  if (!isJsonObject(result)) {
    return {
      messageId: null,
      date: null,
      text: null,
    };
  }

  const messageId = readPositiveInteger(result.message_id) ?? null;
  const date = typeof result.date === 'number' && Number.isInteger(result.date) ? result.date : null;
  const text = toNonEmptyString(result.text) ?? null;

  return {
    messageId,
    date,
    text,
  };
}

function normalizeChatAction(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function resolveChatAction(input: JsonObject): string {
  const rawValue = optionalString(input, 'action') ?? optionalString(input, 'status') ?? 'typing';
  const normalized = normalizeChatAction(rawValue);

  const resolved = TELEGRAM_CHAT_ACTION_ALIASES[normalized];
  if (!resolved) {
    const allowed = Object.keys(TELEGRAM_CHAT_ACTION_ALIASES).join(', ');
    throw new Error(`Unsupported chat action '${rawValue}'. Use one of: ${allowed}.`);
  }

  return resolved;
}

export const send: ToolHandler = async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const token = resolveTelegramToken(input);
  const chatId = requireChatId(input, 'chatId');
  const text = requireString(input, 'text');
  const parseMode = resolveParseMode(input);
  const disableNotification = optionalBoolean(input, 'disableNotification');
  const disableWebPagePreview = optionalBoolean(input, 'disableWebPagePreview');
  const replyToMessageId = optionalMessageId(input, 'replyToMessageId');
  const allowSendingWithoutReply = optionalBoolean(input, 'allowSendingWithoutReply');

  const result = await callTelegramMethod(
    'sendMessage',
    token,
    compactJson({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_notification: disableNotification,
      disable_web_page_preview: disableWebPagePreview,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: allowSendingWithoutReply,
    }),
    input
  );

  const summary = extractMessageSummary(result);
  return {
    ok: true,
    chatId,
    messageId: summary.messageId,
    date: summary.date,
    text: summary.text,
  };
};

export const edit: ToolHandler = async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const token = resolveTelegramToken(input);
  const chatId = requireChatId(input, 'chatId');
  const messageId = requireMessageId(input, 'messageId');
  const text = requireString(input, 'text');
  const parseMode = resolveParseMode(input);
  const disableWebPagePreview = optionalBoolean(input, 'disableWebPagePreview');

  const result = await callTelegramMethod(
    'editMessageText',
    token,
    compactJson({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: disableWebPagePreview,
    }),
    input
  );

  const summary = extractMessageSummary(result);
  return {
    ok: true,
    chatId,
    messageId: summary.messageId ?? messageId,
    edited: true,
  };
};

export const remove: ToolHandler = async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const token = resolveTelegramToken(input);
  const chatId = requireChatId(input, 'chatId');
  const messageId = requireMessageId(input, 'messageId');

  await callTelegramMethod(
    'deleteMessage',
    token,
    compactJson({
      chat_id: chatId,
      message_id: messageId,
    }),
    input
  );

  return {
    ok: true,
    chatId,
    messageId,
    deleted: true,
  };
};

export const react: ToolHandler = async (_ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const token = resolveTelegramToken(input);
  const chatId = requireChatId(input, 'chatId');
  const messageId = requireMessageId(input, 'messageId');
  const isBig = optionalBoolean(input, 'isBig');
  const reactionResolution = resolveReactions(input);

  await callTelegramMethod(
    'setMessageReaction',
    token,
    compactJson({
      chat_id: chatId,
      message_id: messageId,
      reaction: reactionResolution.reactions,
      is_big: isBig,
    }),
    input
  );

  return {
    ok: true,
    chatId,
    messageId,
    cleared: reactionResolution.cleared,
    emojis: reactionResolution.emojis,
    reactionCount: reactionResolution.reactions.length,
  };
};

export const setChatAction: ToolHandler = async (
  _ctx: ToolContext,
  input: JsonObject
): Promise<JsonValue> => {
  const token = resolveTelegramToken(input);
  const chatId = requireChatId(input, 'chatId');
  const action = resolveChatAction(input);

  await callTelegramMethod(
    'sendChatAction',
    token,
    compactJson({
      chat_id: chatId,
      action,
    }),
    input
  );

  return {
    ok: true,
    chatId,
    status: action,
    action,
  };
};

export const handlers = {
  send,
  edit,
  delete: remove,
  react,
  setChatAction,
} satisfies Record<string, ToolHandler>;
