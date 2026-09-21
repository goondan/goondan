import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  fold,
  StoreConflictError,
  StoreInputError,
  type AppendOptions,
  type JournalEvent,
  type NewJournalEvent,
  type ScanOptions,
  type Store,
  type StoreLease,
} from '@goondan/core';

interface ActiveLease {
  owner: string;
  token: number;
  identity: object;
}

interface SessionState {
  queue: Promise<void>;
  lease?: ActiveLease;
}

interface Watcher {
  sessionId?: string;
  pending: boolean;
  wake?: () => void;
}

interface TokenMetadata {
  nextToken: number;
}

const sessionStates = new Map<string, SessionState>();
const rootWatchers = new Map<string, Set<Watcher>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJson);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const eventKeys = new Set([
  'version', 'type', 'sessionId', 'agent', 'instance', 'turnId', 'executionId', 'inputId',
  'parentExecutionId', 'operationId', 'data', 'skippable',
]);

function validNewEvent(value: unknown): value is NewJournalEvent {
  if (!isRecord(value) || Object.keys(value).some((key) => !eventKeys.has(key))) return false;
  if (!positiveInteger(value['version']) || !nonEmpty(value['type']) || typeof value['sessionId'] !== 'string') return false;
  if (!Object.hasOwn(value, 'data') || !isJson(value['data'])) return false;
  for (const key of ['agent', 'instance', 'turnId', 'executionId', 'inputId', 'parentExecutionId', 'operationId']) {
    const candidate = value[key];
    if (candidate !== undefined && !nonEmpty(candidate)) return false;
  }
  if (value['skippable'] !== undefined && value['skippable'] !== true) return false;
  return value['parentExecutionId'] === undefined || value['operationId'] === undefined;
}

function validStoredEvent(value: unknown): value is JournalEvent {
  if (!isRecord(value)) return false;
  const unstored: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'seq' && key !== 'at' && key !== 'writeId') unstored[key] = item;
  }
  return validNewEvent(unstored)
    && positiveInteger(value['seq'])
    && nonNegativeInteger(value['at'])
    && nonEmpty(value['writeId']);
}

function stateFor(key: string): SessionState {
  const current = sessionStates.get(key);
  if (current) return current;
  const created: SessionState = { queue: Promise.resolve() };
  sessionStates.set(key, created);
  return created;
}

async function serialized<T>(state: SessionState, action: () => Promise<T>): Promise<T> {
  const result = state.queue.then(action, action);
  state.queue = result.then(() => undefined, () => undefined);
  return await result;
}

function copyEvents(events: readonly JournalEvent[]): JournalEvent[] {
  return events.map((event) => structuredClone(event));
}

/** 세션마다 완전한 저널 이벤트 봉투를 한 줄씩 기록하는 CLI JSONL 저장소입니다. */
export class FileJournalStore implements Store {
  readonly #root: string;
  readonly #directory: string;

  constructor(stateDirectory: string) {
    this.#root = resolve(stateDirectory);
    this.#directory = join(this.#root, 'sessions');
  }

