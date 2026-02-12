import { isJsonObject } from '@goondan/runtime';

export interface ParsedConnectorEvent {
  name: string;
  instanceKey: string;
  messageText: string;
  properties: Record<string, string>;
}

export interface IngressRouteRule {
  eventName?: string;
  properties?: Record<string, string>;
  agentName?: string;
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

export function selectTargetAgentName(
  rules: IngressRouteRule[],
  defaultAgentName: string,
  event: ParsedConnectorEvent,
): string {
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

    if (rule.agentName && rule.agentName.length > 0) {
      return rule.agentName;
    }

    return defaultAgentName;
  }

  return defaultAgentName;
}
