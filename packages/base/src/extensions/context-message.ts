import { createHash } from 'node:crypto';

import type { ExtensionApi, JsonObject, JsonValue, Message, TurnMiddlewareContext } from '../types.js';
import { createId, isJsonObject } from '../utils.js';

const EXTENSION_NAME = 'context-message';
const EXTENSION_EVENTS_METADATA_KEY = 'extension.events';
const CONTEXT_MESSAGE_MARKER_KEY = '__goondanContextMessage';

interface RuntimeAgentPromptMetadata {
  system?: string;
}

interface RuntimeAgentMetadata {
  prompt?: RuntimeAgentPromptMetadata;
}

interface ContextSegment {
  id: string;
  content: string;
}

interface SegmentResolution {
  id: string;
  included: boolean;
}

export interface ContextMessageExtensionConfig {
  includeAgentPrompt?: boolean;
  includeSwarmCatalog?: boolean;
  includeInboundContext?: boolean;
  includeCallContext?: boolean;
  includeRouteSummary?: boolean;
  swarmCatalogInstruction?: string;
}

const DEFAULT_CONFIG: Required<ContextMessageExtensionConfig> = {
  includeAgentPrompt: true,
  includeSwarmCatalog: false,
  includeInboundContext: false,
  includeCallContext: false,
  includeRouteSummary: false,
  swarmCatalogInstruction: '위 callableAgents를 참고해 위임 대상이 모호하면 agents__catalog로 최신 목록을 다시 확인한다.',
};

function readConfig(raw: unknown): Required<ContextMessageExtensionConfig> {
  if (!isJsonObject(raw)) {
    return { ...DEFAULT_CONFIG };
  }

  const config: Required<ContextMessageExtensionConfig> = { ...DEFAULT_CONFIG };
  if (typeof raw.includeAgentPrompt === 'boolean') {
    config.includeAgentPrompt = raw.includeAgentPrompt;
  }
  if (typeof raw.includeSwarmCatalog === 'boolean') {
    config.includeSwarmCatalog = raw.includeSwarmCatalog;
  }
  if (typeof raw.includeInboundContext === 'boolean') {
    config.includeInboundContext = raw.includeInboundContext;
  }
  if (typeof raw.includeCallContext === 'boolean') {
    config.includeCallContext = raw.includeCallContext;
  }
  if (typeof raw.includeRouteSummary === 'boolean') {
    config.includeRouteSummary = raw.includeRouteSummary;
  }
  if (typeof raw.swarmCatalogInstruction === 'string' && raw.swarmCatalogInstruction.trim().length > 0) {
    config.swarmCatalogInstruction = raw.swarmCatalogInstruction.trim();
  }
  return config;
}

function createPromptHash(system: string): string {
  return createHash('sha256').update(system).digest('hex');
}

function readPromptHashMarker(message: Message): string | undefined {
  if (!isJsonObject(message.metadata)) {
    return undefined;
  }

  const marker = message.metadata[CONTEXT_MESSAGE_MARKER_KEY];
  if (!isJsonObject(marker)) {
    return undefined;
  }

  const promptHash = marker.promptHash;
  if (typeof promptHash !== 'string' || promptHash.length === 0) {
    return undefined;
  }

  return promptHash;
}

function hasPromptHashMarker(messages: Message[], promptHash: string, content: string): boolean {
  for (const message of messages) {
    const existingHash = readPromptHashMarker(message);
    if (existingHash === promptHash) {
      return true;
    }

    if (
      message.source.type === 'extension'
      && message.source.extensionName === EXTENSION_NAME
      && message.data.role === 'system'
      && message.data.content === content
    ) {
      return true;
    }
  }

  return false;
}

function createMessageMarker(promptHash: string, segmentIds: string[]): JsonObject {
  const marker: JsonObject = {
    promptHash,
    segmentIds,
  };
  return marker;
}

function createContextMessage(promptHash: string, content: string, segmentIds: string[]): Message {
  const metadata: Record<string, JsonValue> = {
    [CONTEXT_MESSAGE_MARKER_KEY]: createMessageMarker(promptHash, segmentIds),
  };

  return {
    id: createId('msg'),
    data: {
      role: 'system',
      content,
    },
    metadata,
    createdAt: new Date(),
    source: {
      type: 'extension',
      extensionName: EXTENSION_NAME,
    },
  };
}

