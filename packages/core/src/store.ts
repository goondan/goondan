import { type ConversationStore, type Message, type OperationStatus, type OperationStore, type OperationUpdate, type PendingOperation } from "./types.ts";

export class MemoryConversationStore implements ConversationStore {
  readonly #conversations = new Map<string, Message[]>();
  #key(conversationId: string, agent: string): string { return `${conversationId}:${agent}`; }
  async load(conversationId: string, agent: string): Promise<Message[]> { return structuredClone(this.#conversations.get(this.#key(conversationId, agent)) ?? []); }
  async append(conversationId: string, agent: string, messages: Message[]): Promise<void> { const key = this.#key(conversationId, agent); this.#conversations.set(key, [...(this.#conversations.get(key) ?? []), ...structuredClone(messages)]); }
  async replace(conversationId: string, agent: string, messages: Message[]): Promise<void> { this.#conversations.set(this.#key(conversationId, agent), structuredClone(messages)); }
  async finish(): Promise<void> {}
}

export class MemoryOperationStore implements OperationStore {
  readonly #operations = new Map<string, PendingOperation>();
  #key(conversationId: string, operationId: string): string { return `${conversationId}:${operationId}`; }
  async list(conversationId?: string): Promise<PendingOperation[]> { return structuredClone([...this.#operations.values()].filter((item) => conversationId === undefined || item.conversationId === conversationId)); }
  async get(conversationId: string, operationId: string): Promise<PendingOperation | undefined> { const value = this.#operations.get(this.#key(conversationId, operationId)); return value ? structuredClone(value) : undefined; }
  async save(operation: PendingOperation): Promise<void> { this.#operations.set(this.#key(operation.conversationId, operation.operationId), structuredClone(operation)); }
  async transition(conversationId: string, operationId: string, from: OperationStatus[], update: OperationUpdate): Promise<PendingOperation | undefined> { const key = this.#key(conversationId, operationId); const current = this.#operations.get(key); if (!current || !from.includes(current.status)) return undefined; const changed = { ...current, ...structuredClone(update) }; this.#operations.set(key, changed); return structuredClone(changed); }
  async claimDelivery(conversationId: string, operationId: string, updatedAt: number): Promise<PendingOperation | undefined> { const key = this.#key(conversationId, operationId); const current = this.#operations.get(key); if (!current || current.deliveryStatus !== "pending") return undefined; const changed: PendingOperation = { ...current, deliveryStatus: "delivering", updatedAt }; this.#operations.set(key, changed); return structuredClone(changed); }
  async releaseDelivery(conversationId: string, operationId: string, deliveryId: string, updatedAt: number): Promise<PendingOperation | undefined> { const key = this.#key(conversationId, operationId); const current = this.#operations.get(key); if (!current || current.deliveryId !== deliveryId || current.deliveryStatus !== "delivering") return undefined; const changed: PendingOperation = { ...current, deliveryStatus: "pending", updatedAt }; this.#operations.set(key, changed); return structuredClone(changed); }
}
