# How to: Write a Connector

> Build a custom Connector that bridges an external protocol to your Goondan swarm.

[Korean version (한국어)](./write-a-connector.ko.md)

---

## Prerequisites

- A working Goondan project (`gdn init` completed)
- Familiarity with the Connector/Connection separation (see [Connector API Reference](../reference/connector-api.md))
- Basic understanding of the [Runtime Model](../explanation/runtime-model.md)

---

## 1. Define the Connector resource

Create a `kind: Connector` document in your `goondan.yaml`. The two required fields are `spec.entry` (the path to your entry module) and `spec.events` (the event schemas your connector will emit).

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: my-webhook
spec:
  entry: "./connectors/my-webhook/index.ts"
  events:
    - name: incoming_message
      properties:
        channel_id: { type: string }
        sender_id: { type: string }
    - name: status_update
      properties:
        channel_id: { type: string }
        status: { type: string }
```

**Rules to remember:**

- `spec.entry` is required and must point to a valid file.
- Each `events[].name` must be unique within this Connector.
- There is no `triggers` or `runtime` field -- Connectors always run as Bun processes.

---

## 2. Implement the entry module

The entry module must provide a **single default export** function that receives a `ConnectorContext`. This function is responsible for implementing whatever protocol your connector handles -- an HTTP server, a WebSocket connection, a polling loop, a cron scheduler, etc.

```typescript
// connectors/my-webhook/index.ts
import type { ConnectorContext } from '@goondan/types';

export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, config, secrets, logger } = ctx;
  const port = Number(config.PORT) || 4000;

  Bun.serve({
    port,
    async fetch(req) {
      const body = await req.json();

      await emit({
        name: 'incoming_message',
        message: { type: 'text', text: body.text },
        properties: {
          channel_id: String(body.channelId),
          sender_id: String(body.senderId),
        },
        instanceKey: `my-webhook:${body.channelId}`,
      });

      return new Response('OK');
    },
  });

  logger.info(`my-webhook connector listening on port ${port}`);
}
```

### ConnectorContext fields

| Field | Type | Description |
|-------|------|-------------|
| `emit` | `(event: ConnectorEvent) => Promise<void>` | Sends a normalized event to the Orchestrator via IPC |
| `config` | `Record<string, string>` | General settings from the Connection's `spec.config` |
| `secrets` | `Record<string, string>` | Sensitive values from the Connection's `spec.secrets` |
| `logger` | `Console` | Structured logger for diagnostic output |

### ConnectorEvent fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Must match one of the names in `spec.events[]` |
| `message` | `ConnectorEventMessage` | Yes | The input content (`text`, `image`, or `file`) |
| `properties` | `Record<string, string>` | Yes | Event metadata matching `events[].properties` keys |
| `instanceKey` | `string` | Yes | Routing key that determines which AgentProcess receives the event |

> **Tip:** Events with the same `instanceKey` are routed to the same AgentProcess, preserving conversation context. Choose a key that reflects your desired conversation boundary (e.g., per-channel, per-user, or a shared singleton).

---

## 3. Add signature verification (recommended)

Verifying the authenticity of inbound requests prevents spoofed events from reaching your agents. Read the signing secret from `ctx.secrets` and validate before emitting.

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;

  Bun.serve({
    port: 4000,
    async fetch(req) {
      // 1. Verify signature
      const signingSecret = secrets.SIGNING_SECRET;
      if (signingSecret) {
        const signature = req.headers.get('x-webhook-signature');
        const rawBody = await req.text();

        if (!verifyHmacSignature(rawBody, signature, signingSecret)) {
          logger.warn('Signature verification failed');
          return new Response('Unauthorized', { status: 401 });
        }

        // Parse from the raw body we already read
        const body = JSON.parse(rawBody);
        await emit({
          name: 'incoming_message',
          message: { type: 'text', text: body.text },
          properties: { channel_id: body.channelId },
          instanceKey: `my-webhook:${body.channelId}`,
        });

        return new Response('OK');
      }

      // Fallback: no signing secret configured
      const body = await req.json();
      await emit({
        name: 'incoming_message',
        message: { type: 'text', text: body.text },
        properties: { channel_id: body.channelId },
        instanceKey: `my-webhook:${body.channelId}`,
      });

      return new Response('OK');
    },
  });
}

function verifyHmacSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const hmac = new Bun.CryptoHasher('sha256', secret);
  hmac.update(body);
  const expected = hmac.digest('hex');

  // Use timing-safe comparison
  if (expected.length !== signature.length) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');
  return require('crypto').timingSafeEqual(expectedBuf, receivedBuf);
}
```

**Recommended secret key names:** `SIGNING_SECRET` or `WEBHOOK_SECRET`.

**On failure:** Do not emit a `ConnectorEvent`. Return HTTP 401/403 and log the failure via `ctx.logger`.

---

## 4. Create the Connection resource

