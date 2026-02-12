import type { ConnectorContext, ConnectorEvent } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

/**
 * Discord interaction type constants
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object-interaction-type
 */
const DISCORD_INTERACTION_PING = 1;
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2;
const DISCORD_INTERACTION_MESSAGE_COMPONENT = 3;

export function parseDiscordInteraction(body: unknown): ConnectorEvent | null {
  if (!isRecord(body)) {
    return null;
  }

  const interactionType = readNumber(body.type);
  if (interactionType === undefined) {
    return null;
  }

  // Ping interaction - no connector event
  if (interactionType === DISCORD_INTERACTION_PING) {
    return null;
  }

  const interactionId = readString(body.id);
  const token = readString(body.token);
  const channelId = readString(body.channel_id);
  const guildId = readString(body.guild_id);

  const properties: Record<string, string> = {};
  if (interactionId) {
    properties.interaction_id = interactionId;
  }
  if (channelId) {
    properties.channel_id = channelId;
  }
  if (guildId) {
    properties.guild_id = guildId;
  }
  if (token) {
    properties.interaction_token = token;
  }

  const member = isRecord(body.member) ? body.member : undefined;
  const user = isRecord(body.user) ? body.user : (member && isRecord(member.user) ? member.user : undefined);

  const userId = user ? readString(user.id) : undefined;
  const username = user ? readString(user.username) : undefined;
  if (userId) {
    properties.user_id = userId;
  }
  if (username) {
    properties.username = username;
  }

  let text = '';
  let eventName = 'interaction';

  if (interactionType === DISCORD_INTERACTION_APPLICATION_COMMAND) {
    eventName = 'slash_command';
    const data = isRecord(body.data) ? body.data : undefined;
    if (data) {
      const commandName = readString(data.name);
      if (commandName) {
        properties.command_name = commandName;
        text = `/${commandName}`;
      }
    }
  } else if (interactionType === DISCORD_INTERACTION_MESSAGE_COMPONENT) {
    eventName = 'component_interaction';
    const data = isRecord(body.data) ? body.data : undefined;
    if (data) {
      const customId = readString(data.custom_id);
      if (customId) {
        properties.custom_id = customId;
        text = customId;
      }
    }
  }

  const instanceKey = channelId
    ? `discord:${channelId}`
    : `discord:${interactionId ?? 'unknown'}`;

  return {
    name: eventName,
    message: { type: 'text', text },
    properties,
    instanceKey,
  };
}

export function createDiscordPingResponse(): Response {
  return new Response(JSON.stringify({ type: 1 }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleDiscordRequest(
  ctx: ConnectorContext,
  rawBody: string
): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (!isRecord(body)) {
    return new Response('Bad Request', { status: 400 });
  }

  // Handle ping
  const interactionType = readNumber(body.type);
  if (interactionType === DISCORD_INTERACTION_PING) {
    return createDiscordPingResponse();
  }

  // Parse and emit event
  const event = parseDiscordInteraction(body);
  if (!event) {
    return new Response('OK');
  }

  await ctx.emit(event);
  return new Response('OK');
}

export default async function run(ctx: ConnectorContext): Promise<void> {
  ctx.logger.info('[discord] connector skeleton initialized');
}