  async append(events: NewJournalEvent[], options: AppendOptions = {}): Promise<JournalEvent[]> {
    if (events.length === 0) throw new StoreInputError('append requires at least one event');
    const sessionId = events[0]?.sessionId;
    if (sessionId === undefined || events.some((event) => event.sessionId !== sessionId || !validNewEvent(event))) {
      throw new StoreInputError('append events must be valid and belong to one session');
    }
    if (options.expected !== undefined && !nonNegativeInteger(options.expected)) {
      throw new StoreInputError('expected must be a non-negative safe integer');
    }
    if (options.token !== undefined && !positiveInteger(options.token)) {
      throw new StoreInputError('token must be a positive safe integer');
    }
    if (options.writeId !== undefined && !nonEmpty(options.writeId)) {
      throw new StoreInputError('writeId must be a non-empty string');
    }

    const path = this.#journalPath(sessionId);
    const state = stateFor(path);
    return await serialized(state, async () => {
      this.#checkToken(state, options.token);
      const current = await this.#read(sessionId);
      const writeId = options.writeId ?? randomUUID();
      const previous = current.filter((event) => event.writeId === writeId);
      if (previous.length > 0) return copyEvents(previous);
      const head = current.at(-1)?.seq ?? 0;
      if (options.expected !== undefined && options.expected !== head) {
        throw new StoreConflictError(`expected head ${String(options.expected)}, found ${String(head)}`);
      }
      if (!Number.isSafeInteger(head + events.length)) throw new StoreInputError('event sequence exceeds the safe integer range');
      const at = Date.now();
      const stored = events.map((event, index): JournalEvent => ({
        ...structuredClone(event), seq: head + index + 1, at, writeId,
      }));
      try {
        fold(sessionId, [...current, ...stored]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new StoreInputError(`append events do not form a valid journal: ${detail}`);
      }
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${stored.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
      this.#notify(sessionId);
      return copyEvents(stored);
    });
  }

  async *scan(options: ScanOptions = {}): AsyncIterable<JournalEvent> {
    if (options.sessionId === undefined) {
      if (options.fromSeq !== undefined || options.limit !== undefined) {
        throw new StoreInputError('fromSeq and limit require sessionId');
      }
      const all: JournalEvent[] = [];
      for (const sessionId of await this.#sessionIds()) all.push(...await this.#read(sessionId));
      all.sort((left, right) => left.at - right.at || compareText(left.sessionId, right.sessionId) || left.seq - right.seq);
      for (const event of all) yield structuredClone(event);
      return;
    }
    const fromSeq = options.fromSeq ?? 1;
    if (!positiveInteger(fromSeq)) throw new StoreInputError('fromSeq must be a positive safe integer');
    if (options.limit !== undefined && !positiveInteger(options.limit)) {
      throw new StoreInputError('limit must be a positive safe integer');
    }
    const selected = (await this.#read(options.sessionId)).filter((event) => event.seq >= fromSeq);
    const bounded = options.limit === undefined ? selected : selected.slice(0, options.limit);
    for (const event of bounded) yield structuredClone(event);
  }

  async head(sessionId: string): Promise<number> {
    const events = await this.#read(sessionId);
    return events.at(-1)?.seq ?? 0;
  }

  async *watch(options: { sessionId?: string; signal?: AbortSignal } = {}): AsyncIterable<void> {
    const watcher: Watcher = { sessionId: options.sessionId, pending: false };
    const watchers = rootWatchers.get(this.#root) ?? new Set<Watcher>();
    rootWatchers.set(this.#root, watchers);
    watchers.add(watcher);
    try {
      while (!options.signal?.aborted) {
        if (!watcher.pending) {
          await new Promise<void>((done) => {
            watcher.wake = done;
            options.signal?.addEventListener('abort', () => done(), { once: true });
          });
        }
        watcher.wake = undefined;
        if (options.signal?.aborted) return;
        watcher.pending = false;
        yield undefined;
      }
    } finally {
      watchers.delete(watcher);
      if (watchers.size === 0) rootWatchers.delete(this.#root);
    }
  }

  async acquireLease(sessionId: string, owner: string): Promise<StoreLease | null> {
    if (!nonEmpty(owner)) throw new StoreInputError('lease owner must be a non-empty string');
    const path = this.#journalPath(sessionId);
    const state = stateFor(path);
    return await serialized(state, async () => {
      if (state.lease) return null;
      const metadata = await this.#readMetadata(sessionId);
      const token = metadata.nextToken;
      if (!positiveInteger(token) || token === Number.MAX_SAFE_INTEGER) {
        throw new StoreInputError('fencing token exceeds the safe integer range');
      }
      await this.#writeMetadata(sessionId, { nextToken: token + 1 });
      const identity = {};
      state.lease = { owner, token, identity };
      return {
        token,
        expiresAt: null,
        renew: async () => await serialized(state, async () => state.lease?.identity === identity),
        release: async () => await serialized(state, async () => {
          if (state.lease?.identity === identity) state.lease = undefined;
        }),
      };
    });
  }

  async deleteSession(sessionId: string, options: { token: number }): Promise<void> {
    if (!positiveInteger(options.token)) throw new StoreInputError('token must be a positive safe integer');
    const path = this.#journalPath(sessionId);
    const state = stateFor(path);
    await serialized(state, async () => {
      if (!state.lease || state.lease.token !== options.token) {
        throw new StoreConflictError('the fencing token does not own this session');
      }
      await unlink(path).catch((error: unknown) => {
        if (!isRecord(error) || error['code'] !== 'ENOENT') throw error;
      });
      state.lease = undefined;
      this.#notify(sessionId);
    });
  }

  #checkToken(state: SessionState, token: number | undefined): void {
    if (state.lease) {
      if (token !== state.lease.token) throw new StoreConflictError('the fencing token does not own this session');
    } else if (token !== undefined) {
      throw new StoreConflictError('the fencing token no longer owns this session');
    }
  }

  #journalPath(sessionId: string): string {
    return join(this.#directory, `${encodeURIComponent(sessionId)}.jsonl`);
  }

  #metadataPath(sessionId: string): string {
    return join(this.#directory, `${encodeURIComponent(sessionId)}.meta.json`);
  }

  async #read(sessionId: string): Promise<JournalEvent[]> {
    const path = this.#journalPath(sessionId);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return [];
      throw error;
    }
    const events: JournalEvent[] = [];
    const lines = raw.split('\n');
    for (const [index, line] of lines.entries()) {
      if (line.length === 0 && index === lines.length - 1) continue;
      let candidate: unknown;
      try {
        candidate = JSON.parse(line);
      } catch {
        throw new Error(`Invalid chat journal: ${path} (line ${String(index + 1)})`);
      }
      if (!validStoredEvent(candidate)) throw new Error(`Invalid chat journal: ${path} (line ${String(index + 1)})`);
      events.push(structuredClone(candidate));
    }
    try {
      fold(sessionId, events);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid chat journal: ${path}: ${detail}`, { cause: error });
    }
    return events;
  }

  async #sessionIds(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return [];
      throw error;
    }
    const ids: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        ids.push(decodeURIComponent(name.slice(0, -'.jsonl'.length)));
      } catch {
        // 다른 프로그램이 만든 파일은 세션 저널로 취급하지 않습니다.
      }
    }
    return ids;
  }

  async #readMetadata(sessionId: string): Promise<TokenMetadata> {
    const path = this.#metadataPath(sessionId);
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!isRecord(value) || !positiveInteger(value['nextToken'])) throw new Error(`Invalid chat journal metadata: ${path}`);
      return { nextToken: value['nextToken'] };
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return { nextToken: 1 };
      throw error;
    }
  }

  async #writeMetadata(sessionId: string, metadata: TokenMetadata): Promise<void> {
    const path = this.#metadataPath(sessionId);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(metadata)}\n`, 'utf8');
    await rename(temporary, path);
  }

  #notify(sessionId: string): void {
    for (const watcher of rootWatchers.get(this.#root) ?? []) {
      if (watcher.sessionId !== undefined && watcher.sessionId !== sessionId) continue;
      watcher.pending = true;
      watcher.wake?.();
    }
  }
}
