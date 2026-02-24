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

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readPathValue(record, path) {
  if (!isRecord(record)) {
    return undefined;
  }

  const keys = path.split('.');
  let current = record;

  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

function resolveDateFromContext(input) {
  const paths = [
    'date',
    'timestamp',
    'ts',
    'thread_ts',
    'createdAt',
    'message.date',
    'message.ts',
    'event.date',
    'event.ts',
    'properties.date',
    'properties.ts',
    'properties.thread_ts',
    'properties.message.date',
    'properties.message.ts',
    'originProperties.date',
    'originProperties.ts',
    'originProperties.thread_ts',
    'originProperties.message.date',
    'originProperties.message.ts',
  ];

  for (const path of paths) {
    const value = readPathValue(input, path);
    const parsed = parseDate(value);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
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
    const fromMetadata = resolveDateFromContext(evt?.metadata);
    if (fromMetadata) {
      return fromMetadata;
    }

    const fromSource = resolveDateFromContext(evt?.source);
    if (fromSource) {
      return fromSource;
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
