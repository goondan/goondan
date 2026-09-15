/**
 * Named gates that fix the order of asynchronous work inside a case.
 *
 * Every gate starts closed and stays open once released. `never` is reserved
 * and can never be released. See fixtures/conformance/README.md ("게이트").
 */

import { RESERVED_GATE } from "./conformance-case.ts";

export class GateCancelledError extends Error {
  constructor(gate: string, reason: string) {
    super(`gate ${gate} wait cancelled: ${reason}`);
    this.name = "GateCancelledError";
  }
}

interface Waiter {
  gate: string;
  owner: unknown;
  reject(error: Error): void;
  resolve(): void;
  detach(): void;
}

export interface GateWaitOptions {
  /** The runtime the waiting call belongs to; used when a runtime closes. */
  owner?: unknown;
  /** Cancellation for model, tool and hook calls. */
  signal?: AbortSignal;
}

export class GateRegistry {
  readonly #open = new Set<string>();
  readonly #waiters = new Set<Waiter>();
  readonly #started = new Map<string, number>();
  readonly #reachers = new Map<string, Array<() => void>>();

  isOpen(gate: string): boolean {
    return this.#open.has(gate);
  }

  /** Number of calls that started waiting on `gate` since the case began. */
  startedWaiting(gate: string): number {
    return this.#started.get(gate) ?? 0;
  }

  async wait(gate: string, options: GateWaitOptions = {}): Promise<void> {
    this.#started.set(gate, this.startedWaiting(gate) + 1);
    const reachers = this.#reachers.get(gate);
    if (reachers) {
      this.#reachers.delete(gate);
      for (const resolve of reachers) resolve();
    }
    if (this.#open.has(gate)) return;
    await new Promise<void>((resolve, reject) => {
      const signal = options.signal;
      const onAbort = (): void => {
        waiter.detach();
        this.#waiters.delete(waiter);
        reject(new GateCancelledError(gate, "aborted"));
      };
      const waiter: Waiter = {
        gate,
        owner: options.owner,
        resolve,
        reject,
        detach: () => {
          if (signal) signal.removeEventListener("abort", onAbort);
        },
      };
      this.#waiters.add(waiter);
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /** Waits until at least one call has started waiting on `gate`. */
  async reach(gate: string): Promise<void> {
    if (this.startedWaiting(gate) > 0) return;
    await new Promise<void>((resolve) => {
      const list = this.#reachers.get(gate) ?? [];
      list.push(resolve);
      this.#reachers.set(gate, list);
    });
  }

  release(gate: string): void {
    if (gate === RESERVED_GATE) throw new Error(`gate ${RESERVED_GATE} must not be released`);
    this.#open.add(gate);
    for (const waiter of [...this.#waiters]) {
      if (waiter.gate !== gate) continue;
      this.#waiters.delete(waiter);
      waiter.detach();
      waiter.resolve();
    }
  }

  /** Cancels the waits that belong to one runtime. */
  cancelOwner(owner: unknown, reason = "runtime closed"): void {
    for (const waiter of [...this.#waiters]) {
      if (waiter.owner !== owner) continue;
      this.#waiters.delete(waiter);
      waiter.detach();
      waiter.reject(new GateCancelledError(waiter.gate, reason));
    }
  }

  /** Cancels every remaining wait at the end of a case. */
  cancelAll(reason = "case finished"): void {
    for (const waiter of [...this.#waiters]) {
      this.#waiters.delete(waiter);
      waiter.detach();
      waiter.reject(new GateCancelledError(waiter.gate, reason));
    }
    for (const [, reachers] of this.#reachers) for (const resolve of reachers) resolve();
    this.#reachers.clear();
  }
}
