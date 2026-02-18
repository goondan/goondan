# Tool System

> **Deep dive into how Goondan's Tool system works and why it is designed this way.**

[Korean version (한국어)](./tool-system.ko.md)

---

## What is a Tool?

A Tool is the fundamental unit of _action_ in Goondan. While agents think and converse through LLM calls, they **do things** through Tools -- executing shell commands, reading files, making HTTP requests, or communicating with other agents. Every time an LLM decides to call a function, it is invoking a Tool.

In Goondan's declarative configuration model, a Tool is a first-class resource (`kind: Tool`) declared in `goondan.yaml`. This means Tools are not hard-coded into agents; they are independently defined, versioned, and composable -- much like containers in Kubernetes.

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
spec:
  entry: "./tools/bash/index.ts"
  exports:
    - name: exec
      description: "Execute a shell command"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
```

---

## The double-underscore naming convention

When a Tool is exposed to an LLM, its functions are named using a **double-underscore** (`__`) convention:

```
{resource name}__{export name}
```

For example, a Tool resource named `bash` with an export named `exec` becomes `bash__exec` in the LLM's tool catalog.

### Why this convention?

This design solves several problems at once:

1. **Resource boundary clarity** -- A single Tool resource can export multiple functions (e.g., `file-system__read`, `file-system__write`). The double underscore makes the grouping immediately visible, both to the LLM and to developers debugging tool calls.

2. **No encoding overhead** -- The `__` separator is a valid character sequence in the Vercel AI SDK's tool naming scheme. Unlike alternatives such as `/` or `.`, it requires no URL encoding, no escaping, and no special parser logic. It just works.

3. **Deterministic parsing** -- Given a full tool name, you can always split on the first `__` to recover the resource name and the export name. This makes routing straightforward:

   ```
   "file-system__read"  -->  resource: "file-system",  export: "read"
   "http-fetch__post"   -->  resource: "http-fetch",   export: "post"
   ```

4. **Collision prevention** -- Tool resource names and export names themselves must not contain `__`. This constraint guarantees that the split is always unambiguous.

Even a Tool with a single export must follow this pattern (e.g., `self-restart__request`). This consistency means the runtime never needs special-case logic for "single-function tools" versus "multi-function tools."

---

## The Tool resource schema

A Tool resource consists of three essential parts:

| Field | Purpose |
|-------|---------|
| `spec.entry` | Path to the JavaScript/TypeScript module that contains the handlers |
| `spec.exports` | Array of functions the Tool exposes to the LLM (name, description, JSON Schema parameters) |
| `spec.errorMessageLimit` | Maximum length of error messages returned to the LLM (default: 1000 characters) |

The `exports` array is critical: it defines the contract between the Tool and the LLM. Each export specifies a `name`, a human-readable `description` (which the LLM uses to decide when to call the tool), and a `parameters` schema in JSON Schema format.

```yaml
spec:
  entry: "./tools/file-system/index.ts"
  exports:
    - name: read
      description: "Read file contents"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: [path]
    - name: write
      description: "Write content to a file"
      parameters:
        type: object
        properties:
          path: { type: string }
          content: { type: string }
        required: [path, content]
```

> For the complete YAML schema, see [Resources reference](../reference/resources.md).

---

## ToolHandler: the implementation contract

The entry module pointed to by `spec.entry` must export a `handlers` object -- a map from export names to handler functions:

```typescript
export const handlers: Record<string, ToolHandler> = {
  read: async (ctx, input) => {
    // ... implementation
    return { content: fileContent };
  },
  write: async (ctx, input) => {
    // ... implementation
    return { written: true };
  },
};
```

Each handler receives two arguments:

- **`ctx`** (`ToolContext`) -- the execution context, providing workspace paths, logging, and inter-agent communication
- **`input`** (`JsonObject`) -- the parameters the LLM passed, conforming to the export's JSON Schema

Handlers return a `JsonValue` (any JSON-serializable value) on success. If an error occurs, the runtime wraps it into a structured `ToolCallResult` with `status: "error"` rather than propagating exceptions. This is a deliberate design choice: instead of crashing the agent, the error is fed back to the LLM so it can attempt recovery on its own.

---

## ToolContext: the execution environment

Every Tool handler receives a `ToolContext` that provides essential runtime services. The context is intentionally kept small -- it contains only what a Tool genuinely needs, avoiding unnecessary coupling to the broader runtime.

### Key fields

| Field | Type | Purpose |
|-------|------|---------|
| `workdir` | `string` | The instance workspace directory. File-system tools (bash, file-system) use this as their default working directory. |
| `logger` | `Console` | Standard logging interface for the tool's output. |
| `runtime` | `AgentToolRuntime` (optional) | Interface for inter-agent communication -- `request`, `send`, `spawn`, `list`, `catalog`. |
| `message` | `Message` | The assistant message that contains the current tool call. |
| `toolCallId` | `string` | Unique identifier for this specific tool invocation. |

### Why is ToolContext minimal?

Earlier designs included fields like `swarmBundle` or `oauth` in the tool context. These were deliberately removed. The principle is that a Tool should only see what it needs to execute its function:

- **`workdir`** gives tools a sandboxed file-system location tied to the conversation instance.
- **`runtime`** is the gateway for inter-agent communication, used primarily by the built-in `agents` tool.
- **`logger`** and **`message`** support observability and context awareness.

Anything beyond this (authentication, bundle access, configuration) belongs in Extensions or Connections, not in the Tool itself. This separation keeps Tools simple, testable, and reusable.

> For full API signatures, see [Tool API reference](../reference/tool-api.md).

---

## How a Tool executes inside AgentProcess

Understanding where and how Tools run is key to understanding Goondan's architecture. Tools do **not** run in a separate process. They execute inside the **AgentProcess** -- the same Bun process that runs the agent's LLM loop.

Here is the execution flow:

```
LLM response includes tool_calls
         |
         v
