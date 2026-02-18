# Connector API Reference

> Goondan v0.0.3

[Korean version (한국어)](./connector-api.ko.md)

---

## Overview

A **Connector** is a protocol adapter that normalizes external channel events into canonical `ConnectorEvent` objects. Each Connector runs as an independent Bun child process spawned by the Orchestrator. The Connector directly implements its own protocol handling (HTTP server, WebSocket, long polling, cron, etc.) and emits events to the Orchestrator via IPC.

A **Connection** binds a Connector to a Swarm, providing config/secrets and defining ingress routing rules.

> For a step-by-step guide on building a connector, see [How to: Write a Connector](../how-to/write-a-connector.md).
> For an explanation of the runtime execution model, see [Explanation: Runtime Model](../explanation/runtime-model.md).

---

## Connector Resource

### YAML Schema

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: <string>          # Unique name within the bundle
spec:
  entry: <string>          # Path to the entry module (relative to bundle root)
  events:                  # Event schemas this connector can emit
    - name: <string>       # Event name (unique within this connector)
      properties:          # Optional: typed properties
        <key>:
          type: string | number | boolean
          optional: true | false    # default: false
```

### ConnectorSpec

```typescript
interface ConnectorSpec {
  /** Entry file path (single default export). Always runs in Bun. */
  entry: string;

  /** Event schemas the connector can emit */
  events?: EventSchema[];
}

interface EventSchema {
  /** Event name (referenced by Connection match rules) */
  name: string;
  /** Property type declarations */
  properties?: Record<string, EventPropertyType>;
}

interface EventPropertyType {
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}
```

### Validation Rules

| Field | Required | Rule |
|-------|----------|------|
| `spec.entry` | MUST | Valid file path |
| `spec.events[].name` | MUST | Unique within the Connector |
| Entry default export | MUST | Entry module must have a default export function |
| `triggers` field | MUST NOT | Does not exist |
| `runtime` field | MUST NOT | Does not exist (always Bun) |

### Example

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
        user_id: { type: string }
    - name: command
      properties:
        chat_id: { type: string }
        command: { type: string }
```

---

## Entry Function

The Connector entry module must provide a **single default export** function. This function receives a `ConnectorContext` and is responsible for implementing the protocol handling loop.

```typescript
type ConnectorEntryFunction = (ctx: ConnectorContext) => Promise<void>;
```

### Rules

1. The entry module **MUST** provide a single default export.
2. The entry function **MUST** implement the protocol receive loop (HTTP server, WebSocket, polling, etc.) itself.
3. If the entry function resolves (returns), the Connector process **MAY** terminate.
4. If the entry function rejects unexpectedly, the Orchestrator **MAY** re-spawn it according to its restart policy.

### Minimal Example

```typescript
import type { ConnectorContext } from '@goondan/types';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, config, secrets, logger } = ctx;

  Bun.serve({
    port: Number(config.PORT) || 3000,
    async fetch(req) {
      const body = await req.json();

      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.text },
        properties: { chat_id: String(body.chatId) },
        instanceKey: `my-connector:${body.chatId}`,
      });

      return new Response('OK');
    },
  });

  logger.info('Connector listening on port', Number(config.PORT) || 3000);
}
```

---

## ConnectorContext

The context object passed to the Connector entry function.

```typescript
interface ConnectorContext {
  /** Emit a ConnectorEvent to the Orchestrator */
  emit(event: ConnectorEvent): Promise<void>;

  /** Resolved config values from Connection.spec.config */
  config: Record<string, string>;

  /** Resolved secret values from Connection.spec.secrets */
  secrets: Record<string, string>;

  /** Logger instance */
  logger: Console;
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `emit` | `(event: ConnectorEvent) => Promise<void>` | Emits a `ConnectorEvent` to the Orchestrator via IPC. The Orchestrator routes it based on the Connection's ingress rules. |
| `config` | `Record<string, string>` | Key-value pairs resolved from the Connection's `spec.config`. |
| `secrets` | `Record<string, string>` | Key-value pairs resolved from the Connection's `spec.secrets`. Use this for signing secrets, bot tokens, etc. |
| `logger` | `Console` | Structured logging interface. Logs are written to the Connector's process log file. |

---

## ConnectorEvent

The canonical event object emitted via `ctx.emit()`.

```typescript
interface ConnectorEvent {
  /** Event name (should match one of Connector.spec.events[].name) */
  name: string;

