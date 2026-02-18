# Extension & Pipeline Architecture

> Understanding how Extensions hook into the Goondan runtime through the middleware pipeline

[Korean version (한국어)](./extension-pipeline.ko.md)

---

## Why Extensions and a Pipeline?

Goondan separates _what an agent does_ (defined in YAML configuration) from _how the runtime behaves during execution_. Tools give an LLM actions to perform; Extensions give _you_ -- the developer -- the ability to observe and reshape the runtime's execution from the inside.

Without Extensions, every cross-cutting concern (logging, message compaction, tool filtering, context injection) would need to be baked into the runtime core. That would make the core brittle and force every user to live with the same policies. Instead, Goondan follows a **Middleware Only** model: the runtime exposes three well-defined interception points, and Extensions register middleware functions at those points.

This is the same pattern used by Koa, Express, and other server frameworks -- but applied to the lifecycle of an AI agent conversation.

---

## The Extension Resource

An Extension is one of Goondan's 8 resource Kinds. Its YAML declaration is intentionally minimal:

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: my-extension
spec:
  entry: "./extensions/my-extension/index.ts"
  config:                # optional: arbitrary key-value pairs
    maxMessages: 50
```

| Field | Purpose |
|-------|---------|
| `spec.entry` | Path to the TypeScript module (resolved from Bundle Root, executed with Bun) |
| `spec.config` | Optional configuration consumed by the Extension's own logic |

An Extension does nothing on its own. It becomes active only when an **Agent** references it:

```yaml
kind: Agent
metadata:
  name: coder
spec:
  extensions:
    - ref: "Extension/logging"           # loaded 1st
    - ref: "Extension/message-compaction" # loaded 2nd
    - ref: "Extension/skills"            # loaded 3rd
```

The order in this array matters -- it determines the middleware layering order (more on this below).

---

## The `register(api)` Pattern

Every Extension entry module must export a `register` function:

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/core';

export function register(api: ExtensionApi): void {
  // Use api.pipeline, api.tools, api.state, api.events, api.logger
}
```

When an AgentProcess starts, it loads each Extension declared in `Agent.spec.extensions` **sequentially, in order**. For each Extension it:

1. Imports the entry module
2. Calls `register(api)` and waits for it to return (or resolve, if async)
3. Moves to the next Extension

If any `register()` call throws, the AgentProcess initialization fails entirely. This fail-fast behavior ensures that a misconfigured Extension is caught immediately rather than causing subtle runtime errors later.

---

## ExtensionApi: Five Doors into the Runtime

The `api` object passed to `register()` exposes five capabilities:

```text
ExtensionApi
  +-- pipeline   Register middleware (turn / step / toolCall)
  +-- tools      Register dynamic tools at runtime
  +-- state      Read/write persistent JSON state per instance
  +-- events     Subscribe to / emit runtime events (pub/sub)
  +-- logger     Structured logging (Console interface)
```

| API area | What it does |
|----------|-------------|
| `pipeline` | The primary extension mechanism. Register middleware that wraps turn execution, LLM calls, and tool calls. |
| `tools` | Dynamically register tools that appear in the LLM's tool catalog -- useful for patterns like MCP or skill discovery. |
| `state` | Persist JSON data per agent instance. Automatically restored on restart and saved after each turn. |
| `events` | Lightweight in-process event bus. Extensions can react to `turn.completed`, `step.started`, etc. without coupling to each other. |
| `logger` | Standard `Console` interface routed to structured logs. |

The `pipeline` API is where most Extension logic lives. The next sections focus entirely on it.

> For detailed interface signatures, see [Extension API Reference](../reference/extension-api.md).

---

## The Middleware Pipeline (Onion Model)

### Three middleware layers

Goondan's pipeline has exactly three middleware types. Each corresponds to a different granularity of the agent execution lifecycle:

| Middleware | Wraps | Typical use |
|-----------|-------|-------------|
| **`turn`** | An entire conversation turn (one inbound event to completion) | Message compaction, conversation windowing, turn-level metrics |
| **`step`** | A single LLM call plus its subsequent tool executions | Tool catalog filtering, context injection, step timing |
| **`toolCall`** | An individual tool invocation | Argument validation/transformation, per-tool logging |

These three layers are **nested**: a turn contains multiple steps, and a step may contain multiple tool calls.

### The Onion Model

Each middleware follows the **onion pattern**: it receives a context object with a `next()` function. Everything before `next()` is pre-processing; everything after is post-processing. The first-registered middleware forms the outermost layer.

