import { describe, expect, it } from "vitest";
import { ConversationStateImpl } from "../src/conversation/state.js";
import { createMessage } from "./helpers.js";

describe("ConversationStateImpl", () => {
  it("base + events 규칙으로 nextMessages를 계산하고 fold한다", () => {
    const baseUser = createMessage({ role: "user", content: "hello" });
    const baseAssistant = createMessage({ role: "assistant", content: "hi", source: { type: "assistant", stepId: "s0" } });

    const state = new ConversationStateImpl([baseUser, baseAssistant]);

    const replacement = createMessage({ role: "assistant", content: "updated", source: { type: "assistant", stepId: "s1" } });
    const appended = createMessage({ role: "user", content: "next" });

    state.emitMessageEvent({ type: "replace", targetId: baseAssistant.id, message: replacement });
    state.emitMessageEvent({ type: "append", message: appended });

    expect(state.baseMessages).toHaveLength(2);
    expect(state.events).toHaveLength(2);
    expect(state.nextMessages.map((message) => message.id)).toEqual([baseUser.id, replacement.id, appended.id]);

    const llmMessages = state.toLlmMessages();
    expect(llmMessages).toHaveLength(3);
    expect(llmMessages[1]?.content).toBe("updated");

    state.foldEventsToBase();

    expect(state.baseMessages.map((message) => message.id)).toEqual([baseUser.id, replacement.id, appended.id]);
    expect(state.events).toHaveLength(0);
  });
});
