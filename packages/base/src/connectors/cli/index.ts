/**
 * CLI Connector (v1.0)
 *
 * readline 기반으로 CLI 입력을 수신하고 ConnectorEvent로 변환하여 emit하는 Connector입니다.
 * 단일 default export 패턴을 따릅니다.
 *
 * @see /docs/specs/connector.md - Section 5. Entry Function 실행 모델
 * @packageDocumentation
 */

import * as readline from 'node:readline';
import type {
  ConnectorContext,
  ConnectorEvent,
  CliTriggerPayload,
} from '@goondan/core';

// ============================================================================
// 타입 가드
// ============================================================================

/**
 * CliTriggerPayload 타입 가드
 */
function isCliTrigger(trigger: { type: string }): trigger is CliTriggerPayload {
  return trigger.type === 'cli';
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 종료 명령어인지 확인합니다.
 *
 * @param input - 입력 문자열
 * @returns 종료 명령어 여부
 */
export function isExitCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === ':exit' || trimmed === ':quit';
}

// ============================================================================
// Connector Entry Function (단일 default export)
// ============================================================================

/**
 * CLI Connector Entry Function
 *
 * CLI(stdin)로부터 입력을 받아 ConnectorEvent로 변환하여 emit합니다.
 * Connection마다 한 번씩 호출됩니다.
 *
 * @param context - ConnectorContext
 */
const cliConnector = async function (context: ConnectorContext): Promise<void> {
  const { event, emit, logger } = context;

  // connector.trigger 이벤트만 처리
  if (event.type !== 'connector.trigger') {
    return;
  }

  const trigger = event.trigger;

  // CLI trigger만 처리
  if (!isCliTrigger(trigger)) {
    logger.debug('[CLI] Not a CLI trigger, skipping');
    return;
  }

  const text = trigger.payload.text;

  // 빈 입력 무시
  if (!text || text.trim() === '') {
    logger.debug('[CLI] Empty input, skipping');
    return;
  }

  const trimmedText = text.trim();

  // 종료 명령어 처리
  if (isExitCommand(trimmedText)) {
    logger.info('[CLI] Exit command received');
    return;
  }

  // ConnectorEvent 생성 및 발행
  const connectorEvent: ConnectorEvent = {
    type: 'connector.event',
    name: 'user_input',
    message: {
      type: 'text',
      text: trimmedText,
    },
    properties: {
      instanceKey: trigger.payload.instanceKey ?? 'cli-default',
    },
    auth: {
      actor: {
        id: 'cli:local-user',
        name: 'CLI User',
      },
      subjects: {
        global: 'cli:local',
        user: 'cli:local-user',
      },
    },
  };

  await emit(connectorEvent);

  logger.info(`[CLI] Input emitted: instanceKey=${trigger.payload.instanceKey ?? 'cli-default'}`);
};

export default cliConnector;

// ============================================================================
// Interactive CLI 함수
// ============================================================================

/**
 * Interactive CLI 세션 옵션
 */
export interface InteractiveCliOptions {
  /** 이벤트 핸들러 (입력 텍스트와 instanceKey를 받음) */
  onInput: (text: string, instanceKey: string) => Promise<void>;
  /** 인스턴스 키 (기본: 'cli-default') */
  instanceKey?: string;
  /** 프롬프트 문자열 (기본: '> ') */
  prompt?: string;
  /** 로거 */
  logger?: Console;
}

/**
 * Interactive CLI 세션을 시작합니다.
 *
 * readline을 사용하여 사용자 입력을 받고 onInput 콜백으로 전달합니다.
 * `:exit` 또는 `:quit` 명령어로 세션을 종료할 수 있습니다.
 *
 * @param options - Interactive CLI 옵션
 * @returns readline.Interface (외부에서 close 가능)
 */
export function startInteractiveCli(options: InteractiveCliOptions): readline.Interface {
  const {
    onInput,
    instanceKey = 'cli-default',
    prompt = '> ',
    logger = console,
  } = options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  logger.info('Goondan CLI 시작. :exit 또는 :quit으로 종료.');

  const promptUser = (): void => {
    rl.question(prompt, (line: string) => {
      const trimmed = line.trim();

      if (isExitCommand(trimmed)) {
        logger.info('Goondan CLI 종료.');
        rl.close();
        return;
      }

      if (!trimmed) {
        promptUser();
        return;
      }

      onInput(trimmed, instanceKey)
        .then(() => {
          promptUser();
        })
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          logger.error('[CLI] Error:', errorMessage);
          promptUser();
        });
    });
  };

  promptUser();

  return rl;
}
