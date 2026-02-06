/**
 * HTTP Fetch Tool - HTTP 요청 실행
 *
 * Node.js 내장 fetch API를 사용하여 HTTP GET/POST 요청을 수행합니다.
 *
 * @see /docs/specs/tool.md
 */

import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

/** 기본 타임아웃 (30초) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 응답 본문 최대 길이 (100KB) */
const MAX_RESPONSE_LENGTH = 100_000;

/** HTTP 요청 공통 입력 타입 */
interface HttpRequestInput {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/** HTTP POST 입력 타입 */
interface HttpPostInput extends HttpRequestInput {
  body?: string;
}

/** HTTP 응답 출력 타입 */
interface HttpResponseOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  truncated: boolean;
}

/**
 * 응답 본문을 최대 길이로 자름
 */
function truncateBody(body: string, maxLength: number): { text: string; truncated: boolean } {
  if (body.length <= maxLength) {
    return { text: body, truncated: false };
  }
  return {
    text: body.slice(0, maxLength) + '\n... (response truncated)',
    truncated: true,
  };
}

/**
 * Record<string, string> 형태의 headers를 안전하게 파싱
 */
function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      result[k] = v;
    }
  }
  return result;
}

/**
 * URL 유효성 및 프로토콜 검증
 * - http:// 또는 https:// 프로토콜만 허용
 * - file://, ftp://, data: 등 위험한 프로토콜 차단
 */
function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`유효하지 않은 URL입니다: ${url}`);
  }

  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`허용되지 않는 프로토콜입니다: ${parsed.protocol}. http: 또는 https:만 허용됩니다.`);
  }
}

/**
 * JsonObject에서 HttpRequestInput을 파싱
 */
function parseHttpRequestInput(input: JsonObject): HttpRequestInput {
  const url = input['url'];
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('url은 비어있지 않은 문자열이어야 합니다.');
  }

  validateUrl(url);

  const result: HttpRequestInput = { url };

  const headers = parseHeaders(input['headers']);
  if (headers !== undefined) {
    result.headers = headers;
  }

  const timeout = input['timeout'];
  if (typeof timeout === 'number' && timeout > 0) {
    result.timeout = timeout;
  }

  return result;
}

/**
 * JsonObject에서 HttpPostInput을 파싱
 */
function parseHttpPostInput(input: JsonObject): HttpPostInput {
  const base = parseHttpRequestInput(input);
  const result: HttpPostInput = { ...base };

  const body = input['body'];
  if (typeof body === 'string') {
    result.body = body;
  }

  return result;
}

/**
 * Response 헤더를 Record<string, string>으로 변환
 */
function responseHeadersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * HTTP 요청 수행
 */
async function executeHttpRequest(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  logger: Console | undefined
): Promise<HttpResponseOutput> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger?.debug?.(`[http-fetch] ${options.method ?? 'GET'} ${url}`);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const rawBody = await response.text();
    const { text: body, truncated } = truncateBody(rawBody, MAX_RESPONSE_LENGTH);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeadersToRecord(response.headers),
      body,
      ok: response.ok,
      truncated,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`HTTP 요청 타임아웃 (${timeoutMs}ms): ${url}`);
    }
    if (error instanceof Error) {
      throw new Error(`HTTP 요청 실패: ${error.message}`);
    }
    throw new Error(`HTTP 요청 실패: ${String(error)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Tool handlers
 */
export const handlers: Record<string, ToolHandler> = {
  /**
   * http.get - HTTP GET 요청
   */
  'http.get': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseHttpRequestInput(input);
    const timeoutMs = parsed.timeout ?? DEFAULT_TIMEOUT_MS;

    const requestInit: RequestInit = { method: 'GET' };
    if (parsed.headers !== undefined) {
      requestInit.headers = parsed.headers;
    }

    const result = await executeHttpRequest(
      parsed.url,
      requestInit,
      timeoutMs,
      ctx.logger,
    );

    return {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      ok: result.ok,
      truncated: result.truncated,
    };
  },

  /**
   * http.post - HTTP POST 요청
   */
  'http.post': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseHttpPostInput(input);
    const timeoutMs = parsed.timeout ?? DEFAULT_TIMEOUT_MS;

    const requestHeaders: Record<string, string> = {
      ...parsed.headers,
    };

    // body가 있고 Content-Type이 명시되지 않으면 기본값 설정
    if (parsed.body !== undefined && requestHeaders['Content-Type'] === undefined && requestHeaders['content-type'] === undefined) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers: requestHeaders,
    };
    if (parsed.body !== undefined) {
      requestInit.body = parsed.body;
    }

    const result = await executeHttpRequest(
      parsed.url,
      requestInit,
      timeoutMs,
      ctx.logger,
    );

    return {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      ok: result.ok,
      truncated: result.truncated,
    };
  },
};
