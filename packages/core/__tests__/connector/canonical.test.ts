/**
 * CanonicalEvent 처리 테스트
 * @see /docs/specs/connector.md - 7.2 Canonical Event
 */
import { describe, it, expect } from 'vitest';
import {
  createCanonicalEvent,
  validateCanonicalEvent,
  toRuntimeEventInput,
} from '../../src/connector/canonical.js';
import type { CanonicalEvent, RuntimeEventInput, TurnAuth } from '../../src/connector/types.js';
import type { JsonObject, ObjectRefLike } from '../../src/types/index.js';

describe('CanonicalEvent 처리', () => {
  describe('createCanonicalEvent 함수', () => {
    it('필수 필드로 CanonicalEvent를 생성한다', () => {
      const event = createCanonicalEvent({
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-123',
        input: 'Hello, agent!',
      });

      expect(event.type).toBe('message');
      expect(event.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
      expect(event.instanceKey).toBe('key-123');
      expect(event.input).toBe('Hello, agent!');
    });

    it('선택 필드를 포함할 수 있다', () => {
      const event = createCanonicalEvent({
        type: 'webhook',
        swarmRef: 'Swarm/my-swarm',
        instanceKey: 'req-456',
        input: 'Process this',
        agentName: 'planner',
        origin: {
          connector: 'custom-webhook',
          source: 'github',
        },
        auth: {
          actor: { type: 'system', id: 'github-webhook' },
          subjects: { global: 'github:repo:org/repo' },
        },
        metadata: {
          priority: 'high',
          retryCount: 0,
        },
      });

      expect(event.agentName).toBe('planner');
      expect(event.origin).toEqual({
        connector: 'custom-webhook',
        source: 'github',
      });
      expect(event.auth?.actor.id).toBe('github-webhook');
      expect(event.metadata).toEqual({
        priority: 'high',
        retryCount: 0,
      });
    });

    it('swarmRef를 문자열로 지정할 수 있다', () => {
      const event = createCanonicalEvent({
        type: 'test',
        swarmRef: 'Swarm/production',
        instanceKey: 'key-1',
        input: 'test',
      });

      expect(event.swarmRef).toBe('Swarm/production');
    });
  });

  describe('validateCanonicalEvent 함수', () => {
    it('유효한 이벤트는 성공한다', () => {
      const event: CanonicalEvent = {
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-1',
        input: 'hello',
      };

      const result = validateCanonicalEvent(event);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('type이 비어있으면 실패한다', () => {
      const event = {
        type: '',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-1',
        input: 'hello',
      };

      const result = validateCanonicalEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('type is required');
    });

    it('swarmRef가 없으면 실패한다', () => {
      const event = {
        type: 'message',
        swarmRef: undefined,
        instanceKey: 'key-1',
        input: 'hello',
      };

      const result = validateCanonicalEvent(event as unknown as CanonicalEvent);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('swarmRef is required');
    });

    it('instanceKey가 비어있으면 실패한다', () => {
      const event = {
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: '',
        input: 'hello',
      };

      const result = validateCanonicalEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('instanceKey is required');
    });

    it('input이 undefined이면 실패한다', () => {
      const event = {
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-1',
        input: undefined,
      };

      const result = validateCanonicalEvent(event as unknown as CanonicalEvent);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('input is required');
    });

    it('input이 빈 문자열이면 유효하다', () => {
      const event: CanonicalEvent = {
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-1',
        input: '',
      };

      const result = validateCanonicalEvent(event);

      expect(result.valid).toBe(true);
    });

    it('여러 에러를 동시에 보고한다', () => {
      const event = {
        type: '',
        swarmRef: undefined,
        instanceKey: '',
        input: undefined,
      };

      const result = validateCanonicalEvent(event as unknown as CanonicalEvent);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('swarmRef가 문자열일 때 유효성을 검사한다', () => {
      const validEvent: CanonicalEvent = {
        type: 'test',
        swarmRef: 'Swarm/default',
        instanceKey: 'key-1',
        input: 'hello',
      };

      const invalidEvent = {
        type: 'test',
        swarmRef: 'invalid-ref', // Kind/name 형식이 아님
        instanceKey: 'key-1',
        input: 'hello',
      };

      expect(validateCanonicalEvent(validEvent).valid).toBe(true);
      expect(validateCanonicalEvent(invalidEvent as CanonicalEvent).valid).toBe(false);
    });

    it('swarmRef가 ObjectRef일 때 kind와 name을 검사한다', () => {
      const validEvent: CanonicalEvent = {
        type: 'test',
        swarmRef: { kind: 'Swarm', name: 'my-swarm' },
        instanceKey: 'key-1',
        input: 'hello',
      };

      const invalidEvent = {
        type: 'test',
        swarmRef: { kind: '', name: 'my-swarm' },
        instanceKey: 'key-1',
        input: 'hello',
      };

      expect(validateCanonicalEvent(validEvent).valid).toBe(true);
      expect(validateCanonicalEvent(invalidEvent as CanonicalEvent).valid).toBe(false);
    });
  });

  describe('toRuntimeEventInput 함수', () => {
    it('CanonicalEvent를 RuntimeEventInput으로 변환한다', () => {
      const event: CanonicalEvent = {
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'thread-123',
        input: 'Hello!',
        agentName: 'assistant',
        origin: { connector: 'slack' },
        auth: {
          actor: { type: 'user', id: 'U123' },
          subjects: { global: 'slack:team:T123' },
        },
      };

      const input = toRuntimeEventInput(event);

      expect(input.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
      expect(input.instanceKey).toBe('thread-123');
      expect(input.input).toBe('Hello!');
      expect(input.agentName).toBe('assistant');
      expect(input.origin).toEqual({ connector: 'slack' });
      expect(input.auth?.actor.id).toBe('U123');
    });

    it('swarmRef 문자열을 그대로 유지한다', () => {
      const event: CanonicalEvent = {
        type: 'test',
        swarmRef: 'Swarm/my-swarm',
        instanceKey: 'key-1',
        input: 'hello',
      };

      const input = toRuntimeEventInput(event);

      expect(input.swarmRef).toBe('Swarm/my-swarm');
    });

    it('선택 필드가 없으면 생략한다', () => {
      const event: CanonicalEvent = {
        type: 'test',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: 'key-1',
        input: 'hello',
      };

      const input = toRuntimeEventInput(event);

      expect(input.agentName).toBeUndefined();
      expect(input.origin).toBeUndefined();
      expect(input.auth).toBeUndefined();
    });
  });

  describe('TurnAuth 구조', () => {
    it('Slack 형식의 auth를 생성한다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'user',
          id: 'slack:U234567',
          display: 'alice',
        },
        subjects: {
          global: 'slack:team:T111',
          user: 'slack:user:T111:U234567',
        },
      };

      expect(auth.actor.type).toBe('user');
      expect(auth.actor.display).toBe('alice');
      expect(auth.subjects.global).toBe('slack:team:T111');
      expect(auth.subjects.user).toBe('slack:user:T111:U234567');
    });

    it('시스템 형식의 auth를 생성한다', () => {
      const auth: TurnAuth = {
        actor: {
          type: 'system',
          id: 'scheduler',
        },
        subjects: {
          global: 'cron:default',
        },
      };

      expect(auth.actor.type).toBe('system');
      expect(auth.actor.display).toBeUndefined();
      expect(auth.subjects.user).toBeUndefined();
    });
  });

  describe('CanonicalEvent 생성 시나리오', () => {
    it('Slack 메시지로부터 CanonicalEvent를 생성한다', () => {
      const slackPayload = {
        team_id: 'T111',
        event: {
          type: 'message',
          thread_ts: '1700000000.000100',
          text: 'Hello, agent!',
          user: 'U234567',
          channel: 'C123456',
        },
      };

      const event = createCanonicalEvent({
        type: 'message',
        swarmRef: { kind: 'Swarm', name: 'default' },
        instanceKey: '1700000000.000100',
        input: 'Hello, agent!',
        origin: {
          connector: 'slack-main',
          channel: 'C123456',
          threadTs: '1700000000.000100',
          teamId: 'T111',
          userId: 'U234567',
        },
        auth: {
          actor: {
            type: 'user',
            id: 'slack:U234567',
          },
          subjects: {
            global: 'slack:team:T111',
            user: 'slack:user:T111:U234567',
          },
        },
      });

      expect(event.instanceKey).toBe('1700000000.000100');
      expect(event.auth?.subjects.user).toBe('slack:user:T111:U234567');
    });

    it('Webhook으로부터 CanonicalEvent를 생성한다', () => {
      const webhookPayload = {
        requestId: 'req-abc-123',
        body: {
          message: 'Process this webhook',
          priority: 'high',
        },
      };

      const event = createCanonicalEvent({
        type: 'webhook',
        swarmRef: { kind: 'Swarm', name: 'webhook-handler' },
        instanceKey: 'req-abc-123',
        input: 'Process this webhook',
        origin: {
          connector: 'github-webhook',
          source: 'github',
          requestId: 'req-abc-123',
        },
        auth: {
          actor: { type: 'system', id: 'webhook' },
          subjects: { global: 'webhook:github' },
        },
        metadata: {
          priority: 'high',
        },
      });

      expect(event.type).toBe('webhook');
      expect(event.metadata).toEqual({ priority: 'high' });
    });

    it('Cron 스케줄로부터 CanonicalEvent를 생성한다', () => {
      const event = createCanonicalEvent({
        type: 'cron',
        swarmRef: { kind: 'Swarm', name: 'scheduled-tasks' },
        instanceKey: 'schedule:daily-report',
        input: '일일 리포트 생성',
        origin: {
          connector: 'cron-connector',
          source: 'cron',
          scheduleName: 'daily-report',
        },
        auth: {
          actor: { type: 'system', id: 'scheduler' },
          subjects: { global: 'cron:daily-report' },
        },
      });

      expect(event.type).toBe('cron');
      expect(event.instanceKey).toBe('schedule:daily-report');
    });
  });
});
