/**
 * TriggerHandler 실행
 * @see /docs/specs/connector.md - 6. Trigger Handler 시스템, 7. Trigger Execution Model
 */

import type { Resource, ConnectorSpec, JsonObject } from '../types/index.js';
import type { TriggerConfig } from '../types/specs/connector.js';
import type {
  TriggerHandler,
  TriggerEvent,
  TriggerContext,
  CanonicalEvent,
  OAuthTokenRequest,
  OAuthTokenResult,
  LiveConfigPatch,
} from './types.js';

/**
 * TriggerExecutor 옵션
 */
export interface TriggerExecutorOptions {
  /** Canonical event 발행 콜백 */
  onEmit: (event: CanonicalEvent) => Promise<void>;
  /** 로거 */
  logger: Console;
  /** Connector 설정 (선택) */
  connector?: Resource<ConnectorSpec>;
  /** OAuth API (선택) */
  oauth?: {
    getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
  };
  /** LiveConfig API (선택) */
  liveConfig?: {
    proposePatch(patch: LiveConfigPatch): Promise<void>;
  };
}

/**
 * TriggerContext 생성 옵션
 */
export interface CreateTriggerContextOptions {
  /** Connector 설정 */
  connector: Resource<ConnectorSpec>;
  /** Canonical event 발행 콜백 */
  onEmit: (event: CanonicalEvent) => Promise<void>;
  /** 로거 */
  logger: Console;
  /** OAuth API (선택) */
  oauth?: {
    getAccessToken(request: OAuthTokenRequest): Promise<OAuthTokenResult>;
  };
  /** LiveConfig API (선택) */
  liveConfig?: {
    proposePatch(patch: LiveConfigPatch): Promise<void>;
  };
}

/**
 * TriggerContext를 생성한다.
 *
 * @param options - 생성 옵션
 * @returns TriggerContext
 */
export function createTriggerContext(options: CreateTriggerContextOptions): TriggerContext {
  const ctx: TriggerContext = {
    emit: options.onEmit,
    logger: options.logger,
    connector: options.connector,
  };

  if (options.oauth) {
    ctx.oauth = options.oauth;
  }

  if (options.liveConfig) {
    ctx.liveConfig = options.liveConfig;
  }

  return ctx;
}

/**
 * Trigger 실행기
 * Trigger handler를 등록하고 실행한다.
 */
export class TriggerExecutor {
  private readonly handlers: Map<string, TriggerHandler> = new Map();
  private readonly options: TriggerExecutorOptions;

  constructor(options: TriggerExecutorOptions) {
    this.options = options;
  }

  /**
   * Handler를 등록한다.
   *
   * @param name - Handler 이름
   * @param handler - Handler 함수
   */
  registerHandler(name: string, handler: TriggerHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Handler가 등록되어 있는지 확인한다.
   *
   * @param name - Handler 이름
   * @returns 등록 여부
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Handler를 실행한다.
   *
   * @param handlerName - Handler 이름
   * @param event - Trigger 이벤트
   * @param connection - Connection 설정
   */
  async execute(
    handlerName: string,
    event: TriggerEvent,
    connection: JsonObject
  ): Promise<void> {
    const handler = this.handlers.get(handlerName);
    if (!handler) {
      throw new Error(`Handler not found: ${handlerName}`);
    }

    // 기본 Connector 설정
    const defaultConnector: Resource<ConnectorSpec> = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connector',
      metadata: { name: 'default' },
      spec: { type: 'custom' },
    };

    const ctx = createTriggerContext({
      connector: this.options.connector ?? defaultConnector,
      onEmit: this.options.onEmit,
      logger: this.options.logger,
      oauth: this.options.oauth,
      liveConfig: this.options.liveConfig,
    });

    await handler(event, connection, ctx);
  }
}

/**
 * Handler 검증 결과
 */
export interface ValidateResult {
  valid: boolean;
  errors: string[];
}

/**
 * 모듈에서 trigger handler를 로드한다.
 *
 * @param module - 로드된 모듈
 * @param handlerNames - 로드할 handler 이름 목록
 * @returns Handler Map
 * @throws Handler가 존재하지 않거나 함수가 아닌 경우
 */
export function loadTriggerModule(
  module: Record<string, unknown>,
  handlerNames: string[]
): Map<string, TriggerHandler> {
  const handlers = new Map<string, TriggerHandler>();

  for (const name of handlerNames) {
    const handler = module[name];

    if (handler === undefined) {
      throw new Error(`Handler not exported: ${name}`);
    }

    if (typeof handler !== 'function') {
      throw new Error(`Handler is not a function: ${name}`);
    }

    handlers.set(name, handler as TriggerHandler);
  }

  return handlers;
}

/**
 * trigger handler의 유효성을 검증한다.
 *
 * @param module - 검증할 모듈
 * @param triggers - Trigger 설정 목록
 * @returns 검증 결과
 */
export function validateTriggerHandlers(
  module: Record<string, unknown>,
  triggers: TriggerConfig[]
): ValidateResult {
  const errors: string[] = [];

  for (const trigger of triggers) {
    const handler = module[trigger.handler];

    if (handler === undefined) {
      errors.push(`Handler not exported: ${trigger.handler}`);
      continue;
    }

    if (typeof handler !== 'function') {
      errors.push(`Handler is not a function: ${trigger.handler}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
