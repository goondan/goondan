/**
 * Workspace 타입 테스트
 * @see /docs/specs/workspace.md
 */
import { describe, it, expect } from 'vitest';
import type {
  GoondanHomeOptions,
  WorkspacePathsOptions,
  SwarmBundleRootLayout,
  InstanceStatePaths,
  AgentStatePaths,
  SystemStatePaths,
  OAuthStorePaths,
  MessageBaseLogRecord,
  MessageEventLogRecord,
  MessageEventType,
  LlmMessage,
  ToolCall,
  InstanceMetadata,
  SwarmInstanceStatus,
  TurnMetricsLogRecord,
  TokenUsage,
  SwarmEventLogRecord,
  SwarmEventKind,
  AgentEventLogRecord,
  AgentEventKind,
  LogLevel,
  LogEntry,
} from '../../src/workspace/types.js';

describe('Workspace 타입', () => {
  describe('GoondanHomeOptions', () => {
    it('cliStateRoot를 선택적으로 가질 수 있다', () => {
      const options: GoondanHomeOptions = {
        cliStateRoot: '/custom/path',
      };
      expect(options.cliStateRoot).toBe('/custom/path');
    });

    it('envStateRoot를 선택적으로 가질 수 있다', () => {
      const options: GoondanHomeOptions = {
        envStateRoot: '/env/path',
      };
      expect(options.envStateRoot).toBe('/env/path');
    });

    it('빈 객체를 허용해야 한다', () => {
      const options: GoondanHomeOptions = {};
      expect(options).toEqual({});
    });
  });

  describe('WorkspacePathsOptions', () => {
    it('swarmBundleRoot는 필수이다', () => {
      const options: WorkspacePathsOptions = {
        swarmBundleRoot: '/path/to/project',
      };
      expect(options.swarmBundleRoot).toBe('/path/to/project');
    });

    it('stateRoot를 선택적으로 가질 수 있다', () => {
      const options: WorkspacePathsOptions = {
        stateRoot: '/custom/state',
        swarmBundleRoot: '/path/to/project',
      };
      expect(options.stateRoot).toBe('/custom/state');
    });
  });

  describe('SwarmBundleRootLayout', () => {
    it('configFile은 필수이다', () => {
      const layout: SwarmBundleRootLayout = {
        configFile: 'goondan.yaml',
      };
      expect(layout.configFile).toBe('goondan.yaml');
    });

    it('선택적 필드를 가질 수 있다', () => {
      const layout: SwarmBundleRootLayout = {
        configFile: 'goondan.yaml',
        resourceDirs: ['resources'],
        promptsDir: 'prompts',
        toolsDir: 'tools',
        extensionsDir: 'extensions',
        connectorsDir: 'connectors',
        bundleManifest: 'bundle.yaml',
      };

      expect(layout.resourceDirs).toEqual(['resources']);
      expect(layout.promptsDir).toBe('prompts');
      expect(layout.toolsDir).toBe('tools');
      expect(layout.extensionsDir).toBe('extensions');
      expect(layout.connectorsDir).toBe('connectors');
      expect(layout.bundleManifest).toBe('bundle.yaml');
    });
  });

  describe('InstanceStatePaths', () => {
    it('모든 필수 필드를 가진다', () => {
      const mockPaths: InstanceStatePaths = {
        root: '/home/.goondan/instances/ws1/inst1',
        metadataFile: '/home/.goondan/instances/ws1/inst1/metadata.json',
        swarmEventsLog: '/home/.goondan/instances/ws1/inst1/swarm/events/events.jsonl',
        metricsLog: '/home/.goondan/instances/ws1/inst1/metrics/turns.jsonl',
        extensionSharedState: '/home/.goondan/instances/ws1/inst1/extensions/_shared.json',
        extensionState(extensionName: string): string {
          return `/home/.goondan/instances/ws1/inst1/extensions/${extensionName}/state.json`;
        },
        agent: (agentName: string): AgentStatePaths => ({
          root: `/home/.goondan/instances/ws1/inst1/agents/${agentName}`,
          messageBaseLog: `/home/.goondan/instances/ws1/inst1/agents/${agentName}/messages/base.jsonl`,
          messageEventsLog: `/home/.goondan/instances/ws1/inst1/agents/${agentName}/messages/events.jsonl`,
          eventsLog: `/home/.goondan/instances/ws1/inst1/agents/${agentName}/events/events.jsonl`,
        }),
      };

      expect(mockPaths.root).toBeDefined();
      expect(mockPaths.metadataFile).toContain('metadata.json');
      expect(mockPaths.swarmEventsLog).toBeDefined();
      expect(mockPaths.metricsLog).toContain('turns.jsonl');
      expect(mockPaths.extensionSharedState).toContain('_shared.json');
      expect(mockPaths.extensionState('basicCompaction')).toContain('basicCompaction/state.json');
      expect(typeof mockPaths.agent).toBe('function');
    });
  });

  describe('AgentStatePaths', () => {
    it('root, messageBaseLog, messageEventsLog, eventsLog 경로를 가진다', () => {
      const paths: AgentStatePaths = {
        root: '/home/.goondan/instances/ws1/inst1/agents/planner',
        messageBaseLog: '/home/.goondan/instances/ws1/inst1/agents/planner/messages/base.jsonl',
        messageEventsLog: '/home/.goondan/instances/ws1/inst1/agents/planner/messages/events.jsonl',
        eventsLog: '/home/.goondan/instances/ws1/inst1/agents/planner/events/events.jsonl',
      };

      expect(paths.root).toBeDefined();
      expect(paths.messageBaseLog).toContain('base.jsonl');
      expect(paths.messageEventsLog).toContain('events.jsonl');
      expect(paths.eventsLog).toContain('events/events.jsonl');
    });
  });

  describe('MessageBaseLogRecord', () => {
    it('type이 message.base여야 하고 단일 메시지와 seq를 가져야 한다', () => {
      const record: MessageBaseLogRecord = {
        type: 'message.base',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc123',
        message: { id: 'msg-001', role: 'user', content: 'Hello' },
        seq: 0,
      };

      expect(record.type).toBe('message.base');
      expect(record.traceId).toBe('trace-a1b2c3');
      expect(record.message.role).toBe('user');
      expect(record.seq).toBe(0);
    });
  });

  describe('MessageEventLogRecord', () => {
    it('type이 message.event여야 한다', () => {
      const record: MessageEventLogRecord = {
        type: 'message.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc123',
        seq: 1,
        eventType: 'llm_message',
        payload: { message: { id: 'msg-001', role: 'user', content: 'Hello' } },
      };

      expect(record.type).toBe('message.event');
      expect(record.seq).toBe(1);
      expect(record.eventType).toBe('llm_message');
    });

    it('stepId는 선택적이다', () => {
      const record: MessageEventLogRecord = {
        type: 'message.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc123',
        seq: 2,
        eventType: 'llm_message',
        payload: { message: { id: 'msg-002', role: 'assistant', content: 'Hi' } },
        stepId: 'step-xyz789',
      };

      expect(record.stepId).toBe('step-xyz789');
    });
  });

  describe('MessageEventType', () => {
    it('정의된 이벤트 타입을 허용해야 한다', () => {
      const types: MessageEventType[] = [
        'system_message',
        'llm_message',
        'replace',
        'remove',
        'truncate',
      ];

      expect(types.length).toBe(5);
    });
  });

  describe('LlmMessage', () => {
    it('system 역할을 가질 수 있다', () => {
      const message: LlmMessage = {
        id: 'msg-001',
        role: 'system',
        content: 'You are a helpful assistant',
      };
      expect(message.role).toBe('system');
      expect(message.id).toBe('msg-001');
    });

    it('user 역할을 가질 수 있다', () => {
      const message: LlmMessage = {
        id: 'msg-002',
        role: 'user',
        content: 'Hello',
      };
      expect(message.role).toBe('user');
    });

    it('assistant 역할을 가질 수 있다 (content만)', () => {
      const message: LlmMessage = {
        id: 'msg-003',
        role: 'assistant',
        content: 'Hi there!',
      };
      expect(message.role).toBe('assistant');
    });

    it('assistant 역할을 가질 수 있다 (toolCalls 포함)', () => {
      const toolCall: ToolCall = {
        id: 'call_001',
        name: 'file.list',
        arguments: { path: '.' },
      };
      const message: LlmMessage = {
        id: 'msg-004',
        role: 'assistant',
        toolCalls: [toolCall],
      };
      expect(message.role).toBe('assistant');
      if (message.role === 'assistant' && message.toolCalls) {
        expect(message.toolCalls[0].name).toBe('file.list');
      }
    });

    it('tool 역할을 가질 수 있다', () => {
      const message: LlmMessage = {
        id: 'msg-005',
        role: 'tool',
        toolCallId: 'call_001',
        toolName: 'file.list',
        output: ['README.md', 'package.json'],
      };
      expect(message.role).toBe('tool');
    });
  });

  describe('InstanceMetadata', () => {
    it('필수 필드를 가져야 한다', () => {
      const metadata: InstanceMetadata = {
        status: 'running',
        updatedAt: '2026-02-01T12:00:00.000Z',
        createdAt: '2026-02-01T12:00:00.000Z',
      };

      expect(metadata.status).toBe('running');
      expect(metadata.updatedAt).toBeDefined();
      expect(metadata.createdAt).toBeDefined();
    });

    it('expiresAt는 선택적이다', () => {
      const metadata: InstanceMetadata = {
        status: 'running',
        updatedAt: '2026-02-01T12:00:00.000Z',
        createdAt: '2026-02-01T12:00:00.000Z',
        expiresAt: '2026-02-02T12:00:00.000Z',
      };

      expect(metadata.expiresAt).toBe('2026-02-02T12:00:00.000Z');
    });

    it('모든 SwarmInstanceStatus 값을 허용해야 한다', () => {
      const statuses: SwarmInstanceStatus[] = ['running', 'paused', 'terminated'];
      expect(statuses.length).toBe(3);
    });
  });

  describe('TurnMetricsLogRecord', () => {
    it('type이 metrics.turn이어야 한다', () => {
      const tokenUsage: TokenUsage = { prompt: 150, completion: 30, total: 180 };
      const record: TurnMetricsLogRecord = {
        type: 'metrics.turn',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        turnId: 'turn-abc123',
        instanceId: 'default-cli',
        agentName: 'planner',
        latencyMs: 3200,
        tokenUsage,
        toolCallCount: 1,
        errorCount: 0,
      };

      expect(record.type).toBe('metrics.turn');
      expect(record.tokenUsage.total).toBe(180);
    });
  });

  describe('SwarmEventLogRecord', () => {
    it('type이 swarm.event여야 한다', () => {
      const record: SwarmEventLogRecord = {
        type: 'swarm.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        kind: 'swarm.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
      };

      expect(record.type).toBe('swarm.event');
      expect(record.kind).toBe('swarm.created');
      expect(record.traceId).toBe('trace-a1b2c3');
    });

    it('agentName과 data는 선택적이다', () => {
      const record: SwarmEventLogRecord = {
        type: 'swarm.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        kind: 'agent.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
        agentName: 'planner',
        data: { reason: 'initial' },
      };

      expect(record.agentName).toBe('planner');
      expect(record.data).toEqual({ reason: 'initial' });
    });
  });

  describe('SwarmEventKind', () => {
    it('정의된 이벤트 종류를 허용해야 한다', () => {
      const kinds: SwarmEventKind[] = [
        'swarm.created',
        'swarm.started',
        'swarm.stopped',
        'swarm.paused',
        'swarm.resumed',
        'swarm.terminated',
        'swarm.deleted',
        'swarm.error',
        'swarm.configChanged',
        'agent.created',
        'agent.started',
        'agent.stopped',
        'agent.delegate',
        'agent.delegationResult',
        'changeset.committed',
        'changeset.rejected',
        'changeset.activated',
      ];

      expect(kinds.length).toBe(17);
    });

    it('확장 가능하므로 임의의 문자열도 허용해야 한다', () => {
      const customKind: SwarmEventKind = 'custom.event';
      expect(customKind).toBe('custom.event');
    });
  });

  describe('AgentEventLogRecord', () => {
    it('type이 agent.event여야 한다', () => {
      const record: AgentEventLogRecord = {
        type: 'agent.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        kind: 'turn.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
      };

      expect(record.type).toBe('agent.event');
      expect(record.kind).toBe('turn.started');
      expect(record.traceId).toBe('trace-a1b2c3');
    });

    it('turnId, stepId, stepIndex, data는 선택적이다', () => {
      const record: AgentEventLogRecord = {
        type: 'agent.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        traceId: 'trace-a1b2c3',
        kind: 'step.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc123',
        stepId: 'step-xyz789',
        stepIndex: 0,
        data: { info: 'test' },
      };

      expect(record.turnId).toBe('turn-abc123');
      expect(record.stepId).toBe('step-xyz789');
      expect(record.stepIndex).toBe(0);
      expect(record.data).toEqual({ info: 'test' });
    });
  });

  describe('AgentEventKind', () => {
    it('정의된 이벤트 종류를 허용해야 한다', () => {
      const kinds: AgentEventKind[] = [
        'turn.started',
        'turn.completed',
        'turn.error',
        'step.started',
        'step.completed',
        'step.error',
        'step.llmCall',
        'step.llmResult',
        'step.llmError',
        'toolCall.started',
        'toolCall.completed',
        'toolCall.error',
        'liveConfig.patchProposed',
        'liveConfig.patchApplied',
        'auth.required',
        'auth.granted',
      ];

      expect(kinds.length).toBe(16);
    });

    it('확장 가능하므로 임의의 문자열도 허용해야 한다', () => {
      const customKind: AgentEventKind = 'custom.agent.event';
      expect(customKind).toBe('custom.agent.event');
    });
  });

  describe('LogLevel', () => {
    it('debug, info, warn, error를 허용해야 한다', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      expect(levels).toContain('debug');
      expect(levels).toContain('info');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });
  });

  describe('LogEntry', () => {
    it('필수 필드를 가져야 한다', () => {
      const entry: LogEntry = {
        timestamp: '2026-02-01T12:00:00.000Z',
        level: 'info',
        category: 'workspace',
        message: 'Workspace initialized',
      };

      expect(entry.timestamp).toBeDefined();
      expect(entry.level).toBe('info');
      expect(entry.category).toBe('workspace');
      expect(entry.message).toBeDefined();
    });

    it('선택적 필드를 가질 수 있다', () => {
      const entry: LogEntry = {
        timestamp: '2026-02-01T12:00:00.000Z',
        level: 'debug',
        category: 'agent',
        message: 'Processing turn',
        data: { key: 'value' },
        turnId: 'turn-abc123',
        stepId: 'step-xyz789',
        agentName: 'planner',
      };

      expect(entry.data).toEqual({ key: 'value' });
      expect(entry.turnId).toBe('turn-abc123');
      expect(entry.stepId).toBe('step-xyz789');
      expect(entry.agentName).toBe('planner');
    });
  });
});
