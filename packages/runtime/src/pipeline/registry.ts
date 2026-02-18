import type {
  AgentEvent,
  ConversationState,
  ExecutionContext,
  JsonObject,
  JsonValue,
  MiddlewareAgentsApi,
  MessageEvent,
  StepResult,
  ToolCallResult,
  ToolCatalogItem,
  Turn,
  TurnResult,
} from "../types.js";
import type { RuntimeEventBus } from "../events/runtime-events.js";

export type PipelineType = "turn" | "step" | "toolCall";

export interface MiddlewareOptions {
  priority?: number;
}

export interface TurnMiddlewareContext extends ExecutionContext {
  readonly inputEvent: AgentEvent;
  readonly conversationState: ConversationState;
  readonly agents: MiddlewareAgentsApi;
  emitMessageEvent(event: MessageEvent): void;
  metadata: Record<string, JsonValue>;
  next(): Promise<TurnResult>;
}

export interface StepMiddlewareContext extends ExecutionContext {
  readonly turn: Turn;
  readonly stepIndex: number;
  readonly conversationState: ConversationState;
  readonly agents: MiddlewareAgentsApi;
  emitMessageEvent(event: MessageEvent): void;
  toolCatalog: ToolCatalogItem[];
  metadata: Record<string, JsonValue>;
  next(): Promise<StepResult>;
}

export interface ToolCallMiddlewareContext extends ExecutionContext {
  readonly stepIndex: number;
  readonly toolName: string;
  readonly toolCallId: string;
  args: JsonObject;
  metadata: Record<string, JsonValue>;
  next(): Promise<ToolCallResult>;
}

export type TurnMiddleware = (ctx: TurnMiddlewareContext) => Promise<TurnResult>;
export type StepMiddleware = (ctx: StepMiddlewareContext) => Promise<StepResult>;
export type ToolCallMiddleware = (ctx: ToolCallMiddlewareContext) => Promise<ToolCallResult>;

interface MiddlewareEntry<T> {
  readonly fn: T;
  readonly priority: number;
  readonly registrationOrder: number;
}

interface TurnMutableState extends ExecutionContext {
  inputEvent: AgentEvent;
  conversationState: ConversationState;
  agents: MiddlewareAgentsApi;
  emitMessageEvent(event: MessageEvent): void;
  metadata: Record<string, JsonValue>;
}

interface StepMutableState extends ExecutionContext {
  turn: Turn;
  stepIndex: number;
  conversationState: ConversationState;
  agents: MiddlewareAgentsApi;
  emitMessageEvent(event: MessageEvent): void;
  toolCatalog: ToolCatalogItem[];
  metadata: Record<string, JsonValue>;
}

interface ToolCallMutableState extends ExecutionContext {
  stepIndex: number;
  toolName: string;
  toolCallId: string;
  args: JsonObject;
  metadata: Record<string, JsonValue>;
}

export interface PipelineRegistry {
  register(type: "turn", fn: TurnMiddleware, options?: MiddlewareOptions): void;
  register(type: "step", fn: StepMiddleware, options?: MiddlewareOptions): void;
  register(type: "toolCall", fn: ToolCallMiddleware, options?: MiddlewareOptions): void;
  runTurn(ctx: Omit<TurnMiddlewareContext, "next">, core: TurnMiddleware): Promise<TurnResult>;
  runStep(ctx: Omit<StepMiddlewareContext, "next">, core: StepMiddleware): Promise<StepResult>;
  runToolCall(
    ctx: Omit<ToolCallMiddlewareContext, "next">,
    core: ToolCallMiddleware,
  ): Promise<ToolCallResult>;
}

export class PipelineRegistryImpl implements PipelineRegistry {
  private turnMiddlewares: MiddlewareEntry<TurnMiddleware>[] = [];
  private stepMiddlewares: MiddlewareEntry<StepMiddleware>[] = [];
  private toolCallMiddlewares: MiddlewareEntry<ToolCallMiddleware>[] = [];

  constructor(private readonly eventBus?: RuntimeEventBus) {}

  register(...args: ["turn", TurnMiddleware, MiddlewareOptions?]): void;
  register(...args: ["step", StepMiddleware, MiddlewareOptions?]): void;
  register(...args: ["toolCall", ToolCallMiddleware, MiddlewareOptions?]): void;
  register(
    ...args:
      | ["turn", TurnMiddleware, MiddlewareOptions?]
      | ["step", StepMiddleware, MiddlewareOptions?]
      | ["toolCall", ToolCallMiddleware, MiddlewareOptions?]
  ): void {
    const [type, fn, options] = args;
    const priority = options?.priority ?? 0;

    if (type === "turn") {
      this.turnMiddlewares.push({
        fn,
        priority,
        registrationOrder: this.turnMiddlewares.length,
      });
      return;
    }

    if (type === "step") {
      this.stepMiddlewares.push({
        fn,
        priority,
        registrationOrder: this.stepMiddlewares.length,
      });
      return;
    }

    this.toolCallMiddlewares.push({
      fn,
      priority,
      registrationOrder: this.toolCallMiddlewares.length,
    });
  }

