import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { STUDIO_HTML } from '../studio/assets.js';
import type {
  InstanceStore,
  ListInstancesRequest,
  StudioInstanceRequest,
  StudioInstanceSummary,
  StudioInstancesRequest,
  StudioInteraction,
  StudioInteractionHistory,
  StudioParticipant,
  StudioServerRequest,
  StudioServerSession,
  StudioService,
  StudioTimelineEntry,
  StudioVisualization,
} from '../types.js';
import { exists, isObjectRecord, readTextFileIfExists } from '../utils.js';
import { resolveStateRoot } from './config.js';

interface LocatedInstancePath {
  workspaceName: string;
  instancePath: string;
  source: 'exact' | 'workspace';
}

interface MessageLike {
  createdAt: string;
  sourceType: string;
  toolName?: string;
  extensionName?: string;
  content: string;
  inboundContext?: MessageInboundContext;
}

interface MessageInboundContext {
  sourceKind: 'agent' | 'connector';
  sourceName: string;
  eventName: string;
  instanceKey: string;
}

interface MessageRouteState {
  replyTargetId: string;
}

interface ConnectorLogEvent {
  at: string;
  connectorName: string;
  connectionName: string;
  eventName: string;
  instanceKey: string;
}

interface MutableParticipant extends StudioParticipant {
  order: number;
}

interface MutableInteraction {
  key: string;
  a: string;
  b: string;
  total: number;
  lastSeenAt: string;
  direction: 'a->b' | 'b->a' | 'undirected';
  history: StudioInteractionHistory[];
  forwardSeen: boolean;
  backwardSeen: boolean;
}

interface TimelineEnvelope {
  entry: StudioTimelineEntry;
  sortAt: number;
  sequence: number;
}

const INBOUND_MESSAGE_METADATA_KEY = '__goondanInbound';

function sanitizeInstanceKey(instanceKey: string): string {
  return instanceKey.replace(/[^a-zA-Z0-9_:-]/g, '-').slice(0, 128);
}

function nowIso(offset = 0): string {
  return new Date(Date.now() + offset).toISOString();
}

function fallbackIsoFromEpochMs(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    return new Date(0).toISOString();
  }

  const normalized = Math.max(0, Math.trunc(epochMs));
  return new Date(normalized).toISOString();
}

function normalizeTimestamp(input: unknown, fallbackEpochMs: number): string {
  if (typeof input === 'string') {
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallbackIsoFromEpochMs(fallbackEpochMs);
}

function toMillis(input: string): number {
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;
}

function toDetailText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const texts = value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (!isObjectRecord(item)) {
          return '';
        }
        const textValue = item['text'];
        return typeof textValue === 'string' ? textValue : '';
      })
      .filter((text) => text.length > 0);
    return texts.join(' ');
  }

  if (isObjectRecord(value)) {
    const textValue = value['text'];
    if (typeof textValue === 'string') {
      return textValue;
    }
  }

  return '';
}

function parseInboundContextFromMetadata(metadataValue: unknown): MessageInboundContext | undefined {
  if (!isObjectRecord(metadataValue)) {
    return undefined;
  }

  const inboundValue = metadataValue[INBOUND_MESSAGE_METADATA_KEY];
  if (!isObjectRecord(inboundValue)) {
    return undefined;
  }

  const sourceKind = inboundValue['sourceKind'];
  const sourceName = inboundValue['sourceName'];
  const eventName = inboundValue['eventName'];
  const instanceKey = inboundValue['instanceKey'];
  if (
    (sourceKind !== 'agent' && sourceKind !== 'connector') ||
    typeof sourceName !== 'string' ||
    sourceName.length === 0 ||
    typeof eventName !== 'string' ||
    eventName.length === 0 ||
    typeof instanceKey !== 'string' ||
    instanceKey.length === 0
  ) {
    return undefined;
  }

  return {
    sourceKind,
    sourceName,
    eventName,
    instanceKey,
  };
}