+---------------------------------------------+
|  AgentProcess (Bun)                          |
|                                              |
|  1. toolCall middleware chain (before)        |
|     - Extensions can validate/transform input|
|                                              |
|  2. ToolRegistry lookup                      |
|     - Find handler by "resource__export"     |
|                                              |
|  3. import(spec.entry) + resolve handler     |
|     - Module loaded into the same process    |
|                                              |
|  4. handler(ctx, input)                      |
|     - Direct JS function call, no IPC        |
|                                              |
|  5. toolCall middleware chain (after)         |
|     - Extensions can transform/log result    |
|                                              |
+---------------------------------------------+
         |
         v
   ToolCallResult  -->  fed back to LLM
```

### Why in-process execution?

Running Tools inside AgentProcess (rather than as separate processes) was a deliberate trade-off:

- **Low latency** -- A tool call is just a JavaScript function call. There is no process spawn overhead, no serialization/deserialization of the payload, and no IPC round-trip.
- **Shared context** -- The tool has direct access to the agent's workspace, loaded modules, and runtime context without marshaling data across process boundaries.
- **Simplicity** -- Tool authors write plain functions. They do not need to implement a server, parse messages, or handle a communication protocol.

The downside is that a misbehaving tool (infinite loop, memory leak) can affect its host AgentProcess. However, because each agent runs in its own Bun process (the Process-per-Agent model), the blast radius is contained to a single agent. The Orchestrator detects the crash and can automatically re-spawn the process.

> For more on the Process-per-Agent model, see [Runtime Model](./runtime-model.md).

---

## Tool Registry vs. Tool Catalog

Goondan distinguishes between two collections of tools:

```
+----------------------------------------------+
|              Tool Registry                    |
|  All executable tools in the AgentProcess:   |
|  - Tools from goondan.yaml (spec.tools)      |
|  - Dynamically registered tools (Extensions) |
|  - MCP-bridged tools                         |
+----------------------------------------------+
              |
              |  step middleware filters
              v
+----------------------------------------------+
|          Tool Catalog (per Step)              |
|  The subset of tools visible to the LLM      |
|  in the current Step.                         |
+----------------------------------------------+
```

- **Tool Registry** is the full set of tool handlers available in the process. It is populated at initialization from the bundle's Tool resources and from Extensions that call `api.tools.register()`.

- **Tool Catalog** is the per-Step subset that is actually sent to the LLM. Each time a new Step begins, the catalog is rebuilt from the agent's `spec.tools` declaration. Step middleware can then add or remove entries from `ctx.toolCatalog`.

This separation enables powerful patterns:

- **Dynamic tool filtering** -- An extension can hide tools the agent does not need for the current task, reducing the LLM's decision space.
- **Tool search** -- A meta-tool lets the LLM discover and select tools for the next step, keeping the catalog focused.
- **Security boundaries** -- The catalog acts as an allow-list. If a tool is not in the catalog, the LLM cannot call it (the call is rejected with a structured error).

---

## Error handling philosophy

When a Tool throws an exception, Goondan does **not** let it propagate up the call stack and crash the agent. Instead, the runtime catches the error and wraps it into a structured `ToolCallResult`:

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL",
    "name": "Error",
    "message": "File not found: /workspace/missing.txt",
    "suggestion": "Check that the file path is correct.",
    "helpUrl": "https://docs.goondan.ai/errors/E_TOOL"
  }
}
```

This result is fed back to the LLM as the tool's response. The LLM can then decide to retry with different parameters, try an alternative approach, or report the issue to the user.

Key details:
- Error messages are truncated to `spec.errorMessageLimit` (default: 1000 characters) to avoid consuming excessive LLM context.
- The `suggestion` and `helpUrl` fields help both the LLM and human operators diagnose issues.
- A tool call to a name that is not in the current catalog returns a specific error code (`E_TOOL_NOT_IN_CATALOG`).

