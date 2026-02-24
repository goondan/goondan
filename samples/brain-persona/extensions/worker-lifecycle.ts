/**
 * worker-lifecycle Extension
 *
 * Worker 에이전트의 turn 파이프라인에 개입하여:
 * - turn.pre: 무의식(unconscious) 에이전트에 맥락 요청 → 시스템 메시지로 주입
 * - turn.post: 관측(observer) 에이전트에 구조화 관측 이벤트 전송 (fire-and-forget)
 */

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

interface MessageLike {
  data?: {
    role?: string;
    content?: unknown;
  };
  role?: string;
  content?: unknown;
}

interface AgentEventLike {
  input?: string;
  instanceKey?: string;
  metadata?: JsonObject;
  source?: JsonObject;
}

interface ConversationStateLike {
  nextMessages: MessageLike[];
}

interface TurnResultLike {
  responseMessage?: MessageLike;
}

interface MiddlewareAgentsApiLike {
  request(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    timeoutMs?: number;
    async?: boolean;
    metadata?: JsonObject;
  }): Promise<{
    target: string;
    response: string;
    correlationId?: string;
    accepted?: boolean;
    async?: boolean;
  }>;
  send(params: {
    target: string;
    input?: string;
    instanceKey?: string;
    metadata?: JsonObject;
  }): Promise<{
    accepted: boolean;
  }>;
}

interface TurnContextLike {
  inputEvent: AgentEventLike;
  conversationState: ConversationStateLike;
  agents: MiddlewareAgentsApiLike;
  emitMessageEvent(event: unknown): void;
  next(): Promise<TurnResultLike>;
}

interface ExtensionApiLike {
  logger?: {
    debug?: (...args: unknown[]) => void;
  };
  pipeline: {
    register(type: 'turn', fn: (ctx: TurnContextLike) => Promise<TurnResultLike>): void;
  };
}

function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRole(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const directRole = payload.role;
  if (typeof directRole === 'string') {
    return directRole;
  }

  const data = payload.data;
  if (isRecord(data) && typeof data.role === 'string') {
    return data.role;
  }

  return undefined;
}

function readContent(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }

  const data = payload.data;
  if (isRecord(data) && Object.prototype.hasOwnProperty.call(data, 'content')) {
    return data.content;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
    return payload.content;
  }

  return undefined;
}

function collectTextFragments(input: unknown, parts: string[], visited: Set<unknown>): void {
  if (input === null || input === undefined) {
    return;
  }

  if (typeof input === 'string') {
    const text = input.trim();
    if (text.length > 0) {
      parts.push(text);
    }
    return;
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    parts.push(String(input));
    return;
  }

  if (!isRecord(input) && !Array.isArray(input)) {
    return;
  }

  if (visited.has(input)) {
    return;
  }
  visited.add(input);

  if (Array.isArray(input)) {
    for (const item of input) {
      collectTextFragments(item, parts, visited);
    }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'content')) {
    collectTextFragments(input.content, parts, visited);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'parts')) {
    collectTextFragments(input.parts, parts, visited);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'text')) {
    collectTextFragments(input.text, parts, visited);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'value')) {
    collectTextFragments(input.value, parts, visited);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'data')) {
    collectTextFragments(input.data, parts, visited);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'message')) {
    collectTextFragments(input.message, parts, visited);
  }
}

function flattenText(content: unknown): string {
  const textParts: string[] = [];
  collectTextFragments(content, textParts, new Set<unknown>());

  if (textParts.length > 0) {
    return textParts.join('\n');
  }

  try {
    const serialized = JSON.stringify(content);
    return typeof serialized === 'string' ? serialized : '';
  } catch {
    return '';
  }
}

function getStringProp(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readCoordinatorInstanceKeyFromMetadata(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  return getStringProp(metadata, 'coordinatorInstanceKey');
}

function readCoordinatorInstanceKeyFromSource(source: unknown): string | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  const direct = getStringProp(source, 'coordinatorInstanceKey');
  if (direct) {
    return direct;
  }

  const sourceMetadata = source.metadata;
  if (isRecord(sourceMetadata)) {
    const fromSourceMetadata = getStringProp(sourceMetadata, 'coordinatorInstanceKey');
    if (fromSourceMetadata) {
      return fromSourceMetadata;
    }
  }

  return undefined;
}

