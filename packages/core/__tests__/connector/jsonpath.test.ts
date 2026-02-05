/**
 * JSONPath 표현식 해석 테스트
 * @see /docs/specs/connector.md - 4.3 JSONPath 해석 규칙
 */
import { describe, it, expect } from 'vitest';
import { readJsonPath, isValidJsonPath } from '../../src/connector/jsonpath.js';

describe('JSONPath 표현식 해석', () => {
  describe('readJsonPath 함수', () => {
    it('단순 경로를 해석할 수 있다', () => {
      const payload = { event: { text: 'hello' } };
      const result = readJsonPath(payload, '$.event.text');

      expect(result).toBe('hello');
    });

    it('중첩 경로를 해석할 수 있다', () => {
      const payload = {
        event: {
          message: {
            user: {
              name: 'alice',
            },
          },
        },
      };
      const result = readJsonPath(payload, '$.event.message.user.name');

      expect(result).toBe('alice');
    });

    it('루트 경로를 해석할 수 있다', () => {
      const payload = { text: 'root text' };
      const result = readJsonPath(payload, '$.text');

      expect(result).toBe('root text');
    });

    it('숫자 값을 반환할 수 있다', () => {
      const payload = { count: 42 };
      const result = readJsonPath(payload, '$.count');

      expect(result).toBe(42);
    });

    it('boolean 값을 반환할 수 있다', () => {
      const payload = { active: true };
      const result = readJsonPath(payload, '$.active');

      expect(result).toBe(true);
    });

    it('null 값을 반환할 수 있다', () => {
      const payload = { value: null };
      const result = readJsonPath(payload, '$.value');

      expect(result).toBeNull();
    });

    it('객체를 반환할 수 있다', () => {
      const payload = { user: { id: 1, name: 'bob' } };
      const result = readJsonPath(payload, '$.user');

      expect(result).toEqual({ id: 1, name: 'bob' });
    });

    it('배열을 반환할 수 있다', () => {
      const payload = { items: [1, 2, 3] };
      const result = readJsonPath(payload, '$.items');

      expect(result).toEqual([1, 2, 3]);
    });

    it('배열 인덱스를 해석할 수 있다', () => {
      const payload = { items: ['a', 'b', 'c'] };
      const result = readJsonPath(payload, '$.items[0]');

      expect(result).toBe('a');
    });

    it('중첩 배열 인덱스를 해석할 수 있다', () => {
      const payload = { data: { users: [{ name: 'alice' }, { name: 'bob' }] } };
      const result = readJsonPath(payload, '$.data.users[1].name');

      expect(result).toBe('bob');
    });

    it('존재하지 않는 경로는 undefined를 반환한다', () => {
      const payload = { event: { text: 'hello' } };
      const result = readJsonPath(payload, '$.event.nonexistent');

      expect(result).toBeUndefined();
    });

    it('중간 경로가 null이면 undefined를 반환한다', () => {
      const payload = { event: null };
      const result = readJsonPath(payload, '$.event.text');

      expect(result).toBeUndefined();
    });

    it('중간 경로가 원시값이면 undefined를 반환한다', () => {
      const payload = { event: 'string value' };
      const result = readJsonPath(payload, '$.event.text');

      expect(result).toBeUndefined();
    });

    it('빈 표현식은 undefined를 반환한다', () => {
      const payload = { text: 'hello' };
      const result = readJsonPath(payload, '');

      expect(result).toBeUndefined();
    });

    it('$. 로 시작하지 않는 표현식은 undefined를 반환한다', () => {
      const payload = { text: 'hello' };
      const result = readJsonPath(payload, 'text');

      expect(result).toBeUndefined();
    });

    it('$만 있는 표현식은 전체 객체를 반환한다', () => {
      const payload = { text: 'hello' };
      const result = readJsonPath(payload, '$');

      expect(result).toEqual({ text: 'hello' });
    });

    it('Slack 이벤트 예시: thread_ts 추출', () => {
      const payload = {
        event: {
          type: 'message',
          thread_ts: '1700000000.000100',
          text: 'Hello, agent!',
        },
      };

      const threadTs = readJsonPath(payload, '$.event.thread_ts');
      const text = readJsonPath(payload, '$.event.text');

      expect(threadTs).toBe('1700000000.000100');
      expect(text).toBe('Hello, agent!');
    });

    it('CLI 이벤트 예시: instanceKey와 text 추출', () => {
      const payload = {
        instanceKey: 'session-123',
        text: 'Run the task',
      };

      const instanceKey = readJsonPath(payload, '$.instanceKey');
      const text = readJsonPath(payload, '$.text');

      expect(instanceKey).toBe('session-123');
      expect(text).toBe('Run the task');
    });

    it('Webhook 이벤트 예시: requestId와 body.message 추출', () => {
      const payload = {
        requestId: 'req-456',
        body: {
          message: 'Process this webhook',
        },
      };

      const requestId = readJsonPath(payload, '$.requestId');
      const message = readJsonPath(payload, '$.body.message');

      expect(requestId).toBe('req-456');
      expect(message).toBe('Process this webhook');
    });

    it('특수 문자가 포함된 키를 처리할 수 있다', () => {
      const payload = {
        'user-id': '123',
        'team_id': 'T111',
      };

      const userId = readJsonPath(payload, '$.user-id');
      const teamId = readJsonPath(payload, '$.team_id');

      expect(userId).toBe('123');
      expect(teamId).toBe('T111');
    });
  });

  describe('isValidJsonPath 함수', () => {
    it('유효한 JSONPath 표현식을 검증한다', () => {
      expect(isValidJsonPath('$.event.text')).toBe(true);
      expect(isValidJsonPath('$.items[0]')).toBe(true);
      expect(isValidJsonPath('$.a.b.c.d')).toBe(true);
      expect(isValidJsonPath('$')).toBe(true);
    });

    it('빈 문자열은 유효하지 않다', () => {
      expect(isValidJsonPath('')).toBe(false);
    });

    it('$로 시작하지 않는 표현식은 유효하지 않다', () => {
      expect(isValidJsonPath('event.text')).toBe(false);
      expect(isValidJsonPath('.text')).toBe(false);
      expect(isValidJsonPath('text')).toBe(false);
    });

    it('undefined나 null은 유효하지 않다', () => {
      expect(isValidJsonPath(undefined)).toBe(false);
      expect(isValidJsonPath(null)).toBe(false);
    });
  });
});
