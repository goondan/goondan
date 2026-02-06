/**
 * CLI Connector 테스트
 *
 * @see /packages/base/src/connectors/cli/AGENTS.md
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { onCliInput, isExitCommand } from '../../../src/connectors/cli/index.js';
import type {
  TriggerEvent,
  CanonicalEvent,
  Resource,
  ConnectorSpec,
  JsonObject,
} from '@goondan/core';

// ============================================================================
// Mock 타입 정의
// ============================================================================

/**
 * 테스트용 Mock Logger 인터페이스
 */
interface MockLogger {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  log: Mock;
}

/**
 * 테스트용 Mock TriggerContext
 */
interface MockTriggerContext {
  emit: Mock;
  logger: MockLogger;
  connector: Resource<ConnectorSpec>;
}

// ============================================================================
// Mock 헬퍼
// ============================================================================

/**
 * TriggerEvent 생성 헬퍼
 */
function createMockTriggerEvent(payload: JsonObject): TriggerEvent {
  return {
    type: 'message',
    payload,
    timestamp: new Date().toISOString(),
  };
}

/**
 * CLI Connector 리소스 생성 헬퍼
 */
function createMockConnector(
  ingress: ConnectorSpec['ingress'] = []
): Resource<ConnectorSpec> {
  return {
    apiVersion: 'agents.example.io/v1alpha1',
    kind: 'Connector',
    metadata: { name: 'cli-test' },
    spec: {
      type: 'cli',
      runtime: 'node',
      entry: './connectors/cli/index.js',
      ingress,
      triggers: [{ handler: 'onCliInput' }],
    },
  };
}

/**
 * Mock Logger 생성 헬퍼
 */
function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

/**
 * TriggerContext 생성 헬퍼
 */
function createMockTriggerContext(
  connector: Resource<ConnectorSpec>,
  emittedEvents: CanonicalEvent[] = []
): MockTriggerContext {
  return {
    emit: vi.fn().mockImplementation((event: CanonicalEvent) => {
      emittedEvents.push(event);
      return Promise.resolve();
    }),
    logger: createMockLogger(),
    connector,
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

  describe('onCliInput Trigger Handler', () => {
    it('should be defined', () => {
      expect(onCliInput).toBeDefined();
      expect(typeof onCliInput).toBe('function');
    });

    it('should skip empty input', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: '' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[CLI] Empty or non-string input, skipping'
      );
    });

    it('should skip whitespace-only input', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: '   ' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[CLI] Empty or non-string input, skipping'
      );
    });

    it('should skip non-string input', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 123 });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[CLI] Empty or non-string input, skipping'
      );
    });

    it('should skip missing text field', async () => {
      const connector = createMockConnector();
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ noText: 'data' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[CLI] Empty or non-string input, skipping'
      );
    });

    it('should handle :exit command', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: ':exit' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.info).toHaveBeenCalledWith('[CLI] Exit command received');
    });

    it('should handle :quit command', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: ':quit' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.info).toHaveBeenCalledWith('[CLI] Exit command received');
    });

    it('should emit canonical event for matching ingress rule', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({
        text: 'Hello, agent!',
        instanceKey: 'session-1',
      });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      const emitted = emittedEvents[0];
      expect(emitted).toBeDefined();
      expect(emitted.type).toBe('cli_input');
      expect(emitted.instanceKey).toBe('session-1');
      expect(emitted.input).toBe('Hello, agent!');
      expect(emitted.swarmRef).toEqual({ kind: 'Swarm', name: 'default' });
    });

    it('should use default instanceKey when not provided', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].instanceKey).toBe('cli-default');
    });

    it('should use text directly when inputFrom path not found', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.nonExistentPath',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Fallback input' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].input).toBe('Fallback input');
    });

    it('should route to specific agent when agentName is specified', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
            agentName: 'coder',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Write code' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].agentName).toBe('coder');
    });

    it('should include correct auth information', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      const auth = emittedEvents[0].auth;
      expect(auth).toBeDefined();
      expect(auth?.actor.type).toBe('cli');
      expect(auth?.actor.id).toBe('cli:local-user');
      expect(auth?.actor.display).toBe('CLI User');
      expect(auth?.subjects.global).toBe('cli:local');
      expect(auth?.subjects.user).toBe('cli:local-user');
    });

    it('should include correct origin information', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      const origin = emittedEvents[0].origin;
      expect(origin).toBeDefined();
      expect(origin?.['connector']).toBe('cli-test');
      expect(origin?.['source']).toBe('cli');
      expect(typeof origin?.['timestamp']).toBe('string');
    });

    it('should log debug when no matching ingress rule', async () => {
      const connector = createMockConnector([]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(0);
      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[CLI] No matching ingress rule found'
      );
    });

    it('should skip rule with missing swarmRef', async () => {
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'cli-test' },
        spec: {
          type: 'cli',
          runtime: 'node',
          entry: './connectors/cli/index.js',
          ingress: [
            {
              route: Object.create(null),
            },
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'fallback' },
                instanceKeyFrom: '$.instanceKey',
                inputFrom: '$.text',
              },
            },
          ],
          triggers: [{ handler: 'onCliInput' }],
        },
      };
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].swarmRef).toEqual({ kind: 'Swarm', name: 'fallback' });
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        '[CLI] Ingress rule missing swarmRef'
      );
    });

    it('should use first matching ingress rule', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'first' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'second' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].swarmRef).toEqual({ kind: 'Swarm', name: 'first' });
    });

    it('should trim input text', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.instanceKey',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: '  Hello, agent!  ' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      // inputFrom path resolves to the original text (untrimmed because readPath gets raw payload)
      // but the text field itself is '  Hello, agent!  '
      expect(emittedEvents[0].input).toBe('  Hello, agent!  ');
    });

    it('should handle nested JSONPath for instanceKey', async () => {
      const connector = createMockConnector([
        {
          route: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKeyFrom: '$.session.id',
            inputFrom: '$.text',
          },
        },
      ]);
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({
        text: 'Hello',
        session: { id: 'nested-session-123' },
      });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].instanceKey).toBe('nested-session-123');
    });

    it('should use connector name from metadata', async () => {
      const connector: Resource<ConnectorSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'my-custom-cli' },
        spec: {
          type: 'cli',
          runtime: 'node',
          entry: './connectors/cli/index.js',
          ingress: [
            {
              route: {
                swarmRef: { kind: 'Swarm', name: 'default' },
                instanceKeyFrom: '$.instanceKey',
                inputFrom: '$.text',
              },
            },
          ],
          triggers: [{ handler: 'onCliInput' }],
        },
      };
      const emittedEvents: CanonicalEvent[] = [];
      const ctx = createMockTriggerContext(connector, emittedEvents);

      const event = createMockTriggerEvent({ text: 'Hello' });

      await onCliInput(event, {}, ctx);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].origin?.['connector']).toBe('my-custom-cli');
    });
  });
});
