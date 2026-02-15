import { describe, expect, it } from 'vitest';

import {
  formatRuntimeInboundUserText,
  parseAgentToolEventPayload,
  parseConnectorEventPayload,
  resolveInboundInstanceKey,
  resolveRuntimeWorkdir,
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

describe('parseAgentToolEventPayload', () => {
  it('parses agent event payload with fallback instance key', () => {
    const parsed = parseAgentToolEventPayload(
      {
        id: 'evt-1',
        type: 'agent.request',
        input: 'please review',
        source: {
          kind: 'agent',
          name: 'coordinator',
        },
        replyTo: {
          target: 'coordinator',
          correlationId: 'corr-1',
        },
      },
      'thread:1',
      'fallback',
    );

    expect(parsed).toEqual({
      id: 'evt-1',
      type: 'agent.request',
      instanceKey: 'thread:1',
      messageText: 'please review',
      sourceName: 'coordinator',
      metadata: undefined,
      correlationId: 'corr-1',
    });
  });

  it('returns undefined for invalid payload', () => {
    expect(parseAgentToolEventPayload(null, 'default', 'caller')).toBeUndefined();
  });
});

describe('formatRuntimeInboundUserText', () => {
  it('injects goondan context block', () => {
    const text = formatRuntimeInboundUserText({
      sourceKind: 'connector',
      sourceName: 'telegram-polling',
      eventName: 'telegram_message',
      instanceKey: 'telegram:1',
      messageText: 'hello',
      properties: {
        chat_id: '1',
      },
    });

    expect(text).toContain('[goondan_context]');
    expect(text).toContain('telegram_message');
    expect(text).toContain('hello');
  });
});

describe('resolveRuntimeWorkdir', () => {
  it('resolves relative path from base workdir', () => {
    expect(resolveRuntimeWorkdir('/repo', 'apps/a')).toBe('/repo/apps/a');
  });

  it('keeps absolute path as-is', () => {
    expect(resolveRuntimeWorkdir('/repo', '/tmp/run')).toBe('/tmp/run');
  });
});

describe('resolveInboundInstanceKey', () => {
  it('uses shared instance key when configured', () => {
    const key = resolveInboundInstanceKey(
      {
        instanceKey: 'brain-persona-shared',
      },
      {
        name: 'telegram_message',
        instanceKey: 'telegram:1',
        messageText: 'hello',
        properties: {
          from_id: 'u-1',
        },
      },
    );

    expect(key).toBe('brain-persona-shared');
  });

  it('supports property-based override with prefix', () => {
    const key = resolveInboundInstanceKey(
      {
        instanceKeyProperty: 'from_id',
        instanceKeyPrefix: 'user:',
      },
      {
        name: 'telegram_message',
        instanceKey: 'telegram:1',
        messageText: 'hello',
        properties: {
          from_id: '123',
        },
      },
    );

    expect(key).toBe('user:123');
  });

  it('falls back to connector event instance key', () => {
    const key = resolveInboundInstanceKey(
      {},
      {
        name: 'telegram_message',
        instanceKey: 'telegram:1',
        messageText: 'hello',
        properties: {},
      },
    );

    expect(key).toBe('telegram:1');
  });
});
