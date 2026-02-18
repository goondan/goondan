# Extension API Reference

> **Audience**: Extension Makers
> **Version**: v0.0.3
> **Canonical spec**: [`docs/specs/extension.md`](../../specs/extension.md), [`docs/specs/api.md`](../../specs/api.md), [`docs/specs/pipeline.md`](../../specs/pipeline.md)

[Korean version (한국어)](./extension-api.ko.md)

---

## Overview

An Extension is a middleware logic bundle that hooks into the runtime lifecycle. Extensions do not receive LLM tool calls directly -- instead, they register middleware, manage state, subscribe to events, optionally register dynamic tools via the `ExtensionApi` surface, and can call other agents programmatically through `ctx.agents` in `turn` / `step` middleware.

This document is a precise reference for every property and method available to Extension authors. For conceptual background, see [Extension Pipeline (Explanation)](../explanation/extension-pipeline.md). For a practical walkthrough, see [Write an Extension (How-to)](../how-to/write-an-extension.md).

---

## Entry module

Every Extension module must export a named `register` function. The AgentProcess calls `register(api)` during initialization, in the order declared in the Agent's `spec.extensions` array.

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/types';

export function register(api: ExtensionApi): void {
  // Register middleware, tools, event handlers, etc.
}
```

### Signature

```typescript
export function register(api: ExtensionApi): void | Promise<void>;
```

### Rules

- The module **must** provide a named export `register`.
- `register` may return `void` (sync) or `Promise<void>` (async). The AgentProcess awaits the return before proceeding.
- Extensions are initialized sequentially -- the previous Extension's `register()` must complete before the next one is called.
- An exception thrown during `register()` causes the AgentProcess to fail initialization.

---

## ExtensionApi

The `ExtensionApi` interface is the sole surface provided to Extensions. It exposes five areas.

```typescript
interface ExtensionApi {
  /** Middleware registration */
  pipeline: PipelineRegistry;

  /** Dynamic tool registration */
  tools: ExtensionToolsApi;

  /** Per-extension persistent state (JSON) */
  state: ExtensionStateApi;

  /** In-process event bus (pub/sub) */
  events: ExtensionEventsApi;

  /** Structured logger */
  logger: Console;
}
```

| Area | Purpose |
|------|---------|
| [`pipeline`](#1-pipeline--pipelineregistry) | Register `turn` / `step` / `toolCall` middleware |
| [`tools`](#2-tools--extensiontoolsapi) | Dynamically register tools at runtime |
| [`state`](#3-state--extensionstateapi) | Read/write per-instance JSON state (auto-persisted) |
| [`events`](#4-events--extensioneventsapi) | Publish and subscribe to in-process events |
| [`logger`](#5-logger--console) | Structured logging with standard `Console` methods |

---

### 1. `pipeline` -- PipelineRegistry

Register middleware that wraps the runtime execution at three levels: Turn, Step, and ToolCall.

```typescript
interface PipelineRegistry {
  register(type: 'turn', fn: TurnMiddleware, options?: MiddlewareOptions): void;
  register(type: 'step', fn: StepMiddleware, options?: MiddlewareOptions): void;
  register(type: 'toolCall', fn: ToolCallMiddleware, options?: MiddlewareOptions): void;
}

interface MiddlewareOptions {
  /** Execution priority. Lower value = outer layer (runs first). Default: 0 */
  priority?: number;
}
```

#### Middleware types

```typescript
type TurnMiddleware = (ctx: TurnMiddlewareContext) => Promise<TurnResult>;
type StepMiddleware = (ctx: StepMiddlewareContext) => Promise<StepResult>;
type ToolCallMiddleware = (ctx: ToolCallMiddlewareContext) => Promise<ToolCallResult>;
```

#### Rules

- Only three middleware types are allowed: `'turn'`, `'step'`, `'toolCall'`.
- When multiple middleware of the same type are registered, they chain in **onion order** (first registered = outermost layer).
- A single Extension may register multiple middleware types simultaneously.
- A single Extension may register multiple middleware of the same type.
- `ctx.agents.request()` / `ctx.agents.send()` are available in `turn` and `step` middleware only (not in `toolCall`).

#### Example

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  });
}
```

