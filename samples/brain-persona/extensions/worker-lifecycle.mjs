/**
 * worker-lifecycle Extension
 *
 * Worker 에이전트의 turn 파이프라인에 개입하여:
 * - turn.pre: 무의식(unconscious) 에이전트에 맥락 요청 → 시스템 메시지로 주입
 * - turn.post: 관측(observer) 에이전트에 행동 요약 전송 (fire-and-forget)
 */

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function collectTextFragments(input, parts, visited) {
  if (input === null || input === undefined) {
    return;
  }

  if (typeof input === 'string') {
    const text = input.trim();
    if (text) {
      parts.push(text);
    }
    return;
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    parts.push(String(input));
    return;
  }

  if (typeof input !== 'object') {
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

  // content/parts 중첩 구조를 우선적으로 재귀 순회한다.
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

  // 일부 포맷은 message/content 중첩으로 텍스트를 담는다.
  if (Object.prototype.hasOwnProperty.call(input, 'message')) {
    collectTextFragments(input.message, parts, visited);
  }
}

function flattenText(content) {
  const textParts = [];
  collectTextFragments(content, textParts, new Set());

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

function readRole(payload) {
  return payload?.data?.role || payload?.role;
}

function readContent(payload) {
  if (payload?.data?.content !== undefined) {
    return payload.data.content;
  }
  return payload?.content;
}

function stripGoondanContext(raw) {
  if (!raw) {
    return '';
  }
  return raw
    .replace(/\[goondan_context\][\s\S]*?\[\/goondan_context\]\s*/g, '')
    .trim();
}

/**
 * ctx.inputEvent 또는 ctx.messages에서 [goondan_context] 메타데이터의
 * coordinatorInstanceKey를 추출한다.
 */
function extractCoordinatorInstanceKey(ctx) {
  const RE = /\[goondan_context\]\s*(\{[\s\S]*?\})/;

  // inputEvent에서 탐색
  const events = Array.isArray(ctx.inputEvent)
    ? ctx.inputEvent
    : ctx.inputEvent
      ? [ctx.inputEvent]
      : [];
  for (const evt of events) {
    const text = flattenText(readContent(evt) ?? evt);
    const match = text.match(RE);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed?.metadata?.coordinatorInstanceKey) {
          return parsed.metadata.coordinatorInstanceKey;
        }
      } catch {
        // JSON 파싱 실패 시 다음 이벤트로
      }
    }
  }

  // messages에서 역순 탐색
  const messages = ctx.messages;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const text = flattenText(readContent(msg) ?? msg);
      const match = text.match(RE);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed?.metadata?.coordinatorInstanceKey) {
            return parsed.metadata.coordinatorInstanceKey;
          }
        } catch {
          // JSON 파싱 실패 시 다음 메시지로
        }
      }
    }
  }

  return undefined;
}

/**
 * inputEvent에서 가장 최근 user role 메시지의 텍스트를 추출한다.
 */
function extractUserMessage(ctx) {
  const events = Array.isArray(ctx.inputEvent)
    ? ctx.inputEvent
    : ctx.inputEvent
      ? [ctx.inputEvent]
      : [];

  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i];
    const role = readRole(evt);
    if (role !== 'user') {
      continue;
    }

    const raw = flattenText(readContent(evt));
    const cleaned = stripGoondanContext(raw);
    if (cleaned) {
      return cleaned;
    }

    const fallback = stripGoondanContext(flattenText(evt));
    if (fallback) {
      return fallback;
    }
  }

  const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const role = readRole(msg);
    if (role !== 'user') {
      continue;
    }

    const raw = flattenText(readContent(msg));
    const cleaned = stripGoondanContext(raw);
    if (cleaned) {
      return cleaned;
    }

    const fallback = stripGoondanContext(flattenText(msg));
    if (fallback) {
      return fallback;
    }
  }

  return undefined;
}

function collectToolCallsFromMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const names = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (readRole(msg) !== 'assistant') {
      continue;
    }

    const content = readContent(msg);
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (part?.type === 'tool-call') {
        const name = part.toolName || part.name;
        if (name) {
          names.push(name);
        }
      }
    }
  }

  return [...new Set(names)];
}

function extractLatestAssistantOutput(messages) {
  if (!Array.isArray(messages)) {
    return '';
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (readRole(msg) !== 'assistant') {
      continue;
    }

    const content = readContent(msg);
    const text = flattenText(content).trim();
    if (text) {
      return text;
    }
  }

  return '';
}

/**
 * Turn 결과에서 행동 요약을 구성한다.
 * 입력 메시지, 사용된 tool calls, 최종 응답을 포함.
 */
function buildActionSummary(userMessage, result, ctx) {
  const parts = [];
  let hasToolSignal = false;

  // 입력
  parts.push(`[input] ${userMessage || '(no user message)'}`);

  // tool calls 추출
  if (result?.steps && Array.isArray(result.steps)) {
    const toolCalls = [];
    for (const step of result.steps) {
      if (step?.toolCalls && Array.isArray(step.toolCalls)) {
        for (const tc of step.toolCalls) {
          const name = tc.toolName || tc.name || 'unknown';
          toolCalls.push(name);
        }
      }
    }
    if (toolCalls.length > 0) {
      parts.push(`[tools] ${toolCalls.join(', ')}`);
      hasToolSignal = true;
    }
  }

  if (!parts.some((line) => line.startsWith('[tools]'))) {
    const fallbackToolCalls = collectToolCallsFromMessages(ctx?.messages);
    if (fallbackToolCalls.length > 0) {
      parts.push(`[tools] ${fallbackToolCalls.join(', ')}`);
      hasToolSignal = true;
    } else {
      parts.push('[tools] (none)');
    }
  }

  // 최종 응답 요약 (최대 500자)
  let outputText = '';
  const outputCandidates = [
    result?.text,
    result?.response?.text,
    result?.response,
    extractLatestAssistantOutput(ctx?.messages),
  ];
  for (const candidate of outputCandidates) {
    const text = flattenText(candidate).trim();
    if (text) {
      outputText = text;
      break;
    }
  }

  if (outputText) {
    const summary =
      outputText.length > 500
        ? outputText.slice(0, 500) + '...'
        : outputText;
    parts.push(`[output] ${summary}`);
  } else {
    parts.push('[output] (none)');
  }

  const hasUserSignal = Boolean(userMessage && userMessage.trim());
  const hasOutputSignal = Boolean(outputText);
  if (!hasUserSignal && !hasToolSignal && !hasOutputSignal) {
    return '';
  }

  return parts.join('\n');
}

export function register(api) {
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

        if (response) {
          const content = flattenText(response).trim();

          if (content) {
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
        }
      } catch (err) {
        // 무의식 맥락 로드 실패 시 조용히 무시 — Worker LLM에 영향 주지 않음
        if (logger) {
          logger.debug('worker-lifecycle: unconscious context load failed', {
            error: err?.message || String(err),
          });
        }
      }
    }

    // ── Worker LLM 실행 ──
    const result = await ctx.next();

    // ── turn.post: 관측 자동 트리거 ──
    try {
      const actionSummary = buildActionSummary(userMessage, result, ctx);
      if (!actionSummary) {
        return result;
      }
      const coordinatorInstanceKey = extractCoordinatorInstanceKey(ctx);

      await ctx.agents.send({
        target: 'observer',
        input: actionSummary,
        metadata: {
          coordinatorInstanceKey,
        },
      });
    } catch (err) {
      // 관측 트리거 실패 시 조용히 무시
      if (logger) {
        logger.debug('worker-lifecycle: observer trigger failed', {
          error: err?.message || String(err),
        });
      }
    }

    return result;
  });
}
