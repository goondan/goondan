/**
 * worker-lifecycle Extension
 *
 * Worker 에이전트의 turn 파이프라인에 개입하여:
 * - turn.pre: 무의식(unconscious) 에이전트에 맥락 요청 → 시스템 메시지로 주입
 * - turn.post: 관측(observer) 에이전트에 행동 요약 전송 (fire-and-forget)
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
  metadata?: JsonObject;
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

function stripGoondanContext(raw: string): string {
  if (raw.length === 0) {
    return '';
  }

  return raw
    .replace(/\[goondan_context\][\s\S]*?\[\/goondan_context\]\s*/g, '')
    .trim();
}

function extractGoondanContextJsonBlock(raw: string): string | undefined {
  const startTag = '[goondan_context]';
  const endTag = '[/goondan_context]';

  const start = raw.indexOf(startTag);
  if (start < 0) {
    return undefined;
  }

  const contentStart = start + startTag.length;
  const end = raw.indexOf(endTag, contentStart);
  if (end < 0) {
    return undefined;
  }

  const jsonBlock = raw.slice(contentStart, end).trim();
  return jsonBlock.length > 0 ? jsonBlock : undefined;
}

function getStringProp(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readCoordinatorInstanceKeyFromParsedContext(parsed: unknown): string | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }

  const metadata = parsed.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }

  return getStringProp(metadata, 'coordinatorInstanceKey');
}

function readCoordinatorInstanceKeyFromMetadata(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  return getStringProp(metadata, 'coordinatorInstanceKey');
}

function parseCoordinatorInstanceKeyFromText(text: string): string | undefined {
  const block = extractGoondanContextJsonBlock(text);
  if (!block) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(block);
    return readCoordinatorInstanceKeyFromParsedContext(parsed);
  } catch {
    return undefined;
  }
}

function extractCoordinatorInstanceKey(ctx: TurnContextLike): string | undefined {
  const fromMetadata = readCoordinatorInstanceKeyFromMetadata(ctx.inputEvent.metadata);
  if (fromMetadata) {
    return fromMetadata;
  }

  const inputText = typeof ctx.inputEvent.input === 'string' ? ctx.inputEvent.input : '';
  const fromInputText = parseCoordinatorInstanceKeyFromText(inputText);
  if (fromInputText) {
    return fromInputText;
  }

  const messages = Array.isArray(ctx.conversationState?.nextMessages)
    ? ctx.conversationState.nextMessages
    : [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const text = flattenText(readContent(message) ?? message);
    const fromMessage = parseCoordinatorInstanceKeyFromText(text);
    if (fromMessage) {
      return fromMessage;
    }
  }

  return undefined;
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
    ? stripGoondanContext(ctx.inputEvent.input)
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

    const raw = flattenText(content);
    const cleaned = stripGoondanContext(raw);
    if (cleaned.length > 0) {
      return cleaned;
    }

    const fallback = stripGoondanContext(flattenText(message));
    if (fallback.length > 0) {
      return fallback;
    }
  }

  return undefined;
}

function collectToolCallsFromMessages(messages: MessageLike[]): string[] {
  const names: string[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (readRole(message) !== 'assistant') {
      continue;
    }

    const content = readContent(message);
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!isRecord(part) || part.type !== 'tool-call') {
        continue;
      }

      const toolName = getStringProp(part, 'toolName') ?? getStringProp(part, 'name');
      if (toolName) {
        names.push(toolName);
      }
    }
  }

  const unique = new Set<string>();
  const ordered: string[] = [];
  for (const name of names) {
    if (unique.has(name)) {
      continue;
    }
    unique.add(name);
    ordered.push(name);
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

function buildActionSummary(
  userMessage: string | undefined,
  result: TurnResultLike,
  messages: MessageLike[],
): string {
  const parts: string[] = [];

  parts.push(`[input] ${userMessage || '(no user message)'}`);

  const toolCalls = collectToolCallsFromMessages(messages);
  if (toolCalls.length > 0) {
    parts.push(`[tools] ${toolCalls.join(', ')}`);
  } else {
    parts.push('[tools] (none)');
  }

  const outputCandidates: string[] = [];
  if (result.responseMessage) {
    outputCandidates.push(extractTextFromContent(readContent(result.responseMessage)));
  }
  outputCandidates.push(extractLatestAssistantOutput(messages));

  let outputText = '';
  for (const candidate of outputCandidates) {
    if (candidate.length > 0) {
      outputText = candidate;
      break;
    }
  }

  if (outputText.length > 0) {
    const summary = outputText.length > 500
      ? `${outputText.slice(0, 500)}...`
      : outputText;
    parts.push(`[output] ${summary}`);
  } else {
    parts.push('[output] (none)');
  }

  const hasUserSignal = Boolean(userMessage && userMessage.trim().length > 0);
  const hasToolSignal = toolCalls.length > 0;
  const hasOutputSignal = outputText.length > 0;
  if (!hasUserSignal && !hasToolSignal && !hasOutputSignal) {
    return '';
  }

  return parts.join('\n');
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
      const actionSummary = buildActionSummary(userMessage, result, messages);
      if (actionSummary.length === 0) {
        return result;
      }

      const coordinatorInstanceKey = extractCoordinatorInstanceKey(ctx);
      const metadata = coordinatorInstanceKey
        ? { coordinatorInstanceKey }
        : undefined;

      await ctx.agents.send({
        target: 'observer',
        input: actionSummary,
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