---

#### 1.1 TurnMiddlewareContext

Wraps the entire Turn -- from receiving an input event to producing a `TurnResult`.

```typescript
interface TurnMiddlewareContext extends ExecutionContext {
  /** The input event that triggered this Turn */
  readonly inputEvent: AgentEvent;

  /** Conversation state (base + events via event sourcing) */
  readonly conversationState: ConversationState;

  /** Programmatic inter-agent calls from middleware */
  readonly agents: MiddlewareAgentsApi;

  /** Emit a message event (append / replace / remove / truncate) */
  emitMessageEvent(event: MessageEvent): void;

  /** Shared metadata across middleware layers */
  metadata: Record<string, JsonValue>;

  /** Invoke the next middleware or core Turn logic */
  next(): Promise<TurnResult>;
}
```

**Inherited from `ExecutionContext`:**

| Field | Type | Description |
|-------|------|-------------|
| `agentName` | `string` | Current agent name |
| `instanceKey` | `string` | Current instance key |
| `turnId` | `string` | Current Turn identifier |
| `traceId` | `string` | Turn trace identifier |

**Turn-specific fields:**

| Field | Type | Mutable | Description |
|-------|------|---------|-------------|
| `inputEvent` | `AgentEvent` | readonly | The event that started this Turn |
| `conversationState` | `ConversationState` | readonly | Current conversation state |
| `agents` | `MiddlewareAgentsApi` | readonly | Programmatic inter-agent API (`request` / `send`) |
| `emitMessageEvent` | `(event: MessageEvent) => void` | -- | Emit a message mutation event |
| `metadata` | `Record<string, JsonValue>` | mutable | Shared metadata across middleware |
| `next` | `() => Promise<TurnResult>` | -- | Call to proceed to the next layer |

**`next()` must be called exactly once.** Before `next()` is the pre-processing phase; after `next()` is the post-processing phase.

**Result type -- `TurnResult`:**

```typescript
interface TurnResult {
  readonly turnId: string;
  readonly responseMessage?: Message;
  readonly finishReason: 'text_response' | 'max_steps' | 'error';
  readonly error?: { message: string; code?: string };
}
```

**Example:**

```typescript
api.pipeline.register('turn', async (ctx) => {
  // Pre: inspect or manipulate messages before the Turn executes
  const { nextMessages } = ctx.conversationState;

  if (nextMessages.length > 50) {
    // Remove old messages via event sourcing
    for (const msg of nextMessages.slice(0, 10)) {
      ctx.emitMessageEvent({ type: 'remove', targetId: msg.id });
    }
  }

  // Execute the Turn (Step loop happens inside)
  const result = await ctx.next();

  // Post: inspect or log the result
  api.logger.info(`Turn finished: ${result.finishReason}`);
  return result;
});
```

---

#### 1.2 StepMiddlewareContext

Wraps a single Step (LLM call + tool execution). Called once per Step within a Turn.

```typescript
interface StepMiddlewareContext extends ExecutionContext {
  /** Current Turn info */
  readonly turn: Turn;

  /** Step index within the current Turn (0-based) */
  readonly stepIndex: number;

  /** Conversation state */
  readonly conversationState: ConversationState;

  /** Programmatic inter-agent calls from middleware */
  readonly agents: MiddlewareAgentsApi;

  /** Emit a message event */
  emitMessageEvent(event: MessageEvent): void;

  /** Tool catalog for this Step (mutable -- filter, add, or modify entries) */
  toolCatalog: ToolCatalogItem[];

  /** Shared metadata across middleware layers */
  metadata: Record<string, JsonValue>;

  /** Invoke the next middleware or core Step logic (LLM call + tool execution) */
  next(): Promise<StepResult>;
}
```

**Step-specific fields:**

