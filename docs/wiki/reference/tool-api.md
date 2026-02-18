# Tool API Reference

> TypeScript interfaces for building custom tools in Goondan.

[Korean version (한국어)](./tool-api.ko.md)

**See also:**

- [Tool System (Explanation)](../explanation/tool-system.md) -- design rationale and architecture
- [Write a Tool (How-to)](../how-to/write-a-tool.md) -- production checklist
- [Build Your First Tool (Tutorial)](../tutorials/02-build-your-first-tool.md) -- step-by-step guide

---

## Overview

A Tool is a first-class execution unit that an LLM can invoke via tool calls. Tools are loaded into an AgentProcess (Bun) and executed as in-process JavaScript function calls. This document covers the core TypeScript interfaces that Tool makers need to implement.

---

## ToolHandler

The function signature that every tool export must implement.

```typescript
type ToolHandler = (
  ctx: ToolContext,
  input: JsonObject
) => Promise<JsonValue> | JsonValue;
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | [`ToolContext`](#toolcontext) | Execution context providing workspace path, logger, runtime APIs, and metadata about the current tool call |
| `input` | `JsonObject` | Arguments passed by the LLM, matching the JSON Schema defined in `spec.exports[].parameters` |

### Return value

The handler must return a `JsonValue` (or a `Promise<JsonValue>`). The returned value is serialized and delivered to the LLM as the tool call result.

If the handler throws an error, the runtime catches it and converts it into a structured [`ToolCallResult`](#toolcallresult) with `status: "error"` -- the error is never propagated as an exception to the LLM.

### Handler module format

A tool entry module must export a `handlers` map. Each key corresponds to an export name declared in the Tool resource's `spec.exports`.

```typescript
// tools/my-tool/index.ts
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/types';
// Note: ToolContext.runtime (AgentToolRuntime) is NOT part of @goondan/types.
// The Runtime injects the `runtime` field into ToolContext at execution time.
// Your handler can safely access ctx.runtime when it is available (optional).

export const handlers: Record<string, ToolHandler> = {
  doSomething: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    // implementation
    return { result: 'done' };
  },
};
```

The LLM-facing tool name follows the **double-underscore naming convention**: `{Tool resource name}__{export name}`. For example, if the Tool resource is named `my-tool` and the export is `doSomething`, the LLM sees `my-tool__doSomething`.

---

## ToolContext

The execution context passed to every `ToolHandler` invocation. `ToolContext` extends `ExecutionContext`.

### ExecutionContext (base)

```typescript
interface ExecutionContext {
  readonly agentName: string;
  readonly instanceKey: string;
  readonly turnId: string;
  readonly traceId: string;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `agentName` | `string` | Name of the Agent resource executing this tool |
| `instanceKey` | `string` | Unique key identifying the agent instance (e.g., `"telegram:12345"`) |
| `turnId` | `string` | Unique ID for the current turn |
| `traceId` | `string` | Distributed trace ID for observability |

### ToolContext properties

```typescript
interface ToolContext extends ExecutionContext {
  readonly toolCallId: string;
  readonly message: Message;
  readonly workdir: string;
  readonly logger: Console;
  readonly runtime?: AgentToolRuntime;
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `toolCallId` | `string` | Yes | Unique ID for this specific tool call |
| `message` | `Message` | Yes | The assistant message that contains this tool call |
| `workdir` | `string` | Yes | Instance workspace directory path. File-system tools (bash, file-system, etc.) must use this as their default working directory |
| `logger` | `Console` | Yes | Structured logger (`Console` interface) for diagnostic output |
| `runtime` | [`AgentToolRuntime`](#agenttoolruntime) | No | Inter-agent communication API. **Not defined in `@goondan/types`** -- the Runtime injects this field into `ToolContext` at execution time. Available when the tool needs to interact with other agents in the swarm |

### ToolContext rules

1. `workdir` must point to the instance's workspace path (MUST).
2. Tools that access the file system must use `ctx.workdir` as the default working directory (MUST).
3. `ToolContext` must not include non-owned interfaces such as `swarmBundle` or `oauth` (MUST NOT).
4. `message` must reference the assistant Message that contains the current tool call (MUST).

---

## AgentToolRuntime

The inter-agent communication API available via `ctx.runtime`. It provides five methods for communicating with other agents in the swarm.

```typescript
interface AgentToolRuntime {
  request(
    target: string,
    event: AgentEvent,
    options?: AgentRuntimeRequestOptions
  ): Promise<AgentRuntimeRequestResult>;

