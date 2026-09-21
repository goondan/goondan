import {
  type AppendOptions, type JournalEvent, type NewJournalEvent, type ScanOptions,
  type Store, type StoreLease,
} from "./types.ts";
import { compareText } from "./json.ts";
import { validateDefinition } from "./schema.ts";

export class StoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreConflictError";
  }
}

export class StoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreInputError";
  }
}

interface ActiveLease { owner: string; token: number }
interface StreamState {
  events: JournalEvent[];
  writes: Map<string, JournalEvent[]>;
  nextToken: number;
  lease?: ActiveLease;
}

interface Watcher {
  sessionId?: string;
  pending: boolean;
  wake?: () => void;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validNewEvent(event: NewJournalEvent): boolean {
  if (event.parentExecutionId !== undefined && event.operationId !== undefined) return false;
  const candidate: JournalEvent = { ...structuredClone(event), seq: 1, at: 0, writeId: "validation" };
  return validateDefinition("journalEvent", candidate, []).length === 0;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** 세션별 append 전용 이벤트 스트림을 메모리에 보관하는 기본 저장소입니다. */
export class MemoryStore implements Store {
  readonly #streams = new Map<string, StreamState>();
  readonly #watchers = new Set<Watcher>();

  #state(sessionId: string): StreamState {
    const found = this.#streams.get(sessionId);
    if (found) return found;
    const created: StreamState = { events: [], writes: new Map(), nextToken: 1 };
    this.#streams.set(sessionId, created);
    return created;
  }

  async append(events: NewJournalEvent[], options: AppendOptions = {}): Promise<JournalEvent[]> {
    if (events.length === 0) throw new StoreInputError("append requires at least one event");
    const sessionId = events[0]?.sessionId;
    if (sessionId === undefined || events.some((event) => event.sessionId !== sessionId || !validNewEvent(event))) {
      throw new StoreInputError("append events must be valid and belong to one session");
    }
    if (options.expected !== undefined && !nonNegativeInteger(options.expected)) {
      throw new StoreInputError("expected must be a non-negative safe integer");
    }
    if (options.token !== undefined && !positiveInteger(options.token)) {
      throw new StoreInputError("token must be a positive safe integer");
    }
    if (options.writeId !== undefined && !nonEmpty(options.writeId)) {
      throw new StoreInputError("writeId must be a non-empty string");
    }

    const state = this.#state(sessionId);
    if (state.lease) {
      if (options.token !== state.lease.token) throw new StoreConflictError("the fencing token does not own this session");
    } else if (options.token !== undefined) {
      throw new StoreConflictError("the fencing token no longer owns this session");
    }

    const writeId = options.writeId ?? newId();
    const previous = state.writes.get(writeId);
    if (previous) return structuredClone(previous);

    const head = state.events.at(-1)?.seq ?? 0;
    if (options.expected !== undefined && options.expected !== head) {
      throw new StoreConflictError(`expected head ${String(options.expected)}, found ${String(head)}`);
    }

    const at = Date.now();
    const stored = events.map((event, index): JournalEvent => ({
      ...structuredClone(event),
      seq: head + index + 1,
      at,
      writeId,
    }));
    state.events.push(...stored);
    state.writes.set(writeId, structuredClone(stored));
    this.#notify(sessionId);
    return structuredClone(stored);
  }

  async *scan(options: ScanOptions = {}): AsyncIterable<JournalEvent> {
    if (options.sessionId === undefined) {
      if (options.fromSeq !== undefined || options.limit !== undefined) {
        throw new StoreInputError("fromSeq and limit require sessionId");
      }
      const all = [...this.#streams.values()].flatMap((state) => state.events).sort((left, right) => {
        if (left.at !== right.at) return left.at - right.at;
        if (left.sessionId !== right.sessionId) return compareText(left.sessionId, right.sessionId);
        return left.seq - right.seq;
      });
      for (const event of all) yield structuredClone(event);
      return;
    }
    const fromSeq = options.fromSeq ?? 1;
    if (!positiveInteger(fromSeq)) throw new StoreInputError("fromSeq must be a positive safe integer");
    if (options.limit !== undefined && !positiveInteger(options.limit)) {
      throw new StoreInputError("limit must be a positive safe integer");
    }
    const source = this.#streams.get(options.sessionId)?.events ?? [];
    const selected = source.filter((event) => event.seq >= fromSeq);
    const bounded = options.limit === undefined ? selected : selected.slice(0, options.limit);
    for (const event of bounded) yield structuredClone(event);
  }

  async head(sessionId: string): Promise<number> {
    return this.#streams.get(sessionId)?.events.at(-1)?.seq ?? 0;
  }

  async *watch(options: { sessionId?: string; signal?: AbortSignal } = {}): AsyncIterable<void> {
    const watcher: Watcher = { sessionId: options.sessionId, pending: false };
    this.#watchers.add(watcher);
    try {
      while (!options.signal?.aborted) {
        if (!watcher.pending) {
          await new Promise<void>((resolve) => {
            watcher.wake = resolve;
            options.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        watcher.wake = undefined;
        if (options.signal?.aborted) return;
        watcher.pending = false;
        yield undefined;
      }
    } finally {
      this.#watchers.delete(watcher);
    }
  }

  async acquireLease(sessionId: string, owner: string): Promise<StoreLease | null> {
    if (!nonEmpty(owner)) throw new StoreInputError("lease owner must be a non-empty string");
    const state = this.#state(sessionId);
    if (state.lease) return null;
    const token = state.nextToken;
    state.nextToken += 1;
    state.lease = { owner, token };
    return {
      token,
      expiresAt: null,
      renew: async () => state.lease?.owner === owner && state.lease.token === token,
      release: async () => {
        if (state.lease?.owner === owner && state.lease.token === token) state.lease = undefined;
      },
    };
  }

  async deleteSession(sessionId: string, options: { token: number }): Promise<void> {
    if (!positiveInteger(options.token)) throw new StoreInputError("token must be a positive safe integer");
    const state = this.#state(sessionId);
    if (!state.lease || state.lease.token !== options.token) {
      throw new StoreConflictError("the fencing token does not own this session");
    }
    state.events = [];
    state.writes.clear();
    state.lease = undefined;
    this.#notify(sessionId);
  }

  #notify(sessionId: string): void {
    for (const watcher of this.#watchers) {
      if (watcher.sessionId !== undefined && watcher.sessionId !== sessionId) continue;
      watcher.pending = true;
      watcher.wake?.();
    }
  }
}
