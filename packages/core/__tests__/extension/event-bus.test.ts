/**
 * EventBus 테스트
 * @see /docs/specs/extension.md - 7. 이벤트 API
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from '../../src/extension/event-bus.js';
import type { EventBus, EventHandler } from '../../src/extension/types.js';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = createEventBus();
  });

  describe('emit', () => {
    it('이벤트를 발행할 수 있다', () => {
      // emit은 void를 반환하므로 호출이 에러 없이 완료되면 성공
      expect(() => {
        eventBus.emit('test.event', { data: 'value' });
      }).not.toThrow();
    });

    it('payload 없이 이벤트를 발행할 수 있다', () => {
      expect(() => {
        eventBus.emit('test.event');
      }).not.toThrow();
    });
  });

  describe('on', () => {
    it('이벤트를 구독하고 발행 시 핸들러가 호출된다', async () => {
      const handler = vi.fn();
      eventBus.on('test.event', handler);

      eventBus.emit('test.event', { data: 'value' });

      // 비동기 핸들러 처리를 위한 대기
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith({ data: 'value' });
      });
    });

    it('구독 해제 함수를 반환한다', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on('test.event', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('구독 해제 후에는 핸들러가 호출되지 않는다', async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on('test.event', handler);

      unsubscribe();
      eventBus.emit('test.event', { data: 'value' });

      // 약간의 대기 후 호출되지 않았는지 확인
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });

    it('여러 핸들러를 등록할 수 있다', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('test.event', handler1);
      eventBus.on('test.event', handler2);

      eventBus.emit('test.event', { data: 'value' });

      await vi.waitFor(() => {
        expect(handler1).toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
      });
    });

    it('다른 이벤트 타입은 구독하지 않는다', async () => {
      const handler = vi.fn();
      eventBus.on('test.event', handler);

      eventBus.emit('other.event', { data: 'value' });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });

    it('glob 패턴으로 구독할 수 있다 (workspace.*)', async () => {
      const handler = vi.fn();
      eventBus.on('workspace.*', handler);

      eventBus.emit('workspace.repoAvailable', { path: '/repo' });
      eventBus.emit('workspace.worktreeMounted', { path: '/worktree' });

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('once', () => {
    it('이벤트가 한 번만 호출된다', async () => {
      const handler = vi.fn();
      eventBus.once('test.event', handler);

      eventBus.emit('test.event', { data: 'first' });
      eventBus.emit('test.event', { data: 'second' });

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ data: 'first' });
      });
    });

    it('구독 해제 함수를 반환한다', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.once('test.event', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('이벤트 발행 전에 구독 해제할 수 있다', async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.once('test.event', handler);

      unsubscribe();
      eventBus.emit('test.event', { data: 'value' });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('특정 핸들러를 구독 해제할 수 있다', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('test.event', handler1);
      eventBus.on('test.event', handler2);

      eventBus.off('test.event', handler1);
      eventBus.emit('test.event', { data: 'value' });

      await vi.waitFor(() => {
        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
      });
    });
  });

  describe('비동기 핸들러', () => {
    it('비동기 핸들러가 올바르게 실행된다', async () => {
      const results: string[] = [];
      const asyncHandler: EventHandler = async (payload) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push(String(payload.data));
      };

      eventBus.on('test.event', asyncHandler);
      eventBus.emit('test.event', { data: 'async-value' });

      await vi.waitFor(() => {
        expect(results).toContain('async-value');
      });
    });

    it('핸들러 오류가 다른 핸들러 실행을 막지 않는다', async () => {
      const errorHandler: EventHandler = () => {
        throw new Error('Handler error');
      };
      const normalHandler = vi.fn();

      eventBus.on('test.event', errorHandler);
      eventBus.on('test.event', normalHandler);

      eventBus.emit('test.event', { data: 'value' });

      await vi.waitFor(() => {
        expect(normalHandler).toHaveBeenCalled();
      });
    });
  });
});
