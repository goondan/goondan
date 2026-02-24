# Core Concepts

> Understanding Goondan's declarative configuration model and the building blocks that compose an agent swarm.

[Korean version (한국어)](./core-concepts.ko.md)

---

## The "Kubernetes for Agent Swarm" philosophy

Goondan draws direct inspiration from Kubernetes. Just as Kubernetes lets you declare Pods, Services, and Deployments in YAML and the cluster reconciles reality to match, Goondan lets you declare **Models, Agents, Swarms, Tools, Extensions, Connectors, Connections, and Packages** in a `goondan.yaml` file and the runtime brings them to life.

The core principle is **"What, not How"**:

- You describe _what_ you want (an agent with these tools, connected to Telegram, using Claude).
- Goondan figures out _how_ to run it (spawning processes, managing IPC, handling crashes).

This declarative approach means your agent swarm configuration is:

- **Reproducible** -- the same YAML always produces the same behavior.
- **Versionable** -- configuration lives in source control alongside your code.
- **Portable** -- move between environments by changing secrets, not structure.

---

## Resource model

Every piece of configuration in Goondan is a **Resource**. All resources share an identical top-level structure:

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <string>
spec:
  # Kind-specific fields
```

| Field | Purpose |
|-------|---------|
| `apiVersion` | Schema version. Currently `goondan.ai/v1` for all resources. |
| `kind` | The type of resource. One of the 8 known Kinds. |
| `metadata.name` | Unique name within the same Kind (lowercase, hyphens, max 63 chars recommended). |
| `spec` | The resource's configuration, varying by Kind. |

This uniform structure means that tooling (validators, loaders, editors) can process all resources generically before inspecting Kind-specific details.

> **Kubernetes parallel**: This is analogous to every Kubernetes object having `apiVersion`, `kind`, `metadata`, and `spec` (or `data`). If you have worked with Kubernetes manifests, Goondan's resources will feel immediately familiar.

---

## The 8 resource Kinds

Goondan supports exactly **8 Kinds**. Each has a distinct role in the system. Think of them in three layers:

### Infrastructure layer

| Kind | Role | Kubernetes parallel |
|------|------|---------------------|
| **Model** | LLM provider configuration (provider, model name, API key) | _Similar to a StorageClass -- declares an external capability_ |
| **Package** | Project manifest, dependencies, and registry metadata | _Similar to a Helm chart -- a distributable unit_ |

### Agent layer

| Kind | Role | Kubernetes parallel |
|------|------|---------------------|
| **Agent** | Defines a single agent: its model, system prompt, tools, and extensions | _Like a Pod spec -- the unit of computation_ |
| **Swarm** | Groups agents together with execution policies (entry agent, max steps, shutdown policy) | _Like a Deployment -- manages a set of Pods_ |

### Capability layer

| Kind | Role | Kubernetes parallel |
|------|------|---------------------|
| **Tool** | A function the LLM can call (bash, file-system, HTTP fetch, etc.) | _Like a sidecar container providing a capability_ |
| **Extension** | Lifecycle middleware (logging, message compaction, skill injection) | _Like an admission webhook -- intercepts and modifies behavior_ |
| **Connector** | Receives external protocol events (Telegram, Slack, CLI) in its own process | _Like an Ingress controller -- bridges external traffic_ |
| **Connection** | Binds a Connector to a Swarm with config, secrets, and routing rules | _Like an Ingress resource -- defines routing for a specific controller_ |

### Relationships at a glance

```
Package (project manifest)
  └── depends on other Packages

Swarm
  ├── agents: [Agent/coder, Agent/reviewer]
  ├── entryAgent: Agent/coder
  └── policy: { maxStepsPerTurn: 32 }

Agent
  ├── modelConfig.modelRef: Model/claude
  ├── tools: [Tool/bash, Tool/file-system]
  └── extensions: [Extension/logging]

Connection
  ├── connectorRef: Connector/telegram
  ├── swarmRef: Swarm/default
  ├── config: { PORT: ... }
  ├── secrets: { BOT_TOKEN: ... }
  └── ingress.rules: [...]
```

For the complete YAML schema of each Kind, see the [Resources Reference](../reference/resources.md).

---

## ObjectRef: how resources reference each other

Resources don't exist in isolation -- an Agent references a Model, a Swarm references Agents, a Connection references a Connector. Goondan uses **ObjectRef** as the unified way to express these relationships.

### String shorthand (recommended)

```yaml
modelRef: "Model/claude"
toolRef: "Tool/bash"
agentRef: "Agent/coder"
```

The format is always `Kind/name`. Simple, readable, and sufficient for most cases.

### Object form

When you need to reference a resource from a different Package, use the object form:

```yaml
toolRef:
  kind: Tool
  name: bash
  package: "@goondan/base"
