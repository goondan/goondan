# Runtime Model

> Orchestrator, Process-per-Agent, IPC, Reconciliation Loop, and Graceful Shutdown

[Korean version (한국어)](./runtime-model.ko.md)

---

## Why a runtime model matters

When you run `gdn run`, Goondan does not simply load agents into a single process. Instead, it launches a **long-lived Orchestrator** that spawns each agent as an independent child process. Understanding this model helps you reason about crash isolation, restarts, message delivery, and how configuration changes propagate -- all critical for operating a production swarm.

This article explains the _design motivations_ behind each component. For precise interface definitions, see `docs/specs/runtime.md`; for CLI usage, see [CLI Reference](../reference/cli-reference.md).

---

## The big picture

```
gdn run
  |
  v
+---------------------------------------------------------------+
|                    Orchestrator                                |
|                  (long-lived process)                          |
|                                                               |
|   +------------------+  +------------------+                  |
|   | AgentProcess-A   |  | AgentProcess-B   |   ...            |
|   | (Bun child proc) |  | (Bun child proc) |                  |
|   |                  |  |                  |                  |
|   | Turn -> Step ... |  | Turn -> Step ... |                  |
|   +------------------+  +------------------+                  |
|                                                               |
|   +------------------------+                                  |
|   | ConnectorProcess       |                                  |
|   | (Bun child proc)       |                                  |
|   | HTTP server / polling  |                                  |
|   +------------------------+                                  |
+---------------------------------------------------------------+
```

Three kinds of processes make up a running swarm:

| Process | Role | Analogy (Kubernetes) |
|---------|------|----------------------|
| **Orchestrator** | Manages lifecycle of all other processes, routes IPC messages | kube-controller-manager |
| **AgentProcess** | Runs a single agent's Turn/Step loop in isolation | Pod |
| **ConnectorProcess** | Receives external events (HTTP, polling, cron) and emits them to Orchestrator | Ingress controller |

---

## Orchestrator: the long-lived supervisor

The Orchestrator starts when you run `gdn run` and stays alive for the entire session. Even when all AgentProcesses have terminated (e.g., no events to process), the Orchestrator remains, ready to spawn new processes as events arrive.

### Core responsibilities

1. **Parse the Config Plane** -- Load `goondan.yaml` and related resources to build the set of declared agents, connectors, and connections.
2. **Spawn and supervise** -- Create AgentProcess and ConnectorProcess children, watch for their exit.
3. **Route events** -- Accept events from ConnectorProcesses or inter-agent messages and deliver them to the correct AgentProcess based on `instanceKey`.
4. **Act as IPC broker** -- All agent-to-agent communication goes through the Orchestrator.
5. **React to configuration changes** -- On restart signals (`gdn restart`, `--watch` mode), gracefully shut down affected processes and re-spawn them with the updated config.

### Why a single Orchestrator?

Centralizing supervision in one process keeps routing logic simple and state consistent. The Orchestrator does not execute agent logic itself -- it delegates that entirely to child processes. This mirrors the Kubernetes control plane: the controller-manager makes decisions; the kubelet runs workloads.

---

## Process-per-Agent: crash isolation by design

Each `Agent` declared in the Swarm runs in its own Bun child process. This is the most important architectural decision in Goondan's runtime:

- **Crash isolation** -- If Agent-A encounters an unhandled exception, Agent-B keeps running. The Orchestrator detects the crash and can re-spawn Agent-A.
- **Independent scaling** -- Each process has its own memory space and event loop. A slow agent does not block others.
- **Selective restart** -- When you change a Tool or Extension used by one agent, only that agent's process needs restarting. Conversations of other agents are unaffected.

### How it compares to Kubernetes

| Kubernetes | Goondan |
|------------|---------|
| Pod runs a container with isolated resources | AgentProcess runs an agent in an isolated Bun process |
| Pod crash triggers restart by kubelet | AgentProcess crash triggers re-spawn by Orchestrator |
| Pods communicate via Services/networking | AgentProcesses communicate via Orchestrator IPC |
| Declarative desired state in Deployment | Declarative desired state in `goondan.yaml` |

---

## IPC: the message broker

Agents do not talk to each other directly. All inter-process communication flows through the Orchestrator, which acts as a **message broker**.

### Three IPC message types

The IPC protocol is intentionally minimal -- only three message types exist:

| Type | Direction | Purpose |
|------|-----------|---------|
| `event` | Bidirectional | Carries an `AgentEvent` payload -- the universal event envelope for connector inputs, agent-to-agent requests, and responses |
| `shutdown` | Orchestrator -> Child | Tells a process to drain and terminate; includes `gracePeriodMs` and `reason` |
| `shutdown_ack` | Child -> Orchestrator | Acknowledges drain completion; the process exits after sending this |

