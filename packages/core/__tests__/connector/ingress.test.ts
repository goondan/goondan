/**
 * Ingress 라우팅 로직 테스트
 * @see /docs/specs/connector.md - 4. Ingress 규칙
 */
import { describe, it, expect } from 'vitest';
import {
  matchIngressRule,
  routeEvent,
  createCanonicalEventFromIngress,
  IngressMatcher,
} from '../../src/connector/ingress.js';
import type { IngressRule } from '../../src/types/specs/connector.js';
import type { JsonObject } from '../../src/types/index.js';
import type { CanonicalEvent } from '../../src/connector/types.js';

describe('Ingress 라우팅', () => {
  describe('matchIngressRule 함수', () => {
    it('match가 없으면 모든 이벤트가 매칭된다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.instanceKey',
          inputFrom: '$.text',
        },
      };

      const payload: JsonObject = { text: 'hello', instanceKey: 'key-1' };
      const result = matchIngressRule(rule, payload);

      expect(result).toBe(true);
    });

    it('match가 빈 객체이면 모든 이벤트가 매칭된다', () => {
      const rule: IngressRule = {
        match: {},
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      const payload: JsonObject = { text: 'hello' };
      const result = matchIngressRule(rule, payload);

      expect(result).toBe(true);
    });

    it('command 조건을 매칭할 수 있다', () => {
      const rule: IngressRule = {
        match: { command: '/swarm' },
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      expect(matchIngressRule(rule, { command: '/swarm', text: 'hello' })).toBe(true);
      expect(matchIngressRule(rule, { command: '/other', text: 'hello' })).toBe(false);
      expect(matchIngressRule(rule, { text: 'hello' })).toBe(false);
    });

    it('eventType 조건을 매칭할 수 있다', () => {
      const rule: IngressRule = {
        match: { eventType: 'message' },
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      expect(matchIngressRule(rule, { type: 'message', text: 'hello' })).toBe(true);
      expect(matchIngressRule(rule, { type: 'app_mention', text: 'hello' })).toBe(false);
    });

    it('channel 조건을 매칭할 수 있다', () => {
      const rule: IngressRule = {
        match: { channel: 'C123456' },
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      expect(matchIngressRule(rule, { channel: 'C123456', text: 'hello' })).toBe(true);
      expect(matchIngressRule(rule, { channel: 'C999999', text: 'hello' })).toBe(false);
    });

    it('여러 조건을 AND로 매칭한다', () => {
      const rule: IngressRule = {
        match: {
          command: '/swarm',
          eventType: 'message',
          channel: 'C123456',
        },
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      expect(
        matchIngressRule(rule, {
          command: '/swarm',
          type: 'message',
          channel: 'C123456',
        })
      ).toBe(true);

      expect(
        matchIngressRule(rule, {
          command: '/swarm',
          type: 'message',
          channel: 'C999999', // 다른 채널
        })
      ).toBe(false);

      expect(
        matchIngressRule(rule, {
          command: '/other', // 다른 명령어
          type: 'message',
          channel: 'C123456',
        })
      ).toBe(false);
    });

    it('중첩 경로의 이벤트 타입을 매칭할 수 있다', () => {
      const rule: IngressRule = {
        match: { eventType: 'app_mention' },
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
        },
      };

      // Slack 이벤트 형식
      const payload: JsonObject = {
        event: {
          type: 'app_mention',
          text: '<@U123> hello',
        },
      };

      // IngressMatcher는 event.type도 확인
      const matcher = new IngressMatcher();
      const result = matcher.match(rule.match ?? {}, payload);
      expect(result).toBe(true);
    });
  });

  describe('routeEvent 함수', () => {
    it('매칭되는 첫 번째 규칙으로 라우팅한다', () => {
      const rules: IngressRule[] = [
        {
          match: { command: '/agent' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'agent-swarm' },
            instanceKeyFrom: '$.thread_ts',
            inputFrom: '$.text',
          },
        },
        {
          match: { eventType: 'message' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'chat-swarm' },
            instanceKeyFrom: '$.thread_ts',
            inputFrom: '$.text',
          },
        },
      ];

      const payload: JsonObject = {
        command: '/agent',
        text: 'hello',
        thread_ts: '123.456',
      };

      const result = routeEvent(rules, payload);

      expect(result).not.toBeNull();
      expect(result?.route.swarmRef).toEqual({ kind: 'Swarm', name: 'agent-swarm' });
    });

    it('매칭되는 규칙이 없으면 null을 반환한다', () => {
      const rules: IngressRule[] = [
        {
          match: { command: '/agent' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'agent-swarm' },
          },
        },
      ];

      const payload: JsonObject = {
        command: '/other',
        text: 'hello',
      };

      const result = routeEvent(rules, payload);

      expect(result).toBeNull();
    });

    it('빈 규칙 배열은 null을 반환한다', () => {
      const rules: IngressRule[] = [];
      const payload: JsonObject = { text: 'hello' };

      const result = routeEvent(rules, payload);

      expect(result).toBeNull();
    });

    it('catch-all 규칙 (match 없음)은 모든 이벤트를 캐치한다', () => {
      const rules: IngressRule[] = [
        {
          match: { command: '/specific' },
          route: {
            swarmRef: { kind: 'Swarm', name: 'specific-swarm' },
          },
        },
        {
          // catch-all
          route: {
            swarmRef: { kind: 'Swarm', name: 'default-swarm' },
            instanceKeyFrom: '$.id',
            inputFrom: '$.text',
          },
        },
      ];

      const payload: JsonObject = { text: 'random message', id: 'msg-1' };
      const result = routeEvent(rules, payload);

      expect(result).not.toBeNull();
      expect(result?.route.swarmRef).toEqual({ kind: 'Swarm', name: 'default-swarm' });
    });
  });

  describe('createCanonicalEventFromIngress 함수', () => {
    it('IngressRule과 payload로부터 CanonicalEvent를 생성한다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.thread_ts',
          inputFrom: '$.text',
        },
      };

      const payload: JsonObject = {
        thread_ts: '1700000000.000100',
        text: 'Hello, agent!',
        channel: 'C123456',
      };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'message',
        connectorName: 'slack-main',
      });

      expect(event.type).toBe('message');
      expect(event.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
      expect(event.instanceKey).toBe('1700000000.000100');
      expect(event.input).toBe('Hello, agent!');
    });

    it('agentName이 지정되면 포함한다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.id',
          inputFrom: '$.message',
          agentName: 'planner',
        },
      };

      const payload: JsonObject = {
        id: 'req-1',
        message: 'Plan a trip',
      };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'webhook',
        connectorName: 'custom-webhook',
      });

      expect(event.agentName).toBe('planner');
    });

    it('swarmRef가 문자열이면 그대로 사용한다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: 'Swarm/my-swarm',
          instanceKeyFrom: '$.id',
          inputFrom: '$.text',
        },
      };

      const payload: JsonObject = { id: '1', text: 'hello' };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'test',
        connectorName: 'test',
      });

      expect(event.swarmRef).toBe('Swarm/my-swarm');
    });

    it('instanceKeyFrom 결과가 없으면 기본값을 사용한다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.nonexistent',
          inputFrom: '$.text',
        },
      };

      const payload: JsonObject = { text: 'hello' };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'test',
        connectorName: 'test',
        defaultInstanceKey: 'default-key',
      });

      expect(event.instanceKey).toBe('default-key');
    });

    it('inputFrom 결과가 없으면 빈 문자열을 사용한다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.id',
          inputFrom: '$.nonexistent',
        },
      };

      const payload: JsonObject = { id: 'key-1' };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'test',
        connectorName: 'test',
      });

      expect(event.input).toBe('');
    });

    it('origin 정보를 포함할 수 있다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.thread_ts',
          inputFrom: '$.text',
        },
      };

      const payload: JsonObject = {
        thread_ts: '123.456',
        text: 'hello',
        channel: 'C123',
        team_id: 'T111',
      };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'message',
        connectorName: 'slack-main',
        origin: {
          connector: 'slack-main',
          channel: 'C123',
          teamId: 'T111',
          threadTs: '123.456',
        },
      });

      expect(event.origin).toEqual({
        connector: 'slack-main',
        channel: 'C123',
        teamId: 'T111',
        threadTs: '123.456',
      });
    });

    it('auth 정보를 포함할 수 있다', () => {
      const rule: IngressRule = {
        route: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKeyFrom: '$.thread_ts',
          inputFrom: '$.text',
        },
      };

      const payload: JsonObject = {
        thread_ts: '123.456',
        text: 'hello',
        user: 'U234567',
      };

      const event = createCanonicalEventFromIngress(rule, payload, {
        type: 'message',
        connectorName: 'slack-main',
        auth: {
          actor: {
            type: 'user',
            id: 'slack:U234567',
            display: 'alice',
          },
          subjects: {
            global: 'slack:team:T111',
            user: 'slack:user:T111:U234567',
          },
        },
      });

      expect(event.auth?.actor.id).toBe('slack:U234567');
      expect(event.auth?.subjects.global).toBe('slack:team:T111');
    });
  });

  describe('IngressMatcher 클래스', () => {
    it('커스텀 매칭 로직을 추가할 수 있다', () => {
      const matcher = new IngressMatcher();

      // 중첩 경로 지원 (Slack event.type 등)
      const payload: JsonObject = {
        event: {
          type: 'app_mention',
          text: '<@U123> hello',
          channel: 'C123456',
        },
      };

      const match = { eventType: 'app_mention' };
      expect(matcher.match(match, payload)).toBe(true);
    });

    it('command 매칭은 중첩 경로도 지원한다', () => {
      const matcher = new IngressMatcher();

      const payload: JsonObject = {
        event: {
          command: '/agent',
          text: 'do something',
        },
      };

      expect(matcher.match({ command: '/agent' }, payload)).toBe(true);
    });

    it('channel 매칭은 중첩 경로도 지원한다', () => {
      const matcher = new IngressMatcher();

      const payload: JsonObject = {
        event: {
          channel: 'C123456',
          text: 'hello',
        },
      };

      expect(matcher.match({ channel: 'C123456' }, payload)).toBe(true);
    });
  });
});