  send(
    target: string,
    event: AgentEvent
  ): Promise<AgentRuntimeSendResult>;

  spawn(
    target: string,
    options?: AgentRuntimeSpawnOptions
  ): Promise<AgentRuntimeSpawnResult>;

  list(
    options?: AgentRuntimeListOptions
  ): Promise<AgentRuntimeListResult>;

  catalog(): Promise<AgentRuntimeCatalogResult>;
}
```

### request(target, event, options?)

Sends a synchronous request to another agent and waits for the response (request-response pattern).

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | Target agent name (e.g., `"coder"`) |
| `event` | `AgentEvent` | Event payload containing the input message |
| `options` | `AgentRuntimeRequestOptions` | Optional. `{ timeoutMs?: number }` |

**Returns:** `Promise<AgentRuntimeRequestResult>`

```typescript
interface AgentRuntimeRequestResult {
  eventId: string;        // ID of the response event
  target: string;         // Target agent name
  response?: JsonValue;   // Response payload from the target agent
  correlationId: string;  // Correlation ID for trace matching
}
```

If the target agent does not exist, the Orchestrator automatically spawns it before delivering the event.

### send(target, event)

Sends a fire-and-forget message to another agent (no response expected).

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | Target agent name |
| `event` | `AgentEvent` | Event payload containing the input message |

**Returns:** `Promise<AgentRuntimeSendResult>`

```typescript
interface AgentRuntimeSendResult {
  eventId: string;   // ID of the sent event
  target: string;    // Target agent name
  accepted: boolean; // Whether the event was accepted for delivery
}
```

### spawn(target, options?)

Prepares (spawns) a new instance of a defined Agent resource. This does not create a new Agent resource -- it prepares an instance of an existing one.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string` | Target agent name (must be defined in the current Swarm) |
| `options` | `AgentRuntimeSpawnOptions` | Optional. `{ instanceKey?: string, cwd?: string }` |

**Returns:** `Promise<AgentRuntimeSpawnResult>`

```typescript
interface AgentRuntimeSpawnResult {
  target: string;       // Target agent name
  instanceKey: string;  // Resolved instance key
  spawned: boolean;     // true if a new instance was created; false if reused
  cwd?: string;         // Working directory, if specified
}
```

**Rules:**

- `target` must be an Agent resource defined in the current Swarm (MUST).
- `spawn` must not modify the Agent resource definition at runtime (MUST NOT).
- If an instance with the same `instanceKey` already exists, it is reused.

### list(options?)

Returns a list of agent instances.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `AgentRuntimeListOptions` | Optional. `{ includeAll?: boolean }` |

**Returns:** `Promise<AgentRuntimeListResult>`

```typescript
interface AgentRuntimeListResult {
  agents: SpawnedAgentInfo[];
}

interface SpawnedAgentInfo {
  target: string;           // Agent resource name
  instanceKey: string;      // Instance key
  ownerAgent: string;       // Agent that spawned this instance
  ownerInstanceKey: string; // Instance key of the owner
  createdAt: string;        // ISO timestamp
  cwd?: string;             // Working directory, if set
}
```

By default, `list()` returns only instances spawned by the calling agent. Set `includeAll: true` to list all instances in the swarm.

### catalog()

Returns the available agent catalog for the current Swarm.

**Returns:** `Promise<AgentRuntimeCatalogResult>`

```typescript
interface AgentRuntimeCatalogResult {
  swarmName: string;         // Current Swarm name
  entryAgent: string;        // The swarm's entry agent
  selfAgent: string;         // The calling agent's name
  availableAgents: string[]; // All agent names defined in the swarm
  callableAgents: string[];  // Agents that the calling agent can communicate with
}
```

---

## ToolCallResult

The structured result of a tool call execution.

```typescript
interface ToolCallResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: JsonValue;
  readonly status: 'ok' | 'error';
  readonly error?: ToolCallResultError;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `toolCallId` | `string` | Unique ID of the tool call (matches `ToolContext.toolCallId`) |
| `toolName` | `string` | Full tool name (e.g., `"bash__exec"`) |
| `output` | `JsonValue` | The return value of the handler on success |
| `status` | `'ok' \| 'error'` | Whether the call succeeded or failed |
| `error` | `ToolCallResultError` | Error details when `status` is `'error'` |

### ToolCallResultError

```typescript
interface ToolCallResultError {
  readonly name?: string;      // Error type name (e.g., "TypeError")
  readonly message: string;    // Error message (truncated to errorMessageLimit)
  readonly code?: string;      // Machine-readable error code (e.g., "E_TOOL")
  readonly suggestion?: string; // Actionable recovery suggestion for the LLM
  readonly helpUrl?: string;   // Link to relevant documentation
}
```

**Error handling rules:**

1. Tool execution errors must be returned as `ToolCallResult` with `status: "error"`, not thrown as exceptions (MUST).
2. `error.message` length is capped by `Tool.spec.errorMessageLimit` (default: 1000 characters) (MUST).
3. Providing a `suggestion` field is recommended to help the LLM recover (SHOULD).
4. Providing a `helpUrl` field is recommended for documentation links (SHOULD).

---

## Tool resource spec.parameters

Each tool export declares its parameters using JSON Schema in the Tool resource YAML.

### ToolExportSpec

```typescript
interface ToolExportSpec {
  /** Export name (used as "{resourceName}__{name}" in LLM tool calls) */
  name: string;