  /** Multimodal input message */
  message: ConnectorEventMessage;

  /** Event properties (should match events[].properties keys) */
  properties: Record<string, string>;

  /** Instance routing key (used by Orchestrator to map to an AgentProcess) */
  instanceKey: string;
}

type ConnectorEventMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'file'; url: string; name: string };
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | MUST | Event name. Should correspond to a name declared in `Connector.spec.events[]`. |
| `message` | `ConnectorEventMessage` | MUST | The input message. Must contain at least one content type. |
| `properties` | `Record<string, string>` | MUST | Event properties. Keys should match those declared in `events[].properties`. |
| `instanceKey` | `string` | MUST | Routing key for the Orchestrator to map to the correct AgentProcess. Events with the same `instanceKey` are routed to the same AgentProcess, preserving conversation context. |

### Message Types

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `text: string` | Plain text message |
| `image` | `url: string` | Image URL |
| `file` | `url: string`, `name: string` | File URL with filename |

---

## Signature Verification

Connectors are **recommended** to verify the authenticity of inbound requests using secrets provided by the Connection.

### Recommended Flow

1. Read the signing secret from `ctx.secrets` (recommended key names: `SIGNING_SECRET`, `WEBHOOK_SECRET`).
2. Extract the signature from the request headers/body.
3. Run the verification algorithm.
4. On failure: do **not** emit a `ConnectorEvent`, return an HTTP 401/403 response, and log the failure via `ctx.logger`.

### Example

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  Bun.serve({
    port: 3000,
    async fetch(req) {
      // 1. Verify signature
      const signingSecret = secrets.SIGNING_SECRET;
      if (signingSecret) {
        const signature = req.headers.get('x-signature');
        if (!verifySignature(req, signingSecret, signature)) {
          logger.warn('Signature verification failed');
          return new Response('Unauthorized', { status: 401 });
        }
      }

      // 2. Parse and emit
      const body = await req.json();
      await emit({
        name: 'user_message',
        message: { type: 'text', text: body.text },
        properties: { chat_id: body.chatId },
        instanceKey: `channel:${body.chatId}`,
      });

      return new Response('OK');
    },
  });
}
```

---

## Connection Resource

A Connection binds a Connector to a Swarm, providing config, secrets, and ingress routing rules.

### YAML Schema

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: <string>
spec:
  connectorRef: <ObjectRefLike>             # MUST: Connector to bind
  swarmRef: <ObjectRefLike>                 # MAY: Swarm to bind (default: first Swarm in bundle)

  config:                                    # MAY: General settings for the Connector
    <KEY>:
      value: <string>                        # Direct value
      # OR
      valueFrom:
        env: <ENV_VAR_NAME>                  # From environment variable

  secrets:                                   # MAY: Sensitive values for the Connector
    <KEY>:
      value: <string>
      # OR
      valueFrom:
        env: <ENV_VAR_NAME>
        # OR
        secretRef:
          ref: "Secret/<name>"
          key: "<field>"

  ingress:                                   # MAY: Routing rules
    rules:
      - match:                               # MAY: Omit for catch-all
          event: <string>                    # ConnectorEvent.name
          properties:                        # AND conditions
            <key>: <value>
        route:
          agentRef: <ObjectRefLike>          # MAY: Omit to route to entryAgent
          instanceKey: <string>              # MAY: Fixed instanceKey override
          instanceKeyProperty: <string>      # MAY: Read instanceKey from event properties
          instanceKeyPrefix: <string>        # MAY: Prefix for property-based key
```

### ConnectionSpec

```typescript
interface ConnectionSpec {
  /** Connector to bind (MUST) */
  connectorRef: ObjectRefLike;

  /** Swarm to bind (MAY, defaults to first Swarm in bundle) */
  swarmRef?: ObjectRefLike;

  /** General settings passed to ConnectorContext.config */
  config?: Record<string, ValueSource>;

  /** Sensitive values passed to ConnectorContext.secrets */
  secrets?: Record<string, ValueSource>;

  /** Ingress routing rules */
  ingress?: IngressConfig;
}

interface IngressConfig {
  rules?: IngressRule[];
}

interface IngressRule {
  match?: IngressMatch;
  route: IngressRoute;
}

interface IngressMatch {
  /** Match against ConnectorEvent.name */
  event?: string;
  /** Match against ConnectorEvent.properties (AND conditions) */
  properties?: Record<string, string | number | boolean>;
}

interface IngressRoute {
  /** Target Agent (omit to route to Swarm's entryAgent) */
  agentRef?: ObjectRefLike;
  /** Fixed instanceKey override */
  instanceKey?: string;
  /** Read instanceKey from ConnectorEvent.properties */
  instanceKeyProperty?: string;
  /** Prefix for property-based instanceKey */
  instanceKeyPrefix?: string;
}
```

