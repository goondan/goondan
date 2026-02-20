/**
 * Date Helper Extension
 *
 * Worker의 각 step.pre에서 현재 시각을 시스템 메시지로 주입한다.
 */

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function parseDate(value) {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'number') {
    const msValue = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(msValue);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const msValue = numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = new Date(msValue);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function extractGoondanContextDate(text) {
  if (!text || typeof text !== 'string') {
    return undefined;
  }

  const match = text.match(/\[goondan_context\]\s*(\{[\s\S]*?\})\s*\[\/goondan_context\]/);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]);
    const rawDate =
      parsed?.properties?.date ||
      parsed?.properties?.message?.date;
    return parseDate(rawDate);
  } catch {
    return undefined;
  }
}

function readContent(payload) {
  if (!payload) {
    return undefined;
  }

  if (payload?.data?.content !== undefined) {
    return payload.data.content;
  }

  return payload?.content;
}

function flattenText(input, visited = new Set()) {
  if (input === null || input === undefined) {
    return '';
  }

  if (typeof input === 'string') {
    return input;
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input);
  }

  if (typeof input !== 'object') {
    return '';
  }

  if (visited.has(input)) {
    return '';
  }
  visited.add(input);

  if (Array.isArray(input)) {
    return input
      .map((item) => flattenText(item, visited))
      .filter(Boolean)
      .join('\n');
  }

  const candidates = [
    input.content,
    input.parts,
    input.text,
    input.value,
    input.data,
    input.message,
  ];

  return candidates
    .map((candidate) => flattenText(candidate, visited))
    .filter(Boolean)
    .join('\n');
}

function getLatestEventCreatedAt(inputEvent) {
  const events = Array.isArray(inputEvent)
    ? inputEvent
    : inputEvent
      ? [inputEvent]
      : [];

  let latest;
  for (const evt of events) {
    const candidate = parseDate(evt?.createdAt);
    if (!candidate) {
      continue;
    }
    if (!latest || candidate.getTime() > latest.getTime()) {
      latest = candidate;
    }
  }

  return latest;
}

function resolveBaseTime(ctx) {
  const events = Array.isArray(ctx?.inputEvent)
    ? ctx.inputEvent
    : ctx?.inputEvent
      ? [ctx.inputEvent]
      : [];

  for (const evt of events) {
    const text = flattenText(readContent(evt) ?? evt);
    const fromContext = extractGoondanContextDate(text);
    if (fromContext) {
      return fromContext;
    }
  }

  const fromInputEvent = getLatestEventCreatedAt(ctx?.inputEvent);
  if (fromInputEvent) {
    return fromInputEvent;
  }

  const fromEvent = parseDate(ctx?.event?.createdAt);
  if (fromEvent) {
    return fromEvent;
  }

  return new Date(Date.now());
}

function normalizeStepIndex(stepIndex) {
  const parsed = Number(stepIndex);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const integer = Math.trunc(parsed);
  return integer >= 0 ? integer : 0;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatTimezoneOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = pad(Math.floor(absolute / 60));
  const minutes = pad(absolute % 60);
  return `${sign}${hours}:${minutes}`;
}

function buildCurrentTimeMessage(date, stepIndex) {
  return [
    '[current_time]',
    `step_index=${stepIndex}`,
    `local=${formatLocalDateTime(date)}`,
    `timezone_offset=${formatTimezoneOffset(date)}`,
    `iso=${date.toISOString()}`,
    `epoch_ms=${date.getTime()}`,
    '[/current_time]',
  ].join('\n');
}

export function register(api) {
  api.pipeline.register('step', async (ctx) => {
    const baseTime = resolveBaseTime(ctx);
    const safeStepIndex = normalizeStepIndex(ctx?.stepIndex);

    ctx.emitMessageEvent({
      type: 'append',
      message: {
        id: createId('date-helper'),
        data: {
          role: 'system',
          content: buildCurrentTimeMessage(baseTime, safeStepIndex),
        },
        metadata: {
          'date-helper.currentTime': true,
          stepIndex: safeStepIndex,
        },
        createdAt: baseTime,
        source: {
          type: 'extension',
          extensionName: 'date-helper',
        },
      },
    });

    return ctx.next();
  });
}
