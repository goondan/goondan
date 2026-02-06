/**
 * ConnectorAdapter 베이스 구현
 * @see /docs/specs/connector.md - 8. ConnectorAdapter 인터페이스
 */

import type { Resource, ConnectorSpec, ConnectionSpec, JsonObject } from '../types/index.js';
import type {
  ConnectorAdapter,
  ConnectorOptions,
  ConnectorSendInput,
  RuntimeEventHandler,
  TurnAuth,
} from './types.js';
import { routeEvent, createCanonicalEventFromIngress } from './ingress.js';
import { EgressHandler } from './egress.js';
import { toRuntimeEventInput } from './canonical.js';

/**
 * BaseConnectorAdapter 옵션
 */
export interface BaseConnectorAdapterOptions {
  /** Runtime 이벤트 핸들러 */
  runtime: RuntimeEventHandler;
  /** Connector 리소스 설정 */
  connectorConfig: Resource<ConnectorSpec>;
  /** Connection 리소스 설정 */
  connectionConfig: Resource<ConnectionSpec>;
  /** 로거 (선택) */
  logger?: Console;
  /** origin 빌더 함수 (선택) */
  buildOrigin?: (payload: JsonObject) => JsonObject;
  /** auth 빌더 함수 (선택) */
  buildAuth?: (payload: JsonObject) => TurnAuth;
  /** send 구현 (선택) */
  sendImpl?: (input: ConnectorSendInput) => Promise<unknown>;
  /** shutdown 구현 (선택) */
  shutdownImpl?: () => Promise<void>;
}

/**
 * BaseConnectorAdapter 클래스
 * ConnectorAdapter의 기본 구현을 제공한다.
 */
export class BaseConnectorAdapter implements ConnectorAdapter {
  private readonly runtime: RuntimeEventHandler;
  private readonly config: Resource<ConnectorSpec>;
  private readonly connectionConfig: Resource<ConnectionSpec>;
  private readonly logger?: Console;
  private readonly buildOriginFn?: (payload: JsonObject) => JsonObject;
  private readonly buildAuthFn?: (payload: JsonObject) => TurnAuth;
  private readonly shutdownImplFn?: () => Promise<void>;
  private readonly egressHandler?: EgressHandler;

  constructor(options: BaseConnectorAdapterOptions) {
    this.runtime = options.runtime;
    this.config = options.connectorConfig;
    this.connectionConfig = options.connectionConfig;
    this.logger = options.logger;
    this.buildOriginFn = options.buildOrigin;
    this.buildAuthFn = options.buildAuth;
    this.shutdownImplFn = options.shutdownImpl;

    // Egress 핸들러 초기화 (Connection에서 egress 설정 참조)
    if (options.sendImpl) {
      this.egressHandler = new EgressHandler({
        send: options.sendImpl,
        config: this.connectionConfig.spec.egress,
      });
    }
  }

  /**
   * 외부 이벤트를 처리한다.
   *
   * @param payload - 외부 이벤트 페이로드
   */
  async handleEvent(payload: JsonObject): Promise<void> {
    const rules = this.connectionConfig.spec.rules ?? [];

    // 매칭되는 규칙 찾기
    const matchedRule = routeEvent(rules, payload);

    if (!matchedRule) {
      this.logger?.debug?.('No matching ingress rule found');
      return;
    }

    // CanonicalEvent 생성
    const canonicalEvent = createCanonicalEventFromIngress(matchedRule, payload, {
      type: this.extractEventType(payload),
      connectorName: this.config.metadata.name,
      origin: this.buildOriginFn?.(payload),
      auth: this.buildAuthFn?.(payload),
    });

    // RuntimeEventInput으로 변환
    const runtimeInput = toRuntimeEventInput(canonicalEvent);

    // Runtime에 전달
    await this.runtime.handleEvent(runtimeInput);
  }

  /**
   * send 메서드 (sendImpl이 제공된 경우에만 사용 가능)
   */
  get send(): ((input: ConnectorSendInput) => Promise<unknown>) | undefined {
    if (!this.egressHandler) {
      return undefined;
    }

    return (input: ConnectorSendInput) => this.egressHandler!.send(input);
  }

  /**
   * shutdown 메서드
   */
  get shutdown(): (() => Promise<void>) | undefined {
    if (!this.shutdownImplFn && !this.egressHandler) {
      return undefined;
    }

    return async () => {
      // Egress 핸들러 flush
      if (this.egressHandler) {
        await this.egressHandler.shutdown();
      }

      // 커스텀 shutdown
      if (this.shutdownImplFn) {
        await this.shutdownImplFn();
      }
    };
  }

  /**
   * 이벤트 타입을 추출한다.
   */
  private extractEventType(payload: JsonObject): string {
    // 최상위 type
    if (typeof payload['type'] === 'string') {
      return payload['type'];
    }

    // event.type (Slack 등)
    const event = payload['event'];
    if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
      const eventObj: Record<string, unknown> = event as Record<string, unknown>;
      if ('type' in eventObj && typeof eventObj['type'] === 'string') {
        return eventObj['type'];
      }
    }

    return 'unknown';
  }
}

/**
 * ConnectorAdapter를 생성한다.
 *
 * @param options - Connector 옵션
 * @returns ConnectorAdapter
 */
export function createConnectorAdapter(options: ConnectorOptions): ConnectorAdapter {
  return new BaseConnectorAdapter({
    runtime: options.runtime,
    connectorConfig: options.connectorConfig,
    connectionConfig: options.connectionConfig,
    logger: options.logger,
  });
}