function messageFromUnknown(value: unknown): MessageLike | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const createdAt = value['createdAt'];
  const source = value['source'];
  const data = value['data'];

  if (typeof createdAt !== 'string' || !isObjectRecord(source) || !isObjectRecord(data)) {
    return undefined;
  }

  const sourceType = source['type'];
  if (typeof sourceType !== 'string') {
    return undefined;
  }

  const role = data['role'];
  const rawContent = toDetailText(data['content']);
  const contextFromMetadata = parseInboundContextFromMetadata(value['metadata']);
  const content = rawContent;

  const extensionName = source['extensionName'];
  const toolName = source['toolName'];

  let finalSourceType = sourceType;
  if (typeof role === 'string' && role.length > 0 && sourceType === 'assistant') {
    finalSourceType = role;
  }

  return {
    createdAt,
    sourceType: finalSourceType,
    toolName: typeof toolName === 'string' ? toolName : undefined,
    extensionName: typeof extensionName === 'string' ? extensionName : undefined,
    content,
    inboundContext: contextFromMetadata,
  };
}

function parseJsonLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  const raw = await readTextFileIfExists(filePath);
  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseJsonLine)
    .filter((line): line is unknown => line !== undefined);
}

function classifyParticipantKind(sourceType: string): StudioParticipant['kind'] {
  if (sourceType === 'user') {
    return 'user';
  }
  if (sourceType === 'assistant') {
    return 'assistant';
  }
  if (sourceType === 'tool') {
    return 'tool';
  }
  if (sourceType === 'extension') {
    return 'extension';
  }
  if (sourceType === 'system') {
    return 'system';
  }
  return 'unknown';
}

function classifyParticipantKindFromId(id: string, sourceType?: string): StudioParticipant['kind'] {
  if (id.startsWith('agent:')) {
    return 'agent';
  }
  if (id.startsWith('connector:')) {
    return 'connector';
  }
  if (id.startsWith('tool:')) {
    return 'tool';
  }
  if (id.startsWith('extension:')) {
    return 'extension';
  }
  if (id.startsWith('user:')) {
    return 'user';
  }
  if (id.startsWith('system:')) {
    return 'system';
  }
  if (sourceType) {
    return classifyParticipantKind(sourceType);
  }
  return 'unknown';
}

function registerParticipant(
  participants: Map<string, MutableParticipant>,
  id: string,
  label: string,
  kind: StudioParticipant['kind'],
  at: string,
): void {
  const existing = participants.get(id);
  if (!existing) {
    participants.set(id, {
      id,
      label,
      kind,
      lastSeenAt: at,
      order: participants.size,
    });
    return;
  }

  if (toMillis(at) >= toMillis(existing.lastSeenAt)) {
    existing.lastSeenAt = at;
  }
  if (existing.kind === 'unknown' && kind !== 'unknown') {
    existing.kind = kind;
  }
}

function edgeKeyFor(from: string, to: string): { key: string; a: string; b: string; forward: boolean } {
  if (from <= to) {
    return {
      key: `${from}|${to}`,
      a: from,
      b: to,
      forward: true,
    };
  }

  return {
    key: `${to}|${from}`,
    a: to,
    b: from,
    forward: false,
  };
}

function registerInteraction(
  interactions: Map<string, MutableInteraction>,
  from: string,
  to: string,
  at: string,
  kind: string,
  detail: string,
): void {
  if (from.length === 0 || to.length === 0 || from === to) {
    return;
  }

  const edge = edgeKeyFor(from, to);
  const existing = interactions.get(edge.key);
  const history: StudioInteractionHistory = {
    at,
    from,
    to,
    direction: edge.forward ? 'a->b' : 'b->a',
    kind,
    detail,
  };

  if (!existing) {
    interactions.set(edge.key, {
      key: edge.key,
      a: edge.a,
      b: edge.b,
      total: 1,
      lastSeenAt: at,
      direction: edge.forward ? 'a->b' : 'b->a',
      history: [history],
      forwardSeen: edge.forward,
      backwardSeen: !edge.forward,
    });
    return;
  }

  existing.total += 1;
  if (toMillis(at) >= toMillis(existing.lastSeenAt)) {
    existing.lastSeenAt = at;
  }
  existing.history.push(history);
  if (edge.forward) {
    existing.forwardSeen = true;
  } else {
    existing.backwardSeen = true;
  }
  if (existing.forwardSeen && existing.backwardSeen) {
    existing.direction = 'undirected';
  } else {
    existing.direction = existing.forwardSeen ? 'a->b' : 'b->a';
  }
}

