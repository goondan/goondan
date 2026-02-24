# How to: Use Built-in Tools

> Leverage the tools that ship with `@goondan/base` in your agents.

[Korean version (한국어)](./use-builtin-tools.ko.md)

---

## Prerequisites

- A working Goondan project (see [How to: Run a Swarm](./run-a-swarm.md))
- `@goondan/base` added as a dependency

---

## Add `@goondan/base` to your project

If your project does not already depend on `@goondan/base`, add it:

```bash
gdn package add @goondan/base
```

Or declare it in `goondan.yaml` manually:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-project
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
```

Then install:

```bash
gdn package install
```

---

## Reference built-in tools in your Agent

To give an Agent access to a built-in tool, add a `ref` entry to the Agent's `spec.tools` list. Since the tools come from an external package, use the **object ref** form with `package`:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompt:
    system: "You are a helpful assistant."
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: http-fetch
        package: "@goondan/base"
```

Each tool reference registers **all exports** of that tool. For example, referencing `Tool/bash` gives the LLM access to both `bash__exec` and `bash__script`.

> Tool names follow the **double-underscore naming** convention: `{resource-name}__{export-name}`. See [Tool System](../explanation/tool-system.md) for details.

---

## Tool-by-tool usage guide

### bash -- Shell command execution

Run shell commands in the agent's working directory.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: bash
      package: "@goondan/base"
```

**Exposed to LLM as:** `bash__exec`, `bash__script`

**Typical use case:** Execute system commands, run scripts, interact with CLI tools.

```
Agent prompt: "List all TypeScript files in the project."
Tool call:    bash__exec({ command: "find . -name '*.ts'" })
```

> See [Reference: bash](../reference/builtin-tools.md#bash) for full parameter and return value details.

---

### file-system -- File operations

Read, write, list, and create directories within the agent workspace.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: file-system
      package: "@goondan/base"
```

**Exposed to LLM as:** `file-system__read`, `file-system__write`, `file-system__list`, `file-system__mkdir`

**Typical use case:** Read project files, generate code or config files, explore directory structure.

```
Agent prompt: "Read the contents of package.json."
Tool call:    file-system__read({ path: "package.json" })
```

```
Agent prompt: "Create a new config file."
Tool call:    file-system__write({ path: "config.json", content: "{\"key\": \"value\"}" })
```