A `kind: Connection` binds your Connector to a Swarm by providing config, secrets, and ingress routing rules. This is where you wire deployment-specific settings without modifying the Connector code.

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: my-webhook-to-swarm
spec:
  # Required: reference to the Connector
  connectorRef: "Connector/my-webhook"

  # Optional: which Swarm to bind (defaults to first Swarm in bundle)
  swarmRef: "Swarm/default"

  # General settings -> ConnectorContext.config
  config:
    PORT:
      value: "4000"

  # Sensitive values -> ConnectorContext.secrets
  secrets:
    API_TOKEN:
      valueFrom:
        env: MY_WEBHOOK_API_TOKEN
    SIGNING_SECRET:
      valueFrom:
        env: MY_WEBHOOK_SIGNING_SECRET

  # Ingress routing rules
  ingress:
    rules:
      - match:
          event: incoming_message
        route:
          agentRef: "Agent/handler"
      - match:
          event: status_update
        route:
          agentRef: "Agent/monitor"
      - route: {}  # Catch-all: routes to Swarm's entryAgent
```

### Key Connection fields

| Field | Description |
|-------|-------------|
| `connectorRef` | **Required.** Reference to a Connector in the same bundle |
| `swarmRef` | Optional. Defaults to the first Swarm in the bundle |
| `config` | General settings passed to `ConnectorContext.config` |
| `secrets` | Sensitive values passed to `ConnectorContext.secrets` |
| `ingress.rules` | Ordered list of routing rules (first match wins) |

### Ingress routing rules

Rules are evaluated in order. The first matching rule is applied.

| Pattern | Meaning |
|---------|---------|
| `match.event: "incoming_message"` | Match events with this name |
| `match.properties: { channel_id: "C123" }` | Match specific property values (AND logic with `event`) |
| `match` omitted | Catch-all (matches everything) |
| `route.agentRef: "Agent/handler"` | Route to a specific agent |
| `route: {}` | Route to the Swarm's `entryAgent` |
| `route.instanceKey: "shared"` | Override the ConnectorEvent's instanceKey |
| `route.instanceKeyProperty: "sender_id"` | Use a property value as the instanceKey |

> **Constraint:** `route.instanceKey` and `route.instanceKeyProperty` cannot be set simultaneously.

---

## 5. Handle graceful shutdown

The Orchestrator manages Connector process lifecycle. When a shutdown is needed (config change, restart, or Orchestrator shutdown), the process receives `SIGINT` or `SIGTERM`. Clean up resources to ensure a graceful exit.

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { config, logger } = ctx;
  const port = Number(config.PORT) || 4000;

  const server = Bun.serve({
    port,
    async fetch(req) {
      // ... handle requests
      return new Response('OK');
    },
  });

  logger.info(`Connector listening on port ${port}`);

  // Wait for shutdown signal
  const shutdown = new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      logger.info('Received SIGINT, shutting down');
      server.stop();
      resolve();
    });
    process.once('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down');
      server.stop();
      resolve();
    });
  });

  await shutdown;
}
```

---

## 6. Non-HTTP connector patterns

Not all connectors listen on HTTP. Here are other common patterns.

### Polling connector

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, secrets, logger } = ctx;
  const token = secrets.API_TOKEN;
  const controller = new AbortController();

  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  let cursor = 0;
  while (!controller.signal.aborted) {
    const response = await fetch(`https://api.example.com/updates?after=${cursor}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    const updates = await response.json();
    for (const update of updates.items) {
      cursor = Math.max(cursor, update.id);
      await emit({
        name: 'new_update',
        message: { type: 'text', text: update.content },
        properties: { update_id: String(update.id) },
        instanceKey: `poll:${update.channelId}`,
      });
    }

    // Wait before next poll
    await new Promise((r) => setTimeout(r, 5000));
  }
}
```

### Cron connector

```typescript
export default async function(ctx: ConnectorContext): Promise<void> {
  const { emit, config, logger } = ctx;
  const intervalMs = Number(config.INTERVAL_MS) || 60_000;

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  while (!controller.signal.aborted) {
    await emit({
      name: 'scheduled_tick',
      message: { type: 'text', text: `Scheduled event at ${new Date().toISOString()}` },
      properties: { scheduled_at: new Date().toISOString() },
      instanceKey: 'cron:scheduled',
    });

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

---

## 7. Validate and run

```bash
# Validate the bundle (checks entry file existence, event schema, etc.)
gdn validate

# Run the swarm (Orchestrator spawns the Connector as a child process)
gdn run
```

---

## Checklist

- [ ] `kind: Connector` resource with `spec.entry` and `spec.events`
- [ ] Entry module has a single default export function
- [ ] `ctx.emit()` called with valid `ConnectorEvent` (name, message, properties, instanceKey)
- [ ] Signature verification implemented (if the external service supports it)
- [ ] `kind: Connection` resource binding Connector to Swarm with config/secrets/ingress
- [ ] Ingress rules route events to the correct agents
- [ ] Graceful shutdown handled (SIGINT/SIGTERM)
- [ ] `gdn validate` passes

---

## See also

- [Connector API Reference](../reference/connector-api.md) -- Full API details for ConnectorContext, ConnectorEvent, and Connection
- [Runtime Model](../explanation/runtime-model.md) -- How Connector processes fit in the Orchestrator architecture
- [Resources Reference](../reference/resources.md) -- Complete YAML schemas for Connector and Connection
- [How to: Run a Swarm](./run-a-swarm.md) -- Running and managing your swarm

---

_How-to version: v0.0.3_