function pushTimeline(
  timeline: TimelineEnvelope[],
  entry: StudioTimelineEntry,
  sequence: number,
): void {
  timeline.push({
    entry,
    sortAt: toMillis(entry.at),
    sequence,
  });
}

function fromMessageToRoute(
  message: MessageLike,
  instanceKey: string,
  defaultAgentId: string,
  state: MessageRouteState,
): { from: string; to: string; kind: string; detail: string } {
  const userId = `user:${instanceKey}`;
  const systemId = 'system:runtime';

  if (message.sourceType === 'user') {
    const inbound = message.inboundContext;
    if (inbound) {
      const fromId = `${inbound.sourceKind}:${inbound.sourceName}`;
      state.replyTargetId = fromId;
      return {
        from: fromId,
        to: defaultAgentId,
        kind: `message.${inbound.sourceKind}`,
        detail: message.content,
      };
    }

    state.replyTargetId = userId;
    return {
      from: userId,
      to: defaultAgentId,
      kind: 'message.user',
      detail: message.content,
    };
  }

  if (message.sourceType === 'tool') {
    const toolName = message.toolName ?? 'unknown';
    return {
      from: `tool:${toolName}`,
      to: defaultAgentId,
      kind: 'message.tool',
      detail: message.content,
    };
  }

  if (message.sourceType === 'extension') {
    const extensionName = message.extensionName ?? 'unknown';
    return {
      from: `extension:${extensionName}`,
      to: defaultAgentId,
      kind: 'message.extension',
      detail: message.content,
    };
  }

  if (message.sourceType === 'system') {
    return {
      from: systemId,
      to: defaultAgentId,
      kind: 'message.system',
      detail: message.content,
    };
  }

  return {
    from: defaultAgentId,
    to: state.replyTargetId,
    kind: 'message.assistant',
    detail: message.content,
  };
}

function runtimeEventRoute(
  event: Record<string, unknown>,
): {
  from: string;
  to: string;
  detail: string;
  llmInputMessages?: Array<{ role: string; content: string }>;
} | undefined {
  const type = event['type'];
  const agentName = event['agentName'];
  if (typeof type !== 'string' || typeof agentName !== 'string') {
    return undefined;
  }

  const agentId = `agent:${agentName}`;
  const llmInputMessages = parseLlmInputMessages(event['llmInputMessages']);

  if (type === 'tool.called') {
    const toolName = event['toolName'];
    return {
      from: agentId,
      to: `tool:${typeof toolName === 'string' ? toolName : 'unknown'}`,
      detail: typeof toolName === 'string' ? toolName : '',
      llmInputMessages,
    };
  }

  if (type === 'tool.completed' || type === 'tool.failed') {
    const toolName = event['toolName'];
    const status = event['status'];
    const suffix = typeof status === 'string' ? ` (${status})` : '';
    return {
      from: `tool:${typeof toolName === 'string' ? toolName : 'unknown'}`,
      to: agentId,
      detail: `${typeof toolName === 'string' ? toolName : 'unknown'}${suffix}`,
      llmInputMessages,
    };
  }

  return {
    from: agentId,
    to: 'system:runtime',
    detail: type,
    llmInputMessages,
  };
}

function parseLlmInputMessages(
  value: unknown,
): Array<{ role: string; content: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const messages: Array<{ role: string; content: string }> = [];
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue;
    }
    const role = item['role'];
    const content = item['content'];
    if (typeof role !== 'string' || role.length === 0 || typeof content !== 'string') {
      continue;
    }
    messages.push({ role, content });
  }

  return messages.length > 0 ? messages : undefined;
}

function parseConnectorLogLine(line: string, fallbackEpochMs: number): ConnectorLogEvent | undefined {
  const pattern =
    /\[goondan-runtime\]\[([^/\]]+)\/([^\]]+)\] emitted event name=([^\s]+) instanceKey=([^\s]+)/u;
  const match = pattern.exec(line);
  if (!match) {
    return undefined;
  }

  const connectionName = match[1] ?? '';
  const connectorName = match[2] ?? '';
  const eventName = match[3] ?? '';
  const instanceKey = match[4] ?? '';
  if (connectionName.length === 0 || connectorName.length === 0 || eventName.length === 0 || instanceKey.length === 0) {
    return undefined;
  }

  const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/u);
  const at = normalizeTimestamp(timestampMatch ? timestampMatch[1] : undefined, fallbackEpochMs);

  return {
    at,
    connectionName,
    connectorName,
    eventName,
    instanceKey,
  };
}

