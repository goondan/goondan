# Build Your First Extension

> **What you will build**: A conversation logging Extension that tracks turn statistics, logs step timing, and stores persistent state.
>
> **Time**: ~30 minutes
>
> **Prerequisites**: A working Goondan project (complete [Getting Started](./01-getting-started.md) first)

[Korean version (한국어)](./03-build-your-first-extension.ko.md)

---

## What you will learn

By the end of this tutorial, you will have:

1. Defined an Extension resource in YAML
2. Implemented the `register(api)` entry point
3. Written a `turn` middleware that wraps entire conversation turns
4. Used the state API to persist statistics across restarts
5. Added `step` and `toolCall` middleware for finer control
6. Registered the Extension on an Agent and verified it works

---

## Step 1: Understand what an Extension does

Before writing code, let's clarify the difference between a **Tool** and an **Extension**:

| | Tool | Extension |
|--|------|-----------|
| **Who calls it** | The LLM decides when to call a tool | The runtime calls it automatically on every turn/step/tool call |
| **Purpose** | Give the LLM an action to perform | Give *you* control over the runtime lifecycle |
| **Examples** | HTTP fetch, database query, file write | Logging, message compaction, tool filtering, usage tracking |

An Extension registers **middleware** that wraps the runtime execution. Think of it like Express or Koa middleware -- your code runs before and after the core logic, and you call `next()` to proceed.

> For the full conceptual model, see [Extension Pipeline (Explanation)](../explanation/extension-pipeline.md).

---

## Step 2: Plan the Extension

We will build a **conversation-stats** Extension that:

- Counts total turns and tracks the timestamp of each turn
- Measures how long each step (LLM call) takes
- Logs tool call names and results
- Persists all statistics to disk so they survive restarts

This touches three of the five `ExtensionApi` areas:

| Area | How we use it |
|------|--------------|
| `pipeline` | Register `turn`, `step`, and `toolCall` middleware |
| `state` | Persist turn count and timing data |
| `logger` | Log events to structured output |

---

## Step 3: Define the Extension resource in YAML

Open your `goondan.yaml` and add the following Extension resource. If your file already has other resources (Package, Model, Agent, Swarm, etc.), add this as a new YAML document separated by `---`.

```yaml
---
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: conversation-stats
spec:
  entry: "./extensions/conversation-stats/index.ts"
```

That's it. An Extension resource is minimal -- it just needs a `name` and an `entry` pointing to the TypeScript module.

**What each field means:**

| Field | Value | Purpose |
|-------|-------|---------|
| `apiVersion` | `goondan.ai/v1` | Required for all Goondan resources |
| `kind` | `Extension` | Identifies this as an Extension resource |
| `metadata.name` | `conversation-stats` | Unique name within your bundle -- used to reference this Extension |
| `spec.entry` | `./extensions/conversation-stats/index.ts` | Path to the entry module, relative to the project root |

