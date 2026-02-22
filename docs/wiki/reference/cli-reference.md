# CLI Reference (`gdn`)

> Goondan v0.0.3

[Korean version (한국어)](./cli-reference.ko.md)

---

## Overview

`gdn` is the official CLI tool for the Goondan Agent Swarm Orchestrator. It provides commands for running orchestrators, managing instances, validating bundles, managing packages, and diagnosing environments.

### Installation

```bash
# Bun (recommended)
bun add -g @goondan/cli

# npm / pnpm
npm install -g @goondan/cli
pnpm add -g @goondan/cli
```

### Basic Usage

```bash
gdn <command> [subcommand] [options]
```

> For a guide on running swarms, see [How to: Run a Swarm](../how-to/run-a-swarm.md).

---

## Global Options

These options apply to all commands.

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Print help | - |
| `--version` | `-V` | Print version | - |
| `--verbose` | `-v` | Enable verbose output | `false` |
| `--quiet` | `-q` | Minimize output | `false` |
| `--config <path>` | `-c` | Configuration file path | `goondan.yaml` |
| `--state-root <path>` | | System root path | `~/.goondan` |
| `--no-color` | | Disable colored output | `false` |
| `--json` | | JSON format output | `false` |

---

## Commands

| Command | Description |
|---------|-------------|
| [`gdn init`](#gdn-init) | Initialize a new Swarm project |
| [`gdn run`](#gdn-run) | Start the Orchestrator (persistent process) |
| [`gdn restart`](#gdn-restart) | Restart the active Orchestrator |
| [`gdn validate`](#gdn-validate) | Validate bundle configuration |
| [`gdn instance`](#gdn-instance) | Manage instances (list, restart, delete) |
| [`gdn logs`](#gdn-logs) | View process logs |
| [`gdn package`](#gdn-package) | Manage packages (add, install, publish) |
| [`gdn doctor`](#gdn-doctor) | Diagnose environment |

---

## `gdn init`

Initialize a new Goondan Swarm project. Always generates a `kind: Package` document as the first document in `goondan.yaml`.

### Usage

```bash
gdn init [path] [options]
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `path` | Project directory path | `.` (current directory) |

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--name <name>` | `-n` | Swarm name | Directory name |
| `--template <name>` | `-t` | Template to use | `default` |
| `--git` | | Initialize git repository | `true` |
| `--no-git` | | Skip git initialization | - |
| `--force` | `-f` | Overwrite existing files | `false` |

### Templates

| Template | Description |
|----------|-------------|
| `default` | Single agent setup |
| `multi-agent` | Multi-agent swarm setup |
| `package` | Package structure |
| `minimal` | Minimal configuration |

### Examples

```bash
# Initialize in current directory
gdn init

# Initialize in a specific path
gdn init ./my-agent

# Use multi-agent template
gdn init --template multi-agent

# Specify package name
gdn init --name @myorg/my-tools
```

### Generated File Structure (default template)

```
<project>/
  goondan.yaml           # Main configuration (apiVersion: goondan.ai/v1)
  prompts/
    default.system.md    # Default system prompt
  .env                   # Environment variable template
  .gitignore             # Git ignore file
```

### Generated goondan.yaml

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-agent
spec:
  version: "0.1.0"
---
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
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompts:
    systemPrompt: |
      You are a helpful assistant.
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
```

---

## `gdn run`

Start the Orchestrator as a **persistent process**. Spawns and manages agent/connector processes.

### Usage

```bash
gdn run [options]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--swarm <name>` | `-s` | Swarm name to run. If omitted, selects `default`; if no `default`, auto-selects when only one Swarm exists | `default` |
| `--watch` | `-w` | Watch mode (auto-restart on file changes) | `false` |
| `--foreground` | | Run in the current terminal (no background detach) | `false` |
| `--input <text>` | | Initial input message | - |
| `--input-file <path>` | | Input file path | - |
| `--interactive` | | Interactive mode | Default for CLI Connector |
| `--no-install` | | Skip automatic dependency installation | `false` |
| `--env-file <path>` | | Custom environment variable file path | - |

### How It Works

1. Parses `goondan.yaml` and related resource files
2. Validates local `kind: Package` document and `metadata.name` (fails if missing)
3. Selects the Swarm and computes `instanceKey`: `Swarm.spec.instanceKey ?? Swarm.metadata.name`
4. If an Orchestrator with the same key is already running, resumes that process
5. Resolves the `@goondan/runtime/runner` path and spawns a runtime-runner child process
6. Waits for startup handshake (`ready` or `start_error`)
7. Updates the state file (`runtime/active.json`)
8. Spawns ConnectorProcess for each defined Connection
9. Starts interactive loop if using CLI Connector
10. Spawns AgentProcesses on demand when events arrive

The Orchestrator stays alive even after all agents terminate; it will re-spawn AgentProcesses when new events arrive.

### Environment Variable File Loading

`gdn run` automatically loads `.env` files from the project root.

**Loading priority** (earlier loaded values take precedence):

1. `--env-file` specified file (highest priority)
2. `.env.local` (local machine only, gitignored)
3. `.env` (project defaults)

Already-set system environment variables are **preserved** (not overwritten).

### Watch Mode

```bash
gdn run --watch
```

In `--watch` mode, the Orchestrator:

- **MUST** watch `goondan.yaml` and related resource files for changes.
- **SHOULD** selectively restart only affected AgentProcesses when a resource changes.
- **SHOULD** restart processes when Tool/Extension/Connector entry files change.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOONDAN_LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) |
| `GOONDAN_STATE_ROOT` | System root path |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key |

### Examples

```bash
# Default run (CLI interactive mode)
gdn run

# Run a specific Swarm
gdn run --swarm code-review

# Development mode (watch)
gdn run --watch

# Foreground mode (Ctrl+C to stop)
gdn run --foreground

# Single input then exit
gdn run --input "Hello, agent!"

# File input
gdn run --input-file ./request.txt
```

---

## `gdn restart`

Restart the active Orchestrator instance with the latest runner binary. Recalculates the instanceKey from the active Swarm definition, starts a replacement process, and terminates the old one.

### Usage

```bash
gdn restart [options]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--agent <name>` | `-a` | Restart only the specified agent's process (selective restart) | - |
| `--fresh` | | Clear persisted message history (`base/events/runtime-events`) before restarting | `false` |

### How It Works

1. Reads the active Orchestrator instance from `runtime/active.json`
2. Recalculates instanceKey from the active Swarm definition (`Swarm.spec.instanceKey ?? Swarm.metadata.name`)
3. If `--agent` is specified, signals the Orchestrator to restart only that agent's process
4. Otherwise, starts a replacement runner first, updates the active PID, and terminates the old Orchestrator PID

### Examples

```bash
# Restart the active Orchestrator
gdn restart

# Restart only a specific agent's process
gdn restart --agent coder

# Clear all state and restart fresh
gdn restart --fresh

# Restart a specific agent with state reset
gdn restart --agent coder --fresh
```

---

## `gdn validate`

Validate the bundle configuration.

### Usage

```bash
gdn validate [path] [options]
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `path` | Bundle path to validate | `.` |

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--strict` | | Strict mode (treat warnings as errors) | `false` |
| `--fix` | | Auto-fix fixable issues | `false` |
| `--format <format>` | | Output format (`text`, `json`, `github`) | `text` |

### Validation Checks

1. **Schema validation** -- YAML resource schema compliance (`apiVersion: goondan.ai/v1`)
2. **Reference integrity** -- ObjectRef targets exist
3. **File existence** -- Entry file paths exist
4. **Circular references** -- Detect circular resource references
5. **Naming conventions** -- `metadata.name` format validation
6. **Kind validation** -- Only the 8 supported Kinds (Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)

### Output Examples

**Text format:**

```
Validating /path/to/project...

  Schema validation passed
  Reference integrity passed
  File existence check failed
  - tools/missing/index.ts: File not found (referenced in Tool/missing)
  Naming convention warning
  - Tool/MyTool: Name should be lowercase with hyphens

Errors: 1, Warnings: 1
```

**JSON format:**

```json
{
  "valid": false,
  "errors": [
    {
      "code": "FILE_NOT_FOUND",
      "message": "File not found",
      "path": "tools/missing/index.ts",
      "resource": "Tool/missing",
      "field": "spec.entry",
      "suggestion": "Create the file or fix the path",
      "helpUrl": "https://docs.goondan.io/errors/FILE_NOT_FOUND"
    }
  ],
  "warnings": [
    {
      "code": "NAMING_CONVENTION",
      "message": "Name should be lowercase with hyphens",
      "resource": "Tool/MyTool",
      "suggestion": "Rename to my-tool"
    }
  ]
}
```

---

## `gdn instance`

Manage orchestrator instances. When invoked without a subcommand, enters interactive TUI mode.

### Subcommands

| Command | Description |
|---------|-------------|
| `gdn instance list` | List instances |
| `gdn instance restart <key>` | Restart an instance |
| `gdn instance delete <key>` | Delete an instance |

### `gdn instance` (bare) -- Interactive TUI

When `gdn instance` is invoked without a subcommand, it enters an interactive TUI mode (requires TTY). Displays instance status in real-time with ANSI rendering. Falls back to `gdn instance list` on non-TTY or when `--json` is specified.

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `r` | Restart the selected instance |
| `q` / Ctrl+C | Exit |

Each row displays the `started` timestamp to confirm restart status.

### `gdn instance list`

List orchestrator instances. Shows the active orchestrator from `runtime/active.json` and managed runtime-runner PIDs under the same state-root. Agent conversation instances are not displayed.

```bash
gdn instance list [options]
```

**Options:**

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--agent <name>` | `-a` | Agent name filter (`orchestrator` only) | - |
| `--limit <n>` | `-n` | Maximum count | `20` |
| `--all` | | Show all detected instances | `false` |

**Output example:**

```
INSTANCE KEY    AGENT          STATUS    CREATED              UPDATED
default         orchestrator   running   2026-02-13 09:30:00  2026-02-13 09:30:00
```

### `gdn instance restart`

Restart a specific orchestrator instance with the latest runner binary. Recalculates instanceKey from the active Swarm definition and updates the PID in `runtime/active.json`.

```bash
gdn instance restart <key> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `key` | Instance key to restart |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--fresh` | Clear persisted message history (`base/events/runtime-events`) before restarting | `false` |

Using `gdn instance restart --fresh` also clears the message/runtime-event history consumed by Studio, so the view starts empty after refresh.

**Example:**

```bash
gdn instance restart default
```

### `gdn instance delete`

Delete an instance and its state. Removes message history, extension state, and the entire instance workspace directory. Terminates managed runtime-runner PIDs under the same state-root regardless of active status, and also cleans up child processes (including agent/connector children) spawned by that runtime-runner.

```bash
gdn instance delete <key> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `key` | Instance key to delete |

**Options:**

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--force` | `-f` | Delete without confirmation | `false` |

**Examples:**

```bash
# Delete with confirmation prompt
gdn instance delete user:123

# Force delete without confirmation
gdn instance delete user:123 --force
```

---

## `gdn logs`

View process log files.

### Usage

```bash
gdn logs [options]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--instance-key <key>` | `-i` | Instance key to query. Omit to use the active instance from `runtime/active.json` | active instance |
| `--agent <name>` | `-a` | Filter events by agent name | - |
| `--trace <traceId>` | | Filter events by trace ID (follows a single causal chain across agents) | - |
| `--process <name>` | `-p` | Process name | `orchestrator` |
| `--stream <stdout\|stderr\|both>` | | Log stream selection | `both` |
| `--lines <n>` | `-l` | Last N lines from each log file | `200` |

### Log File Paths

```
~/.goondan/runtime/logs/<instanceKey>/<process>.stdout.log
~/.goondan/runtime/logs/<instanceKey>/<process>.stderr.log
```

### Examples

```bash
# Active instance orchestrator logs (last 200 lines)
gdn logs

# Filter by agent name
gdn logs --agent coder

# Follow a specific trace chain across all agents
gdn logs --trace abc-123-def

# Combine agent and trace filters
gdn logs --agent coder --trace abc-123-def

# Specific instance stderr (last 100 lines)
gdn logs --instance-key session-001 --stream stderr --lines 100

# Specific process logs
gdn logs --instance-key session-001 --process connector-telegram
```

---

## `gdn package`

Manage packages.

### Subcommands

| Command | Description |
|---------|-------------|
| `gdn package add <ref>` | Add a dependency |
| `gdn package install` | Install dependencies |
| `gdn package publish` | Publish a package |

### `gdn package add`

Add a new dependency.

```bash
gdn package add <ref> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `ref` | Package reference (e.g., `@goondan/base`, `@goondan/base@1.0.0`) |

**Options:**

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--dev` | `-D` | Add as devDependency | `false` |
| `--exact` | `-E` | Pin exact version | `false` |
| `--registry <url>` | | Custom registry | Config file setting |

**Examples:**

```bash
# Add latest version
gdn package add @goondan/base

# Add specific version
gdn package add @goondan/base@1.2.0

# Pin exact version
gdn package add @goondan/base@1.2.0 --exact
```

### `gdn package install`

Install all dependencies defined in the Package document of `goondan.yaml`.

```bash
gdn package install [options]
```

**Options:**

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--frozen-lockfile` | | Do not update lockfile | `false` |

**Examples:**

```bash
# Install all dependencies
gdn package install

# Install from lockfile (for CI)
gdn package install --frozen-lockfile
```

### `gdn package publish`

Publish a package to a registry.

```bash
gdn package publish [path] [options]
```

**Arguments:**

| Argument | Description | Default |
|----------|-------------|---------|
| `path` | Package path | `.` |

**Options:**

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--tag <tag>` | | Deployment tag | `latest` |
| `--access <level>` | | Access level (`public`, `restricted`) | `public` |
| `--dry-run` | | Simulate without publishing | `false` |
| `--registry <url>` | | Custom registry | Config file setting |

**Pre-publish validation:**

1. Package document exists in `goondan.yaml`
2. `spec.dist` directory exists
3. `spec.exports` files exist
4. Version duplication check
5. Configuration validation (`gdn validate`)

**Examples:**

```bash
# Publish package
gdn package publish

# Publish with beta tag
gdn package publish --tag beta

# Dry run
gdn package publish --dry-run
```

---

## `gdn doctor`

Diagnose the environment and check for common issues.

### Usage

```bash
gdn doctor [options]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--fix` | | Attempt auto-fix (placeholder) | `false` |

### Checks

**System:**

| Check | Description | Level |
|-------|-------------|-------|
| Bun | Version check | fail |
| npm/pnpm | Package manager installation | warn |

**API Keys:**

| Check | Description | Level |
|-------|-------------|-------|
| `ANTHROPIC_API_KEY` | Anthropic API key | warn |
| `OPENAI_API_KEY` | OpenAI API key | warn |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key | warn |

**Goondan Packages:**

| Check | Description | Level |
|-------|-------------|-------|
| `@goondan/core` | Core package version | warn |
| `@goondan/cli` | CLI package version | warn |
| `@goondan/base` | Base package version | warn |

**Project:**

| Check | Description | Level |
|-------|-------------|-------|
| Bundle Config | `goondan.yaml` existence | warn |
| Bundle Validation | `goondan.yaml` validity | fail/warn |

### Output Example

```
Goondan Doctor
Checking your environment...

System
  Bun: Bun 1.1.x
  pnpm: pnpm 9.x.x

API Keys
  Anthropic API Key: ANTHROPIC_API_KEY is set (sk-a...****)
  OpenAI API Key: OPENAI_API_KEY is not set
    Set if using OpenAI: export OPENAI_API_KEY=your-api-key

Goondan Packages
  @goondan/core: @goondan/core@2.0.0
  @goondan/cli: @goondan/cli@2.0.0
  @goondan/base: @goondan/base@2.0.0

Project
  Bundle Config: Found goondan.yaml
  Bundle Validation: Valid (5 resources)

Summary
  8 passed, 1 warnings, 0 errors
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments/options |
| `3` | Configuration error |
| `4` | Validation error |
| `5` | Network error |
| `6` | Authentication error |
| `130` | User interrupt (Ctrl+C) |

---

## Configuration File

### `~/.goondan/config.json`

Global CLI configuration file.

```json
{
  "registry": "https://goondan-registry.yechanny.workers.dev",
  "logLevel": "info",
  "registries": {
    "https://goondan-registry.yechanny.workers.dev": {
      "token": "xxx..."
    }
  },
  "scopedRegistries": {
    "@myorg": "https://my-org-registry.example.com"
  }
}
```

### Configuration Priority

Settings priority (highest first):

1. CLI options (`--state-root`, etc.)
2. Environment variables (`GOONDAN_STATE_ROOT`, `GOONDAN_REGISTRY`, etc.)
3. `~/.goondan/config.json`
4. Default values

---

## See Also

- [How to: Run a Swarm](../how-to/run-a-swarm.md) -- Running and managing swarms
- [Reference: Resources](./resources.md) -- All 8 resource Kind schemas
- [Reference: Connector API](./connector-api.md) -- Connector/Connection API reference
- [Explanation: Runtime Model](../explanation/runtime-model.md) -- Understanding the execution model

---

_Wiki version: v0.0.3_