| Field | Type | Mutable | Description |
|-------|------|---------|-------------|
| `turn` | `Turn` | readonly | Current Turn info |
| `stepIndex` | `number` | readonly | Step index (0-based) within the Turn |
| `conversationState` | `ConversationState` | readonly | Current conversation state |
| `agents` | `MiddlewareAgentsApi` | readonly | Programmatic inter-agent API (`request` / `send`) |
| `emitMessageEvent` | `(event: MessageEvent) => void` | -- | Emit a message mutation event |
| `toolCatalog` | `ToolCatalogItem[]` | **mutable** | Tool catalog visible to the LLM for this Step |
| `metadata` | `Record<string, JsonValue>` | mutable | Shared metadata across middleware |
| `next` | `() => Promise<StepResult>` | -- | Call to proceed to the next layer |

Modifying `toolCatalog` before calling `next()` changes which tools the LLM sees for this Step.

**Result type -- `StepResult`:**

```typescript
interface StepResult {
  status: 'completed' | 'failed';
  hasToolCalls: boolean;
  toolCalls: ToolCall[];
  toolResults: ToolCallResult[];
  metadata: Record<string, JsonValue>;
}
```

**Example:**

```typescript
api.pipeline.register('step', async (ctx) => {
  // Pre: filter tools for this step
  ctx.toolCatalog = ctx.toolCatalog.filter(
    t => !t.name.includes('dangerous')
  );

  const result = await ctx.next();

  // Post: log step results
  api.logger.info(`Step ${ctx.stepIndex}: ${result.toolCalls.length} tool calls`);
  return result;
});
```

---

#### 1.3 MiddlewareAgentsApi (`ctx.agents`)

`turn` and `step` middleware can call other agents programmatically via `ctx.agents`. This reuses the same Orchestrator IPC routing path as `agents__request` and `agents__send`.

```typescript
interface MiddlewareAgentsApi {
  request(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    timeoutMs?: number; // default: 15000
    metadata?: Record<string, unknown>;
  }): Promise<{ target: string; response: string }>;

  send(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ accepted: boolean }>;
}
```

Rules:

- Available only in `turn` and `step` contexts.
- Not available in `toolCall` context.
- `request` default timeout is `15000ms`.
- The runtime detects cyclic request chains and returns an error.

Example:

```typescript
api.pipeline.register('turn', async (ctx) => {
  const preload = await ctx.agents.request({
    target: 'retriever',
    input: 'Find relevant context for this user input',
    timeoutMs: 5000,
  });

  if (preload.response.length > 0) {
    ctx.metadata.preloadedContext = preload.response;
  }

  const result = await ctx.next();

  await ctx.agents.send({
    target: 'observer',
    input: `turn=${ctx.turnId} finish=${result.finishReason}`,
  });

  return result;
});
```

---

#### 1.4 ToolCallMiddlewareContext

Wraps a single tool call. Called once per tool invocation within a Step.

```typescript
interface ToolCallMiddlewareContext extends ExecutionContext {
  /** Step index within the current Turn */
  readonly stepIndex: number;

  /** Name of the tool being called ({resourceName}__{exportName}) */
  readonly toolName: string;

  /** Unique ID for this tool call */
  readonly toolCallId: string;

  /** Tool call arguments (mutable -- can be modified before execution) */
  args: JsonObject;

  /** Shared metadata across middleware layers */
  metadata: Record<string, JsonValue>;

  /** Invoke the next middleware or core tool execution */
  next(): Promise<ToolCallResult>;
}
```

**ToolCall-specific fields:**

| Field | Type | Mutable | Description |
|-------|------|---------|-------------|
| `stepIndex` | `number` | readonly | Step index within the Turn |
| `toolName` | `string` | readonly | Tool name (`{resourceName}__{exportName}`) |
| `toolCallId` | `string` | readonly | Unique tool call ID |
| `args` | `JsonObject` | **mutable** | Tool call arguments (modifiable) |
| `metadata` | `Record<string, JsonValue>` | mutable | Shared metadata across middleware |
| `next` | `() => Promise<ToolCallResult>` | -- | Call to proceed to the next layer |

**Result type -- `ToolCallResult`:**

```typescript
interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: JsonValue;
  readonly status: 'ok' | 'error';
  readonly error?: {
    name?: string;
    message: string;
    code?: string;
    suggestion?: string;
    helpUrl?: string;
  };
}
```

**Example:**