> For the full Extension schema, see [Resources Reference](../reference/resources.md#extension).

---

## Step 4: Implement `register(api)`

Create the entry module at the path you declared. Every Extension **must** export a named `register` function.

```bash
mkdir -p extensions/conversation-stats
```

Create `extensions/conversation-stats/index.ts` with the following content:

```typescript
// extensions/conversation-stats/index.ts
import type { ExtensionApi } from '@goondan/types';

export function register(api: ExtensionApi): void {
  api.logger.info('[conversation-stats] Extension loaded');
}
```

This is the minimal Extension -- it loads and logs a message, but does nothing else yet. Let's verify it works before adding middleware.

**What happens at runtime:**

1. The AgentProcess loads your Extension module
2. It calls `register(api)` and waits for it to return
3. If `register()` throws, the AgentProcess fails to start (fail-fast)
4. Extensions are loaded in the order they appear in the Agent's `spec.extensions` array

> For the full `register(api)` contract, see [Extension API Reference -- Entry module](../reference/extension-api.md#entry-module).

---

## Step 5: Write a turn middleware

Now let's add the first piece of real logic -- a `turn` middleware that counts turns and logs timing.

Update your `extensions/conversation-stats/index.ts`:

```typescript
// extensions/conversation-stats/index.ts
import type { ExtensionApi } from '@goondan/types';

interface ConversationStats {
  totalTurns: number;
  lastTurnAt: number;
  totalDurationMs: number;
}

export function register(api: ExtensionApi): void {
  // Register a turn middleware
  api.pipeline.register('turn', async (ctx) => {
    const startTime = Date.now();

    // PRE-PROCESSING: runs before the turn executes
    api.logger.info(
      `[conversation-stats] Turn starting for ${ctx.agentName} ` +
      `(instance: ${ctx.instanceKey})`
    );

    // Call next() to execute the actual turn (and any inner middleware)
    const result = await ctx.next();

    // POST-PROCESSING: runs after the turn completes
    const duration = Date.now() - startTime;
    api.logger.info(
      `[conversation-stats] Turn completed in ${duration}ms ` +
      `(reason: ${result.finishReason})`
    );

    // Read current state (null on first run)
    const raw = await api.state.get();
    const stats: ConversationStats = raw
      ? (raw as ConversationStats)
      : { totalTurns: 0, lastTurnAt: 0, totalDurationMs: 0 };

    // Update statistics
    stats.totalTurns += 1;
    stats.lastTurnAt = Date.now();
    stats.totalDurationMs += duration;

    // Persist updated state
    await api.state.set(stats);

    api.logger.info(
      `[conversation-stats] Total turns: ${stats.totalTurns}, ` +
      `avg duration: ${Math.round(stats.totalDurationMs / stats.totalTurns)}ms`
    );

    // Always return the result from next()
    return result;
  });

  api.logger.info('[conversation-stats] Extension loaded');
}
```

**How the turn middleware works:**

```text
Your middleware
  |
  |-- PRE: log "Turn starting..."
  |
  |-- ctx.next()  ---------> [Core Turn Logic: Step loop, LLM calls, tool executions]
  |
  |-- POST: log timing, update state, persist
  |
  v
Return result
```

**Key points:**

- `ctx.next()` **must** be called exactly once. It executes the inner middleware layers and the core turn logic.
- Everything before `ctx.next()` is **pre-processing** (runs before the turn).
- Everything after `ctx.next()` is **post-processing** (runs after the turn completes).
- `ctx.agentName` and `ctx.instanceKey` identify which agent instance is running.
- `result.finishReason` tells you how the turn ended (`'text_response'`, `'max_steps'`, or `'error'`).

---

## Step 6: Use the state API for persistence

In Step 5, we already used `api.state.get()` and `api.state.set()`. Let's understand what's happening in detail.

### How state works

```text
                   Turn starts
                       |
                       v
   +-- api.state.get() returns previously saved JSON (or null on first run)
   |
   |   ... your middleware runs ...
   |
   +-- api.state.set(newState) updates the in-memory state
                       |
                       v
                  Turn ends
                       |
                       v
   AgentProcess automatically persists state to disk
```

**Storage location:**

```text
~/.goondan/workspaces/<workspaceId>/instances/<instanceKey>/extensions/conversation-stats.json
```

**Rules to remember:**

- State is **per instance** -- different `instanceKey` values have independent state.
- State is **auto-restored** when the AgentProcess starts.
- State is **auto-persisted** at the end of each turn.
- State must be **JSON-serializable** (no functions, Symbols, or circular references).
- `api.state.get()` returns `null` if no state has been saved yet -- always handle this case.

**Expected result after 3 turns:**

```json
{
  "totalTurns": 3,
  "lastTurnAt": 1708300000000,
  "totalDurationMs": 4523
}
```

> For the full state API details, see [Extension API Reference -- ExtensionStateApi](../reference/extension-api.md#3-state----extensionstateapi).

---

## Step 7: Register the Extension on an Agent

The Extension won't run until an Agent references it. Open your `goondan.yaml` and find your Agent resource. Add the Extension to `spec.extensions`:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  model:
    ref: "Model/claude-sonnet"
  tools:
    - ref: "Tool/bash"
  extensions:
    - ref: "Extension/conversation-stats"    # Add this line
```

**The `ref` format is `Extension/<metadata.name>`.**

If you have multiple Extensions, the **order matters** -- the first Extension in the array becomes the outermost middleware layer:

```yaml
  extensions:
    - ref: "Extension/conversation-stats"    # 1st: outermost layer (runs first/last)
    - ref: "Extension/logging"               # 2nd: middle layer
    - ref: "Extension/skills"                # 3rd: innermost layer (runs closest to core)
```

> For more on the onion model, see [Extension Pipeline -- The Onion Model](../explanation/extension-pipeline.md#the-onion-model).

---

## Step 8: Validate and run

### Validate the bundle

```bash
gdn validate
```

Expected output:

```text
Validation passed.
```

If you see an error like `E_BUNDLE_ENTRY_NOT_FOUND`, check that:
- `spec.entry` path is correct relative to your project root
- The file `extensions/conversation-stats/index.ts` exists

### Run the swarm

```bash
gdn run
```

Send a message to your agent (via CLI, Telegram, Slack, or whichever Connector you have configured). In the logs, you should see output like:

```text
[conversation-stats] Extension loaded
[conversation-stats] Turn starting for assistant (instance: default)
[conversation-stats] Turn completed in 1523ms (reason: text_response)
[conversation-stats] Total turns: 1, avg duration: 1523ms
```

Send a second message. The turn count should increment:

```text
[conversation-stats] Turn starting for assistant (instance: default)
[conversation-stats] Turn completed in 987ms (reason: text_response)
[conversation-stats] Total turns: 2, avg duration: 1255ms
```

You can also check the persisted state file:

```bash
cat ~/.goondan/workspaces/*/instances/*/extensions/conversation-stats.json
```

---

## Step 9: Add step and toolCall middleware

Now let's add more granular middleware. A turn contains multiple **steps** (each step is one LLM call), and each step can trigger multiple **tool calls**.

Update your Extension to add step and toolCall middleware:

```typescript
// extensions/conversation-stats/index.ts
import type { ExtensionApi } from '@goondan/types';

interface ConversationStats {
  totalTurns: number;
  totalSteps: number;
  totalToolCalls: number;
  lastTurnAt: number;
  totalDurationMs: number;
}

export function register(api: ExtensionApi): void {
  // 1. TURN middleware: track turns and persist state
  api.pipeline.register('turn', async (ctx) => {
    const startTime = Date.now();

    api.logger.info(
      `[conversation-stats] Turn starting for ${ctx.agentName} ` +
      `(${ctx.conversationState.nextMessages.length} messages in history)`
    );

    const result = await ctx.next();

    const duration = Date.now() - startTime;

    // Read and update persistent state
    const raw = await api.state.get();
    const stats: ConversationStats = raw
      ? (raw as ConversationStats)
      : { totalTurns: 0, totalSteps: 0, totalToolCalls: 0, lastTurnAt: 0, totalDurationMs: 0 };

    stats.totalTurns += 1;
    stats.lastTurnAt = Date.now();
    stats.totalDurationMs += duration;

    await api.state.set(stats);

    api.logger.info(
      `[conversation-stats] Turn completed in ${duration}ms | ` +
      `totals: ${stats.totalTurns} turns, ${stats.totalSteps} steps, ` +
      `${stats.totalToolCalls} tool calls`
    );

    return result;
  });

  // 2. STEP middleware: track step count and timing
  api.pipeline.register('step', async (ctx) => {
    const startTime = Date.now();

    api.logger.info(
      `[conversation-stats] Step ${ctx.stepIndex} starting ` +
      `(${ctx.toolCatalog.length} tools available)`
    );

    const result = await ctx.next();

    const duration = Date.now() - startTime;

    // Increment step count in state
    const raw = await api.state.get();
    if (raw) {
      const stats = raw as ConversationStats;
      stats.totalSteps += 1;
      await api.state.set(stats);
    }

    api.logger.info(
      `[conversation-stats] Step ${ctx.stepIndex} completed in ${duration}ms ` +
      `(${result.toolCalls.length} tool calls)`
    );

    return result;
  });

  // 3. TOOLCALL middleware: track tool usage
  api.pipeline.register('toolCall', async (ctx) => {
    const startTime = Date.now();

    api.logger.info(
      `[conversation-stats] Tool call: ${ctx.toolName} (id: ${ctx.toolCallId})`
    );

    const result = await ctx.next();

    const duration = Date.now() - startTime;

    // Increment tool call count in state
    const raw = await api.state.get();
    if (raw) {
      const stats = raw as ConversationStats;
      stats.totalToolCalls += 1;
      await api.state.set(stats);
    }

    api.logger.info(
      `[conversation-stats] Tool ${ctx.toolName}: ${result.status} (${duration}ms)`
    );

    return result;
  });

  api.logger.info('[conversation-stats] Extension loaded with turn, step, and toolCall middleware');
}
```

**The execution nesting looks like this:**

```text
[Turn Middleware]
  |-- turn.pre: "Turn starting..."
  |
  |-- [Step 0]
  |     |-- step.pre: "Step 0 starting (5 tools available)"
  |     |-- [Core LLM Call]
  |     |-- [Tool Call: bash__exec]
  |     |     |-- toolCall.pre: "Tool call: bash__exec"
  |     |     |-- [Core: execute bash]
  |     |     +-- toolCall.post: "Tool bash__exec: ok (234ms)"
  |     |-- [Tool Call: file-system__read]
  |     |     |-- toolCall.pre: "Tool call: file-system__read"
  |     |     |-- [Core: execute file read]
  |     |     +-- toolCall.post: "Tool file-system__read: ok (12ms)"
  |     +-- step.post: "Step 0 completed in 1823ms (2 tool calls)"
  |
  |-- [Step 1]
  |     |-- step.pre: "Step 1 starting..."
  |     |-- [Core LLM Call -- no tool calls this time]
  |     +-- step.post: "Step 1 completed in 456ms (0 tool calls)"
  |
  +-- turn.post: "Turn completed in 2279ms | totals: 1 turns, 2 steps, 2 tool calls"
```

**Key context fields for each middleware level:**

| Middleware | Key context fields | Mutable fields |
|-----------|-------------------|----------------|
| `turn` | `agentName`, `instanceKey`, `conversationState`, `inputEvent` | `metadata` |
| `step` | everything from turn + `stepIndex`, `turn` | `toolCatalog`, `metadata` |
| `toolCall` | `stepIndex`, `toolName`, `toolCallId` | `args`, `metadata` |

> For the complete context interface details, see [Extension API Reference -- PipelineRegistry](../reference/extension-api.md#1-pipeline----pipelineregistry).

---

## Step 10: Run and verify the complete Extension

Run your swarm again and send a message that triggers tool calls (for example, ask your agent to run a command or read a file):

```bash
gdn run
```

**Expected log output:**

```text
[conversation-stats] Extension loaded with turn, step, and toolCall middleware
[conversation-stats] Turn starting for assistant (3 messages in history)
[conversation-stats] Step 0 starting (5 tools available)
[conversation-stats] Tool call: bash__exec (id: call_abc123)
[conversation-stats] Tool bash__exec: ok (342ms)
[conversation-stats] Step 0 completed in 1845ms (1 tool calls)
[conversation-stats] Step 1 starting (5 tools available)
[conversation-stats] Step 1 completed in 623ms (0 tool calls)
[conversation-stats] Turn completed in 2468ms | totals: 1 turns, 2 steps, 1 tool calls
```

**Check persisted state:**

```bash
cat ~/.goondan/workspaces/*/instances/*/extensions/conversation-stats.json
```

```json
{
  "totalTurns": 1,
  "totalSteps": 2,
  "totalToolCalls": 1,
  "lastTurnAt": 1708300000000,
  "totalDurationMs": 2468
}
```

Stop and restart the swarm. Send another message. The counts should continue from where they left off, proving that state persistence works:

```text
[conversation-stats] Turn completed in 1234ms | totals: 2 turns, 4 steps, 2 tool calls
```

---

## Complete project structure

At this point, your project should look like this:

```text
my-project/
  goondan.yaml              # Package + Model + Agent + Swarm + Extension resources
  extensions/
    conversation-stats/
      index.ts              # Extension entry module
  .env                      # API keys (ANTHROPIC_API_KEY, etc.)
```

And the relevant sections of `goondan.yaml`:

```yaml
# Extension resource
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: conversation-stats
spec:
  entry: "./extensions/conversation-stats/index.ts"
---
# Agent resource (with Extension registered)
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  model:
    ref: "Model/claude-sonnet"
  tools:
    - ref: "Tool/bash"
  extensions:
    - ref: "Extension/conversation-stats"
```

---

## What you learned

| Concept | What you did |
|---------|-------------|
| Extension resource | Defined `kind: Extension` with `spec.entry` pointing to a TypeScript module |
| `register(api)` | Exported a named function that receives the `ExtensionApi` |
| Turn middleware | Wrapped the entire turn with pre/post processing using `api.pipeline.register('turn', ...)` |
| State API | Persisted statistics using `api.state.get()` and `api.state.set()` |
| Step middleware | Tracked individual LLM call timing with `api.pipeline.register('step', ...)` |
| ToolCall middleware | Logged each tool invocation with `api.pipeline.register('toolCall', ...)` |
| Agent registration | Added `ref: "Extension/conversation-stats"` to `Agent.spec.extensions` |
| Validation | Ran `gdn validate` to verify the bundle, then `gdn run` to test |

---

## Next steps

Now that you know how to build an Extension, here are some directions to explore:

### Go deeper with Extensions

- **Add a dynamic tool** -- Use `api.tools.register()` to register a `conversation-stats__report` tool that lets the LLM query the statistics. See [Extension API Reference -- ExtensionToolsApi](../reference/extension-api.md#2-tools----extensiontoolsapi).
- **Use event sourcing** -- Modify conversation messages with `ctx.emitMessageEvent()` (e.g., inject a summary of past turns). See [Extension Pipeline -- ConversationState and Event Sourcing](../explanation/extension-pipeline.md#conversationstate-and-event-sourcing).
- **Subscribe to events** -- Use `api.events.on('turn.completed', ...)` to react to runtime events. See [Extension API Reference -- ExtensionEventsApi](../reference/extension-api.md#4-events----extensioneventsapi).

### Production patterns

- [Write an Extension (How-to)](../how-to/write-an-extension.md) -- comprehensive checklist for production-quality Extensions
- [Extension API Reference](../reference/extension-api.md) -- complete API interface documentation
- [Extension Pipeline (Explanation)](../explanation/extension-pipeline.md) -- deep dive into the middleware architecture and onion model

### Build a Connector

- [Write a Connector (How-to)](../how-to/write-a-connector.md) -- bridge an external protocol (HTTP, WebSocket, polling) to your swarm

### Explore multi-agent patterns

- [Multi-Agent Patterns](../how-to/multi-agent-patterns.md) -- coordinate multiple agents with request/send/spawn

---

_Tutorial version: v0.0.3_
