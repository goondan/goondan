# Built-in Tools Reference

> Catalog of tools provided by `@goondan/base` (v0.0.3)

[Korean version (한국어)](./builtin-tools.ko.md)

---

## Overview

Goondan ships a set of built-in tools in the `@goondan/base` package. These tools are ready to use -- simply reference them in your Agent's `spec.tools` list.

All tool names follow the **double-underscore naming** convention: `{resource-name}__{export-name}`. For example, the `exec` export of the `bash` tool is exposed to the LLM as `bash__exec`. See [Tool System](../explanation/tool-system.md) for details on this convention.

**Cross-references:**
- [How-to: Use Built-in Tools](../how-to/use-builtin-tools.md) -- practical usage patterns
- [Explanation: Tool System](../explanation/tool-system.md) -- architecture deep-dive
- [Reference: Tool API](./tool-api.md) -- `ToolHandler`, `ToolContext`, `ToolCallResult` interfaces

---

## Table of Contents

| Tool Resource | Exports | Description |
|---------------|---------|-------------|
| [bash](#bash) | `exec`, `script` | Shell command execution |
| [file-system](#file-system) | `read`, `write`, `list`, `mkdir` | File read/write/list operations |
| [http-fetch](#http-fetch) | `get`, `post` | HTTP requests (SSRF prevention: http/https only) |
| [json-query](#json-query) | `query`, `pick`, `count`, `flatten` | JSON data querying |
| [text-transform](#text-transform) | `replace`, `slice`, `split`, `join`, `trim`, `case` | Text transformation |
| [agents](#agents) | `request`, `send`, `spawn`, `list`, `catalog` | Inter-agent communication |
| [self-restart](#self-restart) | `request` | Orchestrator restart signal |
| [telegram](#telegram) | `send`, `edit`, `delete`, `react`, `setChatAction`, `downloadFile` | Telegram messaging |
| [slack](#slack) | `send`, `read`, `edit`, `delete`, `react`, `downloadFile` | Slack messaging |

---

## bash

Shell command execution tool. All commands run in the agent instance's working directory (`ctx.workdir`) by default.

**Resource name:** `bash`
**Error message limit:** 1200 characters

### bash__exec

Run a shell command in the instance working directory.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `command` | string | Yes | -- | Shell command to execute |
| `cwd` | string | No | `ctx.workdir` | Working directory (relative paths resolve from `ctx.workdir`) |
| `timeoutMs` | number | No | `30000` | Command timeout in milliseconds |
| `env` | object | No | `process.env` | Additional environment variables (string/number/boolean values) |

**Returns:**

```json
{
  "command": "ls -la",
  "cwd": "/path/to/workdir",
  "durationMs": 42,
  "stdout": "total 8\n...",
  "stderr": "",
  "exitCode": 0,
  "signal": null,
  "timedOut": false
}
```

### bash__script

Run a script file with optional arguments.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Script file path (relative to `ctx.workdir`) |
| `args` | string[] | No | `[]` | Arguments passed to the script |
| `shell` | string | No | `/bin/bash` | Shell interpreter to use |
| `timeoutMs` | number | No | `30000` | Script timeout in milliseconds |
| `env` | object | No | `process.env` | Additional environment variables |

**Returns:**

```json
{
  "path": "/path/to/script.sh",
  "shell": "/bin/bash",
  "args": ["arg1"],
  "durationMs": 120,
  "stdout": "...",
  "stderr": "",
  "exitCode": 0,
  "signal": null,
  "timedOut": false
}
```

---

## file-system

File system operations within the agent instance workspace.

**Resource name:** `file-system`
**Error message limit:** 2000 characters

### file-system__read

Read file content from the working directory.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | -- | File path (relative to `ctx.workdir` or absolute) |
| `maxBytes` | number | No | `100000` | Maximum bytes to read (must be > 0) |

**Returns:**

```json
{
  "path": "/absolute/path/to/file.txt",
  "size": 1234,
  "truncated": false,
  "content": "file contents here..."
}
```

### file-system__write

Write content to a file. Parent directories are created automatically.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | -- | File path (relative to `ctx.workdir` or absolute) |
| `content` | string | Yes | -- | Content to write |
| `append` | boolean | No | `false` | Append to existing file instead of overwriting |

**Returns:**

```json
{
  "path": "/absolute/path/to/file.txt",
  "size": 42,
  "written": true,
  "append": false
}
```

### file-system__list

List directory entries.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | `"."` | Directory path (relative to `ctx.workdir` or absolute) |
| `recursive` | boolean | No | `false` | Recursively list subdirectories |
| `includeDirs` | boolean | No | `true` | Include directories in results |
| `includeFiles` | boolean | No | `true` | Include files in results |

**Returns:**

```json
{
  "path": "/absolute/path/to/dir",
  "recursive": false,
  "count": 3,
  "entries": [
    { "name": "src", "path": "/absolute/path/to/dir/src", "type": "dir" },
    { "name": "README.md", "path": "/absolute/path/to/dir/README.md", "type": "file", "size": 1024 }
  ]
}
```

### file-system__mkdir

Create a directory in the working directory.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Directory path (relative to `ctx.workdir` or absolute) |
| `recursive` | boolean | No | `true` | Create parent directories as needed |

**Returns:**

```json
{
  "path": "/absolute/path/to/new-dir",
  "created": true,
  "recursive": true
}
```

---

## http-fetch

HTTP request tool with built-in SSRF prevention. Only `http:` and `https:` protocols are allowed.

**Resource name:** `http-fetch`
**Max response bytes:** 500,000

### http-fetch__get

Perform an HTTP GET request.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Request URL (http/https only) |
| `headers` | object | No | `{}` | Request headers |
| `timeoutMs` | number | No | `30000` | Request timeout in milliseconds |
| `maxBytes` | number | No | `500000` | Maximum response body bytes |

**Returns:**

```json
{
  "url": "https://api.example.com/data",
  "method": "GET",
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": "{\"key\": \"value\"}",
  "truncated": false,
  "durationMs": 150
}
```

### http-fetch__post

Perform an HTTP POST request.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Request URL (http/https only) |
| `body` | object | No | -- | JSON request body (auto-sets `Content-Type: application/json`) |
| `bodyString` | string | No | -- | Raw string request body (used when `body` is not provided) |
| `headers` | object | No | `{}` | Request headers |
| `timeoutMs` | number | No | `30000` | Request timeout in milliseconds |
| `maxBytes` | number | No | `500000` | Maximum response body bytes |

**Returns:** Same structure as `http-fetch__get` with `"method": "POST"`.

---

## json-query

JSON data querying tool. All operations accept a `data` parameter as a JSON string.

**Resource name:** `json-query`

### json-query__query

Query JSON data by dot-notation path (supports bracket notation for arrays).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `data` | string | Yes | -- | JSON string to query |
| `path` | string | No | `"."` | Dot-notation path (e.g., `users[0].name`, `.items.count`) |

**Returns:**

```json
{
  "path": "users[0].name",
  "found": true,
  "value": "Alice"
}
```

### json-query__pick

Pick specific keys from a JSON object.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `data` | string | Yes | -- | JSON string (must be an object) |
| `keys` | string[] | Yes | -- | Array of keys to extract |

**Returns:**

```json
{
  "keys": ["name", "email"],
  "result": {
    "name": "Alice",
    "email": "alice@example.com"
  }
}
```

### json-query__count

Count elements at a JSON path.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `data` | string | Yes | -- | JSON string |
| `path` | string | No | `"."` | Dot-notation path to count at |

**Returns:**

```json
{
  "path": ".items",
  "count": 5,
  "type": "array"
}
```

The `type` field indicates the resolved type: `"array"`, `"object"` (key count), `"string"` (character count), `"null"`, or a primitive type (`"number"`, `"boolean"`) with count `1`.

### json-query__flatten

Flatten nested JSON arrays.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `data` | string | Yes | -- | JSON string (must be an array) |
| `depth` | number | No | `1` | Maximum flattening depth |

**Returns:**

```json
{
  "depth": 1,
  "count": 4,
  "result": [1, 2, 3, 4]
}
```

---

## text-transform

Text transformation utilities.

**Resource name:** `text-transform`

### text-transform__replace

Replace text occurrences.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | Yes | -- | Input text |
| `search` | string | Yes | -- | String to search for |
| `replacement` | string | No | `""` | Replacement string |
| `all` | boolean | No | `false` | Replace all occurrences (not just the first) |

**Returns:**

```json
{
  "original": "hello world hello",
  "result": "hi world hello",
  "replacements": 1
}
```

### text-transform__slice

Extract a substring by start/end positions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | Yes | -- | Input text |
| `start` | number | No | `0` | Start index (inclusive) |
| `end` | number | No | end of string | End index (exclusive) |

**Returns:**

```json
{
  "original": "hello world",
  "result": "hello",
  "start": 0,
  "end": 5,
  "length": 5
}
```

### text-transform__split

Split text by a delimiter.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | Yes | -- | Input text |
| `delimiter` | string | No | `"\n"` | Delimiter string |
| `maxParts` | number | No | unlimited | Maximum number of parts |

**Returns:**

```json
{
  "delimiter": "\n",
  "count": 3,
  "parts": ["line1", "line2", "line3"]
}
```

### text-transform__join

Join an array of strings with a delimiter.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `parts` | array | Yes | -- | Array of string/number/boolean values to join |
| `delimiter` | string | No | `"\n"` | Delimiter string |

**Returns:**

```json
{
  "delimiter": ", ",
  "count": 3,
  "result": "a, b, c"
}
```

### text-transform__trim

Trim whitespace from text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | Yes | -- | Input text |
| `mode` | string | No | `"both"` | Trim mode: `"both"`, `"start"`, or `"end"` |

**Returns:**

```json
{
  "original": "  hello  ",
  "result": "hello",
  "mode": "both",
  "trimmedLength": 4
}
```

### text-transform__case

Transform text case.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | Yes | -- | Input text |
| `to` | string | Yes | -- | Target case: `"upper"` or `"lower"` |

**Returns:**

```json
{
  "original": "Hello World",
  "result": "HELLO WORLD",
  "to": "upper"
}
```

---

## agents

Inter-agent communication tool. Enables agents to delegate tasks, send fire-and-forget messages, spawn instances, list running agents, and query the agent catalog.

**Resource name:** `agents`
**Error message limit:** 1500 characters

> Requires `ToolContext.runtime` to be available. This tool interacts with the Orchestrator via IPC using the unified event model (`AgentEvent`).

### agents__request

Send a request event to another agent. By default it blocks until response (`async=false`), or returns immediately when `async=true` (response is queued into the caller's message inbox for the next step).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | Yes | -- | Target agent name |
| `input` | string | Yes | -- | Message text to send |
| `instanceKey` | string | No | caller's `instanceKey` | Target instance key |
| `eventType` | string | No | `"agent.request"` | Custom event type |
| `timeoutMs` | number | No | `60000` | Response timeout in milliseconds |
| `async` | boolean | No | `false` | `false`: blocking response, `true`: immediate ack + queued response |
| `metadata` | object | No | -- | Additional metadata attached to the event |

**Returns:**

```json
{
  "target": "researcher",
  "eventId": "agent_event_abc123",
  "correlationId": "corr_xyz789",
  "accepted": true,
  "async": false,
  "response": "Here is the research result..."
}
```

When `async=true`, `response` may be `null` at call time. The actual response is injected as a user message with `metadata.__goondanInterAgentResponse`.

### agents__send

Send a fire-and-forget event to another agent. Returns immediately without waiting for a response. The target agent is auto-spawned if not already running.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | Yes | -- | Target agent name |
| `input` | string | Yes | -- | Message text to send |
| `instanceKey` | string | No | caller's `instanceKey` | Target instance key |
| `eventType` | string | No | `"agent.send"` | Custom event type |
| `metadata` | object | No | -- | Additional metadata attached to the event |

**Returns:**

```json
{
  "target": "logger",
  "eventId": "agent_event_abc123",
  "accepted": true
}
```

### agents__spawn

Spawn or prepare an instance of an already-defined agent resource in the current swarm. Does not create new agent definitions -- only initializes instances of agents declared in `goondan.yaml`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | Yes | -- | Agent name (must be defined in the current Swarm) |
| `instanceKey` | string | No | -- | Custom instance key for the spawned agent |
| `cwd` | string | No | -- | Working directory for the spawned agent |

**Returns:**

```json
{
  "target": "worker",
  "instanceKey": "worker-task-42",
  "spawned": true,
  "cwd": null
}
```

### agents__list

List spawned agent instances in the current runtime.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `includeAll` | boolean | No | `false` | Include all instances (not just those spawned by the caller) |

**Returns:**

```json
{
  "count": 2,
  "agents": [
    {
      "target": "worker",
      "instanceKey": "worker-task-1",
      "ownerAgent": "coordinator",
      "ownerInstanceKey": "coordinator",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "cwd": null
    }
  ]
}
```

### agents__catalog

Describe available and callable agents in the selected swarm.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| _(none)_ | -- | -- | -- | No parameters required |

**Returns:**

```json
{
  "swarmName": "my-swarm",
  "entryAgent": "coordinator",
  "selfAgent": "coordinator",
  "availableCount": 3,
  "callableCount": 2,
  "availableAgents": ["coordinator", "researcher", "writer"],
  "callableAgents": ["researcher", "writer"]
}
```

---

## self-restart

Signals the orchestrator to perform a self-restart. Used for self-evolution scenarios where the agent determines it needs a configuration refresh.

**Resource name:** `self-restart`

### self-restart__request

Request an orchestrator restart via a runtime restart signal.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `reason` | string | No | `"tool:self-restart"` | Reason for the restart request |

**Returns:**

```json
{
  "ok": true,
  "restartRequested": true,
  "restartReason": "Updated configuration"
}
```

> After the tool returns, the runtime detects the restart signal, performs a graceful shutdown (including Connector termination), and spawns a replacement orchestrator process.

---

## telegram

Telegram Bot API tool. Supports message sending, editing, deletion, reactions, chat actions, and file downloads.

**Resource name:** `telegram`

**Token resolution:** The bot token is resolved in this order:
1. `token` parameter (if provided)
2. Environment variables: `TELEGRAM_BOT_TOKEN`, `BOT_TOKEN`, `TELEGRAM_TOKEN`, `BRAIN_TELEGRAM_BOT_TOKEN`

**Common optional parameters** (available on all exports):

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `token` | string | env lookup | Bot token override |
| `timeoutMs` | number | `15000` | API request timeout |
| `apiBaseUrl` | string | `https://api.telegram.org` | Custom API base URL |

### telegram__send

Send a message to a Telegram chat.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chatId` | string | Yes | -- | Target chat ID (string or integer) |
| `text` | string | Yes | -- | Message text |
| `parseMode` | string | No | -- | Parse mode: `"Markdown"`, `"MarkdownV2"`, `"HTML"` (case-insensitive aliases accepted) |
| `disableNotification` | boolean | No | -- | Send silently |
| `disableWebPagePreview` | boolean | No | -- | Disable link previews |
| `replyToMessageId` | number | No | -- | Message ID to reply to |
| `allowSendingWithoutReply` | boolean | No | -- | Allow reply even if the referenced message is deleted |

**Returns:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "date": 1700000000,
  "text": "Hello!"
}
```

### telegram__edit

Edit a Telegram message's text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chatId` | string | Yes | -- | Chat ID |
| `messageId` | number | Yes | -- | Message ID to edit |
| `text` | string | Yes | -- | New message text |
| `parseMode` | string | No | -- | Parse mode |
| `disableWebPagePreview` | boolean | No | -- | Disable link previews |

**Returns:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "edited": true
}
```

### telegram__delete

Delete a message from a Telegram chat.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chatId` | string | Yes | -- | Chat ID |
| `messageId` | number | Yes | -- | Message ID to delete |

**Returns:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "deleted": true
}
```

### telegram__react

Set or clear reactions on a Telegram message.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chatId` | string | Yes | -- | Chat ID |
| `messageId` | number | Yes | -- | Message ID |
| `emoji` | string | No* | -- | Single emoji reaction |
| `emojis` | string[] | No* | -- | Multiple emoji reactions |
| `clear` | boolean | No | `false` | Remove all reactions |
| `isBig` | boolean | No | -- | Show large reaction animation |

*Either `emoji`, `emojis`, or `clear=true` must be provided.

**Returns:**

```json
{
  "ok": true,
  "chatId": "123456",
  "messageId": 42,
  "cleared": false,
  "emojis": ["thumbsup"],
  "reactionCount": 1
}
```

### telegram__setChatAction

Set a bot chat action (e.g., "typing..." indicator).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chatId` | string | Yes | -- | Chat ID |
| `action` | string | No | `"typing"` | Chat action (alias for `status`) |
| `status` | string | No | `"typing"` | Chat action (alias for `action`) |

Supported actions: `typing`, `upload-photo`, `record-video`, `upload-video`, `record-voice`, `upload-voice`, `upload-document`, `choose-sticker`, `find-location`, `record-video-note`, `upload-video-note`

**Returns:**

```json
{
  "ok": true,
  "chatId": "123456",
  "status": "typing",
  "action": "typing"
}
```

### telegram__downloadFile

Download a file from Telegram by file ID.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `fileId` | string | Yes* | -- | Telegram file ID |
| `file_id` | string | Yes* | -- | Alternative key for file ID |
| `maxBytes` | number | No | `3000000` | Maximum download size (1--20,000,000) |
| `includeBase64` | boolean | No | `true` | Include base64-encoded content |
| `includeDataUrl` | boolean | No | `true` | Include data URL |
| `savePath` | string | No | -- | Save file to this path (relative to `ctx.workdir`) |
| `outputPath` | string | No | -- | Alternative key for save path |

*Either `fileId` or `file_id` must be provided.

**Returns:**

```json
{
  "ok": true,
  "fileId": "ABC123",
  "fileUniqueId": "XYZ",
  "filePath": "photos/file_0.jpg",
  "fileSize": 12345,
  "downloadUrl": "https://api.telegram.org/file/bot.../photos/file_0.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 12345,
  "savedPath": null,
  "base64": "...",
  "dataUrl": "data:image/jpeg;base64,..."
}
```

---

## slack

Slack API tool. Supports message sending, reading, editing, deletion, reactions, and file downloads.

**Resource name:** `slack`

**Token resolution:** The bot token is resolved in this order:
1. `token` parameter (if provided)
2. Environment variables: `SLACK_BOT_TOKEN`, `SLACK_TOKEN`, `BRAIN_SLACK_BOT_TOKEN`

**Common optional parameters** (available on all exports):

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `token` | string | env lookup | Bot token override |
| `timeoutMs` | number | `15000` | API request timeout |
| `apiBaseUrl` | string | `https://slack.com/api` | Custom API base URL |

### slack__send

Send a message to a Slack channel.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | Yes | -- | Target channel ID (alias: `channel`) |
| `text` | string | Yes | -- | Message text |
| `threadTs` | string | No | -- | Thread timestamp (reply in thread) |
| `mrkdwn` | boolean | No | -- | Enable Markdown formatting |
| `unfurlLinks` | boolean | No | -- | Enable link unfurling |
| `unfurlMedia` | boolean | No | -- | Enable media unfurling |
| `replyBroadcast` | boolean | No | -- | Broadcast thread reply to channel |

**Returns:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "text": "Hello!"
}
```

### slack__read

Read messages from a Slack channel or thread.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | Yes | -- | Channel ID (alias: `channel`) |
| `messageTs` | string | No | -- | Fetch a specific message by timestamp (aliases: `ts`, `timestamp`) |
| `threadTs` | string | No | -- | Read thread replies |
| `latest` | string | No | -- | Latest message timestamp bound |
| `oldest` | string | No | -- | Oldest message timestamp bound |
| `inclusive` | boolean | No | auto | Include boundary messages |
| `limit` | number | No | `20` (or `1` if `messageTs` set) | Max messages to return (1--1000) |
| `cursor` | string | No | -- | Pagination cursor |

**Returns:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "method": "conversations.history",
  "messageTs": null,
  "threadTs": null,
  "count": 5,
  "found": null,
  "messages": [ ... ],
  "hasMore": false,
  "nextCursor": null
}
```

### slack__edit

Edit a Slack message.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | Yes | -- | Channel ID (alias: `channel`) |
| `messageTs` | string | Yes | -- | Message timestamp to edit (aliases: `ts`, `timestamp`) |
| `text` | string | Yes | -- | New message text |
| `mrkdwn` | boolean | No | -- | Enable Markdown formatting |

**Returns:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "edited": true
}
```

### slack__delete

Delete a Slack message.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | Yes | -- | Channel ID (alias: `channel`) |
| `messageTs` | string | Yes | -- | Message timestamp to delete (aliases: `ts`, `timestamp`) |

**Returns:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "deleted": true
}
```

### slack__react

Add one or more reactions to a Slack message.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | Yes | -- | Channel ID (alias: `channel`) |
| `messageTs` | string | Yes | -- | Message timestamp (aliases: `ts`, `timestamp`) |
| `emoji` | string | No* | -- | Single emoji name (with or without `:colons:`) |
| `emojis` | string[] | No* | -- | Multiple emoji names |

*Either `emoji` or `emojis` must be provided.

**Returns:**

```json
{
  "ok": true,
  "channelId": "C01ABC23DEF",
  "messageTs": "1700000000.000001",
  "emojis": ["thumbsup", "wave"],
  "reactionCount": 2
}
```

### slack__downloadFile

Download a file from Slack with bot token authentication.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes* | -- | File download URL (aliases: `fileUrl`, `downloadUrl`) |
| `maxBytes` | number | No | `3000000` | Maximum download size (1--20,000,000) |
| `includeBase64` | boolean | No | `true` | Include base64-encoded content |
| `includeDataUrl` | boolean | No | `true` | Include data URL |
| `savePath` | string | No | -- | Save file to this path (relative to `ctx.workdir`) |
| `outputPath` | string | No | -- | Alternative key for save path |

*One of `url`, `fileUrl`, or `downloadUrl` must be provided.

**Returns:**

```json
{
  "ok": true,
  "url": "https://files.slack.com/...",
  "contentType": "image/png",
  "contentLength": 54321,
  "sizeBytes": 54321,
  "etag": "\"abc123\"",
  "contentDisposition": "attachment; filename=\"image.png\"",
  "savedPath": null,
  "base64": "...",
  "dataUrl": "data:image/png;base64,..."
}
```

---

## YAML Usage Example

To use built-in tools in your agent, reference them in `goondan.yaml`:

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
    - ref: Tool/bash
    - ref: Tool/file-system
    - ref: Tool/http-fetch
    - ref: Tool/agents
```

This registers all exports of the referenced tools. The LLM will see them as `bash__exec`, `bash__script`, `file-system__read`, `file-system__write`, etc.

---

_Document version: v0.0.3_
