# How to: Multi-Agent Patterns

> Patterns for inter-agent communication using request, send, and spawn.

[Korean version (한국어)](./multi-agent-patterns.ko.md)

---

## Prerequisites

- A working Goondan swarm with multiple agents
- The `agents` tool from `@goondan/base` included in your agent's `spec.tools`
- Familiarity with [Tool API Reference](../reference/tool-api.md) (especially `AgentToolRuntime`)
- Basic understanding of the [Runtime Model](../explanation/runtime-model.md) (IPC and Process-per-Agent)

---

## Overview

Agents in a Goondan swarm communicate exclusively through the Orchestrator using **IPC-based events**. They never talk to each other directly. The `agents` tool from `@goondan/base` provides five operations for inter-agent communication:

| Operation | Pattern | Description |
|-----------|---------|-------------|
| `agents__request` | Request-response | Send a message and wait for a response |
| `agents__send` | Fire-and-forget | Send a message without waiting |
| `agents__spawn` | Instance preparation | Prepare a new agent instance |
| `agents__list` | Discovery | List spawned agent instances |
| `agents__catalog` | Discovery | List available agents in the swarm |

All communication flows through the Orchestrator, which routes events by `instanceKey` and spawns target agents automatically when needed.

In addition to LLM tool calls, `turn` / `step` middleware can call agents programmatically via `ctx.agents`:

| Middleware API | Pattern | Description |
|----------------|---------|-------------|
| `ctx.agents.request` | Request-response | Extension middleware sends a request and waits for response |
| `ctx.agents.send` | Fire-and-forget | Extension middleware sends an async notification |

`ctx.agents` currently supports `request` / `send` only. Instance preparation/discovery (`spawn`, `list`, `catalog`) stays on the `agents` tool path.

---

## Setup: Include the agents tool

To enable inter-agent communication, add the `agents` tool to each agent that needs to communicate with others.

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coordinator
spec:
  modelConfig:
    modelRef: "Model/default"
  tools:
    - ref:
        kind: Tool
        name: agents
        package: "@goondan/base"
    # ... other tools