```typescript
api.pipeline.register('toolCall', async (ctx) => {
  // Pre: validate or transform args
  if (ctx.toolName === 'bash__exec') {
    const cmd = ctx.args.command;
    if (typeof cmd === 'string' && cmd.length > 10000) {
      ctx.args = { ...ctx.args, command: cmd.slice(0, 10000) };
      api.logger.warn('bash command truncated to 10000 chars');
    }
  }

  const result = await ctx.next();

  // Post: log tool result
  api.logger.debug(`${ctx.toolName}: ${result.status}`);
  return result;
});
```

---

#### Onion execution model

Middleware layers form an onion: the first registered middleware is the outermost layer. Turn, Step, and ToolCall middleware nest hierarchically.

```text
[Turn Middleware Chain]
  |-- turn.pre
  |-- [Step Loop: 0..N]
  |   |-- [Step Middleware Chain]
  |   |   |-- step.pre
  |   |   |-- [Core LLM Call]
  |   |   |-- [ToolCall Loop: 0..M]
  |   |   |   |-- [ToolCall Middleware Chain]
  |   |   |   |   |-- toolCall.pre
  |   |   |   |   |-- [Core Tool Execution]
  |   |   |   |   +-- toolCall.post
  |   |   +-- step.post
  +-- turn.post
```

---

### 2. `tools` -- ExtensionToolsApi

Dynamically register tools at runtime. These tools become available to the LLM alongside statically declared tools.

```typescript
interface ExtensionToolsApi {
  /**
   * Register a dynamic tool.
   * @param item - Tool catalog entry (name, description, parameter schema)
   * @param handler - Tool handler function
   */
  register(item: ToolCatalogItem, handler: ToolHandler): void;
}
```

#### Related types

```typescript
interface ToolCatalogItem {
  name: string;
  description: string;
  parameters: JsonObject; // JSON Schema
}

type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject,
) => Promise<JsonValue> | JsonValue;
```

#### Rules

- Tool names **must** follow the double-underscore convention: `{extensionName}__{toolName}`.
- Dynamically registered tools are automatically included in the Step's `toolCatalog`.
- Registering a tool with the same name overwrites the previous registration.

#### Example

```typescript
export function register(api: ExtensionApi): void {
  api.tools.register(
    {
      name: 'my-ext__status',
      description: 'Get extension status',
      parameters: { type: 'object', properties: {} },
    },
    async (ctx, input) => {
      const state = await api.state.get();
      return { status: 'ok', state };
    },
  );
}
```

---

### 3. `state` -- ExtensionStateApi

Read and write per-extension persistent JSON state. State is scoped per instance and automatically persisted by the AgentProcess.

```typescript
interface ExtensionStateApi {
  /** Read current state. Returns null if no state has been saved. */
  get(): Promise<JsonValue>;

  /** Save state. Must be JSON-serializable. */
  set(value: JsonValue): Promise<void>;
}
```

#### Storage path

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/<ext-name>.json
```

#### Rules

- State is bound to the Extension's identity (name).
- State is isolated per instance.
- The AgentProcess auto-restores state from disk on initialization.
- The AgentProcess auto-persists modified state at Turn end.
- State values must be JSON-serializable (no functions, Symbols, or circular references).

#### Example

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('step', async (ctx) => {
    // Read state
    const state = (await api.state.get()) ?? { processedSteps: 0 };
    const count = (state as Record<string, unknown>).processedSteps as number;

    // Update state
    await api.state.set({
      processedSteps: count + 1,
      lastStepAt: Date.now(),
    });

    return ctx.next();
  });
}
```

---

### 4. `events` -- ExtensionEventsApi

In-process event bus for loose coupling between Extensions. Also used to subscribe to standard runtime events.

```typescript
interface ExtensionEventsApi {
  /**
   * Subscribe to an event.
   * @param event - Event name (e.g., 'turn.completed')
   * @param handler - Event handler
   * @returns Unsubscribe function
   */
  on(event: string, handler: (...args: unknown[]) => void): () => void;

  /**
   * Emit an event.
   * @param event - Event name
   * @param args - Event arguments
   */
  emit(event: string, ...args: unknown[]): void;
}
```

#### Standard runtime events

The runtime emits the following events that Extensions can subscribe to via `api.events.on()`:

