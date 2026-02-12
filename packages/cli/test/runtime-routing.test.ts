import { describe, expect, it } from 'vitest';

import {
  parseConnectorEventPayload,
  selectTargetAgentName,
  type IngressRouteRule,
} from '../src/services/runtime-routing.js';

describe('parseConnectorEventPayload', () => {
  it('parses text connector event payload', () => {
    const parsed = parseConnectorEventPayload({
      name: 'telegram_message',
      instanceKey: 'telegram:1',
      message: {
        type: 'text',
        text: 'hello',
      },
      properties: {
        chat_id: '1',
      },
    });

    expect(parsed).toEqual({
      name: 'telegram_message',
      instanceKey: 'telegram:1',
      messageText: 'hello',
      properties: {
        chat_id: '1',
      },
    });
  });

  it('returns undefined when required fields are missing', () => {
    expect(parseConnectorEventPayload({ name: 'x' })).toBeUndefined();
    expect(parseConnectorEventPayload(null)).toBeUndefined();
  });
});

describe('selectTargetAgentName', () => {
  it('uses first matching ingress rule', () => {
    const rules: IngressRouteRule[] = [
      {
        eventName: 'telegram_message',
        properties: {
          chat_id: '2',
        },
        agentName: 'secondary',
      },
      {
        eventName: 'telegram_message',
        agentName: 'primary',
      },
    ];

    const name = selectTargetAgentName(rules, 'fallback', {
      name: 'telegram_message',
      instanceKey: 'telegram:1',
      messageText: 'hi',
      properties: {
        chat_id: '1',
      },
    });

    expect(name).toBe('primary');
  });

  it('falls back to default agent when no rule matches', () => {
    const rules: IngressRouteRule[] = [
      {
        eventName: 'other',
        agentName: 'other-agent',
      },
    ];

    const name = selectTargetAgentName(rules, 'fallback', {
      name: 'telegram_message',
      instanceKey: 'telegram:1',
      messageText: 'hi',
      properties: {},
    });

    expect(name).toBe('fallback');
  });
});
