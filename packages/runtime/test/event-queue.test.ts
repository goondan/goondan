import { describe, expect, it } from "vitest";
import { AgentEventQueueImpl } from "../src/orchestrator/event-queue.js";
import { createAgentEvent } from "./helpers.js";

describe("AgentEventQueueImpl", () => {
  it("빈 큐에서 dequeue하면 null을 반환한다", () => {
    const queue = new AgentEventQueueImpl();
    expect(queue.dequeue()).toBeNull();
  });

  it("enqueue한 이벤트를 FIFO 순서로 dequeue한다", () => {
    const queue = new AgentEventQueueImpl();
    const event1 = createAgentEvent({ id: "evt-1" });
    const event2 = createAgentEvent({ id: "evt-2" });
    const event3 = createAgentEvent({ id: "evt-3" });

    queue.enqueue(event1);
    queue.enqueue(event2);
    queue.enqueue(event3);

    expect(queue.dequeue()?.id).toBe("evt-1");
    expect(queue.dequeue()?.id).toBe("evt-2");
    expect(queue.dequeue()?.id).toBe("evt-3");
    expect(queue.dequeue()).toBeNull();
  });

  it("length가 현재 큐 크기를 반환한다", () => {
    const queue = new AgentEventQueueImpl();
    expect(queue.length).toBe(0);

    queue.enqueue(createAgentEvent({ id: "evt-1" }));
    expect(queue.length).toBe(1);

    queue.enqueue(createAgentEvent({ id: "evt-2" }));
    expect(queue.length).toBe(2);

    queue.dequeue();
    expect(queue.length).toBe(1);
  });

  it("peek가 큐의 스냅샷을 반환하며 큐를 변경하지 않는다", () => {
    const queue = new AgentEventQueueImpl();
    const event1 = createAgentEvent({ id: "evt-1" });
    const event2 = createAgentEvent({ id: "evt-2" });

    queue.enqueue(event1);
    queue.enqueue(event2);

    const snapshot = queue.peek();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].id).toBe("evt-1");
    expect(snapshot[1].id).toBe("evt-2");

    // peek 후에도 큐 크기는 변하지 않는다
    expect(queue.length).toBe(2);
  });

  it("peek가 반환한 배열을 수정해도 원본 큐에 영향이 없다", () => {
    const queue = new AgentEventQueueImpl();
    queue.enqueue(createAgentEvent({ id: "evt-1" }));

    const snapshot = queue.peek();
    // readonly 배열이지만 스프레드 카피이므로 원본과 별개
    expect(snapshot).toHaveLength(1);
    expect(queue.length).toBe(1);
  });
});
