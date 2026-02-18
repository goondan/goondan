# How to Write a Tool

> **Production checklist for building custom tools in Goondan.**

[Korean version (한국어)](./write-a-tool.ko.md)

**See also:**

- [Tool API Reference](../reference/tool-api.md) -- complete TypeScript interfaces
- [Tool System (Explanation)](../explanation/tool-system.md) -- design rationale and architecture
- [Build Your First Tool (Tutorial)](../tutorials/02-build-your-first-tool.md) -- step-by-step beginner guide

---

## Prerequisites

Before you start, make sure you have:

- A Goondan project initialized (`gdn init`)
- A `goondan.yaml` file with at least a `Package` resource
- Bun installed (tools run inside AgentProcess on Bun)
- Familiarity with the [double-underscore naming convention](../explanation/tool-system.md#the-double-underscore-naming-convention)

---

## Step 1: Define the Tool resource in YAML

Create or add a `kind: Tool` document in your `goondan.yaml`. Every Tool resource needs three things: a `name`, an `entry` pointing to your handler module, and at least one `export`.

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: weather          # Resource name (no double underscores allowed)
spec:
  entry: "./tools/weather/index.ts"   # Path to handler module (project root relative)
  errorMessageLimit: 1500             # Optional: max error message length (default: 1000)

  exports:
    - name: forecast                  # Export name (no double underscores allowed)
      description: "Get weather forecast for a city"
      parameters:
        type: object
        properties:
          city:
            type: string
            description: "City name (e.g., Seoul, Tokyo, New York)"
          days:
            type: number
            description: "Number of forecast days (default: 3)"
        required: [city]

    - name: current
      description: "Get current weather conditions for a city"
      parameters:
        type: object
        properties:
          city:
            type: string
            description: "City name"
        required: [city]
```

The LLM will see these as `weather__forecast` and `weather__current`.

### Naming rules checklist

- [ ] Resource name contains only lowercase letters, digits, and hyphens
- [ ] Resource name does **not** contain `__`
- [ ] Export names do **not** contain `__`
- [ ] Export names are unique within the same Tool resource
- [ ] Each export has a clear `description` (the LLM uses this to decide when to call the tool)

> For the complete Tool YAML schema, see [Resources Reference -- Tool](../reference/resources.md#tool).

---

## Step 2: Write the JSON Schema parameters

Good JSON Schema definitions help the LLM provide accurate inputs. Follow these best practices:

### Be explicit with descriptions

```yaml
parameters:
  type: object
  properties:
    query:
      type: string
      description: "Search query. Use natural language. Max 200 characters."
    limit:
      type: number
      description: "Maximum results to return (1-100, default: 10)"
    format:
      type: string
      description: "Output format"
      enum: [json, csv, text]
  required: [query]
```

### Use `enum` for constrained values

When a parameter has a fixed set of valid values, use `enum`. This prevents the LLM from inventing invalid inputs:

```yaml
mode:
  type: string
  description: "Processing mode"
  enum: [fast, balanced, thorough]
```

### Use `required` judiciously

Only mark parameters as `required` if the tool genuinely cannot function without them. Optional parameters with sensible defaults reduce friction for the LLM.

### Avoid deeply nested schemas

LLMs handle flat or shallow object structures more reliably than deeply nested ones. If you find yourself nesting three or more levels, consider splitting into separate exports.

---

## Step 3: Implement the ToolHandler

Create the handler module at the path specified in `spec.entry`. The module must export a `handlers` object mapping export names to handler functions.

```typescript
// tools/weather/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  forecast: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const city = String(input.city);
    const days = typeof input.days === 'number' ? input.days : 3;

    ctx.logger.info(`Fetching ${days}-day forecast for ${city}`);

    const response = await fetch(
      `https://api.weather.example/v1/forecast?city=${encodeURIComponent(city)}&days=${days}`
    );

    if (!response.ok) {
      throw new Error(
        `Weather API returned ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      city,
      days,
      forecast: data.forecast,
    };
  },

  current: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const city = String(input.city);

    const response = await fetch(
      `https://api.weather.example/v1/current?city=${encodeURIComponent(city)}`
    );

    if (!response.ok) {
      throw new Error(
        `Weather API returned ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      city,
      temperature: data.temperature,
      conditions: data.conditions,
      humidity: data.humidity,
    };
  },
};
```

### Handler implementation checklist

- [ ] Module exports a `handlers` object of type `Record<string, ToolHandler>`
- [ ] Each key in `handlers` matches an export `name` from your YAML
- [ ] Handlers receive `(ctx: ToolContext, input: JsonObject)` and return `Promise<JsonValue> | JsonValue`
- [ ] Input parameters are validated/coerced before use (do not trust raw LLM input blindly)
- [ ] Use `ctx.workdir` as the base directory for any file-system operations
- [ ] Use `ctx.logger` for diagnostic logging (not `console.log`)

---

## Step 4: Use ToolContext effectively

The `ToolContext` provides essential runtime services. Here is how to use each field:

### `ctx.workdir` -- instance workspace

Use this as the default working directory for any file operations. This keeps each agent instance's data isolated.

```typescript
import { join, isAbsolute } from 'path';

const targetPath = isAbsolute(input.path)
  ? input.path
  : join(ctx.workdir, String(input.path));
```

### `ctx.logger` -- structured logging

Use the logger instead of `console.log`. Log output is captured per-process and available via `gdn logs`.

```typescript
ctx.logger.info('Processing started', { city: input.city });
ctx.logger.warn('Rate limit approaching');
ctx.logger.error('API call failed', { status: response.status });
```

### `ctx.runtime` -- inter-agent communication

If your tool needs to communicate with other agents, use the `runtime` API. This is primarily used by the built-in `agents` tool, but custom tools can also leverage it.

```typescript
if (ctx.runtime) {
  const result = await ctx.runtime.request('analyst', {
    type: 'agent.event',
    name: 'analyze',
    message: { type: 'text', text: 'Analyze this data...' },
  });
  return { analysis: result.response };
}
```

### `ctx.toolCallId` and `ctx.message`

Use `toolCallId` for correlating log entries and `message` when you need context about the current assistant turn.

> For complete `ToolContext` and `AgentToolRuntime` API details, see [Tool API Reference](../reference/tool-api.md#toolcontext).

---

## Step 5: Handle errors properly

Goondan converts thrown errors into structured `ToolCallResult` objects with `status: "error"`. The LLM receives this result and can attempt recovery. You do not need to catch errors yourself -- simply `throw` when something goes wrong.

### Throw descriptive errors

```typescript
// Good: descriptive error with context
throw new Error(
  `File not found: ${targetPath}. Ensure the file exists in the workspace.`
);

// Bad: vague error
throw new Error('Something went wrong');
```

### Use the `suggestion` and `helpUrl` pattern

For errors that the LLM might be able to recover from, create a custom error with recovery hints. The runtime checks for `suggestion` and `helpUrl` properties on thrown errors:

```typescript
function createToolError(
  message: string,
  options?: { suggestion?: string; helpUrl?: string; code?: string }
): Error {
  const error = new Error(message);
  if (options?.suggestion) {
    (error as Error & { suggestion: string }).suggestion = options.suggestion;
  }
  if (options?.helpUrl) {
    (error as Error & { helpUrl: string }).helpUrl = options.helpUrl;
  }
  if (options?.code) {
    (error as Error & { code: string }).code = options.code;
  }
  return error;
}

// Usage
throw createToolError('Rate limit exceeded (429)', {
  code: 'E_RATE_LIMIT',
  suggestion: 'Wait 30 seconds before retrying.',
  helpUrl: 'https://api.weather.example/docs/rate-limits',
});
```

The resulting `ToolCallResult` will include these fields, helping the LLM make an informed decision.

### Error message length

Error messages are truncated to `spec.errorMessageLimit` (default: 1000 characters). For tools that may produce verbose error output (e.g., bash commands), increase this limit:

```yaml
spec:
  errorMessageLimit: 2000
```

### Error handling checklist

- [ ] Errors are thrown, not swallowed silently
- [ ] Error messages are descriptive and include relevant context (file paths, status codes, etc.)
- [ ] Recovery-friendly errors include `suggestion` text
- [ ] `errorMessageLimit` is adjusted for tools that produce verbose output
- [ ] External API errors include the HTTP status code in the message

---

## Step 6: Register the Tool with your Agent

Add your Tool to an Agent's `spec.tools` in `goondan.yaml`:

### Local Tool (same project)

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/claude"
  tools:
    - ref: "Tool/weather"           # String shorthand for local Tool
    - ref:
        kind: Tool
        name: bash
        package: "@goondan/base"    # Cross-package reference for built-in tools
```

### Reference from `@goondan/base` package

To use built-in tools alongside your custom tools:

```yaml
tools:
  - ref: "Tool/weather"                # Your custom tool
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

> For full details on ObjectRef syntax, see [Resources Reference -- ObjectRef](../reference/resources.md#objectref).

---

## Step 7: Validate your setup

Run `gdn validate` to verify your Tool configuration before starting the swarm:

```bash
gdn validate
```

Validation checks:

- `spec.entry` path exists on disk
- `spec.exports` has at least one entry
- Export names are unique and contain no `__`
- The entry module exports a `handlers` object
- Each export name has a matching handler

Fix any errors before proceeding to `gdn run`.

---

## Step 8: Test your Tool

### Unit testing handlers directly

Since handlers are plain functions, you can test them directly without spinning up a full runtime:

```typescript
import { describe, test, expect, mock } from 'bun:test';
import { handlers } from './tools/weather/index.ts';

describe('weather tool', () => {
  const mockContext = {
    toolCallId: 'test-call-1',
    agentName: 'test-agent',
    instanceKey: 'test-instance',
    turnId: 'test-turn',
    traceId: 'test-trace',
    workdir: '/tmp/test-workspace',
    logger: console,
    message: {
      id: 'msg-1',
      data: { role: 'assistant', content: '' },
      metadata: {},
      createdAt: new Date(),
      source: { type: 'assistant', stepId: 'step-1' },
    },
  };

  test('forecast returns forecast data', async () => {
    // Mock fetch or use a test API
    const result = await handlers.forecast(mockContext, {
      city: 'Seoul',
      days: 3,
    });
    expect(result).toHaveProperty('city', 'Seoul');
    expect(result).toHaveProperty('forecast');
  });

  test('forecast throws on invalid API response', async () => {
    // Arrange: mock fetch to return 500
    await expect(
      handlers.forecast(mockContext, { city: '' })
    ).rejects.toThrow();
  });
});
```

### Integration testing with `gdn validate`

After unit tests pass, validate the full bundle:

```bash
gdn validate
```

### End-to-end testing with `gdn run`

Start the swarm and trigger a tool call through the configured Connector:

```bash
gdn run
```

### Testing checklist

- [ ] Each handler has unit tests covering success and error paths
- [ ] Mock `ToolContext` is used with realistic field values
- [ ] `gdn validate` passes without errors
- [ ] End-to-end test confirms the LLM can discover and call the tool

---

## Complete example: database query Tool

Here is a complete, production-ready Tool example combining all the patterns above.

### YAML definition

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: database
  labels:
    tier: custom
spec:
  entry: "./tools/database/index.ts"
  errorMessageLimit: 2000

  exports:
    - name: query
      description: "Execute a read-only SQL query against the database"
      parameters:
        type: object
        properties:
          sql:
            type: string
            description: "SQL SELECT query to execute"
          params:
            type: array
            description: "Parameterized query values (prevents SQL injection)"
          maxRows:
            type: number
            description: "Maximum rows to return (default: 100)"
        required: [sql]

    - name: tables
      description: "List available database tables and their columns"
      parameters:
        type: object
        properties:
          schema:
            type: string
            description: "Database schema name (default: public)"
```

### Handler implementation

```typescript
// tools/database/index.ts
import type { ToolHandler, ToolContext, JsonObject, JsonValue } from '@goondan/types';

function validateReadOnly(sql: string): void {
  const normalized = sql.trim().toUpperCase();
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE'];
  for (const keyword of forbidden) {
    if (normalized.startsWith(keyword)) {
      throw Object.assign(
        new Error(`Write operations are not allowed. Only SELECT queries are permitted.`),
        {
          code: 'E_WRITE_FORBIDDEN',
          suggestion: 'Rewrite your query as a SELECT statement.',
        }
      );
    }
  }
}

export const handlers: Record<string, ToolHandler> = {
  query: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const sql = String(input.sql);
    const params = Array.isArray(input.params) ? input.params : [];
    const maxRows = typeof input.maxRows === 'number' ? input.maxRows : 100;

    validateReadOnly(sql);
    ctx.logger.info('Executing query', { sql: sql.slice(0, 100) });

    // Replace with your actual database client
    const db = getDatabase();
    const rows = await db.query(sql, params);
    const truncated = rows.length > maxRows;
    const result = truncated ? rows.slice(0, maxRows) : rows;

    return {
      rowCount: result.length,
      truncated,
      rows: result,
    };
  },

  tables: async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const schema = typeof input.schema === 'string' ? input.schema : 'public';

    ctx.logger.info('Listing tables', { schema });

    const db = getDatabase();
    const tables = await db.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [schema]
    );

    return { schema, tables };
  },
};
```

### Agent registration

```yaml
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: data-analyst
spec:
  modelConfig:
    modelRef: "Model/claude"
  tools:
    - ref: "Tool/database"
    - ref:
        kind: Tool
        name: json-query
        package: "@goondan/base"
```

---

## Production checklist summary

| # | Item | Status |
|---|------|--------|
| 1 | Tool YAML resource defined with valid `name`, `entry`, and `exports` | |
| 2 | JSON Schema parameters have clear `description` fields | |
| 3 | Handler module exports `handlers: Record<string, ToolHandler>` | |
| 4 | Handler keys match YAML export names exactly | |
| 5 | Input validation/coercion in every handler | |
| 6 | `ctx.workdir` used for file-system operations | |
| 7 | `ctx.logger` used instead of `console.log` | |
| 8 | Errors are thrown with descriptive messages | |
| 9 | Recovery-friendly errors include `suggestion` | |
| 10 | `errorMessageLimit` set for verbose tools | |
| 11 | Tool registered in Agent's `spec.tools` | |
| 12 | `gdn validate` passes | |
| 13 | Unit tests cover success and error paths | |
| 14 | End-to-end test confirms LLM invocation | |

---

## Related documents

| Document | Relationship |
|----------|-------------|
| [Tool API Reference](../reference/tool-api.md) | Complete TypeScript interfaces (`ToolHandler`, `ToolContext`, `ToolCallResult`) |
| [Tool System (Explanation)](../explanation/tool-system.md) | Design rationale: naming convention, Registry vs Catalog, error philosophy |
| [Build Your First Tool (Tutorial)](../tutorials/02-build-your-first-tool.md) | Step-by-step beginner tutorial |
| [Built-in Tools Reference](../reference/builtin-tools.md) | `@goondan/base` tool catalog and parameter schemas |
| [Resources Reference](../reference/resources.md#tool) | Full Tool Kind YAML schema |
| [Extension API Reference](../reference/extension-api.md) | Dynamic tool registration via `api.tools.register()` |

---

_Wiki version: v0.0.3_