```

### RefItem wrapper

In arrays (like `Agent.spec.tools` or `Swarm.spec.agents`), references are wrapped in a `ref` property:

```yaml
tools:
  - ref: "Tool/bash"
  - ref: "Tool/file-system"
```

### Why it matters

ObjectRef enables **referential integrity** -- the loader validates that every referenced resource actually exists before the runtime starts. If you mistype `"Tool/bsh"` instead of `"Tool/bash"`, you get a clear error at validation time, not a cryptic failure at runtime.

```json
{
  "code": "E_CONFIG_REF_NOT_FOUND",
  "message": "Tool/bsh not found.",
  "suggestion": "Check kind/name or package scope."
}
```

> **Kubernetes parallel**: ObjectRef is Goondan's equivalent of Kubernetes resource references (like `serviceAccountName` or `configMapRef`), but with a unified syntax that works across all Kind types.

---

## Selector and Overrides

While ObjectRef is the primary way to reference resources, Goondan also supports **Selector with Overrides** for more flexible resource matching. A Selector lets you match resources by Kind and/or labels:

```yaml
agents:
  - selector:
      kind: Agent
      matchLabels:
        role: reviewer
    overrides:
      spec:
        modelConfig:
          params:
            temperature: 0.2
```

This approach is useful when you want to:

- **Match a group of resources** by label rather than naming each one explicitly.
- **Override specific fields** for the matched resources without modifying the original definition.

> **Note**: Label-based selection is an advanced feature. For most use cases, direct ObjectRef references (`ref: "Agent/coder"`) are clearer and recommended.

---

## ValueSource: injecting configuration values

Many resources need sensitive data (API keys, tokens) or environment-specific values. Hardcoding these in YAML is a security risk. Goondan's **ValueSource** pattern solves this by declaring _where_ a value comes from without embedding the value itself.

### Three sources

```yaml
# 1. Literal value (use sparingly -- avoid for secrets)
apiKey:
  value: "sk-..."

# 2. Environment variable (recommended)
apiKey:
  valueFrom:
    env: "ANTHROPIC_API_KEY"

# 3. Secret store reference
clientSecret:
  valueFrom:
    secretRef:
      ref: "Secret/slack-oauth"
      key: "client_secret"
```

### Mutual exclusion rules

- `value` and `valueFrom` cannot coexist.
- Within `valueFrom`, `env` and `secretRef` cannot coexist.
- If neither `value` nor `valueFrom` is provided, validation fails.

This design ensures that your `goondan.yaml` never contains raw secrets. API keys live in `.env` files or external secret stores, and the YAML only holds references.

> **Kubernetes parallel**: ValueSource serves the same purpose as Kubernetes `valueFrom` with `secretKeyRef` and `configMapKeyRef` -- separating secret management from resource definition.

---

## instanceKey: identifying swarm instances

When an agent swarm receives a message, Goondan needs to know _which conversation_ to route it to. This is what **instanceKey** does -- it uniquely identifies a running instance of a swarm.

### How instanceKey is determined

```yaml
kind: Swarm
metadata:
  name: my-swarm
spec:
  instanceKey: "main"   # Explicit: uses "main"
```

The rule is: **`Swarm.spec.instanceKey ?? Swarm.metadata.name`**

- If `spec.instanceKey` is set, that value is used.
- If omitted, `metadata.name` becomes the instanceKey.

### instanceKey in multi-tenant scenarios

For chat-based applications, each conversation needs its own instance. Connection ingress rules can derive instanceKey from incoming events:

```yaml
kind: Connection
metadata:
  name: telegram-connection
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - match:
          event: user_message
        route:
          instanceKeyProperty: "chat_id"     # Read from event properties
          instanceKeyPrefix: "telegram:"      # Result: "telegram:12345"
```

This way, each Telegram chat gets its own isolated conversation state, while sharing the same swarm definition.

> **Kubernetes parallel**: instanceKey is conceptually similar to how Kubernetes uses labels or namespace+name to route requests to specific Pod instances. It's the identity that ties a running conversation to its persisted state.

---

## Bundle: your project as YAML

A **Bundle** is the collection of resources defined in your project. The primary file is `goondan.yaml`, which can contain multiple resources separated by `---` (multi-document YAML):

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
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompt:
    system: "You are a coding assistant."
  tools:
    - ref: "Tool/bash"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
```

### Growing beyond a single file

