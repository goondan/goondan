/**
 * CLI Connector 테스트 (v1.0)
 *
 * @see /packages/base/src/connectors/cli/index.ts
 * @see /docs/specs/connector.md
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import cliConnector, { isExitCommand } from '../../../src/connectors/cli/index.js';
import type {
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEvent,
  CliTriggerPayload,
  Resource,
  ConnectionSpec,
  ConnectorSpec,
} from '@goondan/core';

// ============================================================================
// Mock 타입 정의
// ============================================================================

interface MockLogger {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  log: Mock;
}

// ============================================================================
// Mock 헬퍼
// ============================================================================

function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createCliTriggerEvent(text: string, instanceKey?: string): ConnectorTriggerEvent {
  const trigger: CliTriggerPayload = {
    type: 'cli',
    payload: {
      text,
      instanceKey,
    },
  };
  return {
    type: 'connector.trigger',
    trigger,
    timestamp: new Date().toISOString(),
  };
}

function createMockConnectorContext(
  event: ConnectorTriggerEvent,
  emittedEvents: ConnectorEvent[] = [],
): ConnectorContext {
  const mockLogger = createMockLogger();
  return {
    event,
    emit: vi.fn().mockImplementation((e: ConnectorEvent) => {
      emittedEvents.push(e);
      return Promise.resolve();
    }),
    logger: mockLogger as unknown as Console,
    connection: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connection',
      metadata: { name: 'cli-connection' },
      spec: {
        connectorRef: { kind: 'Connector', name: 'cli' },
      },
    } as Resource<ConnectionSpec>,
    connector: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Connector',
      metadata: { name: 'cli' },
      spec: {
        runtime: 'node',
        entry: './connectors/cli/index.js',
        triggers: [{ type: 'cli' }],
        events: [{ name: 'user_input' }],
      },
    } as Resource<ConnectorSpec>,
  };
}

// ============================================================================
// 테스트
// ============================================================================

describe('CLI Connector', () => {
  describe('isExitCommand', () => {
    it('should return true for :exit', () => {
      expect(isExitCommand(':exit')).toBe(true);
    });

    it('should return true for :quit', () => {
      expect(isExitCommand(':quit')).toBe(true);
    });

    it('should return true for :exit with whitespace', () => {
      expect(isExitCommand('  :exit  ')).toBe(true);
    });

    it('should return true for :quit with whitespace', () => {
      expect(isExitCommand('  :quit  ')).toBe(true);
    });

    it('should return false for regular text', () => {
      expect(isExitCommand('hello')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isExitCommand('')).toBe(false);
    });

    it('should return false for exit without colon', () => {
      expect(isExitCommand('exit')).toBe(false);
    });

    it('should return false for quit without colon', () => {
      expect(isExitCommand('quit')).toBe(false);
    });
  });

  describe('cliConnector (default export)', () => {
    it('should be a function', () => {
      expect(typeof cliConnector).toBe('function');
    });

    it('should skip empty input', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent('');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith('[CLI] Empty input, skipping');
    });

    it('should skip whitespace-only input', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent('   ');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith('[CLI] Empty input, skipping');
    });

    it('should handle :exit command', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent(':exit');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.info).toHaveBeenCalledWith('[CLI] Exit command received');
    });

    it('should handle :quit command', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent(':quit');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.info).toHaveBeenCalledWith('[CLI] Exit command received');
    });

    it('should emit ConnectorEvent for valid input', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent('Hello, agent!', 'session-1');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      const emitted = emittedEvents[0];
      expect(emitted.type).toBe('connector.event');
      expect(emitted.name).toBe('user_input');
      expect(emitted.message).toEqual({ type: 'text', text: 'Hello, agent!' });
      expect(emitted.properties?.['instanceKey']).toBe('session-1');
    });

    it('should use default instanceKey when not provided', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent('Hello');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].properties?.['instanceKey']).toBe('cli-default');
    });

    it('should include correct auth information', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent('Hello');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      const auth = emittedEvents[0].auth;
      expect(auth).toBeDefined();
      expect(auth?.actor.id).toBe('cli:local-user');
      expect(auth?.actor.name).toBe('CLI User');
      expect(auth?.subjects.global).toBe('cli:local');
      expect(auth?.subjects.user).toBe('cli:local-user');
    });

    it('should trim input text', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = createCliTriggerEvent('  Hello, agent!  ');
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].message).toEqual({ type: 'text', text: 'Hello, agent!' });
    });

    it('should not emit for non-trigger events', async () => {
      const emittedEvents: ConnectorEvent[] = [];
      const event = {
        type: 'other',
        trigger: { type: 'cli', payload: { text: 'hello' } },
        timestamp: new Date().toISOString(),
      } as unknown as ConnectorTriggerEvent;
      const ctx = createMockConnectorContext(event, emittedEvents);

      await cliConnector(ctx);

      expect(emittedEvents).toHaveLength(0);
    });
  });
});
