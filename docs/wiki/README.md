# Goondan Wiki

> **Kubernetes for Agent Swarm** -- An orchestration framework for AI agent swarms (v0.0.3)

[Korean version (한국어)](./README.ko.md)

---

## What is Goondan?

Goondan is a declarative orchestration framework for AI agent swarms. You define agents, tools, extensions, and connections in a single `goondan.yaml` file, and Goondan handles process management, inter-agent communication, and external channel integration.

Key characteristics:

- **Declarative configuration** -- 8 resource Kinds (`Model`, `Agent`, `Swarm`, `Tool`, `Extension`, `Connector`, `Connection`, `Package`) defined in YAML
- **Process-per-Agent** -- Each agent runs in an isolated Bun process; crashes don't cascade
- **Middleware pipeline** -- 3 middleware layers (`turn` / `step` / `toolCall`) with an onion model
- **Edit & Restart** -- Modify YAML, restart, and affected agents pick up changes while preserving conversation history
- **Package ecosystem** -- Share and reuse tools, extensions, and connectors via a registry

---

## Who is this wiki for?

This wiki is structured around three reader personas. Pick the one that best describes you and follow the recommended path.

### End-user (Swarm operator)

You want to **set up and run** an agent swarm without writing custom tools or extensions.

**Start here:**

1. [Getting Started](./tutorials/01-getting-started.md) -- install, init, and run your first swarm
2. [Run a Swarm](./how-to/run-a-swarm.md) -- launch, restart, inspect, and delete instances
3. [Use Built-in Tools](./how-to/use-builtin-tools.md) -- leverage `@goondan/base` tools (bash, file-system, http-fetch, etc.)

### Tool Maker

You want to **build custom tools** that agents can invoke via LLM tool calls.

**Start here:**

1. [Getting Started](./tutorials/01-getting-started.md) -- ensure the basics work first
2. [Build Your First Tool](./tutorials/02-build-your-first-tool.md) -- step-by-step tutorial
3. [Write a Tool (How-to)](./how-to/write-a-tool.md) -- practical checklist for production tools
4. [Tool System (Explanation)](./explanation/tool-system.md) -- deep dive into the tool architecture
5. [Tool API Reference](./reference/tool-api.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult`

### Extension Maker

You want to **build extensions** that hook into the runtime pipeline (message management, logging, tool filtering, etc.).

**Start here:**

1. [Getting Started](./tutorials/01-getting-started.md) -- ensure the basics work first
2. [Build Your First Extension](./tutorials/03-build-your-first-extension.md) -- step-by-step tutorial
3. [Write an Extension (How-to)](./how-to/write-an-extension.md) -- practical checklist for production extensions
4. [Extension Pipeline (Explanation)](./explanation/extension-pipeline.md) -- deep dive into the middleware architecture
5. [Extension API Reference](./reference/extension-api.md) -- `ExtensionApi`, pipeline, state, events

---

## Wiki structure

This wiki follows the [Diataxis](https://diataxis.fr/) documentation framework, organizing content into four categories based on the reader's goal.

### Tutorials -- _Learning-oriented_

Step-by-step lessons that guide you from zero to a working result.

| Document | Description |
|----------|-------------|
| [Getting Started](./tutorials/01-getting-started.md) | Install Goondan, create a project with `gdn init`, and run your first swarm |
| [Build Your First Tool](./tutorials/02-build-your-first-tool.md) | Create a custom tool from scratch and register it in `goondan.yaml` |
| [Build Your First Extension](./tutorials/03-build-your-first-extension.md) | Create a middleware extension with `register(api)` and wire it into the pipeline |

### How-to guides -- _Task-oriented_

Concise recipes for specific tasks. Assume you already have a working project.

| Document | Description |
|----------|-------------|
| [Run a Swarm](./how-to/run-a-swarm.md) | Launch, restart, inspect, and delete swarm instances |
| [Write a Tool](./how-to/write-a-tool.md) | Checklist for writing production-quality tools |
| [Write an Extension](./how-to/write-an-extension.md) | Checklist for writing production-quality extensions |
| [Write a Connector](./how-to/write-a-connector.md) | Build a connector that bridges an external protocol to Goondan |
| [Use Built-in Tools](./how-to/use-builtin-tools.md) | Leverage `@goondan/base` tools (bash, file-system, agents, http-fetch, etc.) |
| [Multi-Agent Patterns](./how-to/multi-agent-patterns.md) | Patterns for inter-agent communication (request/send/spawn) |

### Explanation -- _Understanding-oriented_

Conceptual articles that explain _why_ things work the way they do.

| Document | Description |
|----------|-------------|
| [Core Concepts](./explanation/core-concepts.md) | Resource Kinds, ObjectRef, instanceKey, Bundle, Package, and the declarative config model |
| [Tool System](./explanation/tool-system.md) | Double-underscore naming, ToolContext, tool execution within AgentProcess |
| [Extension Pipeline](./explanation/extension-pipeline.md) | Middleware onion model, turn/step/toolCall layers, ConversationState event sourcing |
| [Runtime Model](./explanation/runtime-model.md) | Orchestrator, Process-per-Agent, IPC, Reconciliation Loop, Graceful Shutdown |

### Reference -- _Information-oriented_

Precise, exhaustive descriptions of APIs, schemas, and CLI commands.

| Document | Description |
|----------|-------------|
| [Resources](./reference/resources.md) | YAML schema for all 8 resource Kinds (`apiVersion: goondan.ai/v1`) |
| [Built-in Tools](./reference/builtin-tools.md) | Catalog of `@goondan/base` tools with parameters and examples |
| [Tool API](./reference/tool-api.md) | `ToolHandler`, `ToolContext`, `ToolCallResult` TypeScript interfaces |
| [Extension API](./reference/extension-api.md) | `ExtensionApi` -- `pipeline`, `tools`, `state`, `events`, `logger` |
| [Connector API](./reference/connector-api.md) | `ConnectorContext`, `ConnectorEvent`, connector entry module |
| [CLI Reference](./reference/cli-reference.md) | `gdn` commands: `run`, `restart`, `validate`, `instance`, `package`, `logs`, `doctor` |

---

## Relationship to other documents

| Document | Purpose | Audience |
|----------|---------|----------|
| [GUIDE.md](../../GUIDE.md) | Quick-start guide (install, init, run) | First-time users |
| [docs/architecture.md](../architecture.md) | System design overview (diagrams, design patterns) | Architects, contributors |
| [docs/specs/*.md](../specs/) | Implementation specs (SSOT for interfaces, schemas, rules) | Core contributors |
| **This wiki** | User-facing documentation (tutorials, how-to, explanation, reference) | End-users, Tool Makers, Extension Makers |

The wiki is a **user-perspective rewrite** of the information found in specs and architecture docs. It does not replace them -- specs remain the single source of truth for implementation details.

---

## Contributing

When adding or editing wiki pages:

- Place English files as `.md` and Korean translations as `.ko.md` in the same directory
- Use relative links for cross-references (e.g., `./tutorials/01-getting-started.md`)
- Do not duplicate spec content verbatim -- summarize for the user audience and link to specs for details
- Keep examples consistent with `goondan.yaml` schemas defined in `docs/specs/resources.md`

---

_Wiki version: v0.0.3_