As your project grows, you can split resources into separate files. The bundle loader recognizes specific filenames:

```
my-swarm/
├── goondan.yaml        # Package + Swarm + Connection
├── models.yaml         # Model resources
├── agents.yaml         # Agent resources
├── tools/
│   └── tools.yaml      # Tool resource definitions
├── extensions/
│   └── extensions.yaml
└── connectors/
    └── connectors.yaml
```

Recognized filenames include: `goondan`, `model(s)`, `agent(s)`, `tool(s)`, `extension(s)`, `connector(s)`, `connection(s)`, `swarm(s)`, and `resources` (with `.yaml` or `.yml` extensions).

### Fail-fast validation

The bundle loader validates _everything_ before the runtime starts:

- All `apiVersion` values must be `goondan.ai/v1`.
- Every ObjectRef must resolve to an existing resource.
- Every `spec.entry` path must point to an existing file.
- ValueSource fields must follow mutual exclusion rules.

If any check fails, the entire bundle is rejected -- no partial loading. This prevents subtle runtime errors from misconfigured resources.

---

## Package: reusable distribution units

A **Package** elevates a bundle from a local project to a **shareable, versioned unit**. It is the first document in `goondan.yaml` with `kind: Package`:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "1.0.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
---
# ... other resources follow
```

### Bundle vs. Package

| Aspect | Bundle | Package |
|--------|--------|---------|
| **What it is** | A collection of YAML resources + source files | A bundle with metadata for distribution |
| **Required?** | Yes -- every project is a bundle | No -- Package document is optional |
| **File** | `goondan.yaml` (and split files) | First document in `goondan.yaml` with `kind: Package` |
| **Dependencies** | Cannot declare dependencies | Can declare `spec.dependencies` |
| **Publishing** | Not publishable | Can be published to a registry |
| **Versioning** | Not versioned | Uses semver (`spec.version`) |
| **Without Package** | `gdn run` and `gdn validate` work fine | N/A |
| **With Package** | Everything above, plus... | dependency resolution, `gdn package *` commands, registry publishing |

### The dependency model

Packages can depend on other packages. The dependency graph must form a **DAG** (no circular dependencies):

```yaml
spec:
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
    - name: "@myorg/custom-tools"
      version: "^2.0.0"
```

Dependencies are installed to `~/.goondan/packages/` and their resources are merged into the configuration during loading. If there's a name collision, you can disambiguate with the `package` field in ObjectRef:

```yaml
tools:
  - kind: Tool
    name: bash
    package: "@goondan/base"
```

> **npm parallel**: The Package system works much like npm -- you have a manifest (like `package.json`), a lockfile (`goondan.lock.yaml`), a registry, and `gdn package add` / `gdn package install` / `gdn package publish` commands.

---

## Putting it all together

Here is a minimal but complete `goondan.yaml` that uses all the core concepts:

```yaml
# 1. Package manifest (optional but recommended)
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-assistant
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"      # Reusable tools & connectors
      version: "^0.0.3"
---
# 2. Model -- LLM provider configuration
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:                    # ValueSource -- never hardcode secrets
      env: ANTHROPIC_API_KEY
---
# 3. Agent -- the unit of computation
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"      # ObjectRef -- references the Model above
  prompt:
    system: "You are a helpful assistant."
  tools:
    - ref: "Tool/bash"            # RefItem -- from @goondan/base dependency
      package: "@goondan/base"
---
# 4. Swarm -- groups agents with policies
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"   # ObjectRef -- must be in agents list
  agents:
    - ref: "Agent/assistant"
  policy:
    maxStepsPerTurn: 32
---
# 5. Connection -- binds a Connector to the Swarm
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-connection
spec:
  connectorRef:
    kind: Connector
    name: cli
    package: "@goondan/base"      # Cross-package ObjectRef
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}                 # Routes to entryAgent
```

This YAML defines a complete agent swarm: a Claude-powered assistant with shell access, reachable via CLI input. Run it with `gdn run` and Goondan handles the rest -- process management, IPC, crash recovery, and message persistence.

---

## Further reading

- [Resources Reference](../reference/resources.md) -- complete YAML schema for all 8 Kinds
- [Runtime Model](./runtime-model.md) -- how Orchestrator, AgentProcess, and IPC work together
- [Tool System](./tool-system.md) -- double-underscore naming, ToolContext, tool execution
- [Extension Pipeline](./extension-pipeline.md) -- middleware onion model and ConversationState
- [Getting Started (Tutorial)](../tutorials/01-getting-started.md) -- hands-on first project

---

_Wiki version: v0.0.3_
