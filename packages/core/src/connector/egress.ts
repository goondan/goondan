/**
 * Egress 정책 처리
 * @see /docs/specs/connector.md - 5. Egress 규칙
 */

import type { EgressConfig } from '../types/specs/connector.js';
import type { ConnectorSendInput } from './types.js';

/**
 * Egress 핸들러 옵션
 */
export interface EgressOptions {
  /** 실제 전송 함수 */
  send: (input: ConnectorSendInput) => Promise<unknown>;
  /** Egress 설정 */
  config?: EgressConfig;
}

/**
 * 디바운스 키 생성
 */
function createDebounceKey(input: ConnectorSendInput): string {
  const origin = input.origin ?? {};
  const channel = String(origin['channel'] ?? 'default');
  const threadTs = String(origin['threadTs'] ?? '');
  return `${channel}:${threadTs}`;
}

/**
 * Pending 메시지 정보
 */
interface PendingMessage {
  input: ConnectorSendInput;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Egress 핸들러 클래스
 * UpdatePolicy에 따라 메시지 전송을 관리한다.
 */
export class EgressHandler {
  private readonly sendFn: (input: ConnectorSendInput) => Promise<unknown>;
  private readonly config: EgressConfig;
  private readonly pendingMessages: Map<string, PendingMessage> = new Map();

  constructor(options: EgressOptions) {
    this.sendFn = options.send;
    this.config = options.config ?? {};
  }

  /**
   * 메시지를 전송한다.
   * UpdatePolicy에 따라 디바운스 등의 처리를 수행한다.
   *
   * @param input - 전송할 메시지
   * @returns 전송 결과 Promise
   */
  async send(input: ConnectorSendInput): Promise<unknown> {
    const debounceMs = this.config.updatePolicy?.debounceMs ?? 0;

    // final 메시지는 디바운스 무시, pending 취소 후 즉시 전송
    if (input.kind === 'final') {
      const key = createDebounceKey(input);
      this.cancelPending(key);
      return this.sendFn(input);
    }

    // 디바운스 비활성화
    if (debounceMs <= 0) {
      return this.sendFn(input);
    }

    // progress 메시지 디바운스 처리
    return this.debounce(input, debounceMs);
  }

  /**
   * 디바운스 처리
   */
  private debounce(input: ConnectorSendInput, debounceMs: number): Promise<unknown> {
    const key = createDebounceKey(input);

    // 기존 pending 취소
    this.cancelPending(key);

    // 새 pending 등록
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        this.pendingMessages.delete(key);
        const result = await this.sendFn(input);
        resolve(result);
      }, debounceMs);

      this.pendingMessages.set(key, { input, timer });
    });
  }

  /**
   * pending 메시지 취소
   */
  private cancelPending(key: string): void {
    const pending = this.pendingMessages.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingMessages.delete(key);
    }
  }

  /**
   * 종료 처리
   * 모든 pending 메시지를 즉시 flush한다.
   */
  async shutdown(): Promise<void> {
    const promises: Promise<unknown>[] = [];
    const keys = Array.from(this.pendingMessages.keys());

    for (const key of keys) {
      const pending = this.pendingMessages.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        promises.push(this.sendFn(pending.input));
        this.pendingMessages.delete(key);
      }
    }

    await Promise.all(promises);
  }

  /**
   * UpdatePolicy mode getter
   */
  get mode(): string {
    return this.config.updatePolicy?.mode ?? 'append';
  }
}

/**
 * EgressHandler를 생성한다.
 *
 * @param options - Egress 옵션
 * @returns EgressHandler 인스턴스
 */
export function createEgressHandler(options: EgressOptions): EgressHandler {
  return new EgressHandler(options);
}