function compareDirentByNameAsc(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function pseudoEpochMsFromPath(filePath: string): number {
  let hash = 2166136261;
  for (let index = 0; index < filePath.length; index += 1) {
    hash ^= filePath.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const tenYearsInSeconds = 10 * 365 * 24 * 60 * 60;
  const offsetSeconds = (hash >>> 0) % tenYearsInSeconds;
  return 1_577_836_800_000 + offsetSeconds * 1000;
}

function stableFileBaseEpochMs(filePath: string, birthtimeMs: number): number {
  if (Number.isFinite(birthtimeMs) && birthtimeMs > 0) {
    return Math.trunc(birthtimeMs);
  }

  return pseudoEpochMsFromPath(filePath);
}

async function resolveInstanceLocations(stateRoot: string, instanceKey: string): Promise<LocatedInstancePath[]> {
  const safeKey = sanitizeInstanceKey(instanceKey);
  const results: LocatedInstancePath[] = [];
  const seen = new Set<string>();
  const requestedWorkspaceNames = Array.from(new Set([safeKey, instanceKey]));

  const pushLocatedInstance = (
    workspaceName: string,
    instancePath: string,
    source: 'exact' | 'workspace',
  ): void => {
    if (seen.has(instancePath)) {
      return;
    }
    seen.add(instancePath);
    results.push({
      workspaceName,
      instancePath,
      source,
    });
  };

  const appendWorkspaceInstances = async (
    workspaceRootPath: string,
    workspaceName: string,
    source: 'workspace',
    instancesDirName = 'instances',
  ): Promise<void> => {
    const workspacePath = path.join(workspaceRootPath, workspaceName);
    if (!(await exists(workspacePath))) {
      return;
    }

    const instancesRoot = path.join(workspacePath, instancesDirName);
    if (!(await exists(instancesRoot))) {
      return;
    }

    const entries = (await readdir(instancesRoot, { withFileTypes: true })).sort(compareDirentByNameAsc);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const instancePath = path.join(instancesRoot, entry.name);
      pushLocatedInstance(workspaceName, instancePath, source);
    }
  };

  const workspacesRoot = path.join(stateRoot, 'workspaces');
  if (await exists(workspacesRoot)) {
    const workspaces = (await readdir(workspacesRoot, { withFileTypes: true })).sort(compareDirentByNameAsc);
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) {
        continue;
      }

      const workspaceName = workspace.name;
      const candidates = [
        path.join(workspacesRoot, workspaceName, 'instances', safeKey),
        path.join(workspacesRoot, workspaceName, 'instances', instanceKey),
      ];

      for (const candidate of candidates) {
        if (!(await exists(candidate))) {
          continue;
        }
        pushLocatedInstance(workspaceName, candidate, 'exact');
      }
    }
  }

  const legacyRoot = path.join(stateRoot, 'instances');
  if (await exists(legacyRoot)) {
    const workspaceCandidates = (await readdir(legacyRoot, { withFileTypes: true })).sort(compareDirentByNameAsc);
    for (const workspace of workspaceCandidates) {
      if (!workspace.isDirectory()) {
        continue;
      }
      const workspaceName = workspace.name;
      const candidates = [
        path.join(legacyRoot, workspaceName, safeKey),
        path.join(legacyRoot, workspaceName, instanceKey),
      ];
      for (const candidate of candidates) {
        if (!(await exists(candidate))) {
          continue;
        }
        pushLocatedInstance(workspaceName, candidate, 'exact');
      }
    }
  }

  if (results.length > 0) {
    return results;
  }

  if (await exists(workspacesRoot)) {
    for (const workspaceName of requestedWorkspaceNames) {
      await appendWorkspaceInstances(workspacesRoot, workspaceName, 'workspace');
    }
  }

  if (await exists(legacyRoot)) {
    for (const workspaceName of requestedWorkspaceNames) {
      await appendWorkspaceInstances(legacyRoot, workspaceName, 'workspace', '');
    }
  }

  return results;
}

