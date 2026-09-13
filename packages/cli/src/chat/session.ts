import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConversationStore, Message, TurnError } from '@goondan/core';

interface StoredConversation {
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

function parseStoredConversation(raw: string, path: string): StoredConversation {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || value['version'] !== 1 || !isObject(value['agents'])) {
    throw new Error(`Invalid chat session: ${path}`);
  }
  const agents: Record<string, Message[]> = {};
  for (const [name, messages] of Object.entries(value['agents'])) {
    if (!Array.isArray(messages) || !messages.every(isMessage)) throw new Error(`Invalid chat session: ${path}`);
    agents[name] = structuredClone(messages);
  }
  return { version: 1, agents };
}

export class FileConversationStore implements ConversationStore {
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, sessionId: string) {
    this.#path = join(stateDirectory, 'sessions', `${encodeURIComponent(sessionId)}.json`);
  }

  async load(_conversationId: string, agent: string): Promise<Message[]> {
    await this.#writeQueue;
    const stored = await this.#read();
    return structuredClone(stored.agents[agent] ?? []);
  }

  async append(_conversationId: string, agent: string, messages: Message[]): Promise<void> {
    await this.#update((stored) => {
      stored.agents[agent] = [...(stored.agents[agent] ?? []), ...structuredClone(messages)];
    });
  }

  async replace(_conversationId: string, agent: string, messages: Message[]): Promise<void> {
    await this.#update((stored) => {
      stored.agents[agent] = structuredClone(messages);
    });
  }

  async finish(
    _conversationId: string,
    _agent: string,
    _state: { status: 'done' | 'error'; turnId: string; output?: Message; error?: TurnError },
  ): Promise<void> {}

  async #read(): Promise<StoredConversation> {
    try {
      return parseStoredConversation(await readFile(this.#path, 'utf8'), this.#path);
    } catch (error) {
      if (isObject(error) && error['code'] === 'ENOENT') return { version: 1, agents: {} };
      throw error;
    }
  }

  async #update(change: (stored: StoredConversation) => void): Promise<void> {
    const update = async (): Promise<void> => {
      const stored = await this.#read();
      change(stored);
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.${process.pid.toString()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await rename(temporary, this.#path);
    };
    this.#writeQueue = this.#writeQueue.then(update, update);
    await this.#writeQueue;
  }
}
