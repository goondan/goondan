/**
 * CLI Connector
 *
 * readline 기반으로 CLI 입력을 수신하고 응답을 console.log로 출력하는 Connector입니다.
 * 이 모듈은 @goondan/base 패키지에서 재사용 가능한 기본 Connector로 제공됩니다.
 *
 * @see /docs/specs/connector.md - Section 9. CLI Connector 구현 예시
 * @packageDocumentation
 */

import * as readline from 'node:readline';
import type {
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  ConnectorTurnAuth,
  JsonObject,
} from '@goondan/core';

/**
 * TurnAuth 타입 별칭
 */
type TurnAuth = ConnectorTurnAuth;

// ============================================================================
// 타입 가드
// ============================================================================

/**
 * object 타입 가드
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 문자열 타입 가드
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * JSONPath 간단 구현
 *
 * "$.key1.key2" 형식의 경로로 객체에서 값을 추출합니다.
 *
 * @param payload - 대상 객체
 * @param expr - JSONPath 표현식
 * @returns 추출된 값 또는 undefined
 */
function readPath(payload: JsonObject, expr: string | undefined): unknown {
  if (!expr || !expr.startsWith('$.')) return undefined;
  const keys = expr.slice(2).split('.');
  let current: unknown = payload;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * CLI 사용자의 TurnAuth를 생성합니다.
 *
 * @returns TurnAuth 객체
 */
function createCliTurnAuth(): TurnAuth {
  return {
    actor: {
      type: 'cli',
      id: 'cli:local-user',
      display: 'CLI User',
    },
    subjects: {
      global: 'cli:local',
      user: 'cli:local-user',
    },
  };
}

/**
 * CLI Origin 정보를 생성합니다.
 *
 * @param connectorName - Connector 이름
 * @returns Origin 객체
 */
function createOrigin(connectorName: string): JsonObject {
  return {
    connector: connectorName,
    source: 'cli',
    timestamp: new Date().toISOString(),
  };
}

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
// Trigger Handler
// ============================================================================

/**
 * CLI Input 이벤트 핸들러
 *
 * CLI(stdin)로부터 입력을 받아 CanonicalEvent로 변환하여 Runtime에 전달합니다.
 * connector.yaml의 triggers에 handler: onCliInput으로 등록되어야 합니다.
 *
 * @param event - Trigger 이벤트 (payload에 text, instanceKey 포함)
 * @param _connection - Connection 설정 (현재 미사용)
 * @param ctx - Trigger 컨텍스트
 */
export async function onCliInput(
  event: TriggerEvent,
  _connection: JsonObject,
  ctx: TriggerContext
): Promise<void> {
  const payload = event.payload;
  const connector = ctx.connector;
  const connectorName = connector.metadata?.name ?? 'cli';
  const ingressRules = connector.spec.ingress ?? [];

  // text 추출
  const rawText = payload['text'];
  if (!isString(rawText) || rawText.trim() === '') {
    ctx.logger.debug('[CLI] Empty or non-string input, skipping');
    return;
  }

  const text = rawText.trim();

  // 종료 명령어 처리
  if (isExitCommand(text)) {
    ctx.logger.info('[CLI] Exit command received');
    return;
  }

  // Ingress 규칙 매칭
  for (const rule of ingressRules) {
    const route = rule.route;

    if (!route?.swarmRef) {
      ctx.logger.warn('[CLI] Ingress rule missing swarmRef');
      continue;
    }

    // instanceKey 추출 (JSONPath 또는 기본값)
    const instanceKeyRaw = readPath(payload, route.instanceKeyFrom);
    const instanceKey = isString(instanceKeyRaw) ? instanceKeyRaw : 'cli-default';

    // input 추출 (JSONPath 또는 직접 text 사용)
    const inputRaw = readPath(payload, route.inputFrom);
    const input = isString(inputRaw) ? inputRaw : text;

    // CanonicalEvent 생성
    const canonicalEvent: CanonicalEvent = {
      type: 'cli_input',
      swarmRef: route.swarmRef,
      instanceKey,
      input,
      origin: createOrigin(connectorName),
      auth: createCliTurnAuth(),
    };

    // agentName이 지정된 경우 추가
    if (route.agentName) {
      canonicalEvent.agentName = route.agentName;
    }

    // 이벤트 발행
    await ctx.emit(canonicalEvent);

    ctx.logger.info(`[CLI] Input routed: instanceKey=${instanceKey}`);
    return;
  }

  ctx.logger.debug('[CLI] No matching ingress rule found');
}

// ============================================================================
// Interactive CLI 함수
// ============================================================================

/**
 * Interactive CLI 세션 옵션
 */
export interface InteractiveCliOptions {
  /** 이벤트 핸들러 (onCliInput에 전달될 TriggerContext 생성용) */
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
