export type RuntimeEventType =
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "tool.called"
  | "tool.completed"
  | "tool.failed";

export const STEP_STARTED_LLM_INPUT_MESSAGES_METADATA_KEY = "runtime.llmInputMessages";

export const RUNTIME_EVENT_TYPES: RuntimeEventType[] = [
  "turn.started",
  "turn.completed",
  "turn.failed",
  "step.started",
  "step.completed",
  "step.failed",
  "tool.called",
  "tool.completed",
  "tool.failed",
];

interface RuntimeEventBase {
  type: RuntimeEventType;
  timestamp: string;
  agentName: string;
}

export interface StepStartedLlmInputMessage {
  role: string;
  content: string;
}

export interface TurnStartedEvent extends RuntimeEventBase {
  type: "turn.started";
  turnId: string;
  instanceKey: string;
}

export interface TurnCompletedEvent extends RuntimeEventBase {
  type: "turn.completed";
  turnId: string;
  instanceKey: string;
  stepCount: number;
  duration: number;
}

export interface TurnFailedEvent extends RuntimeEventBase {
  type: "turn.failed";
  turnId: string;
  instanceKey: string;
  duration: number;
  errorMessage: string;
}

export interface StepStartedEvent extends RuntimeEventBase {
  type: "step.started";
  stepId: string;
  stepIndex: number;
  turnId: string;
  llmInputMessages?: StepStartedLlmInputMessage[];
}

export interface StepCompletedEvent extends RuntimeEventBase {
  type: "step.completed";
  stepId: string;
  stepIndex: number;
  turnId: string;
  toolCallCount: number;
  duration: number;
}

export interface StepFailedEvent extends RuntimeEventBase {
  type: "step.failed";
  stepId: string;
  stepIndex: number;
  turnId: string;
  duration: number;
  errorMessage: string;
}

export interface ToolCalledEvent extends RuntimeEventBase {
  type: "tool.called";
  toolCallId: string;
  toolName: string;
  stepId: string;
  turnId: string;
}

export interface ToolCompletedEvent extends RuntimeEventBase {
  type: "tool.completed";
  toolCallId: string;
  toolName: string;
  status: "ok" | "error";
  duration: number;
  stepId: string;
  turnId: string;
}

export interface ToolFailedEvent extends RuntimeEventBase {
  type: "tool.failed";
  toolCallId: string;
  toolName: string;
  duration: number;
  stepId: string;
  turnId: string;
  errorMessage: string;
}

export type RuntimeEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | ToolCalledEvent
  | ToolCompletedEvent
  | ToolFailedEvent;

export type RuntimeEventListener = (event: RuntimeEvent) => void | Promise<void>;

export interface RuntimeEventBus {
  on(type: RuntimeEventType, listener: RuntimeEventListener): () => void;
  emit(event: RuntimeEvent): Promise<void>;
  clear(): void;
}

export class RuntimeEventBusImpl implements RuntimeEventBus {
  private listeners = new Map<RuntimeEventType, Set<RuntimeEventListener>>();

  on(type: RuntimeEventType, listener: RuntimeEventListener): () => void {
    const set = this.listeners.get(type) ?? new Set<RuntimeEventListener>();
    set.add(listener);
    this.listeners.set(type, set);

    return () => {
      const current = this.listeners.get(type);
      if (current === undefined) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  async emit(event: RuntimeEvent): Promise<void> {
    const listeners = this.listeners.get(event.type);
    if (listeners === undefined || listeners.size === 0) {
      return;
    }

    const snapshot = [...listeners];
    for (const listener of snapshot) {
      await listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
