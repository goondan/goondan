import type { AgentEvent, JsonObject, JsonValue, ToolContext, ToolHandler } from '../types.js';
import {
  createId,
  optionalJsonObject,
  optionalNumber,
  optionalString,
  requireString,
} from '../utils.js';

function createBaseEvent(
  ctx: ToolContext,
  eventType: string,
  input: string | undefined,
  metadata: JsonObject | undefined
): AgentEvent {
  return {
    id: createId('agent_event'),
    type: eventType,
    createdAt: new Date(),
    traceId: ctx.traceId,
    source: {
      kind: 'agent',
      name: ctx.agentName,
    },
    input,
    metadata,
  };
}

function requireRuntime(ctx: ToolContext) {
  if (!ctx.runtime) {
    throw new Error('Agent runtime interface is not available in ToolContext.runtime');
  }
  return ctx.runtime;
}

export const request: ToolHandler = async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const runtime = requireRuntime(ctx);
  const target = requireString(input, 'target');
  const message = optionalString(input, 'input');
  const eventType = optionalString(input, 'eventType') ?? 'agent.request';
  const metadata = optionalJsonObject(input, 'metadata');
  const timeoutMs = optionalNumber(input, 'timeoutMs', 15_000) ?? 15_000;

  const correlationId = createId('corr');
  const event = {
    ...createBaseEvent(ctx, eventType, message, metadata),
    replyTo: {
      target: ctx.agentName,
      correlationId,
    },
  };

  const response = await runtime.request(target, event, { timeoutMs });

  return {
    target,
    eventId: response.eventId,
    correlationId: response.correlationId,
    response: response.response ?? null,
  };
};

export const send: ToolHandler = async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const runtime = requireRuntime(ctx);
  const target = requireString(input, 'target');
  const message = optionalString(input, 'input');
  const eventType = optionalString(input, 'eventType') ?? 'agent.send';
  const metadata = optionalJsonObject(input, 'metadata');

  const event = createBaseEvent(ctx, eventType, message, metadata);
  const result = await runtime.send(target, event);

  return {
    target,
    eventId: result.eventId,
    accepted: result.accepted,
  };
};

export const handlers = {
  request,
  send,
} satisfies Record<string, ToolHandler>;