  /** Description shown to the LLM */
  description?: string;

  /** JSON Schema defining the parameters */
  parameters?: JsonSchemaObject;
}
```

### JSON Schema format

```typescript
interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  items?: JsonSchemaProperty;
  default?: JsonValue;
}
```

### YAML example

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: my-tool
spec:
  entry: "./tools/my-tool/index.ts"
  errorMessageLimit: 1200
  exports:
    - name: search
      description: "Search for items by query"
      parameters:
        type: object
        properties:
          query:
            type: string
            description: "Search query string"
          limit:
            type: number
            description: "Maximum number of results (default: 10)"
        required: [query]
```

The full Tool resource schema is documented in the [Resources Reference](./resources.md).

---

## Supporting types

### Json types

```typescript
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
```

### Message

```typescript
interface Message {
  readonly id: string;
  readonly data: CoreMessage;       // AI SDK CoreMessage wrapper
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

---

## Minimal tool example

A complete minimal tool that converts text to uppercase:

**goondan.yaml (Tool resource)**

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: text-utils
spec:
  entry: "./tools/text-utils/index.ts"
  exports:
    - name: uppercase
      description: "Convert text to uppercase"
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "Text to convert"
        required: [text]
```

**tools/text-utils/index.ts**

```typescript
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';
// Note: ctx.runtime (AgentToolRuntime) is injected by the Runtime, not imported from @goondan/types.

export const handlers: Record<string, ToolHandler> = {
  uppercase: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text);
    ctx.logger.info(`Converting "${text}" to uppercase`);
    return { result: text.toUpperCase() };
  },
};
```

The LLM will see this tool as `text-utils__uppercase`.

---

## Related documents

| Document | Relationship |
|----------|-------------|
| [Tool System (Explanation)](../explanation/tool-system.md) | Design rationale: why double-underscore naming, Registry vs Catalog, error propagation model |
| [Write a Tool (How-to)](../how-to/write-a-tool.md) | Production checklist: validation, testing, error handling best practices |
| [Build Your First Tool (Tutorial)](../tutorials/02-build-your-first-tool.md) | Step-by-step tutorial for first-time Tool makers |
| [Built-in Tools](./builtin-tools.md) | Catalog of `@goondan/base` tools with parameter details |
| [Resources Reference](./resources.md) | Full YAML schema for `kind: Tool` |
| [Extension API Reference](./extension-api.md) | Dynamic tool registration via `api.tools.register()` |

---

_Reference version: v0.0.3_