function parseInstanceMetadataAgent(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return undefined;
    }
    const agentName = parsed['agentName'];
    if (typeof agentName === 'string' && agentName.length > 0) {
      return agentName;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function compareTimeline(a: TimelineEnvelope, b: TimelineEnvelope): number {
  if (a.sortAt !== b.sortAt) {
    return a.sortAt - b.sortAt;
  }
  return a.sequence - b.sequence;
}

function finalizeParticipants(participants: Map<string, MutableParticipant>): StudioParticipant[] {
  return [...participants.values()]
    .sort((a, b) => {
      const timeGap = toMillis(b.lastSeenAt) - toMillis(a.lastSeenAt);
      if (timeGap !== 0) {
        return timeGap;
      }
      return a.order - b.order;
    })
    .map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      lastSeenAt: item.lastSeenAt,
    }));
}

function finalizeInteractions(interactions: Map<string, MutableInteraction>): StudioInteraction[] {
  return [...interactions.values()]
    .sort((a, b) => toMillis(b.lastSeenAt) - toMillis(a.lastSeenAt))
    .map((item) => ({
      key: item.key,
      a: item.a,
      b: item.b,
      total: item.total,
      lastSeenAt: item.lastSeenAt,
      direction: item.direction,
      history: [...item.history].sort((x, y) => toMillis(x.at) - toMillis(y.at)),
    }));
}

