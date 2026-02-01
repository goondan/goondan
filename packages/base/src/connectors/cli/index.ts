import type { JsonObject, ObjectRefLike } from '@goondan/core';

interface CliConnectorOptions {
  runtime: {
    handleEvent: (event: {
      swarmRef: ObjectRefLike;
      instanceKey: string;
      agentName?: string;
      input: string;
      origin?: JsonObject;
      auth?: JsonObject;
      metadata?: JsonObject;
    }) => Promise<void>;
  };
  connectorConfig: JsonObject;
  logger?: Console;
}

export function createCliConnector(options: CliConnectorOptions) {
  const logger = options.logger || console;
  const config = options.connectorConfig as {
    metadata?: { name?: string };
    spec?: { ingress?: Array<JsonObject> };
  };

  async function handleEvent(payload: JsonObject): Promise<void> {
    const ingressRules = config.spec?.ingress || [];
    const text = String(payload.text || '');

    for (const rule of ingressRules) {
      const match = rule.match as { command?: string } | undefined;
      if (match?.command && !text.startsWith(match.command)) {
        continue;
      }

      const route = rule.route as {
        swarmRef?: ObjectRefLike;
        instanceKeyFrom?: string;
        inputFrom?: string;
        agentName?: string;
      };

      if (!route?.swarmRef) {
        logger.warn('cli ingress rule에 swarmRef가 없습니다.');
        continue;
      }

      const instanceKey = String(readPath(payload, route.instanceKeyFrom || '$.instanceKey') || 'cli');
      const input = String(readPath(payload, route.inputFrom || '$.text') || text);
      await options.runtime.handleEvent({
        swarmRef: route.swarmRef,
        instanceKey,
        agentName: route.agentName,
        input,
        origin: { connector: config.metadata?.name || 'cli' },
        auth: {},
        metadata: { connector: config.metadata?.name || 'cli' },
      });
      return;
    }

    if (ingressRules.length === 0 && payload.swarmRef) {
      await options.runtime.handleEvent({
        swarmRef: payload.swarmRef as ObjectRefLike,
        instanceKey: String(payload.instanceKey || 'cli'),
        agentName: payload.agentName as string | undefined,
        input: text,
        origin: { connector: config.metadata?.name || 'cli' },
        auth: {},
        metadata: { connector: config.metadata?.name || 'cli' },
      });
    }
  }

  async function send(input: { text: string }): Promise<{ ok: true }> {
    if (input?.text) {
      console.log(input.text);
    }
    return { ok: true };
  }

  return { handleEvent, send };
}

function readPath(payload: JsonObject, expr?: string): unknown {
  if (!expr) return undefined;
  if (!expr.startsWith('$.')) return undefined;
  const path = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of path) {
    if (current == null) return undefined;
    current = (current as JsonObject)[key];
  }
  return current;
}
