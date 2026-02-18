# Build Your First Tool

> **A step-by-step tutorial to create a custom Tool from scratch, register it with an agent, and run it.**

[Korean version (한국어)](./02-build-your-first-tool.ko.md)

**What you will build:** A `string-utils` Tool with two exports -- `reverse` (reverses a string) and `count` (counts characters, words, and lines). By the end, your agent will be able to call `string-utils__reverse` and `string-utils__count` through LLM tool calls.

**Time required:** ~15 minutes

**Prerequisites:**

- A working Goondan project (complete [Getting Started](./01-getting-started.md) first)
- Bun installed
- An API key for at least one LLM provider (Anthropic, OpenAI, or Google)

---

## Step 1: Understand what you are building

Before writing any code, plan the Tool you want to create.

A Tool in Goondan is a first-class resource (`kind: Tool`) that exposes one or more functions to the LLM. Each function is called an **export**. When the LLM invokes a tool, it uses the **double-underscore naming convention**:

```
{resource name}__{export name}
```

For our `string-utils` Tool with exports `reverse` and `count`, the LLM will see:

- `string-utils__reverse` -- reverses a given string
- `string-utils__count` -- counts characters, words, and lines in a string

This naming convention ensures that tool names are always unambiguous, even when multiple Tool resources are loaded. The `__` separator is safe to use with the AI SDK -- no encoding or escaping is needed.

