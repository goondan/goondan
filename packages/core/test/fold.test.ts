import { describe, expect, it } from "vitest";
import { fold, JournalFoldError, type JournalEvent, type Message } from "../src/index.ts";

function message(id: string, text: string): Message {
  return { id, role: "user", source: "test", content: [{ type: "text", text }] };
}

function event(seq: number, type: string, data: unknown, scope: {
  agent?: string; instance?: string; turnId?: string; executionId?: string; inputId?: string;
  operationId?: string; version?: number; skippable?: true;
} = {}): JournalEvent {
  const value: JournalEvent = {
    seq,
    version: scope.version ?? 1,
    type,
    sessionId: "s",
    at: seq,
    writeId: `w${String(seq)}`,
    data,
  };
  if (scope.agent !== undefined) value.agent = scope.agent;
  if (scope.instance !== undefined) value.instance = scope.instance;
  if (scope.turnId !== undefined) value.turnId = scope.turnId;
  if (scope.executionId !== undefined) value.executionId = scope.executionId;
  if (scope.inputId !== undefined) value.inputId = scope.inputId;
  if (scope.operationId !== undefined) value.operationId = scope.operationId;
  if (scope.skippable !== undefined) value.skippable = scope.skippable;
  return value;
}

const conversationScope = { agent: "a", instance: "s/a", turnId: "t", executionId: "e" };

describe("fold", () => {
  it("produces the same detached state for the same event stream", () => {
    const events = [
      event(1, "conversation.message.appended", { message: message("m1", "one") }, conversationScope),
      event(2, "conversation.message.appended", { message: message("m2", "two") }, conversationScope),
      event(3, "conversation.message.replaced", { messageId: "m1", message: message("m1", "changed") }, conversationScope),
    ];

    const first = fold("s", events);
    first.conversations[0]?.messages.push(message("outside", "mutation"));
    const second = fold("s", events);

    expect(second).toEqual(fold("s", events));
    expect(second.conversations[0]?.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(second.conversations[0]?.messages[0]?.content).toEqual([{ type: "text", text: "changed" }]);
  });

  it("sorts conversation scopes and truncates to an empty suffix", () => {
    const events = [
      event(1, "conversation.message.appended", { message: message("b1", "b") }, { ...conversationScope, agent: "b", instance: "s/b" }),
      event(2, "conversation.message.appended", { message: message("a1", "a") }, conversationScope),
      event(3, "conversation.truncated", { keepLast: 0 }, conversationScope),
    ];

    const state = fold("s", events);
    expect(state.conversations.map((item) => item.agent)).toEqual(["a", "b"]);
    expect(state.conversations[0]?.messages).toEqual([]);
  });

  it("advances head but not fold version for a skippable future event", () => {
    const state = fold("s", [event(1, "future.notice", {}, { version: 2, skippable: true })]);
    expect(state.head).toBe(1);
    expect(state.version).toBe(1);
  });

  it("rejects gaps and semantic corruption", () => {
    expect(() => fold("s", [event(2, "turn.start", {}, { turnId: "t" })])).toThrow(JournalFoldError);
    expect(() => fold("s", [event(1, "route.function", {
      route: 0, fn: "split", status: "done", input: [], output: "invalid",
    }, { turnId: "t" })])).toThrow(/journal schema/);
    expect(() => fold("s", [
      event(1, "conversation.message.appended", { message: message("m", "one") }, conversationScope),
      event(2, "conversation.message.appended", { message: message("m", "two") }, conversationScope),
    ])).toThrow(/message id already exists/);
  });

  it("validates a snapshot and can resume from a pruned stream", () => {
    const original = [event(1, "turn.start", {}, { turnId: "t" })];
    const before = fold("s", original);
    const snapshot = event(2, "snapshot.saved", { throughSeq: 1, state: before }, { skippable: true });

    expect(fold("s", [...original, snapshot])).toEqual({ ...before, head: 2 });
    expect(fold("s", [snapshot])).toEqual({ ...before, head: 2 });
  });
});