### Ingress Routing Rules

Rules are evaluated **in order**; the first matching rule is applied.

| Behavior | Condition |
|----------|-----------|
| **Catch-all** | `match` is omitted |
| **Event filter** | `match.event` matches `ConnectorEvent.name` |
| **Property filter** | `match.properties` matches `ConnectorEvent.properties` (AND logic) |
| **Route to specific Agent** | `route.agentRef` is specified |
| **Route to entryAgent** | `route.agentRef` is omitted |
| **Override instanceKey** | `route.instanceKey` is specified (replaces `ConnectorEvent.instanceKey`) |
| **Dynamic instanceKey** | `route.instanceKeyProperty` reads a value from event properties |

**Constraints:**
- `route.instanceKey` and `route.instanceKeyProperty` are mutually exclusive (MUST NOT be set simultaneously).

### Validation Rules

| Field | Required | Rule |
|-------|----------|------|
| `spec.connectorRef` | MUST | Valid Connector reference in the same bundle |
| `spec.swarmRef` | MAY | Valid Swarm reference (defaults to first Swarm) |
| `spec.config` | MAY | Each value is a valid `ValueSource` |
| `spec.secrets` | MAY | Each value is a valid `ValueSource` |
| `spec.ingress.rules[].route` | MUST | Required if rule is present |
| `spec.ingress.rules[].match.event` | SHOULD | Match a name from Connector's `events[]` |
| `spec.ingress.rules[].route.agentRef` | SHOULD | Valid Agent in the bound Swarm |

### Example: Telegram Connection

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: telegram-production
spec:
  connectorRef: "Connector/telegram"
  swarmRef: "Swarm/default"

  config:
    PORT:
      value: "3000"
  secrets:
    BOT_TOKEN:
      valueFrom:
        env: TELEGRAM_BOT_TOKEN
    SIGNING_SECRET:
      valueFrom:
        env: TELEGRAM_WEBHOOK_SECRET

  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: command
        route: {}  # Routes to Swarm entryAgent
```

### Example: Minimal CLI Connection

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef: "Connector/cli"
  ingress:
    rules:
      - route: {}  # All events to entryAgent
```

---

## Event Flow

```
[Connector Process: protocol receive (HTTP/WebSocket/Polling/Cron)]
     |
     |  External event received -> normalize
     v
[ctx.emit(ConnectorEvent)]
     |
     |  IPC to Orchestrator
     v
[Orchestrator: receives ConnectorEvent]
     |
     |  Connection.ingress.rules matching
     |  match.event vs ConnectorEvent.name
     |  match.properties vs ConnectorEvent.properties
     v
[Matched rule's route -> AgentProcess]
     |  instanceKey -> AgentProcess mapping (spawn if needed)
     |  agentRef -> specific Agent / omitted -> entryAgent
     v
[AgentProcess: Turn processing]
```

---

## What Connectors Do NOT Do

| Responsibility | Owner |
|----------------|-------|
| **Routing** (which Agent receives the event) | Connection ingress rules |
| **Authentication credentials** (API tokens) | Connection secrets |
| **Response sending** (replying to users) | Tools (e.g., `telegram__send`, `slack__send`) |
| **Instance management** (Turn/Step lifecycle) | Orchestrator / AgentProcess |

---

## See Also

- [How to: Write a Connector](../how-to/write-a-connector.md) -- Step-by-step guide for building a connector
- [How to: Run a Swarm](../how-to/run-a-swarm.md) -- Running and managing swarms
- [Explanation: Runtime Model](../explanation/runtime-model.md) -- Understanding the execution model
- [Reference: Resources](./resources.md) -- All 8 resource Kind schemas
- [Reference: CLI](./cli-reference.md) -- CLI commands reference

---

_Wiki version: v0.0.3_
