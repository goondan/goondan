import { isRecord } from "./json.ts";

export type ModelProvider = "anthropic" | "openai";

export type ModelErrorCode =
  | "invalid_request"
  | "authentication"
  | "permission"
  | "not_found"
  | "request_too_large"
  | "context_length"
  | "quota"
  | "rate_limited"
  | "overloaded"
  | "server_error"
  | "timeout"
  | "network"
  | "invalid_response"
  | "unsupported_content";

export interface ModelErrorDetails {
  provider: ModelProvider;
  code: ModelErrorCode;
  status?: number;
  retryAfterMs?: number;
  requestId?: string;
  cause?: unknown;
}

const RETRYABLE_CODES: ReadonlySet<ModelErrorCode> = new Set<ModelErrorCode>([
  "rate_limited",
  "overloaded",
  "server_error",
  "timeout",
  "network",
]);

export const PROVIDER_LABEL: Readonly<Record<ModelProvider, string>> = { anthropic: "Anthropic", openai: "OpenAI" };

/** The error thrown by the official model adapters. The runtime reports `code` as the second value of `codes`. */
export class ModelError extends Error {
  override name = "ModelError";
  readonly provider: ModelProvider;
  readonly code: ModelErrorCode;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, details: ModelErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.provider = details.provider;
    this.code = details.code;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.requestId = details.requestId;
  }

  /** True for `rate_limited`, `overloaded`, `server_error`, `timeout` and `network`. */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }
}

export function isModelError(value: unknown): value is ModelError {
  return value instanceof ModelError;
}

export function invalidRequest(provider: ModelProvider, message: string): ModelError {
  return new ModelError(`${PROVIDER_LABEL[provider]} adapter: ${message}`, { provider, code: "invalid_request" });
}

export function unsupportedContent(provider: ModelProvider, message: string): ModelError {
  return new ModelError(`${PROVIDER_LABEL[provider]} adapter cannot send ${message}`, { provider, code: "unsupported_content" });
}

export function invalidResponse(provider: ModelProvider, message: string, cause?: unknown): ModelError {
  return new ModelError(`${PROVIDER_LABEL[provider]} returned an invalid response: ${message}`, { provider, code: "invalid_response", cause });
}

interface ErrorFacts {
  status: number | undefined;
  type: string | undefined;
  code: string | undefined;
  message: string;
  stream: boolean;
}

const CONTEXT_LENGTH_MESSAGE = /prompt is too long|context length|maximum context/i;

/** Classifies an HTTP error response or an in-stream error with the ordered rules of spec/model-adapters.md. */
export function classifyError(facts: ErrorFacts): ModelErrorCode {
  const { status, type, code, message } = facts;
  if (code === "insufficient_quota" || type === "billing_error" || status === 402) return "quota";
  if (code === "context_length_exceeded" || CONTEXT_LENGTH_MESSAGE.test(message)) return "context_length";
  if (type === "overloaded_error" || status === 529) return "overloaded";
  if (type === "rate_limit_error" || status === 429) return "rate_limited";
  if (type === "authentication_error" || status === 401) return "authentication";
  if (type === "permission_error" || status === 403) return "permission";
  if (type === "not_found_error" || status === 404) return "not_found";
  if (type === "request_too_large" || status === 413) return "request_too_large";
  if (status === 408) return "timeout";
  if (type === "api_error" || status === 409 || (status !== undefined && status >= 500)) return "server_error";
  if (!facts.stream) return "invalid_request";
  return type === "invalid_request_error" ? "invalid_request" : "server_error";
}

interface ErrorObjectFields {
  type: string | undefined;
  code: string | undefined;
  numericCode: number | undefined;
  message: string | undefined;
}

function errorObjectFields(value: unknown): ErrorObjectFields {
  if (!isRecord(value)) return { type: undefined, code: undefined, numericCode: undefined, message: undefined };
  const { type, code, message } = value;
  return {
    type: typeof type === "string" ? type : undefined,
    code: typeof code === "string" ? code : undefined,
    numericCode: typeof code === "number" && Number.isInteger(code) ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `request-id`, then `x-request-id`, then the `request_id` field of the response body or stream event. */
export function findRequestId(headers: Headers | undefined, body: unknown): string | undefined {
  const fromHeaders = headers === undefined ? undefined : nonEmpty(headers.get("request-id")) ?? nonEmpty(headers.get("x-request-id"));
  if (fromHeaders !== undefined) return fromHeaders;
  return isRecord(body) && typeof body.request_id === "string" ? nonEmpty(body.request_id) : undefined;
}

const DECIMAL = /^\s*-?\d+(?:\.\d+)?\s*$/;

function decimal(value: string): number | undefined {
  return DECIMAL.test(value) ? Number(value) : undefined;
}

/** Reads `retry-after-ms`, then `retry-after` in seconds or as an HTTP date. */
export function retryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const milliseconds = headers.get("retry-after-ms");
  if (milliseconds !== null) {
    const parsed = decimal(milliseconds);
    if (parsed !== undefined) return parsed;
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter === null) return undefined;
  const seconds = decimal(retryAfter);
  if (seconds !== undefined) return seconds * 1000;
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function clip(text: string): string {
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

/** Builds the error for a response whose status code is not 2xx. */
export function httpStatusError(provider: ModelProvider, status: number, headers: Headers, text: string): ModelError {
  const body = parseBody(text);
  const fields = errorObjectFields(isRecord(body) ? body.error : undefined);
  const message = fields.message ?? text;
  const code = classifyError({ status, type: fields.type, code: fields.code, message, stream: false });
  const retryAfter = retryAfterMs(headers);
  const requestId = findRequestId(headers, body);
  const detail = message === "" ? "" : `: ${clip(message)}`;
  return new ModelError(`${PROVIDER_LABEL[provider]} HTTP ${status}${detail}`, {
    provider,
    code,
    status,
    ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
    ...(requestId === undefined ? {} : { requestId }),
  });
}

/** Builds the error for an `error` object received inside the stream. */
export function streamError(provider: ModelProvider, errorObject: unknown, requestId: string | undefined): ModelError {
  const fields = errorObjectFields(errorObject);
  const message = fields.message ?? "";
  const code = classifyError({ status: fields.numericCode, type: fields.type, code: fields.code, message, stream: true });
  const detail = message === "" ? "" : `: ${clip(message)}`;
  return new ModelError(`${PROVIDER_LABEL[provider]} stream error${detail}`, {
    provider,
    code,
    ...(requestId === undefined ? {} : { requestId }),
  });
}
