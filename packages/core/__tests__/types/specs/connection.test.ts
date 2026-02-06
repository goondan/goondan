/**
 * Connection Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.10 Connection
 */
import { describe, it, expect } from 'vitest';
import type {
  ConnectionSpec,
  ConnectionRule,
  ConnectionResource,
} from '../../../src/types/specs/connection.js';
import type { Resource } from '../../../src/types/resource.js';

describe('ConnectionSpec', () => {
  it('connectorRef는 필수이다', () => {
    const spec: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'cli' },
    };

    expect(spec.connectorRef).toEqual({ kind: 'Connector', name: 'cli' });
  });

  it('connectorRef는 문자열 축약 형식을 지원한다', () => {
    const spec: ConnectionSpec = {
      connectorRef: 'Connector/cli',
    };

    expect(spec.connectorRef).toBe('Connector/cli');
  });

  it('auth는 선택적이다', () => {
    const withOAuth: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'slack' },
      auth: {
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      },
    };

    expect(withOAuth.auth).toBeDefined();

    const withStaticToken: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'telegram' },
      auth: {
        staticToken: {
          valueFrom: { env: 'TELEGRAM_BOT_TOKEN' },
        },
      },
    };

    expect(withStaticToken.auth).toBeDefined();
  });

  it('rules는 선택적이다', () => {
    const spec: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'cli' },
      rules: [
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ],
    };

    expect(spec.rules).toHaveLength(1);
    expect(spec.rules?.[0]?.route.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
  });

  it('rules에 match 조건을 설정할 수 있다', () => {
    const rule: ConnectionRule = {
      match: { command: '/start', eventType: 'message' },
      route: {
        swarmRef: { kind: 'Swarm', name: 'coding-swarm' },
        instanceKeyFrom: '$.message.chat.id',
        inputFrom: '$.message.text',
        agentName: 'planner',
      },
    };

    expect(rule.match?.command).toBe('/start');
    expect(rule.route.agentName).toBe('planner');
  });

  it('egress는 선택적이다', () => {
    const spec: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'cli' },
      egress: {
        updatePolicy: {
          mode: 'replace',
        },
      },
    };

    expect(spec.egress?.updatePolicy?.mode).toBe('replace');
  });

  it('egress에 debounceMs를 설정할 수 있다', () => {
    const spec: ConnectionSpec = {
      connectorRef: { kind: 'Connector', name: 'slack' },
      egress: {
        updatePolicy: {
          mode: 'updateInThread',
          debounceMs: 1500,
        },
      },
    };

    expect(spec.egress?.updatePolicy?.debounceMs).toBe(1500);
  });
});

describe('ConnectionResource', () => {
  it('Resource<ConnectionSpec> 타입을 가진다', () => {
    const resource: ConnectionResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connection',
      metadata: { name: 'cli-to-default' },
      spec: {
        connectorRef: { kind: 'Connector', name: 'cli' },
        rules: [
          {
            route: {
              swarmRef: { kind: 'Swarm', name: 'default' },
              instanceKeyFrom: '$.instanceKey',
              inputFrom: '$.text',
            },
          },
        ],
      },
    };

    expect(resource.kind).toBe('Connection');
    expect(resource.spec.connectorRef).toEqual({ kind: 'Connector', name: 'cli' });
    expect(resource.spec.rules).toHaveLength(1);
  });

  it('전체 필드를 가진 Connection 리소스를 정의할 수 있다', () => {
    const resource: ConnectionResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connection',
      metadata: {
        name: 'telegram-to-coding-swarm',
        labels: { tier: 'production' },
      },
      spec: {
        connectorRef: { kind: 'Connector', name: 'telegram' },
        auth: {
          staticToken: {
            valueFrom: { env: 'TELEGRAM_BOT_TOKEN' },
          },
        },
        rules: [
          {
            match: { command: '/start' },
            route: {
              swarmRef: { kind: 'Swarm', name: 'coding-swarm' },
              instanceKeyFrom: '$.message.chat.id',
              inputFrom: '$.message.text',
            },
          },
          {
            route: {
              swarmRef: { kind: 'Swarm', name: 'coding-swarm' },
              instanceKeyFrom: '$.message.chat.id',
              inputFrom: '$.message.text',
            },
          },
        ],
        egress: {
          updatePolicy: {
            mode: 'updateInThread',
            debounceMs: 1500,
          },
        },
      },
    };

    expect(resource.metadata.labels?.tier).toBe('production');
    expect(resource.spec.auth).toBeDefined();
    expect(resource.spec.rules).toHaveLength(2);
    expect(resource.spec.egress?.updatePolicy?.mode).toBe('updateInThread');
  });
});
