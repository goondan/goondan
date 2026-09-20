import { type ConversationStore, type Message, type OperationStatus, type OperationStore, type OperationUpdate, type PendingOperation } from "./types.ts";

/** 문자열 결합에서 생길 수 있는 충돌 없이 모든 `(sessionId, agent)` 조합을 구분합니다. */
function key(sessionId: string, second: string): string { return JSON.stringify([sessionId, second]); }

export class MemoryConversationStore implements ConversationStore {
  readonly #conversations = new Map<string, Message[]>();
  #key(sessionId: string, agent: string): string { return key(sessionId, agent); }
  async load(sessionId: string, agent: string): Promise<Message[]> { return structuredClone(this.#conversations.get(this.#key(sessionId, agent)) ?? []); }
  async append(sessionId: string, agent: string, messages: Message[]): Promise<void> { const storageKey = this.#key(sessionId, agent); this.#conversations.set(storageKey, [...(this.#conversations.get(storageKey) ?? []), ...structuredClone(messages)]); }
  async replace(sessionId: string, agent: string, messages: Message[]): Promise<void> { this.#conversations.set(this.#key(sessionId, agent), structuredClone(messages)); }
  async deleteSession(sessionId: string): Promise<void> {
    for (const storageKey of this.#conversations.keys()) {
      const parsed: unknown = JSON.parse(storageKey);
      if (!Array.isArray(parsed) || typeof parsed[0] !== "string") continue;
      if (parsed[0] === sessionId || parsed[0].startsWith(`${sessionId}#`)) this.#conversations.delete(storageKey);
    }
  }
}

export class MemoryOperationStore implements OperationStore {
  readonly #operations = new Map<string, PendingOperation>();
  #key(sessionId: string, operationId: string): string { return key(sessionId, operationId); }
  async list(sessionId?: string): Promise<PendingOperation[]> { return structuredClone([...this.#operations.values()].filter((item) => sessionId === undefined || item.sessionId === sessionId)); }
  async get(sessionId: string, operationId: string): Promise<PendingOperation | undefined> { const value = this.#operations.get(this.#key(sessionId, operationId)); return value ? structuredClone(value) : undefined; }
  async save(operation: PendingOperation): Promise<void> { this.#operations.set(this.#key(operation.sessionId, operation.operationId), structuredClone(operation)); }
  async transition(sessionId: string, operationId: string, from: OperationStatus[], update: OperationUpdate): Promise<PendingOperation | undefined> { const storageKey = this.#key(sessionId, operationId); const current = this.#operations.get(storageKey); if (!current || !from.includes(current.status)) return undefined; const changed = { ...current, ...structuredClone(update) }; this.#operations.set(storageKey, changed); return structuredClone(changed); }
  async claimDelivery(sessionId: string, operationId: string, updatedAt: number): Promise<PendingOperation | undefined> { const storageKey = this.#key(sessionId, operationId); const current = this.#operations.get(storageKey); if (!current || current.deliveryStatus !== "pending") return undefined; const changed: PendingOperation = { ...current, deliveryStatus: "delivering", updatedAt }; this.#operations.set(storageKey, changed); return structuredClone(changed); }
  async releaseDelivery(sessionId: string, operationId: string, deliveryId: string, updatedAt: number): Promise<PendingOperation | undefined> { const storageKey = this.#key(sessionId, operationId); const current = this.#operations.get(storageKey); if (!current || current.deliveryId !== deliveryId || current.deliveryStatus !== "delivering") return undefined; const changed: PendingOperation = { ...current, deliveryStatus: "pending", updatedAt }; this.#operations.set(storageKey, changed); return structuredClone(changed); }
}