function normalizeHostForDisplay(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function parseRecentLimit(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(parsed, 200);
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function writeText(res: ServerResponse, statusCode: number, contentType: string, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function notFound(res: ServerResponse): void {
  writeJson(res, 404, {
    error: 'not_found',
    message: '요청한 리소스를 찾을 수 없습니다.',
  });
}

export class DefaultStudioService implements StudioService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly instances: InstanceStore;

  constructor(env: NodeJS.ProcessEnv, instances: InstanceStore) {
    this.env = env;
    this.instances = instances;
  }

  async listInstances(request: StudioInstancesRequest): Promise<StudioInstanceSummary[]> {
    const rows = await this.instances.list({
      limit: 200,
      all: true,
      stateRoot: request.stateRoot,
    } satisfies ListInstancesRequest);

    return rows.map((row) => ({
      key: row.key,
      status: row.status,
      agent: row.agent,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async loadVisualization(request: StudioInstanceRequest): Promise<StudioVisualization> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const instanceLocations = await resolveInstanceLocations(stateRoot, request.instanceKey);
    const participants = new Map<string, MutableParticipant>();
    const interactions = new Map<string, MutableInteraction>();
    const timeline: TimelineEnvelope[] = [];
    let sequence = 0;

    registerParticipant(participants, `user:${request.instanceKey}`, 'user', 'user', nowIso(1));

    const knownAgents = new Set<string>();

    for (const location of instanceLocations) {
      const metadataPath = path.join(location.instancePath, 'metadata.json');
      const metadataRaw = await readTextFileIfExists(metadataPath);
      const metadataAgent = metadataRaw ? parseInstanceMetadataAgent(metadataRaw) : undefined;
      const resolvedAgent = metadataAgent ?? path.basename(location.instancePath);
      knownAgents.add(resolvedAgent);
      registerParticipant(
        participants,
        `agent:${resolvedAgent}`,
        resolvedAgent,
        'agent',
        nowIso(sequence),
      );

      const basePath = path.join(location.instancePath, 'messages', 'base.jsonl');
      const eventsPath = path.join(location.instancePath, 'messages', 'events.jsonl');
      const runtimeEventsPath = path.join(location.instancePath, 'messages', 'runtime-events.jsonl');
      const baseFallbackMs = (await stat(basePath).catch(() => undefined))?.mtimeMs ?? 0;
      const eventsFallbackMs = (await stat(eventsPath).catch(() => undefined))?.mtimeMs ?? 0;
      const runtimeFallbackMs = (await stat(runtimeEventsPath).catch(() => undefined))?.mtimeMs ?? 0;

      const baseRows = await readJsonLines(basePath);
      const routeState: MessageRouteState = {
        replyTargetId: `user:${request.instanceKey}`,
      };
      for (const row of baseRows) {
        const message = messageFromUnknown(row);
        if (!message) {
          continue;
        }
        const at = normalizeTimestamp(message.createdAt, baseFallbackMs + sequence);
        const principalAgent = resolvedAgent;
        const principalAgentId = `agent:${principalAgent}`;
        registerParticipant(participants, principalAgentId, principalAgent, 'agent', at);
        const routed = fromMessageToRoute(message, request.instanceKey, principalAgentId, routeState);

        registerParticipant(
          participants,
          routed.from,
          routed.from.replace(/^[^:]+:/u, ''),
          classifyParticipantKindFromId(routed.from, message.sourceType),
          at,
        );
        registerParticipant(
          participants,
          routed.to,
          routed.to.replace(/^[^:]+:/u, ''),
          classifyParticipantKindFromId(routed.to),
          at,
        );

        registerInteraction(interactions, routed.from, routed.to, at, routed.kind, routed.detail);
        pushTimeline(
          timeline,
          {
            at,
            kind: 'message',
            source: routed.from,
            target: routed.to,
            subtype: routed.kind,
            detail: routed.detail,
          },
          sequence,
        );
        sequence += 1;
      }

      const eventRows = await readJsonLines(eventsPath);
      for (const row of eventRows) {
        if (!isObjectRecord(row)) {
          continue;
        }
        const eventType = row['type'];
        if (typeof eventType !== 'string') {
          continue;
        }

        if (eventType === 'append') {
          const message = messageFromUnknown(row['message']);
          if (!message) {
            continue;
          }
          const at = normalizeTimestamp(message.createdAt, eventsFallbackMs + sequence);
          const principalAgent = resolvedAgent;
          const principalAgentId = `agent:${principalAgent}`;
          const routed = fromMessageToRoute(message, request.instanceKey, principalAgentId, routeState);

          registerParticipant(
            participants,
            routed.from,
            routed.from.replace(/^[^:]+:/u, ''),
            classifyParticipantKindFromId(routed.from, message.sourceType),
            at,
          );
          registerParticipant(
            participants,
            routed.to,
            routed.to.replace(/^[^:]+:/u, ''),
            classifyParticipantKindFromId(routed.to),
            at,
          );
          registerInteraction(interactions, routed.from, routed.to, at, 'message.append', routed.detail);
          pushTimeline(
            timeline,
            {
              at,
              kind: 'message',
              source: routed.from,
              target: routed.to,
              subtype: 'message.append',
              detail: routed.detail,
            },
            sequence,
          );
          sequence += 1;
          continue;
        }

        const at = normalizeTimestamp(
          isObjectRecord(row) ? row['createdAt'] : undefined,
          eventsFallbackMs + sequence,
        );
        pushTimeline(
          timeline,
          {
            at,
            kind: 'message',
            source: 'system:runtime',
            target: `agent:${resolvedAgent}`,
            subtype: `event.${eventType}`,
            detail: `message event: ${eventType}`,
          },
          sequence,
        );
        sequence += 1;
      }

      const runtimeRows = await readJsonLines(runtimeEventsPath);
      for (const row of runtimeRows) {
        if (!isObjectRecord(row)) {
          continue;
        }
        const at = normalizeTimestamp(row['timestamp'], runtimeFallbackMs + sequence);
        const routed = runtimeEventRoute(row);
        if (!routed) {
          continue;
        }

        const sourceLabel = routed.from.replace(/^[^:]+:/u, '');
        const targetLabel = routed.to.replace(/^[^:]+:/u, '');
        registerParticipant(
          participants,
          routed.from,
          sourceLabel,
          routed.from.startsWith('agent:') ? 'agent' : routed.from.startsWith('tool:') ? 'tool' : 'system',
          at,
        );
        registerParticipant(
          participants,
          routed.to,
          targetLabel,
          routed.to.startsWith('agent:') ? 'agent' : routed.to.startsWith('tool:') ? 'tool' : 'system',
          at,
        );

        const subtype = typeof row['type'] === 'string' ? row['type'] : 'runtime.event';
        registerInteraction(interactions, routed.from, routed.to, at, subtype, routed.detail);
        pushTimeline(
          timeline,
          {
            at,
            kind: 'runtime-event',
            source: routed.from,
            target: routed.to,
            subtype,
            detail: routed.detail,
            llmInputMessages: routed.llmInputMessages,
          },
          sequence,
        );
        sequence += 1;
      }
    }

    const includesWorkspaceFallback = instanceLocations.some((location) => location.source === 'workspace');
    const connectorEvents = await this.readConnectorEventsFromLogs(
      stateRoot,
      request.instanceKey,
      includesWorkspaceFallback,
    );
    const primaryAgent = knownAgents.values().next().value ?? request.instanceKey;
    const primaryAgentId = `agent:${primaryAgent}`;

    for (const event of connectorEvents) {
      const source = `connector:${event.connectorName}`;
      const target = primaryAgentId;
      const detail = `${event.connectionName}/${event.connectorName} -> ${event.eventName}`;
      registerParticipant(participants, source, event.connectorName, 'connector', event.at);
      registerParticipant(participants, target, primaryAgent, 'agent', event.at);
      registerInteraction(interactions, source, target, event.at, 'connector.emitted', detail);
      pushTimeline(
        timeline,
        {
          at: event.at,
          kind: 'connector-log',
          source,
          target,
          subtype: 'connector.emitted',
          detail,
        },
        sequence,
      );
      sequence += 1;
    }

    timeline.sort(compareTimeline);
    const entries = timeline.map((item) => item.entry);
    const recentLimit = request.maxRecentEvents ?? 20;
    const recentEvents = entries.slice(Math.max(0, entries.length - recentLimit));

    return {
      instanceKey: request.instanceKey,
      participants: finalizeParticipants(participants),
      interactions: finalizeInteractions(interactions),
      timeline: entries,
      recentEvents,
    };
  }

  async startServer(request: StudioServerRequest): Promise<StudioServerSession> {
    const host = request.host;
    const port = request.port;
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const server = createServer(async (req, res) => {
      await this.handleHttpRequest(req, res, stateRoot);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const closed = new Promise<void>((resolve) => {
      server.once('close', () => {
        resolve();
      });
    });

    const close = async (): Promise<void> =>
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });

    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr && typeof addr.port === 'number' ? addr.port : port;
    const displayHost = normalizeHostForDisplay(host);

    return {
      url: `http://${displayHost}:${String(boundPort)}`,
      close,
      closed,
    };
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse, stateRoot: string): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://studio.local');
    const pathname = url.pathname;

    if (pathname === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/') {
      writeText(res, 200, 'text/html; charset=utf-8', STUDIO_HTML);
      return;
    }


    const segments = pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (method === 'GET' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'instances') {
      const items = await this.listInstances({ stateRoot });
      writeJson(res, 200, {
        items,
        polledAt: new Date().toISOString(),
      });
      return;
    }

    if (
      method === 'GET' &&
      segments.length === 4 &&
      segments[0] === 'api' &&
      segments[1] === 'instances' &&
      segments[3] === 'visualization'
    ) {
      const encodedKey = segments[2];
      const instanceKey = decodeURIComponent(encodedKey ?? '');
      if (!instanceKey) {
        writeJson(res, 400, {
          error: 'invalid_instance_key',
          message: 'instance key가 비어 있습니다.',
        });
        return;
      }

      const maxRecentEvents = parseRecentLimit(url.searchParams.get('recent'));
      const visualization = await this.loadVisualization({
        stateRoot,
        instanceKey,
        maxRecentEvents,
      });
      writeJson(res, 200, visualization);
      return;
    }

    notFound(res);
  }

  private async readConnectorEventsFromLogs(
    stateRoot: string,
    instanceKey: string,
    includeAllInstanceKeys = false,
  ): Promise<ConnectorLogEvent[]> {
    const events: ConnectorLogEvent[] = [];
    const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);
    if (!(await exists(logDir))) {
      return events;
    }

    const files = (await readdir(logDir, { withFileTypes: true })).sort(compareDirentByNameAsc);
    let sequence = 0;

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.stdout.log')) {
        continue;
      }

      const fullPath = path.join(logDir, file.name);
      const content = await readTextFileIfExists(fullPath);
      if (!content) {
        continue;
      }

      const stats = await stat(fullPath);
      const baseOffsetMs = stableFileBaseEpochMs(fullPath, stats.birthtimeMs);
      const lines = content.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      for (const line of lines) {
        const parsed = parseConnectorLogLine(line, baseOffsetMs + sequence);
        if (!parsed) {
          sequence += 1;
          continue;
        }
        if (!includeAllInstanceKeys && parsed.instanceKey !== instanceKey) {
          sequence += 1;
          continue;
        }
        events.push(parsed);
        sequence += 1;
      }
    }

    return events.sort((a, b) => toMillis(a.at) - toMillis(b.at));
  }
}
