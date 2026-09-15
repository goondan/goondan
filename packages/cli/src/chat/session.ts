import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConversationStore, Message } from '@goondan/core';

/**
 * The session file: one bucket per conversation identifier, then one entry per agent path. Version 1
 * kept a single `agents` map, so it is read as the session's own conversation and rewritten as
 * version 2 on the next write.
 */
interface StoredSession {
  version: 2;
  conversations: Record<string, Record<string, Message[]>>;
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

function parseAgents(value: unknown, path: string): Record<string, Message[]> {
  if (!isObject(value)) throw new Error(`Invalid chat session: ${path}`);
  const agents: Record<string, Message[]> = {};
  for (const [agent, messages] of Object.entries(value)) {
    if (!Array.isArray(messages) || !messages.every(isMessage)) throw new Error(`Invalid chat session: ${path}`);
    agents[agent] = structuredClone(messages);
  }
  return agents;
}

function parseStoredSession(raw: string, path: string, conversationId: string): StoredSession {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value)) throw new Error(`Invalid chat session: ${path}`);
  if (value['version'] === 1) return { version: 2, conversations: { [conversationId]: parseAgents(value['agents'], path) } };
  if (value['version'] !== 2 || !isObject(value['conversations'])) throw new Error(`Invalid chat session: ${path}`);
  const conversations: Record<string, Record<string, Message[]>> = {};
  for (const [stored, agents] of Object.entries(value['conversations'])) conversations[stored] = parseAgents(agents, path);
  return { version: 2, conversations };
}

function agentsOf(stored: StoredSession, conversationId: string): Record<string, Message[]> {
  const existing = stored.conversations[conversationId];
  if (existing) return existing;
  const created: Record<string, Message[]> = {};
  stored.conversations[conversationId] = created;
  return created;
}

export class FileConversationStore implements ConversationStore {
  readonly #path: string;
  readonly #sessionId: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, sessionId: string) {
    this.#path = join(stateDirectory, 'sessions', `${encodeURIComponent(sessionId)}.json`);
    this.#sessionId = sessionId;
  }

  async load(conversationId: string, agent: string): Promise<Message[]> {
    await this.#writeQueue;
    const stored = await this.#read();
    return structuredClone(stored.conversations[conversationId]?.[agent] ?? []);
  }

  async append(conversationId: string, agent: string, messages: Message[]): Promise<void> {
    await this.#update((stored) => {
      const agents = agentsOf(stored, conversationId);
      agents[agent] = [...(agents[agent] ?? []), ...structuredClone(messages)];
    });
  }

  async replace(conversationId: string, agent: string, messages: Message[]): Promise<void> {
    await this.#update((stored) => {
      agentsOf(stored, conversationId)[agent] = structuredClone(messages);
    });
  }

  async #read(): Promise<StoredSession> {
    try {
      return parseStoredSession(await readFile(this.#path, 'utf8'), this.#path, this.#sessionId);
    } catch (error) {
      if (isObject(error) && error['code'] === 'ENOENT') return { version: 2, conversations: {} };
      throw error;
    }
  }

  async #update(change: (stored: StoredSession) => void): Promise<void> {
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