function readCoordinatorInstanceKeyFromInputEvent(inputEvent: AgentEventLike): string | undefined {
  return typeof inputEvent.instanceKey === 'string'
    ? inputEvent.instanceKey
    : undefined;
}

function extractCoordinatorInstanceKey(ctx: TurnContextLike): string | undefined {
  const fromMetadata = readCoordinatorInstanceKeyFromMetadata(ctx.inputEvent.metadata);
  if (fromMetadata) {
    return fromMetadata;
  }

  const fromSource = readCoordinatorInstanceKeyFromSource(ctx.inputEvent.source);
  if (fromSource) {
    return fromSource;
  }

  return readCoordinatorInstanceKeyFromInputEvent(ctx.inputEvent);
}

function isToolResultOnlyContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }

  for (const part of content) {
    if (!isRecord(part) || part.type !== 'tool-result') {
      return false;
    }
  }

  return true;
}

function extractUserMessage(ctx: TurnContextLike): string | undefined {
  const fromInput = typeof ctx.inputEvent.input === 'string'
    ? ctx.inputEvent.input.trim()
    : '';
  if (fromInput.length > 0) {
    return fromInput;
  }

  const messages = Array.isArray(ctx.conversationState?.nextMessages)
    ? ctx.conversationState.nextMessages
    : [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (readRole(message) !== 'user') {
      continue;
    }

    const content = readContent(message);
    if (isToolResultOnlyContent(content)) {
      continue;
    }

    const raw = flattenText(content).trim();
    if (raw.length > 0) {
      return raw;
    }

    const fallback = flattenText(message).trim();
    if (fallback.length > 0) {
      return fallback;
    }
  }

  return undefined;
}

type ToolExecutionStatus = 'ok' | 'error' | 'unknown';

interface ObserverToolExecution {
  toolCallId: string;
  toolName: string;
  status: ToolExecutionStatus;
  inputPreview: string;
  inputTruncated: boolean;
  outputPreview: string;
  outputTruncated: boolean;
  highlights: string[];
}

interface ObserverSignals {
  fileOperations: string[];
  agentInteractions: string[];
  shellCommands: string[];
  networkRequests: string[];
  toolErrors: string[];
}

export interface ObserverPayload {
  schema: 'goondan.observation.turn.v2';
  capturedAt: string;
  turn: {
    input: string;
    inputTruncated: boolean;
    output: string;
    outputTruncated: boolean;
    toolCallCount: number;
  };
  tools: ObserverToolExecution[];
  signals: ObserverSignals;
}

interface CollectedToolExecution {
  toolCallId: string;
  toolName: string;
  input?: JsonObject;
  outputText: string;
  hasOutput: boolean;
}

interface ParsedToolCallPart {
  toolCallId: string;
  toolName: string;
  input?: JsonObject;
}

