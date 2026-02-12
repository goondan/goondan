import fs from "node:fs/promises";
import path from "node:path";

import { isRecord, readNumber, readString } from "./types.js";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface PersistedState {
  offset: number;
  conversations: Record<string, ConversationTurn[]>;
}

function isConversationTurn(value: unknown): value is ConversationTurn {
  if (!isRecord(value)) {
    return false;
  }
  const role = readString(value, "role");
  const content = readString(value, "content");
  if (role !== "user" && role !== "assistant") {
    return false;
  }
  return typeof content === "string";
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!isRecord(value)) {
    return false;
  }
  const offset = readNumber(value, "offset");
  if (offset === undefined || offset < 0) {
    return false;
  }
  const conversationsUnknown = value.conversations;
  if (!isRecord(conversationsUnknown)) {
    return false;
  }

  const entries = Object.entries(conversationsUnknown);
  for (const entry of entries) {
    const turns = entry[1];
    if (!Array.isArray(turns)) {
      return false;
    }
    for (const turn of turns) {
      if (!isConversationTurn(turn)) {
        return false;
      }
    }
  }

  return true;
}

export class BotStateStore {
  private readonly filePath: string;
  private readonly maxConversationTurns: number;
  private state: PersistedState;

  private constructor(filePath: string, maxConversationTurns: number, state: PersistedState) {
    this.filePath = filePath;
    this.maxConversationTurns = maxConversationTurns;
    this.state = state;
  }

  static async create(filePath: string, maxConversationTurns: number): Promise<BotStateStore> {
    const state = await BotStateStore.loadFromDisk(filePath);
    return new BotStateStore(filePath, maxConversationTurns, state);
  }

  getOffset(): number {
    return this.state.offset;
  }

  setOffset(offset: number): void {
    if (offset >= 0) {
      this.state.offset = offset;
    }
  }

  getConversation(chatId: number): ConversationTurn[] {
    const key = String(chatId);
    const turns = this.state.conversations[key] ?? [];
    return turns.slice();
  }

  appendTurn(chatId: number, turn: ConversationTurn): void {
    const key = String(chatId);
    const turns = this.state.conversations[key] ?? [];
    const next = turns.concat(turn);
    const maxTurns = this.maxConversationTurns * 2;
    if (next.length > maxTurns) {
      this.state.conversations[key] = next.slice(next.length - maxTurns);
      return;
    }
    this.state.conversations[key] = next;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const json = JSON.stringify(this.state, null, 2);
    await fs.writeFile(this.filePath, `${json}\n`, "utf8");
  }

  private static async loadFromDisk(filePath: string): Promise<PersistedState> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (isPersistedState(parsed)) {
        return parsed;
      }
      return { offset: 0, conversations: {} };
    } catch {
      return { offset: 0, conversations: {} };
    }
  }
}
