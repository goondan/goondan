# How to Write an Extension

> **Audience**: Extension Makers
> **Version**: v0.0.3
> **Style**: Checklist-driven how-to -- follow each step to build a production-quality Extension

[Korean version (한국어)](./write-an-extension.ko.md)

---

## Prerequisites

Before you begin, make sure you have:

- A working Goondan project (run `gdn init` if you don't have one)
- `@goondan/types` installed (for TypeScript types)
- Basic understanding of Goondan's [core concepts](../explanation/core-concepts.md) and [Extension pipeline architecture](../explanation/extension-pipeline.md)

---

## Step 1: Define the Extension resource in YAML

Every Extension starts with a YAML resource declaration in your `goondan.yaml` (or a separate YAML file in your bundle).

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: my-extension         # Unique name within the bundle
spec:
  entry: "./extensions/my-extension/index.ts"   # Entry module path (relative to Bundle Root)
  config:                    # Optional: arbitrary key-value configuration
    maxRetries: 3
    logLevel: "debug"
```

**Checklist:**

- [ ] `apiVersion` is `goondan.ai/v1`
- [ ] `kind` is `Extension`
- [ ] `metadata.name` is a unique, descriptive name
- [ ] `spec.entry` points to a valid `.ts` file (resolved from Bundle Root, executed with Bun)
- [ ] `spec.config` contains only the configuration your Extension needs (optional)

> See [Resources Reference](../reference/resources.md) for the full Extension schema.

---

## Step 2: Create the entry module with `register(api)`

Create the TypeScript file at the path you declared in `spec.entry`. The module **must** export a named `register` function.

```typescript
// extensions/my-extension/index.ts
import type { ExtensionApi } from '@goondan/types';

export function register(api: ExtensionApi): void {
  // All Extension logic goes here:
  // - Register middleware (api.pipeline)
  // - Register dynamic tools (api.tools)
  // - Initialize state (api.state)
  // - Subscribe to events (api.events)
  // - Log initialization (api.logger)

  api.logger.info('my-extension initialized');
}
```

**Checklist:**

- [ ] The module exports a named `register` function (not a default export)
- [ ] The function accepts a single `ExtensionApi` parameter
- [ ] The function returns `void` or `Promise<void>` (async is allowed)
- [ ] Any initialization error will cause the AgentProcess to fail fast -- this is by design

> For the full `register(api)` contract, see [Extension API Reference -- Entry module](../reference/extension-api.md#entry-module).

---

## Step 3: Register middleware (pipeline)

The `api.pipeline` API is where most Extension logic lives. Register middleware at one or more of the three levels: `turn`, `step`, and `toolCall`.

### 3a. Turn middleware

Wraps an entire conversation turn. Use it for message compaction, conversation windowing, or turn-level metrics.

```typescript
api.pipeline.register('turn', async (ctx) => {
  // PRE-PROCESSING: runs before the Turn executes
  const { nextMessages } = ctx.conversationState;
  api.logger.info(`Turn starting with ${nextMessages.length} messages`);

  // Execute the Turn (Step loop happens inside)
  const result = await ctx.next();

  // POST-PROCESSING: runs after the Turn completes
  api.logger.info(`Turn finished: ${result.finishReason}`);
  return result;
});
```

**Key context fields:** `conversationState`, `emitMessageEvent()`, `inputEvent`, `metadata`

### 3b. Step middleware

Wraps a single LLM call and its tool executions. Use it for tool catalog filtering, context injection, or step timing.

```typescript
api.pipeline.register('step', async (ctx) => {
  // PRE: filter the tool catalog before the LLM sees it
  ctx.toolCatalog = ctx.toolCatalog.filter(
    t => !t.name.includes('disabled')
  );

  const start = Date.now();
  const result = await ctx.next();

  // POST: log timing
  api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
  return result;
});
```

**Key context fields:** everything from turn plus `stepIndex`, `toolCatalog` (mutable)

### 3c. ToolCall middleware

Wraps an individual tool invocation. Use it for argument validation, transformation, or per-tool logging.

```typescript
api.pipeline.register('toolCall', async (ctx) => {
  // PRE: validate or transform arguments
  api.logger.debug(`Calling ${ctx.toolName}`, ctx.args);

  const result = await ctx.next();

  // POST: log result
  api.logger.debug(`${ctx.toolName}: ${result.status}`);
  return result;
});
```

**Key context fields:** `toolName`, `toolCallId`, `args` (mutable), `metadata`

**Checklist:**

- [ ] Every middleware calls `ctx.next()` exactly once
- [ ] `next()` return value is propagated (return the result)
- [ ] Pre-processing happens before `ctx.next()`; post-processing happens after
- [ ] You chose the right middleware level for your use case (turn / step / toolCall)

> For middleware context details, see [Extension API Reference -- PipelineRegistry](../reference/extension-api.md#1-pipeline----pipelineregistry). For the conceptual model, see [Extension Pipeline (Explanation)](../explanation/extension-pipeline.md#the-middleware-pipeline-onion-model).

---

## Step 4: Use ConversationState and event sourcing

Extensions manipulate conversation messages through **event sourcing**, not direct mutation. Use `ctx.emitMessageEvent()` to emit message events.

```typescript
api.pipeline.register('turn', async (ctx) => {
  const { nextMessages } = ctx.conversationState;

  // Remove old messages beyond a threshold
  if (nextMessages.length > 50) {
    for (const msg of nextMessages.slice(0, 10)) {
      ctx.emitMessageEvent({ type: 'remove', targetId: msg.id });
    }
  }

  // Append a context message
  ctx.emitMessageEvent({
    type: 'append',
    message: {
      id: crypto.randomUUID(),
      data: { role: 'system', content: 'Additional context here' },
      metadata: { 'injected-by': 'my-extension' },
      createdAt: new Date(),
      source: { type: 'extension', extensionName: 'my-extension' },
    },
  });

  return ctx.next();
});
```

**Available event types:**

| Event type | Effect |
|-----------|--------|
| `append` | Add a message to the end |
| `replace` | Replace a message by `targetId` |
| `remove` | Remove a message by `targetId` |
| `truncate` | Clear all messages |

**Checklist:**

- [ ] Messages are never modified directly -- always use `emitMessageEvent()`
- [ ] The formula `NextMessages = BaseMessages + SUM(Events)` is understood
- [ ] Events can be emitted both before and after `ctx.next()`

> See [Extension Pipeline -- ConversationState and Event Sourcing](../explanation/extension-pipeline.md#conversationstate-and-event-sourcing) for the full conceptual explanation.

---

## Step 5: Register dynamic tools (`api.tools`)

Extensions can register tools at runtime that appear in the LLM's tool catalog alongside statically declared tools.

```typescript
api.tools.register(
  {
    name: 'my-ext__status',           // MUST follow {extensionName}__{toolName}
    description: 'Get my-extension status and metrics',
    parameters: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Include detailed metrics' },
      },
    },
  },
  async (ctx, input) => {
    const state = await api.state.get();
    return {
      status: 'ok',
      state,
      verbose: input.verbose === true,
    };
  },
);
```

**Checklist:**

- [ ] Tool name follows the double-underscore convention: `{extensionName}__{toolName}`
- [ ] `parameters` is a valid JSON Schema object
- [ ] The handler returns a JSON-serializable value
- [ ] Registering a tool with the same name overwrites the previous one

> See [Extension API Reference -- ExtensionToolsApi](../reference/extension-api.md#2-tools----extensiontoolsapi) for the full API.

---

## Step 6: Manage persistent state (`api.state`)

Each Extension gets its own persistent JSON state, scoped per agent instance. The AgentProcess auto-restores state on startup and auto-persists at turn end.

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    // Read current state (null if first run)
    const state = (await api.state.get()) ?? { turnCount: 0, lastTurnAt: 0 };
    const turnCount = (state as Record<string, unknown>).turnCount as number;

    const result = await ctx.next();

    // Update state after turn completes
    await api.state.set({
      turnCount: turnCount + 1,
      lastTurnAt: Date.now(),
    });

    return result;
  });
}
```