```text
  Request enters from outside
         |
         v
  +-------------------------------+
  | Extension A  (registered 1st) |  <-- outermost layer
  |   pre-processing              |
  |   +--------------------------+|
  |   | Extension B  (reg. 2nd) ||
  |   |   pre-processing        ||
  |   |   +--------------------+||
  |   |   |  Core runtime      |||  <-- innermost: actual execution
  |   |   |  logic             |||
  |   |   +--------------------+||
  |   |   post-processing       ||
  |   +--------------------------+|
  |   post-processing             |
  +-------------------------------+
         |
         v
  Result returns to caller
```

A concrete example with logging and compaction:

```text
  Incoming AgentEvent
         |
         v
  +---------------------------------------+
  | logging.turn.pre  (log "turn start")  |
  |  +-----------------------------------+|
  |  | compaction.turn.pre (compact msgs)||
  |  |  +-------------------------------+||
  |  |  | [Core Turn Logic]             |||
  |  |  |  Step 0..N                    |||
  |  |  +-------------------------------+||
  |  | compaction.turn.post             ||
  |  +-----------------------------------+|
  | logging.turn.post (log "turn end")    |
  +---------------------------------------+
         |
         v
  TurnResult
```

The rule is simple: **the Extension listed first in `Agent.spec.extensions` becomes the outermost layer**. Its pre-processing runs first, and its post-processing runs last.

### Nested execution: turn > step > toolCall

The three middleware types nest inside each other during execution:

```text
Turn Middleware Chain
  |-- turn.pre (all turn middlewares, onion order)
  |-- [Core Turn: Step Loop 0..N]
  |     |
  |     +-- Step Middleware Chain
  |           |-- step.pre (all step middlewares, onion order)
  |           |-- [Core Step: LLM call]
  |           |-- [ToolCall Loop 0..M]
  |           |     |
  |           |     +-- ToolCall Middleware Chain
  |           |           |-- toolCall.pre (all toolCall middlewares)
  |           |           |-- [Core: execute tool handler]
  |           |           +-- toolCall.post (all toolCall middlewares)
  |           |
  |           +-- step.post (all step middlewares, onion order)
  |
  +-- turn.post (all turn middlewares, onion order)
```

Each layer has a dedicated context with the fields relevant to its scope:

- **`turn` context** -- `conversationState`, `emitMessageEvent()`, `inputEvent`, `metadata`
- **`step` context** -- everything from turn plus `stepIndex`, `toolCatalog` (mutable)
- **`toolCall` context** -- `toolName`, `toolCallId`, `args` (mutable), `metadata`

### Why three layers instead of one?

A single "before/after" hook would force every Extension to figure out which phase of execution it's in. By splitting into three explicit layers:

- **Compaction** only needs to register a `turn` middleware -- it operates on the full message history once per turn.
- **Tool filtering** only needs a `step` middleware -- it adjusts the tool catalog before each LLM call.
- **Argument sanitization** only needs a `toolCall` middleware -- it runs per tool invocation.

This separation keeps each Extension focused and avoids accidental interference between concerns.

---

## ConversationState and Event Sourcing

### The problem

An agent's conversation is a list of messages. Multiple Extensions may want to manipulate this list in the same turn -- one might remove old messages (compaction), another might inject context (skills), and a third might pin important messages. If they all mutated the same array directly, order-of-execution bugs would be inevitable.

### The solution: event sourcing

Goondan uses an **event sourcing** model for message management:

```text
NextMessages = BaseMessages + SUM(Events)
```

- **`baseMessages`** -- the snapshot of messages at the start of the turn (loaded from disk)
- **`events`** -- an ordered list of `MessageEvent` objects emitted during the turn
- **`nextMessages`** -- the computed result of applying all events to the base

Extensions do not modify `nextMessages` directly. Instead, they call `ctx.emitMessageEvent()` to emit events:

```typescript
// Append a new system message
ctx.emitMessageEvent({
  type: 'append',
  message: createSystemMessage('Context from skills extension'),
});

// Remove an old message by ID
ctx.emitMessageEvent({
  type: 'remove',
  targetId: oldMessage.id,
});
```

Available event types:

| Event type | Effect |
|-----------|--------|
| `append` | Add a message to the end of the list |
| `replace` | Replace a message identified by `targetId` |
| `remove` | Remove a message identified by `targetId` |
| `truncate` | Clear all messages |

At the end of the turn, the runtime **folds** all events into a new base snapshot and persists it. This means:

- Events from all Extensions compose predictably regardless of middleware order
- The full event history is available for debugging and auditing
- The conversation state can be reconstructed from `base + events` at any point during the turn

---

## PipelineRegistry: How Middleware Gets Wired

