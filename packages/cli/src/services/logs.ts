import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { configError } from '../errors.js';
import type { LogChunk, LogReadRequest, LogReadResult, LogService } from '../types.js';
import { exists, isObjectRecord } from '../utils.js';
import { resolveStateRoot } from './config.js';

interface ActiveLogFile {
  process: string;
  stdout: string;
  stderr: string;
}

interface ActiveRuntimeState {
  instanceKey: string;
  logs: ActiveLogFile[];
}

function parseActiveLogFile(value: unknown): ActiveLogFile | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const process = value['process'];
  const stdout = value['stdout'];
  const stderr = value['stderr'];

  if (typeof process !== 'string' || typeof stdout !== 'string' || typeof stderr !== 'string') {
    return undefined;
  }

  if (process.length === 0 || stdout.length === 0 || stderr.length === 0) {
    return undefined;
  }

  return {
    process,
    stdout,
    stderr,
  };
}

function parseActiveRuntimeState(raw: string): ActiveRuntimeState | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return undefined;
    }

    const instanceKey = parsed['instanceKey'];
    if (typeof instanceKey !== 'string' || instanceKey.length === 0) {
      return undefined;
    }

    const logsValue = parsed['logs'];
    const logs: ActiveLogFile[] = [];
    if (Array.isArray(logsValue)) {
      for (const item of logsValue) {
        const parsedLog = parseActiveLogFile(item);
        if (parsedLog) {
          logs.push(parsedLog);
        }
      }
    }

    return {
      instanceKey,
      logs,
    };
  } catch {
    return undefined;
  }
}

function tailLines(content: string, maxLines: number): string[] {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);

  if (lines.length <= maxLines) {
    return lines;
  }

  return lines.slice(lines.length - maxLines);
}

function resolveFallbackLogPaths(stateRoot: string, instanceKey: string, processName: string): { stdout: string; stderr: string } {
  const logDir = path.join(stateRoot, 'runtime', 'logs', instanceKey);
  return {
    stdout: path.join(logDir, `${processName}.stdout.log`),
    stderr: path.join(logDir, `${processName}.stderr.log`),
  };
}

function sanitizeProcessName(processName: string): string {
  const normalized = processName.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw configError('process 이름 형식이 올바르지 않습니다.', '영문/숫자/점/대시/언더스코어만 사용하세요.');
  }
  return normalized;
}

async function readChunk(stream: 'stdout' | 'stderr', filePath: string, maxLines: number): Promise<LogChunk | undefined> {
  const hasFile = await exists(filePath);
  if (!hasFile) {
    return undefined;
  }

  const raw = await readFile(filePath, 'utf8');
  return {
    stream,
    path: filePath,
    lines: tailLines(raw, maxLines),
  };
}

interface EventFilter {
  agent?: string;
  trace?: string;
}

function matchesEventFilter(line: string, filter: EventFilter): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isObjectRecord(parsed)) {
      return false;
    }

    if (filter.agent) {
      const agentName = parsed['agentName'];
      if (typeof agentName !== 'string' || agentName !== filter.agent) {
        return false;
      }
    }

    if (filter.trace) {
      const traceId = parsed['traceId'];
      if (typeof traceId !== 'string' || traceId !== filter.trace) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function filterAndTailLines(content: string, maxLines: number, filter: EventFilter): string[] {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);

  const filtered = lines.filter((line) => matchesEventFilter(line, filter));

  if (filtered.length <= maxLines) {
    return filtered;
  }

  return filtered.slice(filtered.length - maxLines);
}

async function readRuntimeEventsChunk(
  filePath: string,
  maxLines: number,
  filter: EventFilter,
): Promise<LogChunk | undefined> {
  const hasFile = await exists(filePath);
  if (!hasFile) {
    return undefined;
  }

  const raw = await readFile(filePath, 'utf8');
  return {
    stream: 'stdout',
    path: filePath,
    lines: filterAndTailLines(raw, maxLines, filter),
  };
}

export class FileLogService implements LogService {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  async read(request: LogReadRequest): Promise<LogReadResult> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const processName = sanitizeProcessName(request.process);
    const maxLines = Number.isFinite(request.lines) ? Math.max(1, Math.trunc(request.lines)) : 200;

    const activePath = path.join(stateRoot, 'runtime', 'active.json');
    const hasActive = await exists(activePath);
    const active = hasActive ? parseActiveRuntimeState(await readFile(activePath, 'utf8')) : undefined;

    const instanceKey = request.instanceKey ?? active?.instanceKey;
    if (!instanceKey) {
      throw configError('실행 중인 인스턴스를 찾지 못했습니다.', 'gdn run으로 먼저 실행하거나 --instance-key를 지정하세요.');
    }

    const hasEventFilter = Boolean(request.agent) || Boolean(request.trace);

    // agent/trace 필터가 있으면 runtime-events.jsonl에서 필터링
    if (hasEventFilter) {
      const filter: EventFilter = {
        agent: request.agent,
        trace: request.trace,
      };
      const eventsPath = path.join(stateRoot, 'workspaces', instanceKey, 'messages', 'runtime-events.jsonl');
      const chunk = await readRuntimeEventsChunk(eventsPath, maxLines, filter);
      if (!chunk) {
        throw configError(
          `런타임 이벤트 파일을 찾을 수 없습니다. (instance=${instanceKey})`,
          'gdn run을 다시 실행한 뒤 gdn logs를 사용하세요.',
        );
      }

      return {
        instanceKey,
        process: processName,
        chunks: [chunk],
      };
    }

    const fromActive = active?.logs.find((item) => item.process === processName);
    const resolvedPaths = fromActive ?? resolveFallbackLogPaths(stateRoot, instanceKey, processName);

    const chunks: LogChunk[] = [];
    if (request.stream === 'stdout' || request.stream === 'both') {
      const chunk = await readChunk('stdout', resolvedPaths.stdout, maxLines);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    if (request.stream === 'stderr' || request.stream === 'both') {
      const chunk = await readChunk('stderr', resolvedPaths.stderr, maxLines);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    if (chunks.length === 0) {
      throw configError(
        `로그 파일을 찾을 수 없습니다. (instance=${instanceKey}, process=${processName})`,
        'gdn run을 다시 실행한 뒤 gdn logs를 사용하세요.',
      );
    }

    return {
      instanceKey,
      process: processName,
      chunks,
    };
  }
}
