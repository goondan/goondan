# How to: Run a Swarm

> Initialize, launch, restart, and manage a Goondan swarm instance.

[Korean version (한국어)](./run-a-swarm.ko.md)

---

## Prerequisites

- [Bun](https://bun.sh) installed (Goondan's only supported runtime)
- `@goondan/cli` installed globally:
  ```bash
  bun add -g @goondan/cli
  ```
- An LLM API key (e.g., `ANTHROPIC_API_KEY`)

---

## 1. Initialize a project

```bash
gdn init ./my-swarm
cd my-swarm
```

This generates a `goondan.yaml` with a `kind: Package` document, a `Model`, an `Agent`, and a `Swarm` -- everything needed to run immediately.

**Generated file structure:**

```
my-swarm/
  goondan.yaml           # Main configuration (apiVersion: goondan.ai/v1)
  prompts/
    default.system.md    # Default system prompt
  .env                   # Environment variable template
  .gitignore
```

Use `--template` to start with a different structure:

```bash
# Multi-agent swarm scaffold
gdn init --template multi-agent

# Minimal configuration
gdn init --template minimal
```

> See [CLI Reference: `gdn init`](../reference/cli-reference.md#gdn-init) for all options.

---

## 2. Set up environment variables

Add your API keys to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

For machine-specific overrides, create `.env.local` (gitignored by default):

```bash
# .env.local -- overrides .env values on this machine
ANTHROPIC_API_KEY=sk-ant-my-local-key...
GOONDAN_LOG_LEVEL=debug
```

**Loading priority** (earlier loaded values take precedence):

1. `--env-file <path>` (highest priority)
2. `.env.local`
3. `.env`

System environment variables that are already set are **never overwritten** by `.env` files.

> You can also pass a custom env file: `gdn run --env-file ./env.production`

---

## 3. Validate the configuration

Before running, verify your bundle is correct:

```bash
gdn validate
```

This checks schema compliance, reference integrity, entry file existence, circular references, naming conventions, and Kind validation.

For JSON output (useful in CI):

```bash
gdn validate --format json
```

For strict mode (treat warnings as errors):

```bash
gdn validate --strict
```

> See [CLI Reference: `gdn validate`](../reference/cli-reference.md#gdn-validate) for details.

---

## 4. Run the swarm

```bash
gdn run
```

**What happens:**

1. Parses `goondan.yaml` and validates the `kind: Package` document
2. Selects the Swarm (defaults to `Swarm/default`; auto-selects if only one exists)
3. Computes `instanceKey` from `Swarm.spec.instanceKey ?? Swarm.metadata.name`
4. Spawns the Orchestrator as a persistent process
5. Spawns ConnectorProcesses for each defined Connection
6. Starts an interactive CLI loop (default Connector)

If an Orchestrator with the same instanceKey is already running, `gdn run` resumes that process instead of spawning a new one.

### Run a specific Swarm

If your project defines multiple Swarms:

```bash
gdn run --swarm code-review
```

### Single input (non-interactive)

```bash
# Send one message and exit
gdn run --input "Summarize the latest news about AI agents"

# From a file
gdn run --input-file ./request.txt
```

### Foreground mode

```bash
gdn run --foreground
```

The Orchestrator runs in the current terminal. Press Ctrl+C to stop.

> See [CLI Reference: `gdn run`](../reference/cli-reference.md#gdn-run) for all options.

---

## 5. Watch mode (development)

During development, use `--watch` to auto-restart affected processes when files change:

```bash
gdn run --watch
```

In watch mode, the Orchestrator monitors:

- `goondan.yaml` and related resource files
- Tool/Extension/Connector entry files (`.ts`/`.js`)

When a change is detected, only the affected AgentProcesses are selectively restarted. Conversation history is preserved across restarts by default.

> For details on the Edit & Restart model, see [Explanation: Runtime Model](../explanation/runtime-model.md#edit--restart-the-configuration-change-model).

---

## 6. Restart the Orchestrator

After editing `goondan.yaml` (without `--watch`), apply changes by restarting:

```bash
# Restart the entire Orchestrator
gdn restart

# Restart only a specific agent's process
gdn restart --agent coder

# Clear persisted message history (base/events/runtime-events) and restart fresh
gdn restart --fresh

# Restart a specific agent with state reset
gdn restart --agent coder --fresh
```

The default `gdn restart`:

1. Reads the active Orchestrator from `runtime/active.json`
2. Recalculates the instanceKey from the Swarm definition
3. Starts a replacement runner process
4. Terminates the old Orchestrator PID

When `--agent` is specified, only that agent's process is restarted; other agents continue running undisturbed. Conversation history is preserved by default unless `--fresh` is used.

> See [CLI Reference: `gdn restart`](../reference/cli-reference.md#gdn-restart) for all options.

---

## 7. Manage instances

### List running instances

```bash
gdn instance list
```

Output:

```
INSTANCE KEY    AGENT          STATUS    CREATED              UPDATED
default         orchestrator   running   2026-02-13 09:30:00  2026-02-13 09:30:00
```

### Interactive TUI

Run `gdn instance` without a subcommand to enter the interactive TUI (requires TTY):

```bash
gdn instance
```

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `r` | Restart the selected instance |
| `q` / Ctrl+C | Exit |

Each row displays a `started` timestamp to confirm restart status.

### Restart a specific instance

```bash
gdn instance restart default
```

This restarts the instance with the latest runner binary and recalculates the instanceKey.

### Delete an instance

```bash
# With confirmation prompt
gdn instance delete user:123

# Force delete without confirmation
gdn instance delete user:123 --force
```

Deleting an instance removes all its state: message history, extension state, and the workspace directory. Any running runtime-runner PIDs for that instance are terminated, along with their child processes (including agent/connector children).

> See [CLI Reference: `gdn instance`](../reference/cli-reference.md#gdn-instance) for details.

---

## 8. View logs

```bash
# Active instance orchestrator logs (last 200 lines)
gdn logs

# Filter by agent name
gdn logs --agent coder

# Follow a specific trace chain across all agents
gdn logs --trace <traceId>

# Combine agent and trace filters
gdn logs --agent coder --trace <traceId>

# Specific instance, stderr only
gdn logs --instance-key session-001 --stream stderr --lines 100

# Specific process logs (e.g., a connector)
gdn logs --process connector-telegram
```

The `--agent` and `--trace` flags are especially useful for multi-agent debugging. `--trace` follows a single causal chain (traceId) across all agents in the swarm, making it easy to understand _why_ a particular agent was invoked.

Log files are stored at:

```
~/.goondan/runtime/logs/<instanceKey>/<process>.stdout.log
~/.goondan/runtime/logs/<instanceKey>/<process>.stderr.log
```

> See [CLI Reference: `gdn logs`](../reference/cli-reference.md#gdn-logs) for all options.

---

## 9. Diagnose environment issues

```bash
gdn doctor
```

This checks:

- **System**: Bun version, package manager availability
- **API Keys**: Whether LLM API keys are set
- **Goondan Packages**: Installed package versions
- **Project**: `goondan.yaml` existence and validity

> See [CLI Reference: `gdn doctor`](../reference/cli-reference.md#gdn-doctor) for details.

---

## Troubleshooting

### "Package document not found"

`gdn run` requires a `kind: Package` document with `metadata.name` in your `goondan.yaml`. Run `gdn init` to generate one, or add it manually:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-project
spec:
  version: "0.1.0"
```

### "Orchestrator already running"

If `gdn run` reports an existing Orchestrator, it will resume that process. To start fresh:

```bash
gdn instance delete default --force
gdn run
```

### Startup handshake failure

If `gdn run` fails immediately, check logs for the error:

```bash
gdn logs --stream stderr
```

Common causes:
- Missing or invalid API key in `.env`
- Entry file referenced in `goondan.yaml` does not exist (run `gdn validate`)
- Version mismatch between `@goondan/cli` and `@goondan/runtime`

### Watch mode not detecting changes

Ensure you are editing files within the project directory. Watch mode monitors `goondan.yaml`, resource files, and entry files referenced by Tools, Extensions, and Connectors.

---

## Quick reference: common workflows

| Task | Command |
|------|---------|
| Create a new project | `gdn init ./my-swarm` |
| Validate configuration | `gdn validate` |
| Start the swarm | `gdn run` |
| Start with watch mode | `gdn run --watch` |
| Restart after config edit | `gdn restart` |
| Restart a specific agent | `gdn restart --agent coder` |
| Restart with state reset | `gdn restart --fresh` |
| List instances | `gdn instance list` |
| Restart an instance | `gdn instance restart <key>` |
| Delete an instance | `gdn instance delete <key> --force` |
| View logs | `gdn logs` |
| View agent-specific logs | `gdn logs --agent coder` |
| Follow a trace chain | `gdn logs --trace <traceId>` |
| Diagnose environment | `gdn doctor` |

---

## See also

- [CLI Reference](../reference/cli-reference.md) -- Full command reference for `gdn`
- [Explanation: Runtime Model](../explanation/runtime-model.md) -- How the Orchestrator, processes, and IPC work
- [How to: Use Built-in Tools](./use-builtin-tools.md) -- Leverage the tools that ship with `@goondan/base`
- [Reference: Resources](../reference/resources.md) -- YAML schema for all 8 resource Kinds

---

_Wiki version: v0.0.3_