interface ParsedToolResultPart {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

const MAX_TURN_INPUT_CHARS = 1200;
const MAX_TURN_OUTPUT_CHARS = 1600;
const MAX_TOOL_INPUT_CHARS = 500;
const MAX_TOOL_OUTPUT_CHARS = 700;
const MAX_SIGNAL_ITEM_CHARS = 240;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars)}...`,
    truncated: true,
  };
}

function toJsonValue(input: unknown): JsonValue {
  if (input === null) {
    return null;
  }

  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }

  if (Array.isArray(input)) {
    const values: JsonValue[] = [];
    for (const item of input) {
      values.push(toJsonValue(item));
    }
    return values;
  }

  if (isRecord(input)) {
    const output: JsonObject = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) {
        continue;
      }
      output[key] = toJsonValue(value);
    }
    return output;
  }

  return String(input);
}

function toJsonObject(input: unknown): JsonObject | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    output[key] = toJsonValue(value);
  }
  return output;
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const sorted: JsonValue[] = [];
    for (const item of value) {
      sorted.push(sortJsonValue(item));
    }
    return sorted;
  }

  if (!isRecord(value)) {
    return value;
  }

  const sorted: JsonObject = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const entry = value[key];
    if (entry === undefined) {
      continue;
    }
    sorted[key] = sortJsonValue(entry);
  }
  return sorted;
}

function stringifyJsonObject(value: JsonObject | undefined): string {
  if (!value) {
    return '';
  }

  try {
    const normalized = sortJsonValue(value);
    const serialized = JSON.stringify(normalized);
    return typeof serialized === 'string' ? serialized : '';
  } catch {
    return '';
  }
}

function parseToolCallPart(part: unknown): ParsedToolCallPart | undefined {
  if (!isRecord(part) || part.type !== 'tool-call') {
    return undefined;
  }

  const toolCallId = getStringProp(part, 'toolCallId') ?? getStringProp(part, 'id');
  const toolName = getStringProp(part, 'toolName') ?? getStringProp(part, 'name');
  if (!toolCallId || !toolName) {
    return undefined;
  }

  return {
    toolCallId,
    toolName,
    input: toJsonObject(part.input),
  };
}

function parseToolResultPart(part: unknown): ParsedToolResultPart | undefined {
  if (!isRecord(part) || part.type !== 'tool-result') {
    return undefined;
  }

  const toolCallId = getStringProp(part, 'toolCallId') ?? getStringProp(part, 'tool_use_id');
  if (!toolCallId) {
    return undefined;
  }

  const toolName = getStringProp(part, 'toolName') ?? getStringProp(part, 'tool_name') ?? 'unknown-tool';
  const output = Object.hasOwn(part, 'output') ? part.output : part.content;

  return {
    toolCallId,
    toolName,
    output,
  };
}

function normalizeToolOutput(output: unknown): string {
  if (isRecord(output)) {
    const type = getStringProp(output, 'type');
    const value = output.value;
    if (type === 'text' && typeof value === 'string') {
      return value.trim();
    }
  }

  const text = extractTextFromContent(output).trim();
  if (text.length > 0) {
    return text;
  }

  if (isRecord(output) || Array.isArray(output)) {
    try {
      const serialized = JSON.stringify(output);
      return typeof serialized === 'string' ? serialized : '';
    } catch {
      return '';
    }
  }

  return typeof output === 'string' ? output.trim() : '';
}

function inferToolStatus(outputText: string, hasOutput: boolean): ToolExecutionStatus {
  if (!hasOutput) {
    return 'unknown';
  }

  const normalized = outputText.trim().toLowerCase();
  if (normalized.length === 0) {
    return 'unknown';
  }

  const errorSignals = ['error', 'failed', 'exception', 'invalid', 'timeout', 'not available', 'not registered'];
  for (const signal of errorSignals) {
    if (normalized.includes(signal)) {
      return 'error';
    }
  }

  return 'ok';
}

function findTurnStartIndex(messages: MessageLike[], userMessage: string | undefined): number {
  const normalizedUser = normalizeWhitespace(userMessage ?? '');
  let fallbackIndex = -1;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (readRole(message) !== 'user') {
      continue;
    }

    const content = readContent(message);
    if (isToolResultOnlyContent(content)) {
      continue;
    }

    const raw = extractTextFromContent(content);
    const normalized = normalizeWhitespace(raw);
    if (normalized.length === 0) {
      continue;
    }

    if (fallbackIndex < 0) {
      fallbackIndex = i;
    }

    if (normalizedUser.length > 0) {
      if (normalized === normalizedUser || normalized.includes(normalizedUser) || normalizedUser.includes(normalized)) {
        return i;
      }
    }
  }

  if (fallbackIndex >= 0) {
    return fallbackIndex;
  }

  return messages.length > 8 ? messages.length - 8 : 0;
}

function readInputString(input: JsonObject | undefined, key: string): string | undefined {
  if (!input) {
    return undefined;
  }
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function formatSignalValue(input: string | undefined): string {
  if (!input) {
    return '';
  }
  const compact = normalizeWhitespace(input);
  if (compact.length === 0) {
    return '';
  }
  const preview = truncateText(compact, MAX_SIGNAL_ITEM_CHARS);
  return preview.text;
}

function buildToolHighlights(toolName: string, input: JsonObject | undefined): string[] {
  const highlights: string[] = [];

  if (toolName.startsWith('file-system__')) {
    const action = toolName.slice('file-system__'.length) || 'unknown';
    const path = readInputString(input, 'path');
    const from = readInputString(input, 'from');
    const to = readInputString(input, 'to');
    if (path) {
      highlights.push(`action=${action}, path=${path}`);
    } else if (from || to) {
      highlights.push(`action=${action}, from=${from ?? '(none)'}, to=${to ?? '(none)'}`);
    } else {
      highlights.push(`action=${action}`);
    }
  } else if (toolName.startsWith('agents__')) {
    const method = toolName.slice('agents__'.length) || 'call';
    const target = readInputString(input, 'target');
    const instanceKey = readInputString(input, 'instanceKey');
    const targetLabel = target ?? '(unknown)';
    if (instanceKey) {
      highlights.push(`method=${method}, target=${targetLabel}, instanceKey=${instanceKey}`);
    } else {
      highlights.push(`method=${method}, target=${targetLabel}`);
    }
  } else if (toolName.startsWith('bash__')) {
    const cmd = readInputString(input, 'cmd') ?? readInputString(input, 'command');
    const command = formatSignalValue(cmd);
    if (command.length > 0) {
      highlights.push(`command=${command}`);
    }
  } else if (toolName.startsWith('http-fetch__')) {
    const url = formatSignalValue(readInputString(input, 'url'));
    const method = readInputString(input, 'method') ?? 'GET';
    if (url.length > 0) {
      highlights.push(`method=${method.toUpperCase()}, url=${url}`);
    } else {
      highlights.push(`method=${method.toUpperCase()}`);
    }
  }

  return highlights;
}

function appendUnique(values: string[], value: string): void {
  if (value.length === 0) {
    return;
  }
  if (values.includes(value)) {
    return;
  }
  values.push(value);
}

function collectToolExecutions(messages: MessageLike[]): CollectedToolExecution[] {
  const orderedIds: string[] = [];
  const executions = new Map<string, CollectedToolExecution>();

  for (const message of messages) {
    const content = readContent(message);
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const toolCall = parseToolCallPart(part);
      if (toolCall) {
        const existing = executions.get(toolCall.toolCallId);
        if (!existing) {
          orderedIds.push(toolCall.toolCallId);
          executions.set(toolCall.toolCallId, {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            outputText: '',
            hasOutput: false,
          });
        } else {
          existing.toolName = toolCall.toolName;
          if (toolCall.input) {
            existing.input = toolCall.input;
          }
        }
        continue;
      }

      const toolResult = parseToolResultPart(part);
      if (!toolResult) {
        continue;
      }

      const existing = executions.get(toolResult.toolCallId);
      if (!existing) {
        orderedIds.push(toolResult.toolCallId);
        executions.set(toolResult.toolCallId, {
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          outputText: normalizeToolOutput(toolResult.output),
          hasOutput: true,
        });
      } else {
        existing.toolName = toolResult.toolName || existing.toolName;
        existing.outputText = normalizeToolOutput(toolResult.output);
        existing.hasOutput = true;
      }
    }
  }

  const ordered: CollectedToolExecution[] = [];
  for (const toolCallId of orderedIds) {
    const execution = executions.get(toolCallId);
    if (!execution) {
      continue;
    }
    ordered.push(execution);
  }
  return ordered;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type !== 'text') {
        continue;
      }
      const text = getStringProp(part, 'text');
      if (text && text.trim().length > 0) {
        textParts.push(text.trim());
      }
    }

    if (textParts.length > 0) {
      return textParts.join('\n').trim();
    }
  }

  return flattenText(content).trim();
}

function extractLatestAssistantOutput(messages: MessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (readRole(message) !== 'assistant') {
      continue;
    }

    const text = extractTextFromContent(readContent(message));
    if (text.length > 0) {
      return text;
    }
  }

  return '';
}

function resolveTurnOutput(result: TurnResultLike, messages: MessageLike[]): string {
  const outputCandidates: string[] = [];
  if (result.responseMessage) {
    outputCandidates.push(extractTextFromContent(readContent(result.responseMessage)));
  }
  outputCandidates.push(extractLatestAssistantOutput(messages));

  for (const candidate of outputCandidates) {
    const text = candidate.trim();
    if (text.length > 0) {
      return text;
    }
  }

  return '';
}

function collectObserverSignals(executions: CollectedToolExecution[]): ObserverSignals {
  const fileOperations: string[] = [];
  const agentInteractions: string[] = [];
  const shellCommands: string[] = [];
  const networkRequests: string[] = [];
  const toolErrors: string[] = [];

  for (const execution of executions) {
    if (execution.toolName.startsWith('file-system__')) {
      const action = execution.toolName.slice('file-system__'.length) || 'unknown';
      const path = readInputString(execution.input, 'path')
        ?? readInputString(execution.input, 'from')
        ?? readInputString(execution.input, 'to');
      appendUnique(fileOperations, path ? `${action}:${path}` : action);
    }

    if (execution.toolName.startsWith('agents__')) {
      const method = execution.toolName.slice('agents__'.length) || 'call';
      const target = readInputString(execution.input, 'target') ?? '(unknown)';
      appendUnique(agentInteractions, `${method}:${target}`);
    }

    if (execution.toolName.startsWith('bash__')) {
      const cmd = readInputString(execution.input, 'cmd') ?? readInputString(execution.input, 'command');
      const command = formatSignalValue(cmd);
      if (command.length > 0) {
        appendUnique(shellCommands, command);
      }
    }

    if (execution.toolName.startsWith('http-fetch__')) {
      const method = (readInputString(execution.input, 'method') ?? 'GET').toUpperCase();
      const url = formatSignalValue(readInputString(execution.input, 'url'));
      appendUnique(networkRequests, url.length > 0 ? `${method} ${url}` : method);
    }

    const status = inferToolStatus(execution.outputText, execution.hasOutput);
    if (status === 'error') {
      const raw = normalizeWhitespace(execution.outputText);
      const preview = truncateText(raw.length > 0 ? raw : '(error)', MAX_SIGNAL_ITEM_CHARS);
      appendUnique(toolErrors, `${execution.toolName}(${execution.toolCallId}): ${preview.text}`);
    }
  }

  return {
    fileOperations,
    agentInteractions,
    shellCommands,
    networkRequests,
    toolErrors,
  };
}

export function buildObserverPayload(
  userMessage: string | undefined,
  result: TurnResultLike,
  messages: MessageLike[],
  capturedAt: Date = new Date(),
): ObserverPayload | undefined {
  const startIndex = findTurnStartIndex(messages, userMessage);
  const scopedMessages = messages.slice(startIndex);
  const executions = collectToolExecutions(scopedMessages);
  const outputText = resolveTurnOutput(result, scopedMessages);

  const normalizedInput = normalizeWhitespace(userMessage ?? '');
  const hasUserSignal = normalizedInput.length > 0;
  const hasToolSignal = executions.length > 0;
  const hasOutputSignal = outputText.length > 0;
  if (!hasUserSignal && !hasToolSignal && !hasOutputSignal) {
    return undefined;
  }

  const inputPreview = truncateText(
    normalizedInput.length > 0 ? normalizedInput : '(no user message)',
    MAX_TURN_INPUT_CHARS,
  );
  const outputPreview = truncateText(
    outputText.length > 0 ? outputText : '(none)',
    MAX_TURN_OUTPUT_CHARS,
  );

  const tools: ObserverToolExecution[] = [];
  for (const execution of executions) {
    const inputText = stringifyJsonObject(execution.input);
    const normalizedOutput = normalizeWhitespace(execution.outputText);

    const toolInputPreview = truncateText(
      inputText.length > 0 ? inputText : '(none)',
      MAX_TOOL_INPUT_CHARS,
    );
    const toolOutputPreview = truncateText(
      execution.hasOutput
        ? (normalizedOutput.length > 0 ? normalizedOutput : '(empty)')
        : '(no tool result)',
      MAX_TOOL_OUTPUT_CHARS,
    );

    tools.push({
      toolCallId: execution.toolCallId,
      toolName: execution.toolName,
      status: inferToolStatus(execution.outputText, execution.hasOutput),
      inputPreview: toolInputPreview.text,
      inputTruncated: toolInputPreview.truncated,
      outputPreview: toolOutputPreview.text,
      outputTruncated: toolOutputPreview.truncated,
      highlights: buildToolHighlights(execution.toolName, execution.input),
    });
  }

  return {
    schema: 'goondan.observation.turn.v2',
    capturedAt: capturedAt.toISOString(),
    turn: {
      input: inputPreview.text,
      inputTruncated: inputPreview.truncated,
      output: outputPreview.text,
      outputTruncated: outputPreview.truncated,
      toolCallCount: tools.length,
    },
    tools,
    signals: collectObserverSignals(executions),
  };
}

function buildLegacyObserverSummary(payload: ObserverPayload): string {
  const toolLine = payload.tools.length > 0
    ? payload.tools.map((item) => `${item.toolName}[${item.status}]`).join(', ')
    : '(none)';

  return [
    `[input] ${payload.turn.input}`,
    `[tools] ${toolLine}`,
    `[output] ${payload.turn.output}`,
  ].join('\n');
}

export function serializeObserverPayload(payload: ObserverPayload): string {
  const serialized = JSON.stringify(payload, null, 2);
  return `[observer_payload]\n${serialized}\n[/observer_payload]\n\n${buildLegacyObserverSummary(payload)}`;
}

export function register(api: ExtensionApiLike): void {
  const logger = api.logger;

  api.pipeline.register('turn', async (ctx) => {
    // ── turn.pre: 무의식 맥락 자동 로드 ──
    const userMessage = extractUserMessage(ctx);

    if (userMessage) {
      try {
        const { response } = await ctx.agents.request({
          target: 'unconscious',
          input: userMessage,
          timeoutMs: 10000,
        });

        const content = typeof response === 'string' ? response.trim() : '';
        if (content.length > 0) {
          ctx.emitMessageEvent({
            type: 'append',
            message: {
              id: createId('wlc'),
              data: {
                role: 'system',
                content: `[unconscious_context]\n${content}\n[/unconscious_context]`,
              },
              metadata: {
                'worker-lifecycle.unconsciousContext': true,
              },
              createdAt: new Date(),
              source: {
                type: 'extension',
                extensionName: 'worker-lifecycle',
              },
            },
          });
        }
      } catch (error) {
        if (logger?.debug) {
          logger.debug('worker-lifecycle: unconscious context load failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // ── Worker LLM 실행 ──
    const result = await ctx.next();

    // ── turn.post: 관측 자동 트리거 ──
    try {
      const messages = Array.isArray(ctx.conversationState?.nextMessages)
        ? ctx.conversationState.nextMessages
        : [];
      const observerPayload = buildObserverPayload(userMessage, result, messages);
      if (!observerPayload) {
        return result;
      }
      const observerInput = serializeObserverPayload(observerPayload);

      const coordinatorInstanceKey = extractCoordinatorInstanceKey(ctx);
      const metadata = coordinatorInstanceKey
        ? { coordinatorInstanceKey }
        : undefined;

      await ctx.agents.send({
        target: 'observer',
        input: observerInput,
        metadata,
      });
    } catch (error) {
      if (logger?.debug) {
        logger.debug('worker-lifecycle: observer trigger failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  });
}