Every IPC message contains `from`, `to`, and `payload` fields, and is JSON-serializable with guaranteed ordering.

### Event flow: Connector to Agent

```
External event (e.g., Telegram webhook)
          |
          v
ConnectorProcess
  - Normalize payload to ConnectorEvent
  - ctx.emit(ConnectorEvent)
          |
          v  (IPC)
Orchestrator
  - Match Connection ingress rules
  - Determine target Agent + instanceKey
  - Look up or spawn AgentProcess
          |
          v  (IPC)
AgentProcess
  - Enqueue AgentEvent
  - Process Turn when ready
```

### Event flow: Agent to Agent (request/response)

```
AgentProcess-A
  - Tool call: agents__request("reviewer", ...)
  - Sends IPC event with replyTo.correlationId
          |
          v  (IPC)
Orchestrator
  - Routes to AgentProcess-B (spawns if needed)
          |
          v  (IPC)
AgentProcess-B
  - Processes Turn
  - Sends response IPC event with metadata.inReplyTo = correlationId
          |
          v  (IPC)
Orchestrator
  - Routes back to AgentProcess-A (matching correlationId)
          |
          v
AgentProcess-A
  - Receives response, continues Turn
```

The `replyTo` + `correlationId` pattern allows request-response semantics without dedicated reply channels. Fire-and-forget communication simply omits `replyTo`.

---

## Unified event model: AgentEvent

From the receiving agent's perspective, all incoming events look the same -- an `AgentEvent`. Whether the event came from a Telegram webhook, another agent, or the CLI, the agent sees a uniform envelope:

| Field | Description |
|-------|-------------|
| `id` | Unique event ID |
| `type` | Event type string |
| `input` | Text content |
| `instanceKey` | Routing key for the agent instance |
| `source` | Who sent it (`{ kind: 'agent', name: '...' }` or `{ kind: 'connector', name: '...' }`) |
| `replyTo` | Optional reply channel with `target` and `correlationId` |
| `auth` | Authentication context, forwarded unchanged through handoffs |

This unified model means an agent does not need special handling for different event sources. The `source` field is metadata; the `replyTo` field determines whether a response is expected.

---

## ProcessStatus: the seven states

Every AgentProcess and ConnectorProcess is tracked by the Orchestrator using a status model inspired by Kubernetes Pod phases:

```
                        +---> processing ---+
                        |                   |
spawning ---> idle -----+                   +---> idle
                        |                   |
                        +---> draining ---> terminated
                                            |
         crashed <----- (non-zero exit) <---+
             |
             v  (repeated crashes)
      crashLoopBackOff
```

| Status | Meaning |
|--------|---------|
| `spawning` | Process is being created; not yet ready to handle events |
| `idle` | Process is running but has no active Turn |
| `processing` | Process is executing a Turn |
| `draining` | Process received a `shutdown` message; finishing current Turn, rejecting new events |
| `terminated` | Process exited normally (exit code 0) |
| `crashed` | Process exited abnormally (exit code != 0) |
| `crashLoopBackOff` | Process has crashed repeatedly; Orchestrator is applying exponential backoff before the next re-spawn |

The Orchestrator detects status transitions through direct process observation (Bun spawn/exit events) and optional IPC reports from the child process.

---

## Reconciliation Loop: desired vs. actual state

The Orchestrator runs a periodic **Reconciliation Loop** (default: every 5 seconds) that compares the _desired state_ from configuration with the _actual state_ of running processes, and takes corrective action.

### Desired state

Derived from `goondan.yaml`:

- Which Agents are declared in `Swarm.agents[]`
- Which Connectors are referenced by Connections
- ConnectorProcesses should always be running (they listen for external events)
- AgentProcesses are spawned on-demand when events arrive

### Actual state

Observed directly by the Orchestrator from its own process map:

- Which child processes are alive (pid exists)
- Which have exited and with what exit code
- Consecutive crash count and backoff timers per process

### Reconciliation actions

On each loop iteration, the Orchestrator produces a set of actions:

| Condition | Action |
|-----------|--------|
| A ConnectorProcess should exist but is not running | Spawn it |
| A process exists but its Agent/Connector was removed from config | Graceful shutdown |
| A process is in `crashed` state | Re-spawn (subject to backoff) |
| A process is in `crashLoopBackOff` and `nextSpawnAllowedAt` has passed | Re-spawn |

### Crash Loop detection and backoff

When an AgentProcess crashes repeatedly, the Orchestrator applies exponential backoff to prevent resource exhaustion:

```
crash 1-5:  Immediate re-spawn
crash 6:    crashLoopBackOff -> wait 1s
crash 7:    wait 2s
crash 8:    wait 4s
...
crash N:    wait min(1s * 2^(N-6), 5min)
```

The counter resets to zero once the process completes at least one successful Turn. This mirrors the `CrashLoopBackOff` status in Kubernetes Pods.

### Why a Reconciliation Loop?

A purely event-driven approach (spawn on crash, kill on config delete) can miss edge cases: processes that die between checks, config files that change while a process is spawning, etc. The reconciliation model is **self-healing** -- even if an event is lost, the next loop iteration will detect the discrepancy and correct it.

---

## Graceful Shutdown Protocol

When the Orchestrator needs to stop an AgentProcess -- due to config change, restart command, or its own shutdown -- it follows a protocol designed to prevent data loss:

```
Orchestrator                          AgentProcess
    |                                      |
    |--- shutdown IPC ------------------>  |
    |    { gracePeriodMs: 30000,           |
    |      reason: 'config_change' }       |
    |                                      |--- status -> 'draining'
    |                                      |--- stop accepting new events
    |                                      |--- finish current Turn (if any)
    |                                      |--- fold events -> base
    |                                      |
    |  <--------- shutdown_ack ----------  |
    |                                      |--- exit(0)
    |
    |--- (confirm normal exit)
    |
    |--- (if gracePeriodMs expires
    |     without shutdown_ack)
    |                                      |
    |--- SIGKILL ----------------------->  X
```

### Shutdown reasons

| Reason | When |
|--------|------|
| `config_change` | YAML was modified and the agent needs the new config |
| `restart` | Explicit `gdn restart` command or self-restart signal |
| `orchestrator_shutdown` | The Orchestrator itself is shutting down |

### Recovery after forced kill

If the grace period expires and SIGKILL is used, the AgentProcess may leave un-folded events in `events.jsonl`. On the next startup, the runtime recovers by recomputing `BaseMessages + SUM(Events)`, ensuring no messages are lost. This is the primary reason for the event sourcing model described below.

---

## Turn and Step: the execution model

Inside each AgentProcess, work is organized into **Turns** and **Steps**.

### Turn

A Turn is the unit of processing for a single incoming event. One `AgentEvent` goes in; one `TurnResult` comes out. A Turn contains one or more Steps.

```
AgentEvent (input)
    |
    v
+-- Turn -------------------------------------------+
|                                                   |
|   Step 0: LLM call -> tool calls -> tool results  |
|   Step 1: LLM call -> tool calls -> tool results  |
|   Step 2: LLM call -> text response (no tools)    |
|                                                   |
+---------------------------------------------------+
    |
    v
TurnResult (output)
```

### Step

A Step is a single LLM invocation cycle:

1. Build input messages from `ConversationState`
2. Call LLM with tool catalog
3. If LLM responds with tool calls: execute tools, record results, continue to next Step
4. If LLM responds with text only: Turn is complete

### Middleware integration

Extension middleware wraps each layer:

```
[Turn middleware chain]
  |-- turn.pre
  |-- [Step loop]
  |   |-- [Step middleware chain]
  |   |   |-- step.pre (tool catalog manipulation, etc.)
  |   |   |-- [Core: LLM call]
  |   |   |-- [ToolCall loop]
  |   |   |   |-- [ToolCall middleware chain]
  |   |   |   |   |-- toolCall.pre (input validation)
  |   |   |   |   |-- [Core: tool execution]
  |   |   |   |   |-- toolCall.post (result logging)
  |   |   |-- step.post
  |-- turn.post
```

For a detailed explanation of the middleware pipeline, see [Extension Pipeline](./extension-pipeline.md).

---

## Message event sourcing

Goondan does not mutate a message array in place. Instead, it uses an **event sourcing** model for conversation state:

```
NextMessages = BaseMessages + SUM(Events)
```

| Component | Description |
|-----------|-------------|
| `BaseMessages` | Confirmed message snapshot loaded at Turn start (`messages/base.jsonl`) |
| `Events` | Ordered sequence of `MessageEvent` records accumulated during a Turn (`messages/events.jsonl`) |
| `NextMessages` | Computed result: the actual messages sent to the LLM |

### MessageEvent types

| Type | Effect |
|------|--------|
| `append` | Add a new message at the end |
| `replace` | Swap an existing message (matched by `targetId`) with a new one |
| `remove` | Delete a message by `targetId` |
| `truncate` | Clear all messages |

### Turn lifecycle

