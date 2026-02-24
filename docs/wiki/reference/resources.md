# Resource YAML Reference

> **apiVersion: `goondan.ai/v1`** -- 8 resource Kinds for declarative agent swarm configuration

[Korean version (한국어)](./resources.ko.md)

---

## Common resource structure

Every Goondan resource follows a uniform four-field structure:

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
  labels: {}          # optional
  annotations: {}     # optional
spec:
  # Kind-specific schema
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `apiVersion` | MUST | `string` | Always `goondan.ai/v1` |
| `kind` | MUST | `string` | One of 8 known Kinds (see below) |
| `metadata.name` | MUST | `string` | Unique within the same Kind. Lowercase letters, digits, hyphens; must start with a letter; max 63 chars recommended |
| `metadata.labels` | optional | `Record<string, string>` | Reserved for future use; currently for documentation |
| `metadata.annotations` | optional | `Record<string, string>` | Arbitrary metadata; does not affect runtime behavior |
| `spec` | MUST | `object` | Kind-specific configuration (see sections below) |

### Supported Kinds

| Kind | Role |
|------|------|
| [Model](#model) | LLM provider settings |
| [Agent](#agent) | Agent definition (model, prompt, tools, extensions) |
| [Swarm](#swarm) | Agent group + execution policy |
| [Tool](#tool) | Function callable by LLM |
| [Extension](#extension) | Lifecycle middleware interceptor |
| [Connector](#connector) | External protocol receiver (separate process) |
| [Connection](#connection) | Connector-to-Swarm binding |
| [Package](#package) | Project manifest / distribution unit |

> For a conceptual introduction to Kinds and the declarative config model, see [Core Concepts](../explanation/core-concepts.md).

---

## ObjectRef

ObjectRef is the pattern used to reference one resource from another.

### String shorthand (recommended)

```yaml
modelRef: "Model/claude"
toolRef: "Tool/bash"
agentRef: "Agent/coder"
```

Format: `Kind/name`. Must contain exactly one `/`.

### Object form

```yaml
modelRef:
  kind: Model
  name: claude

# Cross-package reference
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `kind` | MUST | `string` | Resource Kind |
| `name` | MUST | `string` | Resource name |
| `package` | optional | `string` | Package scope (for cross-package references) |
| `apiVersion` | optional | `string` | API version constraint |

### RefItem wrapper

In arrays (e.g., `tools`, `agents`, `extensions`), references are wrapped with a `ref` key:

```yaml
tools:
  - ref: "Tool/bash"
  - ref: "Tool/file-system"
```

### Rules

- The referenced resource MUST exist; otherwise validation fails.
- Zero or more than one `/` in the string form is a validation error.

---

## ValueSource

ValueSource injects configuration values from different sources, keeping secrets out of YAML files.

### Literal value

```yaml
apiKey:
  value: "plain-text-value"
```

### Environment variable (recommended)

```yaml
apiKey:
  valueFrom:
    env: "ANTHROPIC_API_KEY"
```

### Secret store reference

```yaml
clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/slack-oauth"
      key: "client_secret"
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `value` | mutually exclusive with `valueFrom` | `string` | Direct literal value |
| `valueFrom.env` | mutually exclusive with `secretRef` | `string` | Environment variable name |
| `valueFrom.secretRef.ref` | MUST | `string` | `"Secret/<name>"` format |
| `valueFrom.secretRef.key` | MUST | `string` | Key within the secret |

### Rules

- `value` and `valueFrom` MUST NOT coexist.
- Within `valueFrom`, `env` and `secretRef` MUST NOT coexist.
- Sensitive values SHOULD use `valueFrom` rather than `value`.

---

## Model

Model defines LLM provider settings. The runtime abstracts provider differences behind a common call interface.

```yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `provider` | MUST | `string` | -- | LLM provider (`anthropic`, `openai`, `google`, etc.) |
| `model` | MUST | `string` | -- | Model name (e.g., `claude-sonnet-4-20250514`, `gpt-5`) |
| `apiKey` | optional | [ValueSource](#valuesource) | -- | API key for authentication |
| `endpoint` | optional | `string` | -- | Custom endpoint URL |
| `options` | optional | `Record<string, unknown>` | -- | Provider-specific extra options |
| `capabilities` | optional | `ModelCapabilities` | -- | Feature flags (see below) |

### `capabilities` fields

| Field | Type | Description |
|-------|------|-------------|
| `streaming` | `boolean` | Whether the model supports streaming responses |
| `toolCalling` | `boolean` | Whether the model supports tool calling |
| `[key]` | `boolean` | Extensible capability flags |

### Extended example

```yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: gpt
  labels:
    provider: openai
spec:
  provider: openai
  model: gpt-5
  apiKey:
    valueFrom:
      env: OPENAI_API_KEY
  endpoint: "https://api.openai.com/v1"
  options:
    organization: "org-xxxxx"
  capabilities:
    streaming: true
    toolCalling: true
```

---

## Agent

Agent is the central resource that configures agent execution -- which model to use, what system prompt to follow, which tools and extensions to load.

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
    params:
      temperature: 0.5
  prompt:
    system: |
      You are a coding assistant.
  tools:
    - ref: "Tool/bash"
    - ref: "Tool/file-system"
  extensions:
    - ref: "Extension/logging"
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `modelConfig` | MUST | `AgentModelConfig` | -- | Model configuration (see below) |
| `prompt` | optional | `AgentPrompt` | -- | Optional prompt configuration (see below) |
| `tools` | optional | `RefItem[]` | `[]` | Tool references to make available to this agent |
| `requiredTools` | optional | `string[]` | `[]` | Tool names that MUST be called (with success) before turn ends |
| `extensions` | optional | `RefItem[]` | `[]` | Extension references to load for this agent |

### `modelConfig` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `modelRef` | MUST | [ObjectRefLike](#objectref) | -- | Reference to a Model resource |
| `params.temperature` | optional | `number` | -- | Sampling temperature (0.0 -- 2.0) |
| `params.maxTokens` | optional | `number` | -- | Maximum output tokens |
| `params.topP` | optional | `number` | -- | Top-P sampling |
| `params.[key]` | optional | `unknown` | -- | Additional model parameters |

### `prompt` fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `system` | optional | `string` | Inline system prompt hint |
| `systemRef` | optional | `string` | File path to system prompt (relative to Bundle Root) |

`system` and `systemRef` are mutually exclusive. If both are present, YAML validation fails.

### Rules
- `prompt` is optional. If omitted, runtime continues in pure harness mode without `ctx.runtime.agent.prompt`.
- The runtime core does not assemble or auto-inject system prompts by itself.
- Runtime resolves `prompt.systemRef` and exposes only materialized `ctx.runtime.agent.prompt.system` to extensions.
- Message composition is performed by extensions such as `context-message`, which read `ctx.runtime.agent` / `ctx.runtime.swarm` / `ctx.runtime.inbound` / `ctx.runtime.call` and append message events.

- `requiredTools` entries refer to the full tool name (e.g., `channel-dispatch__send`).
- `requiredTools` satisfaction is evaluated per turn; successful calls from a previous turn never satisfy the current turn.
- `requiredTools` is bounded by `policy.maxStepsPerTurn` -- if the step limit is reached before a required tool succeeds, the turn ends regardless.
- There is no `hooks` field on Agent. All lifecycle interception is done via Extension middleware.

---

## Swarm

Swarm defines a group of agents and the execution policy that governs them.

```yaml
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
    - ref: "Agent/reviewer"
  policy:
    maxStepsPerTurn: 32
    shutdown:
      gracePeriodSeconds: 300
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `entryAgent` | MUST | [ObjectRefLike](#objectref) | -- | Default agent that receives inbound events |
| `agents` | MUST | `RefItem[]` | -- | Agent references (min 1) |
| `instanceKey` | optional | `string` | `metadata.name` | Orchestrator instance identifier |
| `policy` | optional | `SwarmPolicy` | -- | Execution policy (see below) |

### `policy` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `maxStepsPerTurn` | optional | `number` | `32` | Maximum steps per turn; forces turn end when reached |
| `lifecycle.ttlSeconds` | optional | `number` | -- | Instance max lifetime (seconds) |
| `lifecycle.gcGraceSeconds` | optional | `number` | -- | GC grace period (seconds) |
| `shutdown.gracePeriodSeconds` | optional | `number` | `300` | Graceful shutdown timeout (seconds) |

### Rules

- `entryAgent` MUST reference an agent listed in `agents`.
- If `instanceKey` is omitted, the runtime uses `metadata.name` as the instance identifier.
- `policy` only supports `maxStepsPerTurn`, `lifecycle`, and `shutdown` sub-fields.

> See [Runtime Model](../explanation/runtime-model.md) for how Orchestrator uses Swarm policy.

---

## Tool

Tool defines a function that the LLM can invoke. Tools run inside the AgentProcess (Bun). Each Tool resource can export multiple sub-tools via the `exports` array.

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

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `entry` | MUST | `string` | -- | Entry file path (relative to Bundle Root) |
| `errorMessageLimit` | optional | `number` | `1000` | Max characters in error messages returned to LLM |
| `exports` | MUST | `ToolExportSpec[]` | -- | Sub-tool declarations (min 1) |

### `exports[]` fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | MUST | `string` | Sub-tool name; unique within this Tool resource |
| `description` | MUST | `string` | Description shown to the LLM |
| `parameters` | MUST | JSON Schema `object` | Parameter schema for the sub-tool |

### Tool naming convention

The LLM sees tools as **`{Tool name}__{export name}`** (double underscore):

```
Tool: bash       ->  exports: exec, script
LLM tool names:  bash__exec,  bash__script
```

### Rules

- Tool resource names and export names MUST NOT contain `__`.
- `exports[].name` MUST be unique within the Tool resource.
- Entry module MUST export `handlers: Record<string, ToolHandler>`.

> See [Tool System](../explanation/tool-system.md) for architecture details and [Tool API](./tool-api.md) for the `ToolHandler` / `ToolContext` interfaces.

---

## Extension

Extension defines a lifecycle middleware interceptor. Extensions run inside the AgentProcess (Bun).

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: logging
spec:
  entry: "./extensions/logging/index.ts"
  config:
    level: info
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `entry` | MUST | `string` | -- | Entry file path (relative to Bundle Root) |
| `config` | optional | `Record<string, unknown>` | -- | Extension-specific configuration (free-form) |

### Entry module contract

The entry module MUST export a `register(api: ExtensionApi)` function:

```typescript
export function register(api: ExtensionApi): void {
  api.pipeline.register('turn', async (ctx) => {
    const result = await ctx.next();
    return result;
  });
}
```

### Rules

- There is no `runtime` field. Extensions always run in Bun.
- Extensions MAY register `turn`, `step`, and `toolCall` middleware via `api.pipeline.register()`.
- Extensions MAY dynamically register tools via `api.tools.register()`.
- Extensions MAY persist JSON state via `api.state.get()` / `api.state.set()`.

> See [Extension Pipeline](../explanation/extension-pipeline.md) for architecture details and [Extension API](./extension-api.md) for the `ExtensionApi` interface.

---

## Connector

Connector defines an independent process that receives external protocol events and emits normalized `ConnectorEvent`s to the Orchestrator. Connectors manage their own protocol handling (HTTP server, WebSocket, polling, cron, etc.).

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: telegram
spec:
  entry: "./connectors/telegram/index.ts"
  events:
    - name: user_message
      properties:
        chat_id: { type: string }
    - name: command
      properties:
        chat_id: { type: string }
        command: { type: string }
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `entry` | MUST | `string` | -- | Entry file path (relative to Bundle Root) |
| `events` | MUST | `EventSchema[]` | -- | Event schemas the connector can emit (min 1) |

### `events[]` fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | MUST | `string` | Event name; unique within this Connector |
| `properties` | optional | `Record<string, { type: string }>` | Event property type declarations |

### Entry module contract

The entry module MUST provide a single default export function:

```typescript
export default async function (ctx: ConnectorContext): Promise<void> {
  const { emit, config, secrets, logger } = ctx;

  Bun.serve({
    port: Number(config.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();
      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.message.text },
        properties: { chat_id: String(body.message.chat.id) },
        instanceKey: `telegram:${body.message.chat.id}`,
      });
      return new Response('OK');
    },
  });
}
```

### Rules

- There is no `runtime` or `triggers` field. Connectors always run as separate Bun processes and manage their own protocol handling.
- `events[].name` MUST be unique within the Connector.
- `ConnectorEvent` MUST include `instanceKey` so the Orchestrator can route to the correct AgentProcess.
- Connectors SHOULD perform signature verification using secrets provided by the Connection.

> See [Connector API](./connector-api.md) for the `ConnectorContext` and `ConnectorEvent` interfaces.

---

## Connection

Connection binds a Connector to a Swarm, providing configuration, secrets, and ingress routing rules.

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-to-swarm
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  config:
    PORT:
      valueFrom:
        env: TELEGRAM_WEBHOOK_PORT
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `connectorRef` | MUST | [ObjectRefLike](#objectref) | -- | Reference to a Connector resource |
| `swarmRef` | optional | [ObjectRefLike](#objectref) | first Swarm in bundle | Reference to a Swarm resource |
| `config` | optional | `Record<string, ValueSource>` | -- | Non-sensitive settings passed to the Connector |
| `secrets` | optional | `Record<string, ValueSource>` | -- | Sensitive values passed to the Connector (tokens, signing secrets) |
| `ingress` | optional | `IngressConfig` | -- | Routing rules (see below) |

### `ingress.rules[]` fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `match.event` | SHOULD | `string` | Event name (should match one of `Connector.spec.events[].name`) |
| `match.properties` | optional | `Record<string, string>` | Property-based matching (AND with `event`) |
| `route.agentRef` | optional | [ObjectRefLike](#objectref) | Target agent; defaults to Swarm's `entryAgent` |
| `route.instanceKey` | optional | `string` | Force a specific conversation instanceKey |
| `route.instanceKeyProperty` | optional | `string` | Read instanceKey from event properties |
| `route.instanceKeyPrefix` | optional | `string` | Prefix when using `instanceKeyProperty` |

### Rules

- `route.instanceKey` and `route.instanceKeyProperty` MUST NOT coexist on the same rule.
- If `route.agentRef` is omitted, events are routed to the Swarm's `entryAgent`.
- If `match` is omitted entirely, the rule acts as a catch-all.
- Rules are evaluated in order; the first match wins.
- OAuth authentication is handled by Extensions, not Connection.

### Minimal example (CLI)

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: "Connector/cli"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}
```

---

## Package

Package is the top-level project manifest. It declares metadata, version, dependencies, and registry information.

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "1.0.0"
  description: "A coding agent swarm"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
  registry:
    url: "https://goondan-registry.yechanny.workers.dev"
```

### `spec` fields

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `version` | MUST (for publish) | `string` | -- | Semver version string |
| `description` | optional | `string` | -- | Human-readable package description |
| `access` | optional | `string` | `"public"` | `"public"` or `"restricted"` |
| `dependencies` | optional | `PackageDependency[]` | `[]` | Package dependencies (see below) |
| `registry` | optional | `PackageRegistry` | -- | Registry settings (see below) |

### `dependencies[]` fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | MUST | `string` | Package name (may include scope, e.g., `@goondan/base`) |
| `version` | MUST | `string` | Semver range (e.g., `^1.0.0`) |

### `registry` fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `url` | MUST | `string` | Registry URL |

### Position rules

- Package MUST be the **first YAML document** in `goondan.yaml`.
- A second `kind: Package` document in the same file is a validation error.
- At most one Package document per `goondan.yaml`.
- Dependencies MUST form a DAG (no circular references).

---

## Validation summary

### Common rules

| Rule | Level |
|------|-------|
| `apiVersion` must be `goondan.ai/v1` | MUST |
| `kind` must be one of 8 known Kinds | MUST |
| `metadata.name` must be non-empty | MUST |
| `metadata.name` must be unique within the same Kind | MUST |
| Referenced resource (ObjectRef) must exist | MUST |
| `value` and `valueFrom` are mutually exclusive | MUST |
| `secretRef.ref` must follow `Secret/<name>` format | MUST |

### Kind-specific required fields

| Kind | Required fields |
|------|----------------|
| Model | `provider`, `model` |
| Agent | `modelConfig.modelRef` |
| Swarm | `entryAgent`, `agents` (min 1); `entryAgent` must be in `agents` |
| Tool | `entry`, `exports` (min 1) |
| Extension | `entry` |
| Connector | `entry`, `events` (min 1) |
| Connection | `connectorRef` |
| Package | `metadata.name`; first YAML doc only; `version` required for publish |

---

## Related documents

- [Core Concepts](../explanation/core-concepts.md) -- conceptual overview of Kinds, ObjectRef, and instanceKey
- [Tool API Reference](./tool-api.md) -- `ToolHandler`, `ToolContext` interfaces
- [Extension API Reference](./extension-api.md) -- `ExtensionApi` interface
- [Connector API Reference](./connector-api.md) -- `ConnectorContext`, `ConnectorEvent` interfaces
- [CLI Reference](./cli-reference.md) -- `gdn validate`, `gdn run`, and other commands
- Internal specs (SSOT): [resources.md](../../specs/resources.md), [shared-types.md](../../specs/shared-types.md), [bundle.md](../../specs/bundle.md)

---

_Wiki version: v0.0.3_