> **Deep dive:** To understand why this convention was chosen, read [Tool System -- The double-underscore naming convention](../explanation/tool-system.md#the-double-underscore-naming-convention).

---

## Step 2: Create the project structure

Starting from your existing Goondan project, create a directory for the Tool's handler module:

```bash
mkdir -p tools/string-utils
```

Your project should now look like this:

```
my-project/
  goondan.yaml          # Existing config from Getting Started
  .env                  # Your API keys
  tools/
    string-utils/
      index.ts          # (you will create this next)
```

---

## Step 3: Define the Tool resource in YAML

Open your `goondan.yaml` and add a new `kind: Tool` document. Each YAML document in `goondan.yaml` is separated by `---`.

Add the following after your existing resources:

```yaml
---
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: string-utils
spec:
  entry: "./tools/string-utils/index.ts"

  exports:
    - name: reverse
      description: "Reverse a string. Returns the input string with characters in reverse order."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to reverse"
        required: [text]

    - name: count
      description: "Count characters, words, and lines in a string."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to analyze"
        required: [text]
```

### What each field means

| Field | Purpose |
|-------|---------|
| `metadata.name` | Resource name. Must not contain `__`. This becomes the first part of the LLM tool name. |
| `spec.entry` | Path to the TypeScript module containing your handler functions (relative to project root). |
| `spec.exports` | Array of functions exposed to the LLM. Each must have a unique `name`. |
| `exports[].name` | Export name. Must not contain `__`. Becomes the second part of the LLM tool name. |
| `exports[].description` | Human-readable description the LLM uses to decide when to call this function. Write it clearly -- the LLM reads this. |
| `exports[].parameters` | JSON Schema defining what input the LLM should provide. |

### Naming rules

Both the resource name and export names have strict rules:

- Only lowercase letters, digits, and hyphens are allowed
- `__` (double underscore) is **forbidden** inside names
- Export names must be unique within the same Tool resource

Even if your Tool has only a single export, you must follow the `{resource}__{export}` pattern. This consistency means the runtime never needs special-case logic.

> **Reference:** For the complete Tool YAML schema, see [Resources Reference](../reference/resources.md#tool).

---

## Step 4: Implement the handler module

Create the file `tools/string-utils/index.ts`. This is the entry module that Goondan's AgentProcess (Bun) loads at runtime.

The module must export a `handlers` object -- a map from export names to handler functions:

```typescript
// tools/string-utils/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  reverse: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text);
    ctx.logger.info(`Reversing string of length ${text.length}`);

    const reversed = text.split('').reverse().join('');

    return {
      original: text,
      reversed,
      length: text.length,
    };
  },

  count: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text);
    ctx.logger.info(`Counting in string of length ${text.length}`);

    const characters = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lines = text.split('\n').length;

    return {
      characters,
      words,
      lines,
    };
  },
};
```

### Key points about the handler

1. **`handlers` export is required** -- The runtime looks for exactly this named export. Each key must match an export `name` from your YAML definition.

2. **Handler signature** -- Every handler receives two arguments:
   - `ctx: ToolContext` -- the execution context (workspace path, logger, runtime APIs)
   - `input: JsonObject` -- the parameters the LLM provided, matching your JSON Schema

3. **Return value** -- Handlers return a `JsonValue` (any JSON-serializable value). This is sent back to the LLM as the tool call result.

4. **Input validation** -- Always validate and coerce input. The LLM might send unexpected types. Use `String(input.text)` rather than trusting `input.text` is a string.

5. **Use `ctx.logger`** -- Use `ctx.logger.info()`, `ctx.logger.warn()`, etc. instead of `console.log`. Log output is captured per-process and accessible via `gdn logs`.

> **Reference:** For the complete `ToolHandler` and `ToolContext` API, see [Tool API Reference](../reference/tool-api.md).

---

## Step 5: Use ToolContext effectively

The `ToolContext` provides essential runtime services. Let's look at the most important fields:

### `ctx.workdir` -- instance workspace

If your tool works with files, always use `ctx.workdir` as the base directory. This keeps each agent instance's data isolated:

```typescript
import { join, isAbsolute } from 'path';

// Resolve file paths relative to the workspace
const targetPath = isAbsolute(input.path)
  ? input.path
  : join(ctx.workdir, String(input.path));
```

Our `string-utils` tool does not need file access, but this pattern is critical for tools like `file-system` or `bash`.

### `ctx.logger` -- structured logging

The logger follows the `Console` interface. Output is captured per-process and accessible via `gdn logs`:

```typescript
ctx.logger.info('Processing started', { text: input.text });
ctx.logger.warn('Input is very long', { length: text.length });
ctx.logger.error('Unexpected error', { error: err.message });
```

### `ctx.toolCallId` and `ctx.message`

- `toolCallId` uniquely identifies this specific tool invocation. Useful for correlating log entries.
- `message` is the assistant message that contains the current tool call. Useful when you need context about what the LLM was doing.

> **Deep dive:** For why ToolContext is deliberately kept minimal, see [Tool System -- ToolContext: the execution environment](../explanation/tool-system.md#toolcontext-the-execution-environment).

---

## Step 6: Register the Tool with your Agent

Now connect your Tool to an Agent. In your `goondan.yaml`, find the Agent resource and add your Tool to `spec.tools`:

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  systemPrompt: |
    You are a helpful assistant. You have access to string utility tools.
    Use string-utils__reverse to reverse strings and string-utils__count
    to count characters, words, and lines.
  tools:
    - ref: "Tool/string-utils"
```

The `ref: "Tool/string-utils"` is a string shorthand for referencing a local Tool resource. It tells Goondan to look up the Tool named `string-utils` in the same bundle.

### Combining with built-in tools

You can use your custom tool alongside built-in tools from `@goondan/base`:

```yaml
spec:
  tools:
    - ref: "Tool/string-utils"           # Your custom tool
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"         # Built-in tool (cross-package reference)
    - ref:
        kind: Tool
        name: file-system
        package: "@goondan/base"
```

> **Reference:** For all ObjectRef patterns, see [Resources Reference -- ObjectRef](../reference/resources.md#objectref).

---

## Step 7: Validate your configuration

Before running the swarm, use `gdn validate` to check for configuration errors:

```bash
gdn validate
```

Validation checks the following for each Tool resource:

| Check | What it verifies |
|-------|-----------------|
| Entry path exists | `spec.entry` points to a file on disk |
| At least one export | `spec.exports` has one or more entries |
| Unique export names | No duplicate names within the same Tool |
| No `__` in names | Resource name and export names do not contain `__` |
| Handler module | Entry module exports a `handlers` object |
| Handler matching | Each export name has a corresponding handler |

**Expected output on success:**

```
Validating goondan.yaml...
  Package my-project ............. ok
  Model claude ................... ok
  Tool string-utils .............. ok
  Agent assistant ................ ok
  Swarm my-swarm ................. ok

Validation passed.
```

**If validation fails**, read the error message carefully. Common issues:

- **Entry file not found** -- Check the `spec.entry` path. It must be relative to the project root.
- **Missing handler** -- Ensure every export name in YAML has a matching key in the `handlers` object.
- **Duplicate export name** -- Each export name must be unique within the Tool.

Fix any errors and run `gdn validate` again until it passes.

---

## Step 8: Run and test your Tool

Start the swarm:

```bash
gdn run
```

Once the runtime is running, interact with your agent through the configured Connector (CLI, Telegram, Slack, etc.). Try prompts like:

- _"Reverse the string 'Hello, Goondan!'"_
- _"Count the characters, words, and lines in this text: 'One\nTwo\nThree'"_
- _"What is 'racecar' reversed?"_

### What to observe

1. **Tool discovery** -- The LLM should recognize `string-utils__reverse` and `string-utils__count` from their descriptions and call them when appropriate.

2. **Correct input** -- The LLM should pass the `text` parameter as defined in your JSON Schema.

3. **Structured output** -- Your handler's return value appears as the tool call result in the conversation.

4. **Logs** -- Check the logs for your `ctx.logger` messages:

   ```bash
   gdn logs
   ```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| LLM never calls the tool | `description` is unclear | Rewrite the export `description` to be more specific |
| LLM calls the wrong tool | Tool names are ambiguous | Make descriptions more distinct |
| Tool call returns error | Handler threw an exception | Check logs with `gdn logs` |
| "Tool not in catalog" error | Tool not registered with Agent | Add `ref: "Tool/string-utils"` to `spec.tools` |

---

## Step 9: Improve error handling

Right now, if something goes wrong in our handler, the error message will be generic. Let's add better error handling with `suggestion` and `helpUrl` fields.

Update the `reverse` handler to validate input more carefully:

```typescript
reverse: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const text = String(input.text ?? '');

  if (text.length === 0) {
    const error = new Error('Input text is empty. Provide a non-empty string to reverse.');
    Object.assign(error, {
      code: 'E_EMPTY_INPUT',
      suggestion: 'Pass a non-empty "text" parameter.',
    });
    throw error;
  }

  if (text.length > 100_000) {
    const error = new Error(`Input too long: ${text.length} characters (max: 100,000).`);
    Object.assign(error, {
      code: 'E_INPUT_TOO_LONG',
      suggestion: 'Shorten the input text to under 100,000 characters.',
      helpUrl: 'https://docs.goondan.ai/errors/E_INPUT_TOO_LONG',
    });
    throw error;
  }

  ctx.logger.info(`Reversing string of length ${text.length}`);
  const reversed = text.split('').reverse().join('');

  return {
    original: text,
    reversed,
    length: text.length,
  };
},
```

### How error handling works

When a handler throws an error, Goondan does **not** crash the agent. Instead, the runtime catches the error and converts it into a structured `ToolCallResult`:

```json
{
  "status": "error",
  "error": {
    "code": "E_EMPTY_INPUT",
    "name": "Error",
    "message": "Input text is empty. Provide a non-empty string to reverse.",
    "suggestion": "Pass a non-empty \"text\" parameter."
  }
}
```

This result is fed back to the LLM, which can then retry with corrected input or inform the user. The `suggestion` field is especially helpful -- it gives the LLM an actionable recovery hint.

### Error message truncation

By default, error messages are truncated to 1000 characters. If your tool might produce verbose errors (e.g., stack traces from external APIs), increase the limit:

```yaml
spec:
  errorMessageLimit: 2000
```

> **How-to:** For a complete error handling checklist, see [Write a Tool -- Handle errors properly](../how-to/write-a-tool.md#step-5-handle-errors-properly).

---

## Complete example

Here is the complete `goondan.yaml` with all the resources needed for this tutorial:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-first-tool-project

---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514

---
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: string-utils
spec:
  entry: "./tools/string-utils/index.ts"

  exports:
    - name: reverse
      description: "Reverse a string. Returns the input string with characters in reverse order."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to reverse"
        required: [text]

    - name: count
      description: "Count characters, words, and lines in a string."
      parameters:
        type: object
        properties:
          text:
            type: string
            description: "The text to analyze"
        required: [text]

---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  systemPrompt: |
    You are a helpful assistant with string utility tools.
    Use string-utils__reverse to reverse strings and
    string-utils__count to count characters, words, and lines.
  tools:
    - ref: "Tool/string-utils"

---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: my-swarm
spec:
  entryAgent:
    ref: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
```

And the complete handler module with error handling:

```typescript
// tools/string-utils/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  reverse: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text ?? '');

    if (text.length === 0) {
      const error = new Error('Input text is empty. Provide a non-empty string to reverse.');
      Object.assign(error, {
        code: 'E_EMPTY_INPUT',
        suggestion: 'Pass a non-empty "text" parameter.',
      });
      throw error;
    }

    if (text.length > 100_000) {
      const error = new Error(`Input too long: ${text.length} characters (max: 100,000).`);
      Object.assign(error, {
        code: 'E_INPUT_TOO_LONG',
        suggestion: 'Shorten the input text to under 100,000 characters.',
      });
      throw error;
    }

    ctx.logger.info(`Reversing string of length ${text.length}`);
    const reversed = text.split('').reverse().join('');

    return {
      original: text,
      reversed,
      length: text.length,
    };
  },

  count: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const text = String(input.text ?? '');

    if (text.length === 0) {
      const error = new Error('Input text is empty. Provide a non-empty string to analyze.');
      Object.assign(error, {
        code: 'E_EMPTY_INPUT',
        suggestion: 'Pass a non-empty "text" parameter.',
      });
      throw error;
    }

    ctx.logger.info(`Counting in string of length ${text.length}`);

    const characters = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lines = text.split('\n').length;

    return {
      characters,
      words,
      lines,
    };
  },
};
```

---

## What you learned

In this tutorial, you:

1. **Designed a Tool** -- Planned exports and their JSON Schema parameters
2. **Wrote the YAML resource** -- Defined `kind: Tool` with `metadata.name`, `spec.entry`, and `spec.exports`
3. **Implemented handlers** -- Created a module exporting `handlers: Record<string, ToolHandler>`
4. **Used ToolContext** -- Leveraged `ctx.logger` for structured logging
5. **Registered with an Agent** -- Added the Tool to `spec.tools` using `ref: "Tool/string-utils"`
6. **Validated and ran** -- Used `gdn validate` and `gdn run` to verify and test
7. **Improved error handling** -- Added `suggestion` and `helpUrl` fields to thrown errors

### Key concepts

- **Double-underscore naming**: `{resource}__{export}` -- e.g., `string-utils__reverse`
- **`handlers` export**: The entry module must export `handlers: Record<string, ToolHandler>`
- **Error as data**: Thrown errors become structured `ToolCallResult` objects that the LLM can reason about
- **ToolContext is minimal**: Only `workdir`, `logger`, `runtime`, `message`, and `toolCallId` -- keeping tools simple and testable

---

## Next steps

Now that you can build custom tools, explore these resources:

| Next | Document |
|------|----------|
| **Build an Extension** | [Build Your First Extension](./03-build-your-first-extension.md) -- create middleware that hooks into the pipeline |
| **Production checklist** | [Write a Tool (How-to)](../how-to/write-a-tool.md) -- complete checklist for production-ready tools |
| **Tool architecture** | [Tool System (Explanation)](../explanation/tool-system.md) -- Registry vs Catalog, in-process execution, middleware interception |
| **Full API** | [Tool API Reference](../reference/tool-api.md) -- `ToolHandler`, `ToolContext`, `AgentToolRuntime`, `ToolCallResult` |
| **Built-in tools** | [Built-in Tools Reference](../reference/builtin-tools.md) -- learn from the `@goondan/base` tools |
| **Multi-agent patterns** | [Multi-Agent Patterns](../how-to/multi-agent-patterns.md) -- use `ctx.runtime` for inter-agent communication |

---

_Tutorial version: v0.0.3_
