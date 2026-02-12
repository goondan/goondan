import { createInterface } from 'node:readline';
import type { ConnectorContext, JsonObject, JsonValue } from '../types.js';
import { parseJsonObject } from '../utils.js';

export interface CliConnectorConfig {
  defaultEventName?: string;
  defaultInstanceKey?: string;
  skipEmptyLines?: boolean;
}

interface NormalizedCliEvent {
  name: string;
  text: string;
  instanceKey: string;
  properties: Record<string, string>;
}

function toProperties(value: JsonValue | undefined): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const properties: Record<string, string> = {};
  for (const [key, propertyValue] of Object.entries(value)) {
    if (
      typeof propertyValue === 'string' ||
      typeof propertyValue === 'number' ||
      typeof propertyValue === 'boolean'
    ) {
      properties[key] = String(propertyValue);
    }
  }
  return properties;
}

function pickString(input: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function normalizeCliLine(
  line: string,
  index: number,
  config: CliConnectorConfig = {}
): NormalizedCliEvent | null {
  const trimmed = line.trim();
  const skipEmptyLines = config.skipEmptyLines ?? true;
  if (trimmed.length === 0 && skipEmptyLines) {
    return null;
  }

  const fallbackEventName = config.defaultEventName ?? 'stdin_message';
  const fallbackInstanceKey = config.defaultInstanceKey ?? 'cli';

  const parsed = parseJsonObject(trimmed);
  if (!parsed) {
    return {
      name: fallbackEventName,
      text: line,
      instanceKey: `${fallbackInstanceKey}:${index}`,
      properties: {},
    };
  }

  const name = pickString(parsed, 'name', 'event') ?? fallbackEventName;
  const text = pickString(parsed, 'text', 'message') ?? line;
  const instanceKey = pickString(parsed, 'instanceKey') ?? `${fallbackInstanceKey}:${index}`;

  return {
    name,
    text,
    instanceKey,
    properties: toProperties(parsed.properties),
  };
}

export async function runCliConnector(
  ctx: ConnectorContext,
  lines: AsyncIterable<string>,
  config: CliConnectorConfig = {}
): Promise<void> {
  let index = 0;
  for await (const line of lines) {
    const normalized = normalizeCliLine(line, index, config);
    index += 1;

    if (!normalized) {
      continue;
    }

    await ctx.emit({
      name: normalized.name,
      message: {
        type: 'text',
        text: normalized.text,
      },
      properties: normalized.properties,
      instanceKey: normalized.instanceKey,
    });
  }
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  try {
    await runCliConnector(ctx, input);
  } finally {
    input.close();
  }
}
