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
  LlmMessageLogRecord,
  LlmMessage,
  ToolCall,
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
    it('root와 swarmEventsLog 경로를 가진다', () => {
      // 타입 체크용 - 실제 객체는 구현에서 생성
      const mockPaths: InstanceStatePaths = {
        root: '/home/.goondan/instances/ws1/inst1',
        swarmEventsLog: '/home/.goondan/instances/ws1/inst1/swarm/events/events.jsonl',
        agent: (agentName: string): AgentStatePaths => ({
          root: `/home/.goondan/instances/ws1/inst1/agents/${agentName}`,
          messagesLog: `/home/.goondan/instances/ws1/inst1/agents/${agentName}/messages/llm.jsonl`,
          eventsLog: `/home/.goondan/instances/ws1/inst1/agents/${agentName}/events/events.jsonl`,
        }),
      };

      expect(mockPaths.root).toBeDefined();
      expect(mockPaths.swarmEventsLog).toBeDefined();
      expect(typeof mockPaths.agent).toBe('function');
    });
  });

  describe('AgentStatePaths', () => {
    it('root, messagesLog, eventsLog 경로를 가진다', () => {
      const paths: AgentStatePaths = {
        root: '/home/.goondan/instances/ws1/inst1/agents/planner',
        messagesLog: '/home/.goondan/instances/ws1/inst1/agents/planner/messages/llm.jsonl',
        eventsLog: '/home/.goondan/instances/ws1/inst1/agents/planner/events/events.jsonl',
      };

      expect(paths.root).toBeDefined();
      expect(paths.messagesLog).toContain('llm.jsonl');
      expect(paths.eventsLog).toContain('events.jsonl');
    });
  });

  describe('LlmMessageLogRecord', () => {
    it('type이 llm.message여야 한다', () => {
      const record: LlmMessageLogRecord = {
        type: 'llm.message',
        recordedAt: '2026-02-01T12:00:00.000Z',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc123',
        message: { role: 'user', content: 'Hello' },
      };

      expect(record.type).toBe('llm.message');
    });

    it('stepId와 stepIndex는 선택적이다', () => {
      const record: LlmMessageLogRecord = {
        type: 'llm.message',
        recordedAt: '2026-02-01T12:00:00.000Z',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc123',
        stepId: 'step-xyz789',
        stepIndex: 0,
        message: { role: 'user', content: 'Hello' },
      };

      expect(record.stepId).toBe('step-xyz789');
      expect(record.stepIndex).toBe(0);
    });
  });

  describe('LlmMessage', () => {
    it('system 역할을 가질 수 있다', () => {
      const message: LlmMessage = {
        role: 'system',
        content: 'You are a helpful assistant',
      };
      expect(message.role).toBe('system');
    });

    it('user 역할을 가질 수 있다', () => {
      const message: LlmMessage = {
        role: 'user',
        content: 'Hello',
      };
      expect(message.role).toBe('user');
    });

    it('assistant 역할을 가질 수 있다 (content만)', () => {
      const message: LlmMessage = {
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
        role: 'tool',
        toolCallId: 'call_001',
        toolName: 'file.list',
        output: ['README.md', 'package.json'],
      };
      expect(message.role).toBe('tool');
    });
  });

  describe('SwarmEventLogRecord', () => {
    it('type이 swarm.event여야 한다', () => {
      const record: SwarmEventLogRecord = {
        type: 'swarm.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
        kind: 'swarm.created',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        swarmName: 'default',
      };

      expect(record.type).toBe('swarm.event');
      expect(record.kind).toBe('swarm.created');
    });

    it('agentName과 data는 선택적이다', () => {
      const record: SwarmEventLogRecord = {
        type: 'swarm.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
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

      expect(kinds.length).toBe(13);
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
        kind: 'turn.started',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
      };

      expect(record.type).toBe('agent.event');
      expect(record.kind).toBe('turn.started');
    });

    it('turnId, stepId, stepIndex, data는 선택적이다', () => {
      const record: AgentEventLogRecord = {
        type: 'agent.event',
        recordedAt: '2026-02-01T12:00:00.000Z',
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
