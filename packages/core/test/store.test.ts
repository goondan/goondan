import { describe, expect, it, vi } from "vitest";
import {
  MemoryStore, StoreConflictError, StoreInputError,
  type JournalEvent, type NewJournalEvent,
} from "../src/index.ts";

function turn(sessionId: string, turnId: string): NewJournalEvent {
  return { version: 1, type: "turn.start", sessionId, turnId, data: {} };
}

async function collect(source: AsyncIterable<JournalEvent>): Promise<JournalEvent[]> {
  const events: JournalEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

describe("MemoryStore", () => {
  it("assigns contiguous sequence numbers to an atomic batch", async () => {
    const store = new MemoryStore();
    const stored = await store.append([turn("s", "t1"), turn("s", "t2")], { expected: 0, writeId: "w1" });

    expect(stored.map((event) => event.seq)).toEqual([1, 2]);
    expect(stored.map((event) => event.writeId)).toEqual(["w1", "w1"]);
    expect(await store.head("s")).toBe(2);
    expect((await collect(store.scan({ sessionId: "s", fromSeq: 2 }))).map((event) => event.seq)).toEqual([2]);
  });

  it("rejects an expected-head conflict without appending any event", async () => {
    const store = new MemoryStore();
    await store.append([turn("s", "t1")], { expected: 0 });

    await expect(store.append([turn("s", "t2")], { expected: 0 })).rejects.toBeInstanceOf(StoreConflictError);
    expect(await store.head("s")).toBe(1);
  });

  it("returns the first batch for a repeated writeId before checking expected", async () => {
    const store = new MemoryStore();
    const first = await store.append([turn("s", "t1")], { expected: 0, writeId: "same" });
    const repeated = await store.append([turn("s", "different")], { expected: 99, writeId: "same" });

    expect(repeated).toEqual(first);
    expect(await store.head("s")).toBe(1);
  });

  it("fences released leases and keeps token generations after deletion", async () => {
    const store = new MemoryStore();
    const first = await store.acquireLease("s", "one");
    if (!first) throw new Error("임대를 획득하지 못했습니다.");
    await store.append([turn("s", "t1")], { token: first.token });
    await first.release();

    const second = await store.acquireLease("s", "two");
    if (!second) throw new Error("두 번째 임대를 획득하지 못했습니다.");
    expect(second.token).toBeGreaterThan(first.token);
    await expect(store.append([turn("s", "t2")], { token: first.token })).rejects.toBeInstanceOf(StoreConflictError);
    await expect(store.append([turn("s", "t2")])).rejects.toBeInstanceOf(StoreConflictError);
    await store.deleteSession("s", { token: second.token });

    const third = await store.acquireLease("s", "three");
    if (!third) throw new Error("세 번째 임대를 획득하지 못했습니다.");
    expect(third.token).toBeGreaterThan(second.token);
    expect(await store.head("s")).toBe(0);
  });

  it("distinguishes invalid input from a write conflict", async () => {
    const store = new MemoryStore();
    await expect(store.append([])).rejects.toBeInstanceOf(StoreInputError);
    await expect(store.append([turn("a", "t1"), turn("b", "t2")])).rejects.toBeInstanceOf(StoreInputError);
    await expect(collect(store.scan({ fromSeq: 1 }))).rejects.toBeInstanceOf(StoreInputError);
  });

  it("wakes a matching watcher after append without treating the signal as an event", async () => {
    const store = new MemoryStore();
    const controller = new AbortController();
    const watcher = store.watch({ sessionId: "s", signal: controller.signal })[Symbol.asyncIterator]();
    const wake = watcher.next();

    await store.append([turn("s", "t")]);
    expect(await wake).toEqual({ value: undefined, done: false });
    controller.abort();
    expect((await watcher.next()).done).toBe(true);
  });

  it("orders global scans by Unicode code point when timestamps match", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      const store = new MemoryStore();
      await store.append([turn("😀", "astral")]);
      await store.append([turn("\ue000", "private")]);

      expect((await collect(store.scan())).map((event) => event.sessionId)).toEqual(["\ue000", "😀"]);
    } finally {
      now.mockRestore();
    }
  });
});