  async runTurn(ctx: Omit<TurnMiddlewareContext, "next">, core: TurnMiddleware): Promise<TurnResult> {
    const ordered = this.sortEntries(this.turnMiddlewares);
    const state: TurnMutableState = {
      agentName: ctx.agentName,
      instanceKey: ctx.instanceKey,
      turnId: ctx.turnId,
      traceId: ctx.traceId,
      inputEvent: ctx.inputEvent,
      conversationState: ctx.conversationState,
      agents: ctx.agents,
      emitMessageEvent: ctx.emitMessageEvent,
      metadata: ctx.metadata,
    };

    const startTime = Date.now();

    if (this.eventBus !== undefined) {
      await this.eventBus.emit({
        type: "turn.started",
        turnId: ctx.turnId,
        agentName: ctx.agentName,
        instanceKey: ctx.instanceKey,
        timestamp: new Date().toISOString(),
      });
    }

    const dispatch = async (index: number): Promise<TurnResult> => {
      if (index >= ordered.length) {
        return core(this.createTurnContext(state, this.createNeverNext("turn")));
      }

      const next = async (): Promise<TurnResult> => dispatch(index + 1);
      const entry = ordered[index];
      if (entry === undefined) {
        throw new Error("turn middleware entry is missing");
      }
      return entry.fn(this.createTurnContext(state, next));
    };

    try {
      const result = await dispatch(0);

      if (this.eventBus !== undefined) {
        await this.eventBus.emit({
          type: "turn.completed",
          turnId: ctx.turnId,
          agentName: ctx.agentName,
          instanceKey: ctx.instanceKey,
          stepCount: 0,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (error) {
      if (this.eventBus !== undefined) {
        await this.eventBus.emit({
          type: "turn.failed",
          turnId: ctx.turnId,
          agentName: ctx.agentName,
          instanceKey: ctx.instanceKey,
          duration: Date.now() - startTime,
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  }

  async runStep(ctx: Omit<StepMiddlewareContext, "next">, core: StepMiddleware): Promise<StepResult> {
    const ordered = this.sortEntries(this.stepMiddlewares);
    const state: StepMutableState = {
      agentName: ctx.agentName,
      instanceKey: ctx.instanceKey,
      turnId: ctx.turnId,
      traceId: ctx.traceId,
      turn: ctx.turn,
      stepIndex: ctx.stepIndex,
      conversationState: ctx.conversationState,
      agents: ctx.agents,
      emitMessageEvent: ctx.emitMessageEvent,
      toolCatalog: ctx.toolCatalog,
      metadata: ctx.metadata,
    };

    const stepId = `${ctx.turnId}-step-${ctx.stepIndex}`;
    const startTime = Date.now();

    if (this.eventBus !== undefined) {
      await this.eventBus.emit({
        type: "step.started",
        stepId,
        stepIndex: ctx.stepIndex,
        turnId: ctx.turnId,
        agentName: ctx.agentName,
        timestamp: new Date().toISOString(),
      });
    }

    const dispatch = async (index: number): Promise<StepResult> => {
      if (index >= ordered.length) {
        return core(this.createStepContext(state, this.createNeverNext("step")));
      }

      const next = async (): Promise<StepResult> => dispatch(index + 1);
      const entry = ordered[index];
      if (entry === undefined) {
        throw new Error("step middleware entry is missing");
      }
      return entry.fn(this.createStepContext(state, next));
    };

    try {
      const result = await dispatch(0);

      if (this.eventBus !== undefined) {
        await this.eventBus.emit({
          type: "step.completed",
          stepId,
          stepIndex: ctx.stepIndex,
          turnId: ctx.turnId,
          agentName: ctx.agentName,
          toolCallCount: result.toolCalls.length,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (error) {
      if (this.eventBus !== undefined) {
        await this.eventBus.emit({
          type: "step.failed",
          stepId,
          stepIndex: ctx.stepIndex,
          turnId: ctx.turnId,
          agentName: ctx.agentName,
          duration: Date.now() - startTime,
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  }

  async runToolCall(
    ctx: Omit<ToolCallMiddlewareContext, "next">,
    core: ToolCallMiddleware,
  ): Promise<ToolCallResult> {
    const ordered = this.sortEntries(this.toolCallMiddlewares);
    const state: ToolCallMutableState = {
      agentName: ctx.agentName,
      instanceKey: ctx.instanceKey,
      turnId: ctx.turnId,
      traceId: ctx.traceId,
      stepIndex: ctx.stepIndex,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      args: ctx.args,
      metadata: ctx.metadata,
    };

    const stepId = `${ctx.turnId}-step-${ctx.stepIndex}`;
    const startTime = Date.now();

    if (this.eventBus !== undefined) {
      await this.eventBus.emit({
        type: "tool.called",
        toolCallId: ctx.toolCallId,
        toolName: ctx.toolName,
        stepId,
        turnId: ctx.turnId,
        agentName: ctx.agentName,
        timestamp: new Date().toISOString(),
      });
    }

    const dispatch = async (index: number): Promise<ToolCallResult> => {
      if (index >= ordered.length) {
        return core(this.createToolCallContext(state, this.createNeverNext("toolCall")));
      }

      const next = async (): Promise<ToolCallResult> => dispatch(index + 1);
      const entry = ordered[index];
      if (entry === undefined) {
        throw new Error("toolCall middleware entry is missing");
      }
      return entry.fn(this.createToolCallContext(state, next));
    };

    try {
      const result = await dispatch(0);

      if (this.eventBus !== undefined) {
        await this.eventBus.emit({
          type: "tool.completed",
          toolCallId: ctx.toolCallId,
          toolName: ctx.toolName,
          status: result.status,
          duration: Date.now() - startTime,
          stepId,
          turnId: ctx.turnId,
          agentName: ctx.agentName,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (error) {
      if (this.eventBus !== undefined) {
        await this.eventBus.emit({
          type: "tool.failed",
          toolCallId: ctx.toolCallId,
          toolName: ctx.toolName,
          duration: Date.now() - startTime,
          stepId,
          turnId: ctx.turnId,
          agentName: ctx.agentName,
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  }

  private sortEntries<T>(entries: MiddlewareEntry<T>[]): MiddlewareEntry<T>[] {
    return [...entries].sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.registrationOrder - right.registrationOrder;
    });
  }

  private createTurnContext(state: TurnMutableState, next: () => Promise<TurnResult>): TurnMiddlewareContext {
    return {
      get agentName() {
        return state.agentName;
      },
      get instanceKey() {
        return state.instanceKey;
      },
      get turnId() {
        return state.turnId;
      },
      get traceId() {
        return state.traceId;
      },
      get inputEvent() {
        return state.inputEvent;
      },
      get conversationState() {
        return state.conversationState;
      },
      get agents() {
        return state.agents;
      },
      emitMessageEvent(event: MessageEvent): void {
        state.emitMessageEvent(event);
      },
      get metadata() {
        return state.metadata;
      },
      set metadata(value: Record<string, JsonValue>) {
        state.metadata = value;
      },
      next,
    };
  }

  private createStepContext(state: StepMutableState, next: () => Promise<StepResult>): StepMiddlewareContext {
    return {
      get agentName() {
        return state.agentName;
      },
      get instanceKey() {
        return state.instanceKey;
      },
      get turnId() {
        return state.turnId;
      },
      get traceId() {
        return state.traceId;
      },
      get turn() {
        return state.turn;
      },
      get stepIndex() {
        return state.stepIndex;
      },
      get conversationState() {
        return state.conversationState;
      },
      get agents() {
        return state.agents;
      },
      emitMessageEvent(event: MessageEvent): void {
        state.emitMessageEvent(event);
      },
      get toolCatalog() {
        return state.toolCatalog;
      },
      set toolCatalog(value: ToolCatalogItem[]) {
        state.toolCatalog = value;
      },
      get metadata() {
        return state.metadata;
      },
      set metadata(value: Record<string, JsonValue>) {
        state.metadata = value;
      },
      next,
    };
  }

  private createToolCallContext(
    state: ToolCallMutableState,
    next: () => Promise<ToolCallResult>,
  ): ToolCallMiddlewareContext {
    return {
      get agentName() {
        return state.agentName;
      },
      get instanceKey() {
        return state.instanceKey;
      },
      get turnId() {
        return state.turnId;
      },
      get traceId() {
        return state.traceId;
      },
      get stepIndex() {
        return state.stepIndex;
      },
      get toolName() {
        return state.toolName;
      },
      get toolCallId() {
        return state.toolCallId;
      },
      get args() {
        return state.args;
      },
      set args(value: JsonObject) {
        state.args = value;
      },
      get metadata() {
        return state.metadata;
      },
      set metadata(value: Record<string, JsonValue>) {
        state.metadata = value;
      },
      next,
    };
  }

  private createNeverNext<T>(type: PipelineType): () => Promise<T> {
    return async (): Promise<T> => {
      throw new Error(`next() is not available inside core ${type} handler`);
    };
  }
}