> See [Reference: file-system](../reference/builtin-tools.md#file-system) for full details.

---

### http-fetch -- HTTP requests

Make HTTP GET/POST requests with built-in SSRF prevention (http/https only).

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: http-fetch
      package: "@goondan/base"
```

**Exposed to LLM as:** `http-fetch__get`, `http-fetch__post`

**Typical use case:** Fetch API data, call external services, retrieve web content.

```
Agent prompt: "Get the latest weather data for Seoul."
Tool call:    http-fetch__get({ url: "https://api.weather.com/v1/seoul" })
```

```
Agent prompt: "Post data to the webhook."
Tool call:    http-fetch__post({ url: "https://hooks.example.com/notify", body: { "message": "done" } })
```

> See [Reference: http-fetch](../reference/builtin-tools.md#http-fetch) for full details.

---

### json-query -- JSON data querying

Query, pick, count, and flatten JSON data structures.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: json-query
      package: "@goondan/base"
```

**Exposed to LLM as:** `json-query__query`, `json-query__pick`, `json-query__count`, `json-query__flatten`

**Typical use case:** Extract specific fields from API responses, count items, reshape data.

```
Agent prompt: "Get the name of the first user."
Tool call:    json-query__query({ data: "[{\"name\":\"Alice\"},{\"name\":\"Bob\"}]", path: "[0].name" })
```

> See [Reference: json-query](../reference/builtin-tools.md#json-query) for full details.

---

### text-transform -- Text transformation

Replace, slice, split, join, trim, and change case of text.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: text-transform
      package: "@goondan/base"
```

**Exposed to LLM as:** `text-transform__replace`, `text-transform__slice`, `text-transform__split`, `text-transform__join`, `text-transform__trim`, `text-transform__case`

**Typical use case:** Format text, extract substrings, clean up input, transform case.

```
Agent prompt: "Convert the title to uppercase."
Tool call:    text-transform__case({ text: "hello world", to: "upper" })
```

> See [Reference: text-transform](../reference/builtin-tools.md#text-transform) for full details.

---

### agents -- Inter-agent communication

Enable agents to delegate tasks, send fire-and-forget messages, spawn instances, list running agents, and query the agent catalog.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: agents
      package: "@goondan/base"
```

**Exposed to LLM as:** `agents__request`, `agents__send`, `agents__spawn`, `agents__list`, `agents__catalog`

**Typical use case:** Multi-agent delegation, spawning workers, querying which agents are available.

```
Agent prompt: "Ask the researcher to find information about quantum computing."
Tool call:    agents__request({ target: "researcher", input: "Find recent papers on quantum computing" })
```

```
Agent prompt: "Notify the logger about the completed task."
Tool call:    agents__send({ target: "logger", input: "Task X completed successfully" })
```

```
Agent prompt: "Spawn a new worker instance for this task."
Tool call:    agents__spawn({ target: "worker", instanceKey: "worker-task-42" })
```

> The target agent must be defined in the current Swarm. The Orchestrator auto-spawns the target AgentProcess if it is not already running. See [Reference: agents](../reference/builtin-tools.md#agents) for full details.

---

### self-restart -- Orchestrator restart signal

Signal the Orchestrator to perform a self-restart. Used for self-evolution scenarios where the agent decides it needs a configuration refresh.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: self-restart
      package: "@goondan/base"
```

**Exposed to LLM as:** `self-restart__request`

**Typical use case:** An agent updates configuration and needs the Orchestrator to reload.

```
Agent prompt: "Restart the system to apply the new configuration."
Tool call:    self-restart__request({ reason: "Configuration updated by agent" })
```

After the tool returns, the runtime detects the restart signal, performs a graceful shutdown (including Connector termination), and spawns a replacement orchestrator process.

> See [Reference: self-restart](../reference/builtin-tools.md#self-restart) for full details.

---

### telegram -- Telegram messaging

Send, edit, delete messages, set reactions, manage chat actions, and download files via the Telegram Bot API.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: telegram
      package: "@goondan/base"
```

**Exposed to LLM as:** `telegram__send`, `telegram__edit`, `telegram__delete`, `telegram__react`, `telegram__setChatAction`, `telegram__downloadFile`

**Environment variable:** Set `TELEGRAM_BOT_TOKEN` (or `BOT_TOKEN`, `TELEGRAM_TOKEN`) in `.env`.

**Typical use case:** Respond to Telegram messages, send notifications, manage conversations.

```
Agent prompt: "Send a greeting to the Telegram chat."
Tool call:    telegram__send({ chatId: "123456", text: "Hello from Goondan!" })
```

```
Agent prompt: "Show typing indicator."
Tool call:    telegram__setChatAction({ chatId: "123456", action: "typing" })
```

**Combined with a Telegram Connector**, the agent receives messages from Telegram and can respond using this tool. Here is a minimal Connection setup:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-connection
spec:
  connectorRef:
    kind: Connector
    name: telegram-polling
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  secrets:
    TELEGRAM_BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
  ingress:
    rules:
      - match:
          event: telegram_message
        route:
          instanceKey: "my-bot"
```

> See [Reference: telegram](../reference/builtin-tools.md#telegram) for full details.

---

### slack -- Slack messaging

Send, read, edit, delete messages, add reactions, and download files via the Slack API.

**Reference:**

```yaml
tools:
  - ref:
      kind: Tool
      name: slack
      package: "@goondan/base"
```

**Exposed to LLM as:** `slack__send`, `slack__read`, `slack__edit`, `slack__delete`, `slack__react`, `slack__downloadFile`

**Environment variable:** Set `SLACK_BOT_TOKEN` (or `SLACK_TOKEN`) in `.env`.

**Typical use case:** Respond to Slack messages, read channel history, send notifications.

```
Agent prompt: "Send a message to the Slack channel."
Tool call:    slack__send({ channelId: "C01ABC23DEF", text: "Build completed successfully!" })
```

```
Agent prompt: "Read the last 5 messages from the channel."
Tool call:    slack__read({ channelId: "C01ABC23DEF", limit: 5 })
```

**Combined with a Slack Connector**, the agent can receive Slack events and respond. Here is a minimal Connection setup:

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: slack-connection
spec:
  connectorRef:
    kind: Connector
    name: slack
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  config:
    SLACK_WEBHOOK_PORT:
      value: "8787"
  ingress:
    rules:
      - match:
          event: message_im
        route:
          instanceKey: "my-bot"
      - match:
          event: app_mention
        route:
          instanceKey: "my-bot"
```

> See [Reference: slack](../reference/builtin-tools.md#slack) for full details.

---

## Full example: multi-tool agent

Here is a complete `goondan.yaml` snippet for an agent that uses multiple built-in tools:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: multi-tool-demo
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
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
  prompt:
    system: |
      You are a versatile assistant with access to shell commands,
      file system operations, HTTP requests, and text processing tools.
  tools:
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: http-fetch
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: json-query
        package: "@goondan/base"
    - ref:
        kind: Tool
        name: text-transform
        package: "@goondan/base"
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

Run it:

```bash
gdn run
```

---

## See also

- [Reference: Built-in Tools](../reference/builtin-tools.md) -- Full parameter tables and return values for every tool
- [Reference: Tool API](../reference/tool-api.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult` interfaces
- [Explanation: Tool System](../explanation/tool-system.md) -- Double-underscore naming, execution model, registry vs catalog
- [How to: Run a Swarm](./run-a-swarm.md) -- Setting up and launching your project
- [Reference: Resources](../reference/resources.md) -- Agent and Tool YAML schemas

---

_Wiki version: v0.0.3_