---

## Built-in Tools

The `@goondan/base` package ships a set of ready-to-use Tools that cover common agent needs:

| Tool | Exports | Purpose |
|------|---------|---------|
| **bash** | `exec`, `script` | Execute shell commands and scripts |
| **file-system** | `read`, `write` | Read and write files in the workspace |
| **http-fetch** | `get`, `post` | Make HTTP requests (SSRF-safe: http/https only) |
| **json-query** | `query` | Query and transform JSON data |
| **text-transform** | `transform` | Text manipulation utilities |
| **agents** | `request`, `send`, `spawn`, `list`, `catalog` | Inter-agent communication |
| **self-restart** | `request` | Signal the runtime to restart the orchestrator |
| **telegram** | `send`, `edit`, `delete`, `react`, `setChatAction`, `downloadFile` | Telegram Bot API operations |
| **slack** | `send`, `read`, `edit`, `delete`, `react`, `downloadFile` | Slack API operations |

These tools follow the same `handlers` export pattern as any custom tool. You reference them in your agent's `spec.tools` via an ObjectRef to the `@goondan/base` package:

```yaml
kind: Agent
spec:
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
```

The `agents` tool is especially noteworthy -- it is the primary mechanism for inter-agent communication, bridging to the Orchestrator's IPC system through `ToolContext.runtime`.

> For detailed parameter schemas and usage examples, see [Built-in Tools reference](../reference/builtin-tools.md).

---

## How Extensions interact with Tools

Extensions and Tools have a clearly defined relationship through the **toolCall middleware**. When an LLM returns a tool call, it does not go directly to the handler. Instead, it passes through a middleware chain that Extensions can hook into:

```
LLM returns tool_call
        |
        v
  Extension A (before next)  -- e.g., log the call
    Extension B (before next) -- e.g., validate input
      Core handler execution  -- the actual tool runs
    Extension B (after next)  -- e.g., transform result
  Extension A (after next)    -- e.g., measure duration
        |
        v
  ToolCallResult returned to LLM
```

This is the classic onion model: each middleware wraps around the next, with `ctx.next()` passing control inward to the core handler and then back outward through the layers.

### What Extensions can do with Tool calls

- **Input validation/transformation** -- Modify `ctx.args` before the tool runs
- **Output transformation** -- Alter the result after the tool completes
- **Logging and observability** -- Record timing, arguments, and results
- **Access control** -- Block certain tool calls based on policy
- **Error decoration** -- Add `suggestion` or `helpUrl` to tool errors

### What Extensions cannot do

Extensions interact with the tool layer exclusively through the `toolCall` middleware. They cannot:
- Directly modify the Tool Registry
- Replace a tool's handler at runtime (they can intercept and override via middleware, but the registry entry itself is immutable)
- Access the tool's internal module state

Extensions can also register entirely new tools dynamically via `api.tools.register()`, but this operates at the catalog level -- it adds a new entry to the Tool Registry, not modifying an existing one.

> For the Extension middleware model in depth, see [Extension Pipeline](./extension-pipeline.md).

---

## Design summary

The Tool system in Goondan is built on a few deliberate design principles:

| Principle | Implementation |
|-----------|---------------|
| **Declarative over imperative** | Tools are YAML resources, not hard-coded into agents |
| **Explicit naming** | Double-underscore convention prevents ambiguity and requires no encoding |
| **In-process execution** | Tools run inside AgentProcess for low latency and simplicity |
| **Error as data** | Exceptions become structured results that the LLM can reason about |
| **Registry/Catalog separation** | Full tool set vs. per-step visible set enables dynamic filtering |
| **Minimal context** | ToolContext provides only what Tools need, keeping them decoupled |
| **Middleware interception** | Extensions wrap tool execution without modifying tool internals |

These choices reflect Goondan's broader philosophy: give agents the tools they need to act in the world, while keeping the system predictable, observable, and safe.

---

## Further reading

- [Build Your First Tool (Tutorial)](../tutorials/02-build-your-first-tool.md) -- Step-by-step guide to creating a custom tool
- [Write a Tool (How-to)](../how-to/write-a-tool.md) -- Production checklist for tool authors
- [Tool API Reference](../reference/tool-api.md) -- Complete `ToolHandler`, `ToolContext`, and `ToolCallResult` API
- [Built-in Tools Reference](../reference/builtin-tools.md) -- Parameter schemas and examples for `@goondan/base` tools
- [Extension Pipeline](./extension-pipeline.md) -- How `toolCall` middleware wraps tool execution
- [Runtime Model](./runtime-model.md) -- Process-per-Agent architecture and IPC

---

_Wiki version: v0.0.3_
