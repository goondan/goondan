import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConversationStore, Message } from '@goondan/core';

interface StoredSession {
  version: 1;
  agents: Record<string, Message[]>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  return isObject(value)
    && typeof value['id'] === 'string'
    && typeof value['role'] === 'string'
    && typeof value['source'] === 'string'
    && Array.isArray(value['content']);
}

function parseStoredSession(raw: string, path: string): StoredSession {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || value['version'] !== 1 || !isObject(value['agents'])) {
    throw new Error(`Invalid chat session: ${path}`);
  }
  const agents: Record<string, Message[]> = {};
  for (const [agent, messages] of Object.entries(value['agents'])) {
    if (!Array.isArray(messages) || !messages.every(isMessage)) throw new Error(`Invalid chat session: ${path}`);
    agents[agent] = structuredClone(messages);
  }
  return { version: 1, agents };
}

export class FileConversationStore implements ConversationStore {
  readonly #directory: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, _sessionId: string) {
    this.#directory = join(stateDirectory, 'sessions');
  }

  async load(sessionId: string, agent: string): Promise<Message[]> {
    await this.#writeQueue;
    const stored = await this.#read(sessionId);
    return structuredClone(stored.agents[agent] ?? []);
  }

  async append(sessionId: string, agent: string, messages: Message[]): Promise<void> {
    await this.#update(sessionId, (stored) => {
      stored.agents[agent] = [...(stored.agents[agent] ?? []), ...structuredClone(messages)];
    });
  }

  async replace(sessionId: string, agent: string, messages: Message[]): Promise<void> {
    await this.#update(sessionId, (stored) => {
      stored.agents[agent] = structuredClone(messages);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    const remove = async (): Promise<void> => {
      let names: string[];
      try {
        names = await readdir(this.#directory);
      } catch (error) {
        if (isObject(error) && error['code'] === 'ENOENT') return;
        throw error;
      }
      await Promise.all(names.flatMap((name) => {
        if (!name.endsWith('.json')) return [];
        let storedSessionId: string;
        try {
          storedSessionId = decodeURIComponent(name.slice(0, -'.json'.length));
        } catch {
          return [];
        }
        if (storedSessionId !== sessionId && !storedSessionId.startsWith(`${sessionId}#`)) return [];
        return [unlink(join(this.#directory, name)).catch((error: unknown) => {
          if (!isObject(error) || error['code'] !== 'ENOENT') throw error;
        })];
      }));
    };
    this.#writeQueue = this.#writeQueue.then(remove, remove);
    await this.#writeQueue;
  }

  #path(sessionId: string): string {
    return join(this.#directory, `${encodeURIComponent(sessionId)}.json`);
  }

  async #read(sessionId: string): Promise<StoredSession> {
    const path = this.#path(sessionId);
    try {
      return parseStoredSession(await readFile(path, 'utf8'), path);
    } catch (error) {
      if (isObject(error) && error['code'] === 'ENOENT') return { version: 1, agents: {} };
      throw error;
    }
  }

  async #update(sessionId: string, change: (stored: StoredSession) => void): Promise<void> {
    const update = async (): Promise<void> => {
      const path = this.#path(sessionId);
      const stored = await this.#read(sessionId);
      change(stored);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid.toString()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await rename(temporary, path);
    };
    this.#writeQueue = this.#writeQueue.then(update, update);
    await this.#writeQueue;
  }
}