function appendRuntimeEvent(
  ctx: TurnMiddlewareContext,
  name: string,
  data: JsonObject | undefined = undefined,
): void {
  const entries: JsonValue[] = Array.isArray(ctx.metadata[EXTENSION_EVENTS_METADATA_KEY])
    ? [...ctx.metadata[EXTENSION_EVENTS_METADATA_KEY]]
    : [];

  const entry: JsonObject = {
    name,
    actor: EXTENSION_NAME,
    at: new Date().toISOString(),
  };
  if (data !== undefined && Object.keys(data).length > 0) {
    entry.data = data;
  }

  entries.push(entry);
  ctx.metadata[EXTENSION_EVENTS_METADATA_KEY] = entries;
}

function resolveAgentPrompt(metadata: RuntimeAgentMetadata): string | null {
  const prompt = metadata.prompt;
  if (!prompt) {
    return null;
  }

  const inlinePrompt = typeof prompt.system === 'string' && prompt.system.trim().length > 0
    ? prompt.system
    : undefined;
  if (!inlinePrompt) {
    return null;
  }

  return inlinePrompt;
}

function formatStringList(values: string[]): string {
  if (values.length === 0) {
    return '';
  }
  return values.join(', ');
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

function resolveSwarmCatalogSegment(
  ctx: TurnMiddlewareContext,
  instruction: string,
): ContextSegment {
  const swarm = ctx.runtime.swarm;
  const lines: string[] = [
    '[runtime_catalog]',
    `swarm=${swarm.swarmName}`,
    `entryAgent=${swarm.entryAgent}`,
    `selfAgent=${swarm.selfAgent}`,
    `availableAgents=${formatStringList(swarm.availableAgents)}`,
    `callableAgents=${formatStringList(swarm.callableAgents)}`,
    '[/runtime_catalog]',
  ];
  if (instruction.length > 0) {
    lines.push(instruction);
  }

  return {
    id: 'runtime.swarm.catalog',
    content: lines.join('\n'),
  };
}

function resolveInboundContextSegment(ctx: TurnMiddlewareContext): ContextSegment {
  const inbound = ctx.runtime.inbound;
  const lines: string[] = [
    '[runtime_inbound]',
    `eventId=${inbound.eventId}`,
    `eventType=${inbound.eventType}`,
    `sourceKind=${inbound.sourceKind}`,
    `sourceName=${inbound.sourceName}`,
    `createdAt=${inbound.createdAt}`,
  ];
  if (typeof inbound.instanceKey === 'string' && inbound.instanceKey.length > 0) {
    lines.push(`instanceKey=${inbound.instanceKey}`);
  }
  if (inbound.eventMetadata && Object.keys(inbound.eventMetadata).length > 0) {
    lines.push(`eventMetadata=${JSON.stringify(inbound.eventMetadata)}`);
  }
  lines.push('[/runtime_inbound]');

  return {
    id: 'runtime.inbound',
    content: lines.join('\n'),
  };
}

function resolveCallContextSegment(ctx: TurnMiddlewareContext): ContextSegment | undefined {
  const call = ctx.runtime.call;
  if (!call) {
    return undefined;
  }

  const lines: string[] = ['[runtime_call]'];
  if (typeof call.callerAgent === 'string' && call.callerAgent.length > 0) {
    lines.push(`callerAgent=${call.callerAgent}`);
  }
  if (typeof call.callerInstanceKey === 'string' && call.callerInstanceKey.length > 0) {
    lines.push(`callerInstanceKey=${call.callerInstanceKey}`);
  }
  if (typeof call.callerTurnId === 'string' && call.callerTurnId.length > 0) {
    lines.push(`callerTurnId=${call.callerTurnId}`);
  }
  if (typeof call.callSource === 'string' && call.callSource.length > 0) {
    lines.push(`callSource=${call.callSource}`);
  }
  if (Array.isArray(call.callStack) && call.callStack.length > 0) {
    lines.push(`callStack=${call.callStack.join(' -> ')}`);
  }
  if (call.replyTo) {
    lines.push(`replyTo.target=${call.replyTo.target}`);
    lines.push(`replyTo.correlationId=${call.replyTo.correlationId}`);
  }
  lines.push('[/runtime_call]');

  if (lines.length <= 2) {
    return undefined;
  }

  return {
    id: 'runtime.call',
    content: lines.join('\n'),
  };
}

function resolveRouteSummarySegment(ctx: TurnMiddlewareContext): ContextSegment {
  const inbound = ctx.runtime.inbound;
  const call = ctx.runtime.call;
  const callerAgent = stringOrUndefined(call?.callerAgent);
  const callerInstanceKey = stringOrUndefined(call?.callerInstanceKey);
  const callerTurnId = stringOrUndefined(call?.callerTurnId);
  const callSource = stringOrUndefined(call?.callSource);
  const inboundInstanceKey = stringOrUndefined(inbound.instanceKey);

  const senderKind = callerAgent ? 'agent' : inbound.sourceKind;
  const senderName = callerAgent ?? inbound.sourceName;
  const senderInstanceKey = callerInstanceKey ?? inboundInstanceKey;

  const lines: string[] = [
    '[runtime_route]',
    'precedence=call>inbound',
    `senderKind=${senderKind}`,
    `senderName=${senderName}`,
    `eventType=${inbound.eventType}`,
    `eventId=${inbound.eventId}`,
  ];
  if (senderInstanceKey) {
    lines.push(`senderInstanceKey=${senderInstanceKey}`);
  }
  if (callerTurnId) {
    lines.push(`senderTurnId=${callerTurnId}`);
  }
  if (callSource) {
    lines.push(`senderSource=${callSource}`);
  }
  lines.push('[/runtime_route]');

  return {
    id: 'runtime.route.summary',
    content: lines.join('\n'),
  };
}

const SEGMENT_ORDER: string[] = [
  'agent.prompt.system',
  'runtime.swarm.catalog',
  'runtime.inbound',
  'runtime.call',
  'runtime.route.summary',
];

function sortSegmentsByOrder(segments: ContextSegment[]): ContextSegment[] {
  const order = new Map<string, number>();
  SEGMENT_ORDER.forEach((id, index) => {
    order.set(id, index);
  });

  return [...segments].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

function resolveContextSegments(
  ctx: TurnMiddlewareContext,
  config: Required<ContextMessageExtensionConfig>,
): {
  resolutions: SegmentResolution[];
  segments: ContextSegment[];
} {
  const resolutions: SegmentResolution[] = [];
  const segments: ContextSegment[] = [];

  if (config.includeAgentPrompt) {
    const system = resolveAgentPrompt({ prompt: ctx.runtime.agent.prompt });
    if (system && system.trim().length > 0) {
      segments.push({
        id: 'agent.prompt.system',
        content: system,
      });
      resolutions.push({ id: 'agent.prompt.system', included: true });
    } else {
      resolutions.push({ id: 'agent.prompt.system', included: false });
    }
  }

  if (config.includeSwarmCatalog) {
    segments.push(resolveSwarmCatalogSegment(ctx, config.swarmCatalogInstruction));
    resolutions.push({ id: 'runtime.swarm.catalog', included: true });
  }

  if (config.includeInboundContext) {
    segments.push(resolveInboundContextSegment(ctx));
    resolutions.push({ id: 'runtime.inbound', included: true });
  }

  if (config.includeCallContext) {
    const callSegment = resolveCallContextSegment(ctx);
    if (callSegment) {
      segments.push(callSegment);
      resolutions.push({ id: 'runtime.call', included: true });
    } else {
      resolutions.push({ id: 'runtime.call', included: false });
    }
  }

  if (config.includeRouteSummary && (config.includeInboundContext || config.includeCallContext)) {
    segments.push(resolveRouteSummarySegment(ctx));
    resolutions.push({ id: 'runtime.route.summary', included: true });
  }

  return {
    resolutions,
    segments: sortSegmentsByOrder(segments),
  };
}

async function emitContextMessages(
  ctx: TurnMiddlewareContext,
  config: Required<ContextMessageExtensionConfig>,
): Promise<void> {
  const composed = resolveContextSegments(ctx, config);
  for (const resolution of composed.resolutions) {
    appendRuntimeEvent(ctx, 'context.segment.resolved', {
      id: resolution.id,
      included: resolution.included,
    });
  }

  if (composed.segments.length === 0) {
    appendRuntimeEvent(ctx, 'context.message.empty');
    return;
  }

  const content = composed.segments.map((segment) => segment.content).join('\n\n');
  const promptHash = createPromptHash(content);
  if (hasPromptHashMarker(ctx.conversationState.nextMessages, promptHash, content)) {
    appendRuntimeEvent(ctx, 'context.message.duplicate', {
      promptHash,
    });
    return;
  }

  ctx.emitMessageEvent({
    type: 'append',
    message: createContextMessage(
      promptHash,
      content,
      composed.segments.map((segment) => segment.id),
    ),
  });

  const emitted: JsonObject = {
    promptHash,
    segmentIds: composed.segments.map((segment) => segment.id),
  };
  appendRuntimeEvent(ctx, 'context.message.appended', emitted);
}

export function register(api: ExtensionApi, rawConfig?: unknown): void {
  const config = readConfig(rawConfig);

  api.pipeline.register('turn', async (ctx) => {
    await emitContextMessages(ctx, config);
    return ctx.next();
  });
}
