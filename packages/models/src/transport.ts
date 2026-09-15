import type { Model, ModelResult } from "@goondan/core";
import { ModelError, PROVIDER_LABEL, findRequestId, httpStatusError, invalidResponse, type ModelProvider } from "./errors.ts";
import type { JsonObject } from "./json.ts";
import type { FetchFunction } from "./options.ts";
import { SseParser } from "./sse.ts";

/** The context the runtime passes to `Model.generate`. */
export type ModelCallContext = Parameters<Model["generate"]>[1];

/** Turns the `data` of each server-sent event into a model result. */
export interface StreamAssembler {
  /** Handles one event; returns true when the provider signalled the end and reading should stop. */
  accept(data: string): boolean;
  result(): ModelResult;
}

export interface StreamCall {
  provider: ModelProvider;
  url: string;
  headers: Record<string, string>;
  body: JsonObject;
  fetch: FetchFunction;
  maxRetries: number;
  idleTimeoutMs: number | undefined;
  ctx: ModelCallContext;
  createAssembler(emit: (delta: string) => void, requestId: string | undefined): StreamAssembler;
}

/** The value thrown on cancellation: `signal.reason` when it is an `Error`, otherwise an `AbortError` DOMException. */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException("The model request was aborted", "AbortError");
}

/** Wait before the nth retry (the first retry is n = 0). */
export function backoffMs(attempt: number, hinted: number | undefined, random: () => number = Math.random): number {
  if (hinted !== undefined && hinted >= 0 && hinted <= 60_000) return hinted;
  return Math.min(8000, 500 * 2 ** attempt) * (1 - 0.25 * random());
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One request attempt. Its signal follows the caller's signal and the idle timer,
 * and `wait` stops waiting as soon as either fires, even if the HTTP implementation ignores the signal.
 */
class AttemptControl {
  readonly #controller = new AbortController();
  readonly #parent: AbortSignal;
  readonly #idleTimeoutMs: number | undefined;
  readonly #provider: ModelProvider;
  #timeout: ModelError | undefined;
  readonly #onParentAbort = (): void => {
    this.#controller.abort(this.#parent.reason);
  };

  constructor(parent: AbortSignal, idleTimeoutMs: number | undefined, provider: ModelProvider) {
    this.#parent = parent;
    this.#idleTimeoutMs = idleTimeoutMs;
    this.#provider = provider;
    if (parent.aborted) this.#controller.abort(parent.reason);
    else parent.addEventListener("abort", this.#onParentAbort, { once: true });
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  wait<T>(promise: Promise<T>): Promise<T> {
    const signal = this.#controller.signal;
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        settle();
        reject(this.#timeout ?? signal.reason);
      };
      if (signal.aborted) {
        promise.catch(() => undefined);
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      const idle = this.#idleTimeoutMs;
      if (idle !== undefined) {
        timer = setTimeout(() => {
          this.#timeout = new ModelError(`${PROVIDER_LABEL[this.#provider]} sent nothing for ${idle} ms`, { provider: this.#provider, code: "timeout" });
          this.#controller.abort(this.#timeout);
        }, idle);
      }
      promise.then(
        (value) => {
          settle();
          resolve(value);
        },
        (error: unknown) => {
          settle();
          reject(error);
        },
      );
    });
  }

  /** Classifies a failed attempt. Errors that are not `ModelError` become `network` errors. */
  failure(error: unknown): ModelError {
    if (this.#timeout !== undefined) return this.#timeout;
    if (error instanceof ModelError) return error;
    return new ModelError(`${PROVIDER_LABEL[this.#provider]} request failed: ${describe(error)}`, { provider: this.#provider, code: "network", cause: error });
  }

  dispose(): void {
    this.#parent.removeEventListener("abort", this.#onParentAbort);
  }
}

function deliver(provider: ModelProvider, assembler: StreamAssembler, events: readonly string[]): boolean {
  for (const data of events) {
    let done: boolean;
    try {
      done = assembler.accept(data);
    } catch (error) {
      if (error instanceof ModelError) throw error;
      throw invalidResponse(provider, `unexpected stream event: ${describe(error)}`, error);
    }
    if (done) return true;
  }
  return false;
}

function finish(provider: ModelProvider, assembler: StreamAssembler): ModelResult {
  try {
    return assembler.result();
  } catch (error) {
    if (error instanceof ModelError) throw error;
    throw invalidResponse(provider, describe(error), error);
  }
}

async function runAttempt(call: StreamCall, payload: string, control: AttemptControl, emit: (delta: string) => void): Promise<ModelResult> {
  const response = await control.wait(call.fetch(call.url, { method: "POST", headers: call.headers, body: payload, signal: control.signal }));
  if (!response.ok) {
    let text = "";
    try {
      text = await control.wait(response.text());
    } catch (error) {
      if (control.signal.aborted) throw error;
    }
    throw httpStatusError(call.provider, response.status, response.headers, text);
  }
  const assembler = call.createAssembler(emit, findRequestId(response.headers, undefined));
  const parser = new SseParser();
  const body = response.body;
  if (body === null) {
    deliver(call.provider, assembler, parser.end());
    return finish(call.provider, assembler);
  }
  const reader = body.getReader();
  let exhausted = false;
  try {
    for (;;) {
      const chunk = await control.wait(reader.read());
      if (chunk.done) exhausted = true;
      const events = chunk.done ? parser.end() : parser.push(chunk.value);
      if (deliver(call.provider, assembler, events) || chunk.done) break;
    }
  } finally {
    if (!exhausted) reader.cancel().catch(() => undefined);
  }
  return finish(call.provider, assembler);
}

/**
 * Sends a streaming request and assembles the result.
 * Retryable failures are resent up to `maxRetries` times, but only while no text chunk has reached the caller.
 */
export async function streamModel(call: StreamCall): Promise<ModelResult> {
  const signal = call.ctx.signal;
  const payload = JSON.stringify(call.body);
  let emitted = false;
  const emit = (delta: string): void => {
    emitted = true;
    call.ctx.onTextDelta(delta);
  };
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) throw abortReason(signal);
    const control = new AttemptControl(signal, call.idleTimeoutMs, call.provider);
    let failure: ModelError;
    try {
      return await runAttempt(call, payload, control, emit);
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      failure = control.failure(error);
    } finally {
      control.dispose();
    }
    if (!failure.retryable || emitted || attempt >= call.maxRetries) throw failure;
    await sleep(backoffMs(attempt, failure.retryAfterMs), signal);
  }
}

/** Parses the `data` of one event as JSON; malformed data is an `invalid_response` error. */
export function parseEventData(provider: ModelProvider, data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw invalidResponse(provider, `stream event data is not JSON: ${describe(error)}`, error);
  }
}
