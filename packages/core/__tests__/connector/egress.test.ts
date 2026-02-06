/**
 * Egress 정책 처리 테스트
 * @see /docs/specs/connector.md - 5. Egress 규칙
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EgressHandler,
  createEgressHandler,
  type EgressOptions,
} from '../../src/connector/egress.js';
import type { EgressConfig, UpdatePolicy } from '../../src/types/specs/connector.js';
import type { ConnectorSendInput } from '../../src/connector/types.js';
import type { JsonObject } from '../../src/types/index.js';

describe('Egress 정책 처리', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('EgressHandler 클래스', () => {
    it('기본 설정으로 메시지를 전송한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const handler = new EgressHandler({ send: sendMock });

      const input: ConnectorSendInput = {
        text: 'Hello!',
        kind: 'final',
      };

      await handler.send(input);

      expect(sendMock).toHaveBeenCalledWith(input);
    });

    it('updatePolicy.mode가 replace일 때 메시지를 교체한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: { mode: 'replace' },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      await handler.send({ text: 'First', origin: { channel: 'C1' }, kind: 'progress' });
      await handler.send({ text: 'Second', origin: { channel: 'C1' }, kind: 'final' });

      expect(sendMock).toHaveBeenCalledTimes(2);
      // replace 모드에서는 모든 메시지가 전송됨 (실제 교체는 플랫폼별 구현)
    });

    it('updatePolicy.mode가 append일 때 새 메시지를 추가한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: { mode: 'append' },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      await handler.send({ text: 'First', kind: 'progress' });
      await handler.send({ text: 'Second', kind: 'progress' });
      await handler.send({ text: 'Final', kind: 'final' });

      expect(sendMock).toHaveBeenCalledTimes(3);
    });

    it('updatePolicy.mode가 updateInThread일 때 스레드에 업데이트한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: { mode: 'updateInThread' },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      await handler.send({
        text: 'Processing...',
        origin: { threadTs: '123.456' },
        kind: 'progress',
      });

      expect(sendMock).toHaveBeenCalledWith({
        text: 'Processing...',
        origin: { threadTs: '123.456' },
        kind: 'progress',
      });
    });
  });

  describe('디바운스 처리', () => {
    it('debounceMs가 설정되면 progress 메시지를 디바운스한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 1000,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      // progress 메시지 여러 개 빠르게 전송
      handler.send({ text: 'Progress 1', kind: 'progress', origin: { channel: 'C1' } });
      handler.send({ text: 'Progress 2', kind: 'progress', origin: { channel: 'C1' } });
      handler.send({ text: 'Progress 3', kind: 'progress', origin: { channel: 'C1' } });

      // 아직 전송되지 않음
      expect(sendMock).not.toHaveBeenCalled();

      // 디바운스 시간 경과
      await vi.advanceTimersByTimeAsync(1000);

      // 마지막 메시지만 전송됨
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith({
        text: 'Progress 3',
        kind: 'progress',
        origin: { channel: 'C1' },
      });
    });

    it('final 메시지는 디바운스를 무시하고 즉시 전송한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 1000,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      // progress 후 final
      handler.send({ text: 'Progress', kind: 'progress', origin: { channel: 'C1' } });
      await handler.send({ text: 'Final', kind: 'final', origin: { channel: 'C1' } });

      // final은 즉시 전송
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith({
        text: 'Final',
        kind: 'final',
        origin: { channel: 'C1' },
      });
    });

    it('서로 다른 채널/스레드는 별도로 디바운스한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 500,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      // 다른 채널로 메시지 전송
      handler.send({ text: 'Ch1 Progress', kind: 'progress', origin: { channel: 'C1' } });
      handler.send({ text: 'Ch2 Progress', kind: 'progress', origin: { channel: 'C2' } });

      await vi.advanceTimersByTimeAsync(500);

      // 각 채널의 마지막 메시지가 전송됨
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('debounceMs가 0이면 디바운스하지 않는다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'append',
          debounceMs: 0,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      await handler.send({ text: 'Message 1', kind: 'progress' });
      await handler.send({ text: 'Message 2', kind: 'progress' });

      expect(sendMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('createEgressHandler 함수', () => {
    it('EgressHandler를 생성한다', () => {
      const sendMock = vi.fn();
      const options: EgressOptions = {
        send: sendMock,
        config: {
          updatePolicy: { mode: 'append' },
        },
      };

      const handler = createEgressHandler(options);

      expect(handler).toBeInstanceOf(EgressHandler);
    });

    it('config 없이도 생성할 수 있다', () => {
      const sendMock = vi.fn();
      const handler = createEgressHandler({ send: sendMock });

      expect(handler).toBeInstanceOf(EgressHandler);
    });
  });

  describe('디바운스 키 생성', () => {
    it('origin의 channel과 threadTs로 키를 생성한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 500,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      // 같은 스레드
      handler.send({
        text: 'Msg 1',
        kind: 'progress',
        origin: { channel: 'C1', threadTs: '123' },
      });
      handler.send({
        text: 'Msg 2',
        kind: 'progress',
        origin: { channel: 'C1', threadTs: '123' },
      });

      // 다른 스레드
      handler.send({
        text: 'Msg 3',
        kind: 'progress',
        origin: { channel: 'C1', threadTs: '456' },
      });

      await vi.advanceTimersByTimeAsync(500);

      // 스레드별로 마지막 메시지만 전송
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Msg 2' })
      );
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Msg 3' })
      );
    });
  });

  describe('mode getter', () => {
    it('설정된 mode를 반환해야 한다', () => {
      const sendMock = vi.fn();
      const handler = new EgressHandler({
        send: sendMock,
        config: { updatePolicy: { mode: 'replace' } },
      });

      expect(handler.mode).toBe('replace');
    });

    it('mode가 설정되지 않으면 append를 반환해야 한다', () => {
      const sendMock = vi.fn();
      const handler = new EgressHandler({ send: sendMock });

      expect(handler.mode).toBe('append');
    });

    it('updatePolicy가 없으면 append를 반환해야 한다', () => {
      const sendMock = vi.fn();
      const handler = new EgressHandler({ send: sendMock, config: {} });

      expect(handler.mode).toBe('append');
    });
  });

  describe('shutdown 처리', () => {
    it('shutdown 시 pending 메시지를 즉시 flush한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 5000,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      // pending 메시지
      handler.send({ text: 'Pending', kind: 'progress', origin: { channel: 'C1' } });

      expect(sendMock).not.toHaveBeenCalled();

      // shutdown
      await handler.shutdown();

      expect(sendMock).toHaveBeenCalledWith({
        text: 'Pending',
        kind: 'progress',
        origin: { channel: 'C1' },
      });
    });

    it('shutdown 시 모든 pending 메시지를 flush한다', async () => {
      const sendMock = vi.fn().mockResolvedValue({ ok: true });
      const config: EgressConfig = {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 5000,
        },
      };
      const handler = new EgressHandler({ send: sendMock, config });

      // 여러 채널에 pending 메시지
      handler.send({ text: 'Ch1', kind: 'progress', origin: { channel: 'C1' } });
      handler.send({ text: 'Ch2', kind: 'progress', origin: { channel: 'C2' } });

      await handler.shutdown();

      expect(sendMock).toHaveBeenCalledTimes(2);
    });
  });
});
