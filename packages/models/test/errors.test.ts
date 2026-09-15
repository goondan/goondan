import { describe, expect, it } from "vitest";
import { ModelError, httpStatusError, isModelError, retryAfterMs, streamError } from "../src/errors.ts";
import { backoffMs } from "../src/transport.ts";

function http(status: number, body: string, headers: Record<string, string> = {}): ModelError {
  return httpStatusError("anthropic", status, new Headers(headers), body);
}

function errorBody(error: Record<string, string | number>): string {
  return JSON.stringify({ error });
}

describe("error classification", () => {
  it("classifies HTTP error responses in the specified order", () => {
    expect(http(402, "").code).toBe("quota");
    expect(http(429, errorBody({ type: "insufficient_quota", code: "insufficient_quota", message: "quota" })).code).toBe("quota");
    expect(http(400, errorBody({ type: "billing_error", message: "billing" })).code).toBe("quota");
    expect(http(400, errorBody({ type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" })).code).toBe("context_length");
    expect(http(400, errorBody({ code: "context_length_exceeded", message: "too long" })).code).toBe("context_length");
    expect(http(400, "This model's Maximum Context is exceeded").code).toBe("context_length");
    expect(http(529, errorBody({ type: "overloaded_error", message: "Overloaded" })).code).toBe("overloaded");
    expect(http(429, "").code).toBe("rate_limited");
    expect(http(401, "").code).toBe("authentication");
    expect(http(403, "").code).toBe("permission");
    expect(http(404, "").code).toBe("not_found");
    expect(http(413, "").code).toBe("request_too_large");
    expect(http(408, "").code).toBe("timeout");
    expect(http(409, "").code).toBe("server_error");
    expect(http(503, "").code).toBe("server_error");
    expect(http(400, errorBody({ type: "invalid_request_error", message: "bad" })).code).toBe("invalid_request");
    expect(http(418, "").code).toBe("invalid_request");
  });

  it("classifies in-stream errors, using an integer error code as the status", () => {
    expect(streamError("anthropic", { type: "overloaded_error", message: "Overloaded" }, undefined).code).toBe("overloaded");
    expect(streamError("anthropic", { type: "invalid_request_error", message: "bad" }, undefined).code).toBe("invalid_request");
    expect(streamError("openai", { code: 502, message: "Provider disconnected" }, undefined).code).toBe("server_error");
    expect(streamError("openai", { code: 429, message: "slow down" }, undefined).code).toBe("rate_limited");
    expect(streamError("openai", { message: "unknown" }, undefined).code).toBe("server_error");
    expect(streamError("openai", { code: 429, message: "slow down" }, undefined).status).toBeUndefined();
  });

  it("records the status, request id, retry hint and the body text as the message", () => {
    const error = http(400, "plain failure", { "request-id": "req_1", "retry-after": "2" });
    expect(error).toMatchObject({ name: "ModelError", provider: "anthropic", code: "invalid_request", status: 400, requestId: "req_1", retryAfterMs: 2000, retryable: false });
    expect(error.message).toBe("Anthropic HTTP 400: plain failure");
    expect(http(500, "", { "x-request-id": "req_2" }).requestId).toBe("req_2");
    expect(http(500, JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" }, request_id: "req_3" })).requestId).toBe("req_3");
  });

  it("marks only rate_limited, overloaded, server_error, timeout and network as retryable", () => {
    const retryable: ModelError["code"][] = ["rate_limited", "overloaded", "server_error", "timeout", "network"];
    const final: ModelError["code"][] = ["invalid_request", "authentication", "permission", "not_found", "request_too_large", "quota", "context_length", "invalid_response", "unsupported_content"];
    for (const code of retryable) expect(new ModelError("x", { provider: "openai", code }).retryable).toBe(true);
    for (const code of final) {
      expect(new ModelError("x", { provider: "openai", code }).retryable).toBe(false);
    }
  });

  it("keeps the cause and is recognised by isModelError", () => {
    const cause = new TypeError("fetch failed");
    const error = new ModelError("network", { provider: "openai", code: "network", cause });
    expect(error.cause).toBe(cause);
    expect(isModelError(error)).toBe(true);
    expect(isModelError(new Error("plain"))).toBe(false);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("retry timing", () => {
  it("reads retry-after-ms, then retry-after seconds or HTTP date", () => {
    const now = Date.parse("2026-09-14T00:00:00Z");
    expect(retryAfterMs(new Headers({ "retry-after-ms": "1500", "retry-after": "9" }), now)).toBe(1500);
    expect(retryAfterMs(new Headers({ "retry-after": "2" }), now)).toBe(2000);
    expect(retryAfterMs(new Headers({ "retry-after": "Mon, 14 Sep 2026 00:00:03 GMT" }), now)).toBe(3000);
    expect(retryAfterMs(new Headers({ "retry-after": "Sun, 13 Sep 2026 23:59:00 GMT" }), now)).toBe(0);
    expect(retryAfterMs(new Headers({ "retry-after": "soon" }), now)).toBeUndefined();
    expect(retryAfterMs(new Headers(), now)).toBeUndefined();
  });

  it("uses a hinted wait between 0 and 60 seconds, otherwise capped exponential backoff with jitter", () => {
    expect(backoffMs(0, 0)).toBe(0);
    expect(backoffMs(3, 60_000)).toBe(60_000);
    expect(backoffMs(0, 60_001, () => 0)).toBe(500);
    expect(backoffMs(1, undefined, () => 0)).toBe(1000);
    expect(backoffMs(0, -1, () => 0.5)).toBe(437.5);
    expect(backoffMs(10, undefined, () => 0)).toBe(8000);
  });
});