**Storage path:**

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/<ext-name>.json
```

**Checklist:**

- [ ] State values are JSON-serializable (no functions, Symbols, or circular references)
- [ ] `api.state.get()` returns `null` on first run -- handle this case
- [ ] State is isolated per instance -- different instanceKeys have independent state

> See [Extension API Reference -- ExtensionStateApi](../reference/extension-api.md#3-state----extensionstateapi).

---

## Step 7: Publish and subscribe to events (`api.events`)

The event bus enables loose coupling between Extensions. You can subscribe to standard runtime events or emit custom events for other Extensions to consume.

### Subscribe to runtime events

```typescript
const unsubscribe = api.events.on('turn.completed', (payload) => {
  api.logger.info('Turn completed', payload);
});

// Clean up on process exit
process.on('beforeExit', () => {
  unsubscribe();
});
```

### Emit custom events

```typescript
// Emit an event other Extensions can listen for
api.events.emit('my-ext.data-ready', { recordCount: 42 });
```

### Subscribe to custom events from another Extension

```typescript
api.events.on('my-ext.data-ready', (payload) => {
  api.logger.info('Data is ready:', payload);
});
```

**Standard runtime events:**

| Event | When it fires |
|-------|--------------|
| `turn.started` | A Turn begins |
| `turn.completed` | A Turn finishes successfully |
| `turn.failed` | A Turn fails |
| `step.started` | A Step begins |
| `step.completed` | A Step finishes |
| `step.failed` | A Step fails |
| `tool.called` | A tool is invoked |
| `tool.completed` | A tool finishes |
| `tool.failed` | A tool fails |

**Checklist:**

- [ ] `api.events.on()` returns an unsubscribe function -- store it if you need cleanup
- [ ] Events propagate only within the same AgentProcess (in-process scope)
- [ ] Custom event names use a namespace prefix to avoid collisions (e.g., `my-ext.event-name`)

> See [Extension API Reference -- ExtensionEventsApi](../reference/extension-api.md#4-events----extensioneventsapi).

---

## Step 8: Register the Extension on an Agent

The Extension only becomes active when an Agent references it in its `spec.extensions` array. The order of entries determines the middleware layering order.

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  model:
    ref: "Model/claude-sonnet"
  extensions:
    - ref: "Extension/logging"        # 1st: outermost middleware layer
    - ref: "Extension/my-extension"   # 2nd: middle layer
    - ref: "Extension/skills"         # 3rd: innermost layer
```