| Event | Key payload fields |
|-------|-------------------|
| `turn.started` | `turnId`, `agentName`, `instanceKey`, `timestamp` |
| `turn.completed` | `turnId`, `agentName`, `instanceKey`, `stepCount`, `duration`, `timestamp` |
| `turn.failed` | `turnId`, `agentName`, `instanceKey`, `timestamp` |
| `step.started` | `stepId`, `stepIndex`, `turnId`, `agentName`, `timestamp` |
| `step.completed` | `stepId`, `stepIndex`, `turnId`, `agentName`, `toolCallCount`, `duration`, `timestamp` |
| `step.failed` | `stepId`, `stepIndex`, `turnId`, `agentName`, `timestamp` |
| `tool.called` | `toolCallId`, `toolName`, `stepId`, `turnId`, `agentName`, `timestamp` |
| `tool.completed` | `toolCallId`, `toolName`, `status`, `duration`, `stepId`, `turnId`, `agentName`, `timestamp` |
| `tool.failed` | `toolCallId`, `toolName`, `stepId`, `turnId`, `agentName`, `timestamp` |

See [`docs/specs/api.md` -- Runtime Events](../../specs/api.md) for the full payload type definitions.

#### Rules

- `on()` **must** return an unsubscribe function.
- Events propagate only within the same AgentProcess (in-process scope).
- Exceptions in event handlers should not block other handlers.

#### Example

```typescript
export function register(api: ExtensionApi): void {
  // Subscribe to runtime events
  const unsubscribe = api.events.on('turn.completed', (payload) => {
    api.logger.info('Turn completed', payload);
  });

  // Emit custom events for other Extensions
  api.events.emit('my-ext.initialized', { version: '1.0.0' });

  // Unsubscribe when no longer needed
  process.on('beforeExit', () => {
    unsubscribe();
  });
}
```

---

### 5. `logger` -- Console

A structured logger following the standard `Console` interface.

```typescript
// Available methods (standard Console interface)
api.logger.info('Extension initialized');
api.logger.debug('Processing step', { stepIndex: 3 });
api.logger.warn('Approaching token limit');
api.logger.error('Failed to load state', error);
```

---

## Supporting types

### ConversationState

Message state is managed via event sourcing: `NextMessages = BaseMessages + SUM(Events)`.

```typescript
interface ConversationState {
  readonly baseMessages: Message[];
  readonly events: MessageEvent[];
  readonly nextMessages: Message[];
  toLlmMessages(): CoreMessage[];
}
```

### MessageEvent

```typescript
type MessageEvent =
  | { type: 'append'; message: Message }
  | { type: 'replace'; targetId: string; message: Message }
  | { type: 'remove'; targetId: string }
  | { type: 'truncate' };
```

### Message

```typescript
interface Message {
  readonly id: string;
  readonly data: CoreMessage;
  metadata: Record<string, JsonValue>;
  readonly createdAt: Date;
  readonly source: MessageSource;
}

type MessageSource =
  | { type: 'user' }
  | { type: 'assistant'; stepId: string }
  | { type: 'tool'; toolCallId: string; toolName: string }
  | { type: 'system' }
  | { type: 'extension'; extensionName: string };
```

### ExecutionContext

Base context inherited by all middleware context types.

```typescript
interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}
```

---

## See also

- [Extension Pipeline (Explanation)](../explanation/extension-pipeline.md) -- conceptual deep dive into the middleware architecture
- [Write an Extension (How-to)](../how-to/write-an-extension.md) -- practical checklist for building Extensions
- [Build Your First Extension (Tutorial)](../tutorials/03-build-your-first-extension.md) -- step-by-step beginner tutorial
- [Tool API Reference](./tool-api.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult`
- [`docs/specs/extension.md`](../../specs/extension.md) -- Extension system spec (canonical)
- [`docs/specs/pipeline.md`](../../specs/pipeline.md) -- Pipeline spec (canonical)
- [`docs/specs/api.md`](../../specs/api.md) -- Runtime/SDK API spec (canonical)
- [`docs/specs/shared-types.md`](../../specs/shared-types.md) -- Shared types SSOT (canonical)

---

_Reference version: v0.0.3_
