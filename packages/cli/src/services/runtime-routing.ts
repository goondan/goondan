import path from 'node:path';
import { isJsonObject, type JsonObject } from '@goondan/runtime';

export interface ParsedConnectorEvent {
  name: string;
  instanceKey: string;
  messageText: string;
  properties: Record<string, string>;
}

export interface ParsedAgentToolEvent {
  id: string;
  type: string;
  instanceKey: string;
  messageText: string;
  sourceName: string;
  metadata?: JsonObject;
  correlationId?: string;
}

export interface IngressRouteRule {
  eventName?: string;
  properties?: Record<string, string>;
  agentName?: string;
  instanceKey?: string;
  instanceKeyProperty?: string;
  instanceKeyPrefix?: string;
}

export interface RuntimeInboundContext {
  sourceKind: 'connector' | 'agent';
  sourceName: string;
  eventName: string;
  instanceKey: string;
  messageText: string;
  properties?: Record<string, string>;
  metadata?: JsonObject;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseConnectorEventPayload(event: unknown): ParsedConnectorEvent | undefined {
  if (!isJsonObject(event)) {
    return undefined;
  }

  const name = typeof event.name === 'string' ? event.name : undefined;
  const instanceKey = typeof event.instanceKey === 'string' ? event.instanceKey : undefined;
  if (!name || !instanceKey) {
    return undefined;
  }

  let messageText = '';
  const message = event.message;
  if (isJsonObject(message)) {
    const messageType = message.type;
    if (messageType === 'text' && typeof message.text === 'string') {
      messageText = message.text;
    } else if (messageType === 'image' && typeof message.url === 'string') {
      messageText = `[image] ${message.url}`;
    } else if (messageType === 'file' && typeof message.url === 'string') {
      const fileName = typeof message.name === 'string' ? message.name : 'file';
      messageText = `[file:${fileName}] ${message.url}`;
    }
  }

  const properties: Record<string, string> = {};
  if (isJsonObject(event.properties)) {
    for (const [key, value] of Object.entries(event.properties)) {
      if (typeof value === 'string') {
        properties[key] = value;
      }
    }
  }

  return {
    name,
    instanceKey,
    messageText,
    properties,
  };
}

export function parseAgentToolEventPayload(
  event: unknown,
  fallbackInstanceKey: string,
  fallbackSourceName: string,
): ParsedAgentToolEvent | undefined {
  if (!isJsonObject(event)) {
    return undefined;
  }

  const id = typeof event.id === 'string' && event.id.length > 0 ? event.id : `agent-event-${Date.now()}`;
  const type = typeof event.type === 'string' && event.type.length > 0 ? event.type : 'agent.request';
  const instanceKey = typeof event.instanceKey === 'string' && event.instanceKey.length > 0
    ? event.instanceKey
    : fallbackInstanceKey;
  const messageText = typeof event.input === 'string' ? event.input : '';

  let sourceName = fallbackSourceName;
  if (isJsonObject(event.source) && typeof event.source.name === 'string' && event.source.name.length > 0) {
    sourceName = event.source.name;
  }

  const metadata = isJsonObject(event.metadata) ? event.metadata : undefined;

  let correlationId: string | undefined;
  if (isJsonObject(event.replyTo) && typeof event.replyTo.correlationId === 'string' && event.replyTo.correlationId.length > 0) {
    correlationId = event.replyTo.correlationId;
  }

  return {
    id,
    type,
    instanceKey,
    messageText,
    sourceName,
    metadata,
    correlationId,
  };
}

export function formatRuntimeInboundUserText(input: RuntimeInboundContext): string {
  const contextPayload = {
    source: {
      kind: input.sourceKind,
      name: input.sourceName,
    },
    event: input.eventName,
    instanceKey: input.instanceKey,
    properties: input.properties ?? {},
    metadata: input.metadata ?? {},
  };

  const contextHeader = safeJsonStringify(contextPayload);
  if (input.messageText.length === 0) {
    return ['[goondan_context]', contextHeader, '[/goondan_context]'].join('\n');
  }

  return ['[goondan_context]', contextHeader, '[/goondan_context]', input.messageText].join('\n');
}

export function resolveRuntimeWorkdir(baseWorkdir: string, cwd?: string): string {
  if (!cwd || cwd.trim().length === 0) {
    return baseWorkdir;
  }

  if (path.isAbsolute(cwd)) {
    return cwd;
  }

  return path.join(baseWorkdir, cwd);
}

export function selectTargetAgentName(
  rules: IngressRouteRule[],
  defaultAgentName: string,
  event: ParsedConnectorEvent,
): string {
  const rule = selectMatchingIngressRule(rules, event);
  if (rule?.agentName && rule.agentName.length > 0) {
    return rule.agentName;
  }

  return defaultAgentName;
}

export function selectMatchingIngressRule(
  rules: IngressRouteRule[],
  event: ParsedConnectorEvent,
): IngressRouteRule | undefined {
  for (const rule of rules) {
    if (rule.eventName && rule.eventName !== event.name) {
      continue;
    }

    if (rule.properties) {
      let matched = true;
      for (const [key, expected] of Object.entries(rule.properties)) {
        if (event.properties[key] !== expected) {
          matched = false;
          break;
        }
      }

      if (!matched) {
        continue;
      }
    }

    return rule;
  }

  return undefined;
}

export function resolveInboundInstanceKey(
  rule: IngressRouteRule | undefined,
  event: ParsedConnectorEvent,
): string {
  if (!rule) {
    return event.instanceKey;
  }

  const staticInstanceKey = rule.instanceKey;
  if (typeof staticInstanceKey === 'string' && staticInstanceKey.trim().length > 0) {
    return staticInstanceKey.trim();
  }

  const propertyName = rule.instanceKeyProperty;
  if (typeof propertyName === 'string' && propertyName.trim().length > 0) {
    const propertyValue = event.properties[propertyName.trim()];
    if (typeof propertyValue === 'string' && propertyValue.trim().length > 0) {
      const prefixValue = rule.instanceKeyPrefix;
      if (typeof prefixValue === 'string' && prefixValue.trim().length > 0) {
        return `${prefixValue.trim()}${propertyValue.trim()}`;
      }
      return propertyValue.trim();
    }
  }

  return event.instanceKey;
}
