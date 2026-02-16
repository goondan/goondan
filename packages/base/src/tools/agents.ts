import type { AgentEvent, JsonObject, JsonValue, ToolContext, ToolHandler } from '../types.js';
import {
  createId,
  optionalBoolean,
  optionalJsonObject,
  optionalNumber,
  optionalString,
  requireString,
} from '../utils.js';

function createBaseEvent(
  ctx: ToolContext,
  eventType: string,
  input: string | undefined,
  instanceKey: string,
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
    instanceKey,
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
  const instanceKey = optionalString(input, 'instanceKey') ?? ctx.instanceKey;
  const eventType = optionalString(input, 'eventType') ?? 'agent.request';
  const metadata = optionalJsonObject(input, 'metadata');
  const timeoutMs = optionalNumber(input, 'timeoutMs', 15_000) ?? 15_000;

  const correlationId = createId('corr');
  const event = {
    ...createBaseEvent(ctx, eventType, message, instanceKey, metadata),
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
  const instanceKey = optionalString(input, 'instanceKey') ?? ctx.instanceKey;
  const eventType = optionalString(input, 'eventType') ?? 'agent.send';
  const metadata = optionalJsonObject(input, 'metadata');

  const event = createBaseEvent(ctx, eventType, message, instanceKey, metadata);
  const result = await runtime.send(target, event);

  return {
    target,
    eventId: result.eventId,
    accepted: result.accepted,
  };
};

export const spawn: ToolHandler = async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const runtime = requireRuntime(ctx);
  const target = requireString(input, 'target');
  const instanceKey = optionalString(input, 'instanceKey');
  const cwd = optionalString(input, 'cwd');

  const result = await runtime.spawn(target, {
    instanceKey,
    cwd,
  });

  return {
    target: result.target,
    instanceKey: result.instanceKey,
    spawned: result.spawned,
    cwd: result.cwd ?? null,
  };
};

export const list: ToolHandler = async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
  const runtime = requireRuntime(ctx);
  const includeAll = optionalBoolean(input, 'includeAll', false) ?? false;

  const result = await runtime.list({
    includeAll,
  });

  return {
    count: result.agents.length,
    agents: result.agents.map((agent) => ({
      target: agent.target,
      instanceKey: agent.instanceKey,
      ownerAgent: agent.ownerAgent,
      ownerInstanceKey: agent.ownerInstanceKey,
      createdAt: agent.createdAt,
      cwd: agent.cwd ?? null,
    })),
  };
};

export const catalog: ToolHandler = async (ctx: ToolContext, _input: JsonObject): Promise<JsonValue> => {
  const runtime = requireRuntime(ctx);
  const result = await runtime.catalog();

  return {
    swarmName: result.swarmName,
    entryAgent: result.entryAgent,
    selfAgent: result.selfAgent,
    availableCount: result.availableAgents.length,
    callableCount: result.callableAgents.length,
    availableAgents: result.availableAgents,
    callableAgents: result.callableAgents,
  };
};

export const handlers = {
  request,
  send,
  spawn,
  list,
  catalog,
} satisfies Record<string, ToolHandler>;