Extensions register middleware through `api.pipeline.register()`:

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    // pre-processing
    const result = await ctx.next();
    // post-processing
    return result;
  });

  api.pipeline.register('step', async (ctx) => {
    ctx.toolCatalog = ctx.toolCatalog.filter(t => !isDisabled(t));
    return ctx.next();
  });

  api.pipeline.register('toolCall', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.debug(`${ctx.toolName}: ${Date.now() - start}ms`);
    return result;
  });
}
```

**Key rules:**

1. You **must** call `ctx.next()` exactly once. Skipping it means the core logic (and all inner middlewares) never execute.
2. You **may** transform the result returned by `next()` before returning it.
3. Multiple Extensions registering the same middleware type are chained in onion order (first registered = outermost).
4. One Extension can register multiple middleware types, or even multiple middlewares of the same type.

### Priority

By default, middleware ordering follows the `Agent.spec.extensions` array order. For fine-grained control, an optional `priority` can be specified:

```typescript
api.pipeline.register('step', myMiddleware, { priority: 10 });
```

Lower priority values become outer layers. Within the same priority, registration order is preserved (stable sort).

---

## Agent-Specific Extension Loading

Extensions are loaded **per agent instance**, not globally. Each Agent declares its own list:

```yaml
# Agent A -- uses logging + compaction
kind: Agent
metadata:
  name: coordinator
spec:
  extensions:
    - ref: "Extension/logging"
    - ref: "Extension/message-compaction"

# Agent B -- uses logging + skills (no compaction)
kind: Agent
metadata:
  name: researcher
spec:
  extensions:
    - ref: "Extension/logging"
    - ref: "Extension/skills"
```

This means:

- The `coordinator` agent has compaction behavior; the `researcher` does not.
- Both share `logging`, but each agent's instance runs its own copy with isolated state.
- The Extension state (via `api.state`) is scoped to each `instanceKey`, so `coordinator:user-1` and `coordinator:user-2` have independent state even though they share the same Extension.

---

## Real-World Extension Patterns

The following patterns illustrate how the pipeline and ExtensionApi compose to solve common problems. Each is described at a conceptual level; for full implementation examples, see the spec documents.

### Logging / Observability

Register `step` and `toolCall` middlewares to measure timing, log inputs/outputs, and track metrics. The onion model naturally provides pre/post timing:

```typescript
api.pipeline.register('step', async (ctx) => {
  const start = Date.now();
  const result = await ctx.next();
  api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
  return result;
});
```

### Message Compaction

Register a `turn` middleware that examines `conversationState.nextMessages` and emits `remove` + `append` events to replace old messages with a summary. Pinned messages are preserved via metadata checks.

### Message Window

A simpler variant of compaction: a `turn` middleware that enforces a maximum message count by emitting `remove` events for the oldest messages beyond the limit.

### Skill Injection

Register dynamic tools via `api.tools.register()` for skill discovery (e.g., `skills__list`, `skills__open`), then use a `step` middleware to inject active skill context into the conversation via `emitMessageEvent()`.

### Tool Search / Filtering

Register a meta-tool (`tool-search__search`) that lets the LLM choose which tools it needs. Use `api.state` to persist the selection, then apply it in a `step` middleware by filtering `ctx.toolCatalog`.

### MCP Integration

Use `api.tools.register()` to dynamically register tools from an MCP server at Extension initialization time. The Extension manages the MCP client connection lifecycle internally and cleans up on process exit.

---

## Summary

| Concept | Key point |
|---------|-----------|
| Extension resource | Minimal YAML (`entry` + optional `config`); activated by Agent reference |
| `register(api)` | Single entry point; called once during AgentProcess initialization |
| ExtensionApi | 5 areas: `pipeline`, `tools`, `state`, `events`, `logger` |
| Middleware types | `turn` (whole conversation turn), `step` (LLM call unit), `toolCall` (single tool invocation) |
| Onion model | First-registered = outermost; `next()` separates pre/post; must call `next()` exactly once |
| ConversationState | Event sourcing: `NextMessages = BaseMessages + SUM(Events)`; no direct mutation |
| Agent-specific loading | Each Agent declares its own Extension list; state is isolated per instance |

---

## Further reading

- [Extension API Reference](../reference/extension-api.md) -- detailed `ExtensionApi` interface signatures
- [Write an Extension (How-to)](../how-to/write-an-extension.md) -- practical checklist for building production extensions
- [Build Your First Extension (Tutorial)](../tutorials/03-build-your-first-extension.md) -- step-by-step guided walkthrough
- [Core Concepts](./core-concepts.md) -- Resource Kinds, ObjectRef, instanceKey
- [Runtime Model](./runtime-model.md) -- Orchestrator, Process-per-Agent, IPC

---

_Document version: v0.0.3_
