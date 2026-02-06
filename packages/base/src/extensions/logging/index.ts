/**
 * Logging Extension
 *
 * 대화 로그를 파일로 저장하는 Extension입니다.
 * - step.llmCall middleware: LLM 요청/응답 로깅
 * - turn.post mutator: Turn 요약 로깅
 *
 * @see /docs/specs/extension.md
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type {
  ExtensionApi,
  ExtStepContext,
  ExtTurnContext,
  ExtLlmMessage,
  ExtLlmResult,
} from '@goondan/core';

/** 로깅 설정 */
interface LoggingConfig {
  logLevel?: LogLevel;
  logDir?: string;
  includeTimestamp?: boolean;
  maxLogFileSizeMB?: number;
}

/** 로그 레벨 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LOG_LEVELS: readonly string[] = ['debug', 'info', 'warn', 'error'];

interface ResolvedLoggingConfig {
  logLevel: LogLevel;
  logDir: string;
  includeTimestamp: boolean;
  maxLogFileSizeMB: number;
}

/** 기본 설정 */
const DEFAULT_CONFIG: ResolvedLoggingConfig = {
  logLevel: 'info',
  logDir: './logs',
  includeTimestamp: true,
  maxLogFileSizeMB: 10,
};

/**
 * 값이 유효한 LogLevel인지 확인
 */
function isValidLogLevel(value: string): value is LogLevel {
  return VALID_LOG_LEVELS.includes(value);
}

/**
 * Record-like 객체인지 확인
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLoggingConfig(input: unknown): ResolvedLoggingConfig {
  if (!isRecordLike(input)) {
    return { ...DEFAULT_CONFIG };
  }

  const logLevel = typeof input['logLevel'] === 'string' && isValidLogLevel(input['logLevel'])
    ? input['logLevel']
    : DEFAULT_CONFIG.logLevel;

  const logDir = typeof input['logDir'] === 'string'
    ? input['logDir']
    : DEFAULT_CONFIG.logDir;

  const includeTimestamp = typeof input['includeTimestamp'] === 'boolean'
    ? input['includeTimestamp']
    : DEFAULT_CONFIG.includeTimestamp;

  const maxLogFileSizeMB = typeof input['maxLogFileSizeMB'] === 'number'
    ? input['maxLogFileSizeMB']
    : DEFAULT_CONFIG.maxLogFileSizeMB;

  return { logLevel, logDir, includeTimestamp, maxLogFileSizeMB };
}

/**
 * 로그 레벨 비교
 */
function shouldLog(messageLevel: LogLevel, configLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[messageLevel] >= LOG_LEVEL_PRIORITY[configLevel];
}

/**
 * 타임스탬프 생성
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 메시지 요약 (긴 내용을 짧게)
 */
function summarizeContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength - 3) + '...';
}

/**
 * 메시지 배열에서 요약 생성
 */
function summarizeMessages(messages: ExtLlmMessage[]): string {
  return messages.map((msg) => {
    const role = msg.role;
    if ('content' in msg && typeof msg.content === 'string') {
      return `[${role}] ${summarizeContent(msg.content, 100)}`;
    }
    return `[${role}] (non-text)`;
  }).join('\n');
}

/**
 * 로그 파일에 기록
 */
async function writeLogEntry(
  logDir: string,
  entry: string,
  includeTimestamp: boolean,
): Promise<void> {
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const logFile = join(logDir, `goondan-${dateStr}.log`);

  const prefix = includeTimestamp ? `[${getTimestamp()}] ` : '';
  const line = `${prefix}${entry}\n`;

  try {
    await mkdir(logDir, { recursive: true });
    await writeFile(logFile, line, { flag: 'a' });
  } catch {
    // 로그 기록 실패는 무시 (로깅이 메인 로직을 방해하면 안 됨)
  }
}

/**
 * Extension register function
 */
export async function register(api: ExtensionApi): Promise<void> {
  const config = parseLoggingConfig(api.extension.spec?.config);
  const logger = api.logger;

  logger?.debug?.(`logging Extension initialized: logDir=${config.logDir}, logLevel=${config.logLevel}`);

  // step.llmCall middleware: LLM 요청/응답 로깅
  api.pipelines.wrap('step.llmCall', async (ctx: ExtStepContext, next: (ctx: ExtStepContext) => Promise<ExtLlmResult>) => {
    const messageCount = ctx.turn.messages.length;
    const agentName = ctx.agent?.metadata?.name ?? 'unknown';

    // 요청 로깅
    if (shouldLog('info', config.logLevel)) {
      const summary = summarizeMessages(ctx.turn.messages);
      await writeLogEntry(
        config.logDir,
        `[LLM_REQUEST] agent=${agentName} messages=${messageCount}\n${summary}`,
        config.includeTimestamp,
      );
    }

    const startTime = Date.now();
    const result = await next(ctx);
    const elapsed = Date.now() - startTime;

    // 응답 로깅
    if (shouldLog('info', config.logLevel)) {
      const responseContent = result.message.content ?? '(no content)';
      const toolCallCount = result.message.toolCalls?.length ?? 0;
      await writeLogEntry(
        config.logDir,
        `[LLM_RESPONSE] agent=${agentName} elapsed=${elapsed}ms toolCalls=${toolCallCount} content=${summarizeContent(responseContent, 200)}`,
        config.includeTimestamp,
      );
    }

    return result;
  });

  // turn.post mutator: Turn 요약 로깅
  api.pipelines.mutate('turn.post', async (ctx: ExtTurnContext) => {
    if (!shouldLog('info', config.logLevel)) {
      return ctx;
    }

    const agentName = ctx.agent?.metadata?.name ?? 'unknown';
    const messageCount = ctx.turn.messages.length;
    const turnId = ctx.turn.metadata?.['turnId'] ?? 'unknown';

    await writeLogEntry(
      config.logDir,
      `[TURN_COMPLETE] agent=${agentName} turnId=${String(turnId)} totalMessages=${messageCount}`,
      config.includeTimestamp,
    );

    return ctx;
  });

  // 초기화 이벤트
  api.events.emit('extension.initialized', {
    name: api.extension.metadata?.name ?? 'logging',
    config: {
      logLevel: config.logLevel,
      logDir: config.logDir,
    },
  });

  logger?.info?.('logging Extension registration complete');
}

export type { LoggingConfig };