```

This exposes five LLM-callable tools: `agents__request`, `agents__send`, `agents__spawn`, `agents__list`, and `agents__catalog`.

---

## Pattern 0: Middleware-triggered request/send (`ctx.agents`)

Use this when inter-agent calls should happen automatically in Extension middleware (for example, turn preloading or turn post auditing), without asking the worker LLM to explicitly call `agents__request`.

```typescript
api.pipeline.register('turn', async (ctx) => {
  const preload = await ctx.agents.request({
    target: 'retriever',
    input: 'Find context for this inbound message',
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

Notes:

- Available only in `turn` / `step` middleware contexts.
- `toolCall` context does not expose `ctx.agents`.
- Default `request` timeout is `15000ms` if omitted.
- Cyclic request chains are detected by runtime and return an error.

---

## Pattern 1: Synchronous request (request-response)

Use `agents__request` when you need a response from another agent before continuing. The calling agent's Turn pauses until the target agent completes its Turn and returns a result.

### How it works

```
Agent A (coordinator)                 Orchestrator                Agent B (researcher)
    |                                      |                           |
    |-- agents__request(researcher, ...) ->|                           |
    |                                      |-- route event ---------->|
    |                                      |   (spawn if needed)      |
    |                                      |                          |-- process Turn
    |                                      |                          |-- return result
    |                                      |<-- response event -------|
    |<-- result ----------------------------|                          |
    |                                      |                           |
    |-- continues Turn                     |                           |
```

### LLM perspective

The LLM calls the `agents__request` tool with:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | `string` | Yes | Name of the target agent (e.g., `"researcher"`) |
| `input` | `string` | No | Text message to send to the target |
| `instanceKey` | `string` | No | Target instance key (defaults to caller's instanceKey) |
| `timeoutMs` | `number` | No | Timeout in milliseconds (default: 15000) |
| `metadata` | `object` | No | Additional metadata to pass with the event |

### Example scenario

A coordinator agent delegates a research task:

```
Coordinator:
  "I need to research quantum computing trends.
   Let me ask the researcher agent."

  -> agents__request({
       target: "researcher",
       input: "Summarize the latest quantum computing trends in 2026"
     })

  <- { target: "researcher", response: "Here are the key trends: ..." }

  "Based on the research, here is my analysis..."
```

### When to use

- The calling agent needs the response to continue its reasoning
- Task delegation where the result feeds back into the current Turn
- Quality review: agent A generates content, agent B reviews and returns feedback

---

## Pattern 2: Asynchronous send (fire-and-forget)

Use `agents__send` when you want to notify another agent without waiting for a response. The tool returns immediately after the event is accepted for delivery.

### How it works

```
Agent A (coordinator)                 Orchestrator                Agent B (notifier)
    |                                      |                           |
    |-- agents__send(notifier, ...) ------>|                           |
    |<-- { accepted: true } immediately ---|                           |
    |                                      |-- route event ---------->|
    |-- continues Turn                     |   (spawn if needed)      |
    |                                      |                          |-- process Turn
    |                                      |                          |   (independently)
```

### LLM perspective

The LLM calls the `agents__send` tool with:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | `string` | Yes | Name of the target agent |
| `input` | `string` | No | Text message to send |
| `instanceKey` | `string` | No | Target instance key (defaults to caller's instanceKey) |
| `metadata` | `object` | No | Additional metadata |

### Example scenario

A coordinator notifies multiple channels after completing a task:

```
Coordinator:
  "Task completed. I'll notify the team."

  -> agents__send({
       target: "notifier",
       input: "Deployment completed successfully for service-x"
     })
  <- { accepted: true }

  -> agents__send({
       target: "logger",
       input: "Deployment event: service-x deployed at 2026-02-18T10:30:00Z"
     })
  <- { accepted: true }

  "Both agents have been notified."
```

### When to use

- Broadcasting notifications to multiple agents
- Logging or auditing events
- Triggering background tasks where you do not need the result
- Avoiding blocking when the response is not needed for the current Turn

---

## Pattern 3: Spawn a new instance

Use `agents__spawn` to prepare a new instance of a defined agent before sending messages to it. This is useful when you want to create isolated instances with specific instance keys or working directories.

### How it works

```
Agent A (coordinator)                 Orchestrator
    |                                      |
    |-- agents__spawn(builder, {           |
    |     instanceKey: "task-42"           |
    |   }) ------------------------------>|
    |                                      |-- prepare instance
    |<-- { spawned: true, instanceKey } ---|
    |                                      |
    |-- agents__request(builder, {         |
    |     instanceKey: "task-42",          |
    |     input: "Build feature X"         |
    |   }) ------------------------------>|
    |                                      |-- route to task-42 instance
```

### LLM perspective

The LLM calls the `agents__spawn` tool with:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | `string` | Yes | Agent name (must be defined in the current Swarm) |
| `instanceKey` | `string` | No | Custom instance key (auto-generated if omitted) |
| `cwd` | `string` | No | Working directory for the new instance |

### Important rules

- The `target` must be an Agent resource defined in the current Swarm -- `spawn` does not create new Agent resources.
- If an instance with the same `instanceKey` already exists, it is reused (not duplicated).
- The Orchestrator also auto-spawns agents when you `request` or `send` to a non-existent instance, so explicit `spawn` is optional in many cases.

### When to use

- Pre-creating instances with specific instance keys before sending messages
- Setting up a custom working directory for an instance
- Creating multiple isolated instances of the same agent type (e.g., one builder per task)

---

## Pattern 4: Discover agents with list and catalog

Before communicating with other agents, you may need to discover what agents are available or what instances have been spawned.

### catalog: What agents are defined

`agents__catalog` returns the agent definitions in the current Swarm.

```
-> agents__catalog()
<- {
     swarmName: "brain",
     entryAgent: "coordinator",
     selfAgent: "coordinator",
     availableAgents: ["coordinator", "researcher", "builder", "reviewer"],
     callableAgents: ["researcher", "builder", "reviewer"]
   }
```

| Field | Description |
|-------|-------------|
| `availableAgents` | All agent names defined in the Swarm |
| `callableAgents` | Agents the caller can communicate with (excludes self) |
| `selfAgent` | The calling agent's own name |
| `entryAgent` | The Swarm's entry agent |

### list: What instances are running

`agents__list` returns information about spawned agent instances.

```
-> agents__list()
<- {
     count: 2,
     agents: [
       { target: "builder", instanceKey: "task-42", ownerAgent: "coordinator", ... },
       { target: "builder", instanceKey: "task-43", ownerAgent: "coordinator", ... }
     ]
   }
```

By default, `list` returns only instances spawned by the calling agent. Pass `includeAll: true` to see all instances in the swarm.

---

## Real-world scenario: Coordinator + Specialist pattern

The most common multi-agent pattern in Goondan is a **coordinator** that delegates tasks to **specialist** agents. Here is a complete working example from the `brain-persona` sample.

### Swarm configuration

```yaml
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: brain
spec:
  entryAgent: "Agent/coordinator"
  agents:
    - ref: "Agent/coordinator"
    - ref: "Agent/researcher"
    - ref: "Agent/builder"
    - ref: "Agent/reviewer"
  policy:
    maxStepsPerTurn: 24
```

### Agent configurations

**Coordinator** -- receives all inbound events and delegates to specialists:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coordinator
spec:
  modelConfig:
    modelRef: "Model/fast-model"
  prompts:
    systemRef: "./prompts/coordinator.system.md"
  tools:
    - ref:
        kind: Tool
        name: agents
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: telegram
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: slack
        package: "@goondan/base"
```

**Specialist** -- focused on a single domain (e.g., research):

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: researcher
spec:
  modelConfig:
    modelRef: "Model/default-model"
  prompts:
    systemRef: "./prompts/researcher.system.md"
  tools:
    - ref:
        kind: Tool
        name: agents
        package: "@goondan/base"
```

### Communication flow

```
User (via Telegram/Slack)
    |
    v
Connector -> Connection ingress -> coordinator
    |
    |  coordinator receives: "Research quantum computing and build a summary doc"
    |
    |  Step 1: coordinator calls agents__request(researcher, "Research quantum computing trends")
    |           -> researcher processes Turn, returns research results
    |
    |  Step 2: coordinator calls agents__request(builder, "Create a summary document based on: ...")
    |           -> builder processes Turn, returns document
    |
    |  Step 3: coordinator calls agents__request(reviewer, "Review this document: ...")
    |           -> reviewer processes Turn, returns feedback
    |
    |  Step 4: coordinator synthesizes results and sends final response via telegram__send
    |
    v
User receives the final response
```

### Connection routing

All inbound events use a shared `instanceKey` to maintain a single conversation thread:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-brain
spec:
  connectorRef:
    kind: Connector
    name: telegram-polling
    package: "@goondan/base"
  swarmRef: "Swarm/brain"
  secrets:
    TELEGRAM_BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: telegram_message
        route:
          instanceKey: "brain-persona-shared"
```

The `instanceKey: "brain-persona-shared"` ensures all Telegram messages go to the same coordinator instance, maintaining conversation continuity.

---

## Tips

### Choosing between request and send

| Scenario | Use |
|----------|-----|
| Need the result to continue reasoning | `request` |
| Broadcasting a notification | `send` |
| Delegating a task and waiting for output | `request` |
| Triggering a background job | `send` |
| Sequential pipeline (A -> B -> C -> result) | `request` at each step |

### Auto-spawn behavior

You do not always need to call `agents__spawn` explicitly. When you `request` or `send` to a target agent that does not have an active instance, the Orchestrator automatically spawns one. Use explicit `spawn` when you need:

- A custom `instanceKey`
- A custom working directory (`cwd`)
- To pre-warm an instance before sending work to it

### instanceKey sharing

When Agent A calls `agents__request(target: "B")` without specifying an `instanceKey`, the caller's own `instanceKey` is used as the default. This means:

- If the coordinator's instanceKey is `"brain-persona-shared"`, the researcher also runs under `"brain-persona-shared"`.
- This is often what you want -- a single conversation context shared across the swarm.
- If you need isolated instances per task, specify a unique `instanceKey` in the request.

---

## See also

- [Tool API Reference](../reference/tool-api.md) -- Full `AgentToolRuntime` API (request/send/spawn/list/catalog)
- [Built-in Tools Reference](../reference/builtin-tools.md) -- `agents` tool parameter details
- [Runtime Model](../explanation/runtime-model.md) -- IPC message routing and Process-per-Agent architecture
- [How to: Write a Connector](./write-a-connector.md) -- Building the inbound event pipeline

---

_How-to version: v0.0.3_
