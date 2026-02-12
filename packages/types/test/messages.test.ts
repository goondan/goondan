import { describe, expect, it } from "vitest";

import {
  applyMessageEvent,
  createConversationState,
  foldMessageEvents,
  type Message,
  type MessageEvent,
} from "../src/index.js";

function makeMessage(id: string, role: "system" | "user" | "assistant" | "tool", content: string): Message {
  return {
    id,
    data: {
      role,
      content,
    },
    metadata: {
      seq: Number(id),
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    source: {
      type: "user",
    },
  };
}

describe("MessageEvent fold", () => {
  it("applies append, replace, remove, truncate events", () => {
    const baseMessages = [makeMessage("1", "user", "hello"), makeMessage("2", "assistant", "world")];

    const appended = applyMessageEvent(baseMessages, {
      type: "append",
      message: makeMessage("3", "assistant", "new"),
    });
    expect(appended.map((message) => message.id)).toEqual(["1", "2", "3"]);

    const replaced = applyMessageEvent(appended, {
      type: "replace",
      targetId: "2",
      message: makeMessage("2b", "assistant", "changed"),
    });
    expect(replaced.map((message) => message.id)).toEqual(["1", "2b", "3"]);

    const removed = applyMessageEvent(replaced, {
      type: "remove",
      targetId: "1",
    });
    expect(removed.map((message) => message.id)).toEqual(["2b", "3"]);

    const truncated = applyMessageEvent(removed, {
      type: "truncate",
    });
    expect(truncated).toEqual([]);
  });

  it("folds events into next messages by Base + SUM(Events)", () => {
    const baseMessages = [makeMessage("1", "user", "alpha"), makeMessage("2", "assistant", "beta")];

    const events: MessageEvent[] = [
      {
        type: "append",
        message: makeMessage("3", "assistant", "gamma"),
      },
      {
        type: "replace",
        targetId: "2",
        message: makeMessage("2r", "assistant", "beta-updated"),
      },
      {
        type: "remove",
        targetId: "1",
      },
    ];

    const folded = foldMessageEvents(baseMessages, events);
    expect(folded.map((message) => message.id)).toEqual(["2r", "3"]);

    const state = createConversationState(baseMessages, events);
    expect(state.nextMessages.map((message) => message.id)).toEqual(["2r", "3"]);
    expect(state.toLlmMessages().map((message) => message.content)).toEqual(["beta-updated", "gamma"]);
  });
});