1. **Turn start** -- Load `BaseMessages` from `base.jsonl`
2. **During Turn** -- All message changes are recorded as `MessageEvent` entries (LLM outputs, Extension manipulations, tool results)
3. **Turn end** -- Fold: compute `BaseMessages + SUM(Events)`, write as new `base.jsonl`, clear `events.jsonl`

### Why event sourcing?

- **Recovery** -- If a process crashes mid-Turn, un-folded events remain in `events.jsonl`. On restart, the runtime replays `Base + SUM(Events)` to reconstruct the exact state.
- **Observability** -- Every message change is an auditable event.
- **Extension-friendly** -- Extensions manipulate messages by emitting events (e.g., compaction removes old messages and appends a summary), not by mutating arrays directly.
- **Compaction** -- Periodic `events -> base` folding keeps the event log bounded.

---

## Edit & Restart: the configuration change model

Goondan uses an **Edit & Restart** model for configuration changes. There is no hot-reload or live API for configuration updates. Instead:

1. Edit `goondan.yaml` (or individual resource files) directly
2. The Orchestrator detects the change (via `--watch` mode or `gdn restart` command)
3. Affected AgentProcesses receive Graceful Shutdown, then are re-spawned with the new configuration

### What is preserved across restarts

- **Conversation history** -- By default, `base.jsonl` is preserved. The agent picks up where it left off with the new configuration applied.
- **Extension state** -- `extensions/<ext-name>.json` files persist across restarts.

### What changes take effect

- Agent system prompts, model references, tool lists, extension lists
- Swarm-level policies (retry, timeout, maxStepsPerTurn)
- Tool/Extension/Connector entry code (if `--watch` is active)

### Restart triggers

| Trigger | Behavior |
|---------|----------|
| `gdn restart` | Sends a restart signal to the active Orchestrator |
| `--watch` mode | Orchestrator monitors file changes and auto-restarts affected processes |
| Crash detection | Reconciliation Loop re-spawns crashed processes with backoff |
| Self-restart signal | An agent's tool (e.g., `self-restart`) emits a restart request; the Orchestrator performs a controlled shutdown/re-spawn cycle |

---

## Connector and Connection processes

Connectors run as **separate Bun processes** managed by the Orchestrator, just like AgentProcesses. The key difference is that Connectors _receive_ external events (they run an HTTP server, poll an API, manage a WebSocket, etc.) while Agents _process_ events.

### Connector process characteristics

- Spawned and supervised by the Orchestrator
- Manages its own protocol implementation (HTTP, WebSocket, polling, cron)
- Emits normalized `ConnectorEvent` objects to the Orchestrator via IPC
- Crash-isolated: a connector crash does not affect agents

### Connection: the routing layer

A Connection binds a Connector to the Swarm by defining:
- **config/secrets** -- Runtime settings and credentials passed to the Connector
- **ingress rules** -- Routing rules that determine which Agent receives each event, based on event name and properties
- **signature verification** -- Optional inbound request verification

The Orchestrator applies Connection ingress rules to each `ConnectorEvent` to determine the target Agent and `instanceKey`, then delivers the event as an `AgentEvent`.

---

## Summary: how it all fits together

```
[External World]
      |
      v
ConnectorProcess (protocol handling)
      |  ConnectorEvent via IPC
      v
Orchestrator
  |-- Connection ingress rules -> target Agent + instanceKey
  |-- Reconciliation Loop: desired vs. actual state
  |-- IPC routing (event / shutdown / shutdown_ack)
      |
      v
AgentProcess (isolated Bun process)
  |-- Event queue (FIFO, serial)
  |-- Turn
  |     |-- Step loop (LLM call + tool execution)
  |     |-- Middleware pipeline (turn / step / toolCall)
  |     |-- Message event sourcing (base + events -> next)
  |     |-- Fold events -> base on Turn end
  |-- Graceful Shutdown on signal
```

This architecture achieves:
- **Crash isolation** through Process-per-Agent
- **Self-healing** through the Reconciliation Loop
- **Data safety** through event sourcing and Graceful Shutdown
- **Simplicity** through declarative configuration and Edit & Restart
- **Extensibility** through the middleware pipeline

---

## Cross-references

- [How to: Run a Swarm](../how-to/run-a-swarm.md) -- Practical commands for launching, restarting, and managing swarm instances
- [CLI Reference](../reference/cli-reference.md) -- Full reference for `gdn run`, `gdn restart`, `gdn instance`, and `gdn logs`
- [Extension Pipeline](./extension-pipeline.md) -- Deep dive into the middleware onion model and ConversationState
- [Core Concepts](./core-concepts.md) -- Resource Kinds, ObjectRef, instanceKey, and the declarative config model

For the authoritative specification, see `docs/specs/runtime.md`.

---

_Wiki version: v0.0.3_
