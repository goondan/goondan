import fs from "node:fs/promises";
import path from "node:path";

import { isRecord, readNumber } from "./types.js";

interface PersistedState {
  offset: number;
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!isRecord(value)) {
    return false;
  }
  const offset = readNumber(value, "offset");
  return offset !== undefined && offset >= 0;
}

export class BotStateStore {
  private readonly filePath: string;
  private state: PersistedState;

  private constructor(filePath: string, state: PersistedState) {
    this.filePath = filePath;
    this.state = state;
  }

  static async create(filePath: string): Promise<BotStateStore> {
    const state = await BotStateStore.loadFromDisk(filePath);
    return new BotStateStore(filePath, state);
  }

  getOffset(): number {
    return this.state.offset;
  }

  setOffset(offset: number): void {
    if (offset >= 0) {
      this.state.offset = offset;
    }
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
        return { offset: parsed.offset };
      }
      return { offset: 0 };
    } catch {
      return { offset: 0 };
    }
  }
}
