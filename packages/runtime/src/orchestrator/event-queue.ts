import type { AgentEvent } from "../types.js";

export interface AgentEventQueue {
  enqueue(event: AgentEvent): void;
  dequeue(): AgentEvent | null;
  readonly length: number;
  peek(): readonly AgentEvent[];
}

export class AgentEventQueueImpl implements AgentEventQueue {
  private readonly queue: AgentEvent[] = [];

  enqueue(event: AgentEvent): void {
    this.queue.push(event);
  }

  dequeue(): AgentEvent | null {
    const event = this.queue.shift();
    if (event === undefined) {
      return null;
    }

    return event;
  }

  get length(): number {
    return this.queue.length;
  }

  peek(): readonly AgentEvent[] {
    return [...this.queue];
  }
}
