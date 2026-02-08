/**
 * Connector Entry Function 로딩 및 실행 (v1.0)
 * @see /docs/specs/connector.md - 5. Entry Function 실행 모델
 *
 * Connector의 entry 모듈을 로드하고 ConnectorContext를 생성하여
 * Connection마다 entry 함수를 호출한다.
 */

import type { Resource, ConnectorSpec, ConnectionSpec } from '../types/index.js';
import type {
  ConnectorEntryFunction,
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEvent,
  OAuthTokenRequest,
  OAuthTokenResult,
} from './types.js';

/**
 * ConnectorContext 생성 옵션
 */
export interface CreateConnectorContextOptions {
  /** Connector 리소스 */
  connector: Resource<ConnectorSpec>;
  /** Connection 리소스 */
  connection: Resource<ConnectionSpec>;
  /** 트리거 이벤트 */
  event: ConnectorTriggerEvent;
  /** ConnectorEvent 발행 콜백 */
  onEmit: (event: ConnectorEvent) => Promise<void>;
  /** 로거 */
  logger: Console;
  /** OAuth API (선택) */
  oauth?: {
    getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
  };
  /** 서명 검증 정보 (선택, Connection의 verify 블록에서 해석된 값) */
  verify?: {
    webhook?: {
      signingSecret: string;
    };
  };
}

/**
 * ConnectorContext를 생성한다.
 *
 * @param options - 생성 옵션
 * @returns ConnectorContext
 */
export function createConnectorContext(options: CreateConnectorContextOptions): ConnectorContext {
  const ctx: ConnectorContext = {
    event: options.event,
    connection: options.connection,
    connector: options.connector,
    emit: options.onEmit,
    logger: options.logger,
  };

  if (options.oauth) {
    ctx.oauth = options.oauth;
  }

  if (options.verify) {
    ctx.verify = options.verify;
  }

  return ctx;
}

/**
 * Entry Function 검증 결과
 */
export interface ValidateEntryResult {
  valid: boolean;
  errors: string[];
}

/**
 * 모듈에서 default export 함수를 로드한다.
 *
 * @param module - 로드된 모듈
 * @returns ConnectorEntryFunction
 * @throws default export가 존재하지 않거나 함수가 아닌 경우
 */
export function loadConnectorEntry(
  module: Record<string, unknown>
): ConnectorEntryFunction {
  const entry = module['default'];

  if (entry === undefined) {
    throw new Error('Connector entry module must have a default export');
  }

  if (typeof entry !== 'function') {
    throw new Error('Connector entry default export must be a function');
  }

  // typeof entry === 'function'이 위에서 검증됨
  // ConnectorEntryFunction 시그니처를 런타임에 완전히 검증할 수는 없으므로
  // 함수 타입을 신뢰한다
  const entryFn: ConnectorEntryFunction = (ctx: ConnectorContext) =>
    (entry as (...args: unknown[]) => Promise<void>)(ctx);

  return entryFn;
}

/**
 * Connector entry 모듈의 유효성을 검증한다.
 *
 * @param module - 검증할 모듈
 * @returns 검증 결과
 */
export function validateConnectorEntry(
  module: Record<string, unknown>
): ValidateEntryResult {
  const errors: string[] = [];

  const entry = module['default'];

  if (entry === undefined) {
    errors.push('default export not found');
  } else if (typeof entry !== 'function') {
    errors.push('default export is not a function');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
