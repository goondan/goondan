/**
 * Ingress 라우팅 테스트 (v1.0)
 * @see /docs/specs/connection.md - 5. Ingress 라우팅 규칙
 */
import { describe, it, expect } from 'vitest';
import {
  IngressMatcher,
  matchIngressRule,
  routeEvent,
} from '../../src/connector/ingress.js';
import type { IngressRule } from '../../src/types/specs/connection.js';
import type { ConnectorEvent } from '../../src/connector/types.js';

function createEvent(overrides: Partial<ConnectorEvent> = {}): ConnectorEvent {
  return {
    type: 'connector.event',
    name: 'test_event',
    message: { type: 'text', text: 'hello' },
    ...overrides,
  };
}

describe('Ingress 라우팅 (v1.0)', () => {
  describe('IngressMatcher', () => {
    const matcher = new IngressMatcher();

    describe('event 매칭', () => {
      it('event 이름이 일치하면 매칭된다', () => {
        const result = matcher.match(
          { event: 'app_mention' },
          createEvent({ name: 'app_mention' })
        );
        expect(result).toBe(true);
      });

      it('event 이름이 다르면 매칭되지 않는다', () => {
        const result = matcher.match(
          { event: 'app_mention' },
          createEvent({ name: 'message.im' })
        );
        expect(result).toBe(false);
      });

      it('event가 지정되지 않으면 모든 이벤트에 매칭된다', () => {
        const result = matcher.match(
          {},
          createEvent({ name: 'any_event' })
        );
        expect(result).toBe(true);
      });
    });

    describe('properties 매칭', () => {
      it('properties 값이 일치하면 매칭된다', () => {
        const result = matcher.match(
          { properties: { channel_id: 'C123' } },
          createEvent({ properties: { channel_id: 'C123', ts: '123.456' } })
        );
        expect(result).toBe(true);
      });

      it('properties 값이 다르면 매칭되지 않는다', () => {
        const result = matcher.match(
          { properties: { channel_id: 'C123' } },
          createEvent({ properties: { channel_id: 'C456' } })
        );
        expect(result).toBe(false);
      });

      it('이벤트에 properties가 없으면 매칭되지 않는다', () => {
        const result = matcher.match(
          { properties: { channel_id: 'C123' } },
          createEvent()
        );
        expect(result).toBe(false);
      });

      it('여러 properties 조건은 AND로 해석된다', () => {
        const event = createEvent({
          properties: { channel_id: 'C123', ts: '123.456' },
        });

        // 모두 일치
        expect(
          matcher.match({ properties: { channel_id: 'C123', ts: '123.456' } }, event)
        ).toBe(true);

        // 하나가 불일치
        expect(
          matcher.match({ properties: { channel_id: 'C123', ts: '999.999' } }, event)
        ).toBe(false);
      });
    });

    describe('event + properties 복합 매칭', () => {
      it('event와 properties 모두 일치해야 매칭된다', () => {
        const event = createEvent({
          name: 'app_mention',
          properties: { channel_id: 'C123' },
        });

        expect(
          matcher.match(
            { event: 'app_mention', properties: { channel_id: 'C123' } },
            event
          )
        ).toBe(true);
      });

      it('event가 일치하지만 properties가 다르면 매칭되지 않는다', () => {
        const event = createEvent({
          name: 'app_mention',
          properties: { channel_id: 'C456' },
        });

        expect(
          matcher.match(
            { event: 'app_mention', properties: { channel_id: 'C123' } },
            event
          )
        ).toBe(false);
      });

      it('properties가 일치하지만 event가 다르면 매칭되지 않는다', () => {
        const event = createEvent({
          name: 'message.im',
          properties: { channel_id: 'C123' },
        });

        expect(
          matcher.match(
            { event: 'app_mention', properties: { channel_id: 'C123' } },
            event
          )
        ).toBe(false);
      });
    });
  });

  describe('matchIngressRule', () => {
    it('match가 없으면 모든 이벤트에 매칭된다 (catch-all)', () => {
      const rule: IngressRule = { route: {} };
      expect(matchIngressRule(rule, createEvent())).toBe(true);
    });

    it('빈 match 객체는 catch-all로 동작한다', () => {
      const rule: IngressRule = { match: {}, route: {} };
      expect(matchIngressRule(rule, createEvent())).toBe(true);
    });

    it('match 조건이 일치하면 매칭된다', () => {
      const rule: IngressRule = {
        match: { event: 'app_mention' },
        route: { agentRef: { kind: 'Agent', name: 'planner' } },
      };
      expect(matchIngressRule(rule, createEvent({ name: 'app_mention' }))).toBe(true);
    });

    it('match 조건이 불일치하면 매칭되지 않는다', () => {
      const rule: IngressRule = {
        match: { event: 'app_mention' },
        route: { agentRef: { kind: 'Agent', name: 'planner' } },
      };
      expect(matchIngressRule(rule, createEvent({ name: 'message.im' }))).toBe(false);
    });
  });

  describe('routeEvent', () => {
    const rules: IngressRule[] = [
      {
        match: { event: 'app_mention' },
        route: { agentRef: { kind: 'Agent', name: 'planner' } },
      },
      {
        match: { event: 'message.im' },
        route: {},
      },
      {
        route: {},  // catch-all
      },
    ];

    it('첫 번째 매칭되는 규칙을 반환한다', () => {
      const result = routeEvent(rules, createEvent({ name: 'app_mention' }));
      expect(result).toBe(rules[0]);
    });

    it('두 번째 규칙에 매칭될 수 있다', () => {
      const result = routeEvent(rules, createEvent({ name: 'message.im' }));
      expect(result).toBe(rules[1]);
    });

    it('catch-all 규칙에 매칭된다', () => {
      const result = routeEvent(rules, createEvent({ name: 'unknown_event' }));
      expect(result).toBe(rules[2]);
    });

    it('규칙이 없으면 null을 반환한다', () => {
      const result = routeEvent([], createEvent());
      expect(result).toBeNull();
    });

    it('어떤 규칙도 매칭되지 않으면 null을 반환한다', () => {
      const strictRules: IngressRule[] = [
        {
          match: { event: 'app_mention' },
          route: {},
        },
      ];
      const result = routeEvent(strictRules, createEvent({ name: 'other' }));
      expect(result).toBeNull();
    });

    it('properties 매칭을 포함한 라우팅', () => {
      const channelRules: IngressRule[] = [
        {
          match: {
            event: 'app_mention',
            properties: { channel_id: 'C-DEV' },
          },
          route: { agentRef: { kind: 'Agent', name: 'dev-agent' } },
        },
        {
          match: {
            event: 'app_mention',
            properties: { channel_id: 'C-OPS' },
          },
          route: { agentRef: { kind: 'Agent', name: 'ops-agent' } },
        },
        { route: {} },
      ];

      const devEvent = createEvent({
        name: 'app_mention',
        properties: { channel_id: 'C-DEV' },
      });
      expect(routeEvent(channelRules, devEvent)).toBe(channelRules[0]);

      const opsEvent = createEvent({
        name: 'app_mention',
        properties: { channel_id: 'C-OPS' },
      });
      expect(routeEvent(channelRules, opsEvent)).toBe(channelRules[1]);

      const otherEvent = createEvent({
        name: 'message.im',
      });
      expect(routeEvent(channelRules, otherEvent)).toBe(channelRules[2]);
    });
  });
});