**Checklist:**

- [ ] The `ref` value matches `Extension/<metadata.name>` from your Extension resource
- [ ] The order reflects the desired middleware layering (first = outermost, last = innermost)
- [ ] Each Agent can have a different Extension list -- Extensions are loaded per agent instance

---

## Step 9: Validate and test

### Validate the bundle

```bash
gdn validate
```

This checks that your Extension's `spec.entry` file exists and the YAML is well-formed.

### Test strategies

1. **Unit test the middleware function**: Extract your middleware logic into a standalone function and test it with a mock context.

```typescript
// my-extension.test.ts
import { describe, it, expect } from 'bun:test';

// Extract middleware logic for testability
function createStepMiddleware(logger: Console) {
  return async (ctx: { stepIndex: number; next: () => Promise<unknown> }) => {
    const start = Date.now();
    const result = await ctx.next();
    logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  };
}

describe('my-extension step middleware', () => {
  it('calls next and logs timing', async () => {
    const logs: string[] = [];
    const mockLogger = { info: (msg: string) => logs.push(msg) } as Console;
    const middleware = createStepMiddleware(mockLogger);

    const result = await middleware({
      stepIndex: 0,
      next: async () => ({ status: 'completed' }),
    });

    expect(result).toEqual({ status: 'completed' });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('Step 0');
  });
});
```

2. **Integration test with `gdn run`**: Run your swarm and verify the Extension behaves correctly with real LLM interactions.

3. **State persistence test**: Run multiple turns and verify that `api.state.get()` returns the expected accumulated state.

**Checklist:**

- [ ] `gdn validate` passes without errors
- [ ] Middleware logic is extracted into testable functions
- [ ] Unit tests cover the pre/post processing logic
- [ ] State serialization/deserialization is tested

---

## Step 10: Handle cleanup and errors

### Resource cleanup

If your Extension allocates resources (connections, file handles, etc.), clean them up on process exit:

```typescript
export function register(api: ExtensionApi): void {
  const connection = createDatabaseConnection();

  api.tools.register(/* ... */);

  // Clean up on process exit
  process.on('beforeExit', async () => {
    await connection.close();
    api.logger.info('Connection closed');
  });
}
```

### Error handling in middleware

Middleware errors propagate through the onion chain. Catch errors if you need custom handling:

```typescript
api.pipeline.register('step', async (ctx) => {
  try {
    return await ctx.next();
  } catch (error) {
    api.logger.error(`Step ${ctx.stepIndex} failed:`, error);
    // Re-throw to let outer middleware and runtime handle it
    throw error;
  }
});
```

---

## Complete example

Here is a full Extension that combines multiple ExtensionApi areas:

```yaml
# goondan.yaml (Extension resource)
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: usage-tracker
spec:
  entry: "./extensions/usage-tracker/index.ts"
  config:
    maxTurnsPerDay: 100
```

```typescript
// extensions/usage-tracker/index.ts
import type { ExtensionApi } from '@goondan/types';

interface UsageState {
  totalTurns: number;
  todayTurns: number;
  todayDate: string;
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function register(api: ExtensionApi): void {
  // 1. Turn middleware: track usage and enforce daily limit
  api.pipeline.register('turn', async (ctx) => {
    const raw = await api.state.get();
    const state: UsageState = raw
      ? (raw as UsageState)
      : { totalTurns: 0, todayTurns: 0, todayDate: getTodayDate() };

    // Reset daily counter if date changed
    const today = getTodayDate();
    if (state.todayDate !== today) {
      state.todayTurns = 0;
      state.todayDate = today;
    }

    // Check daily limit
    if (state.todayTurns >= 100) {
      api.logger.warn('Daily turn limit reached');
      ctx.emitMessageEvent({
        type: 'append',
        message: {
          id: crypto.randomUUID(),
          data: { role: 'system', content: 'Daily usage limit reached. Please try again tomorrow.' },
          metadata: {},
          createdAt: new Date(),
          source: { type: 'extension', extensionName: 'usage-tracker' },
        },
      });
    }

    const result = await ctx.next();

    // Update usage state
    state.totalTurns += 1;
    state.todayTurns += 1;
    await api.state.set(state);

    // Emit custom event
    api.events.emit('usage-tracker.turn-completed', {
      totalTurns: state.totalTurns,
      todayTurns: state.todayTurns,
    });

    return result;
  });

  // 2. Step middleware: log step timing
  api.pipeline.register('step', async (ctx) => {
    const start = Date.now();
    const result = await ctx.next();
    api.logger.info(`Step ${ctx.stepIndex}: ${Date.now() - start}ms`);
    return result;
  });

  // 3. Dynamic tool: query usage stats
  api.tools.register(
    {
      name: 'usage-tracker__stats',
      description: 'Get current usage statistics',
      parameters: { type: 'object', properties: {} },
    },
    async () => {
      const state = (await api.state.get()) ?? { totalTurns: 0, todayTurns: 0 };
      return state;
    },
  );

  // 4. Event subscription: react to other Extensions
  api.events.on('turn.completed', () => {
    api.logger.debug('Turn completed event received');
  });

  api.logger.info('usage-tracker extension initialized');
}
```

```yaml
# Register on an Agent
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  model:
    ref: "Model/claude-sonnet"
  extensions:
    - ref: "Extension/usage-tracker"
    - ref: "Extension/logging"
```

---

## Quick reference checklist

| Step | What to do | Done? |
|------|-----------|-------|
| 1 | Define `kind: Extension` resource YAML with `spec.entry` | |
| 2 | Create entry module exporting `register(api)` | |
| 3 | Register middleware (`turn` / `step` / `toolCall`) as needed | |
| 4 | Use `emitMessageEvent()` for message manipulation (event sourcing) | |
| 5 | Register dynamic tools with `api.tools.register()` if needed | |
| 6 | Manage persistent state with `api.state.get()` / `set()` | |
| 7 | Use `api.events.on()` / `emit()` for event-driven communication | |
| 8 | Add the Extension to `Agent.spec.extensions` | |
| 9 | Run `gdn validate` and write tests | |
| 10 | Handle resource cleanup and errors | |

---

## See also

- [Extension API Reference](../reference/extension-api.md) -- detailed interface signatures for every ExtensionApi method
- [Extension Pipeline (Explanation)](../explanation/extension-pipeline.md) -- conceptual deep dive into the middleware architecture
- [Build Your First Extension (Tutorial)](../tutorials/03-build-your-first-extension.md) -- step-by-step guided walkthrough for beginners
- [Tool API Reference](../reference/tool-api.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult`
- [Resources Reference](../reference/resources.md) -- full YAML schema for all 8 resource Kinds

---

_Document version: v0.0.3_
