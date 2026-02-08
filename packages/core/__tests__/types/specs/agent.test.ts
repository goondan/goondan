/**
 * Agent Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.4 Agent
 */
import { describe, it, expect } from 'vitest';
import type {
  AgentSpec,
  AgentModelConfig,
  ModelParams,
  AgentPrompts,
  HookSpec,
  PipelinePoint,
  AgentChangesetPolicy,
  AgentResource,
} from '../../../src/types/specs/agent.js';

describe('AgentSpec 타입', () => {
  describe('AgentModelConfig', () => {
    it('modelRef는 필수이다', () => {
      const config: AgentModelConfig = {
        modelRef: { kind: 'Model', name: 'openai-gpt-5' },
      };

      expect(config.modelRef).toEqual({ kind: 'Model', name: 'openai-gpt-5' });
    });

    it('params로 모델 파라미터를 지정할 수 있다', () => {
      const config: AgentModelConfig = {
        modelRef: 'Model/openai-gpt-5',
        params: {
          temperature: 0.5,
          maxTokens: 4096,
          topP: 0.9,
        },
      };

      expect(config.params?.temperature).toBe(0.5);
      expect(config.params?.maxTokens).toBe(4096);
      expect(config.params?.topP).toBe(0.9);
    });

    it('문자열 형식의 modelRef를 허용해야 한다', () => {
      const config: AgentModelConfig = {
        modelRef: 'Model/anthropic-claude',
      };

      expect(config.modelRef).toBe('Model/anthropic-claude');
    });
  });

  describe('AgentPrompts', () => {
    it('system으로 인라인 프롬프트를 지정할 수 있다', () => {
      const prompts: AgentPrompts = {
        system: '너는 planner 에이전트다.',
      };

      expect(prompts.system).toBe('너는 planner 에이전트다.');
    });

    it('systemRef로 파일 참조를 지정할 수 있다', () => {
      const prompts: AgentPrompts = {
        systemRef: './prompts/planner.system.md',
      };

      expect(prompts.systemRef).toBe('./prompts/planner.system.md');
    });
  });

  describe('HookSpec', () => {
    it('point와 action.runtime/entry/export는 필수이다', () => {
      const hook: HookSpec = {
        point: 'turn.post',
        action: {
          runtime: 'node',
          entry: './hooks/notify.ts',
          export: 'onTurnPost',
          input: { message: 'Turn completed' },
        },
      };

      expect(hook.point).toBe('turn.post');
      expect(hook.action.runtime).toBe('node');
      expect(hook.action.entry).toBe('./hooks/notify.ts');
      expect(hook.action.export).toBe('onTurnPost');
    });

    it('id와 priority는 선택이다', () => {
      const hook: HookSpec = {
        id: 'notify-on-complete',
        point: 'turn.post',
        priority: 10,
        action: {
          runtime: 'node',
          entry: './hooks/slack.ts',
          export: 'notify',
          input: { channel: '#general', text: 'Done!' },
        },
      };

      expect(hook.id).toBe('notify-on-complete');
      expect(hook.priority).toBe(10);
    });

    it('action.input에 ExprValue를 사용할 수 있다', () => {
      const hook: HookSpec = {
        point: 'turn.post',
        action: {
          runtime: 'node',
          entry: './hooks/slack.ts',
          export: 'notify',
          input: {
            channel: { expr: '$.turn.origin.channel' },
            text: { expr: '$.turn.summary' },
          },
        },
      };

      const channelExpr = hook.action.input?.channel;
      if (channelExpr && typeof channelExpr === 'object' && 'expr' in channelExpr) {
        expect(channelExpr.expr).toBe('$.turn.origin.channel');
        return;
      }

      throw new Error('ExprValue가 설정되지 않았습니다.');
    });
  });

  describe('PipelinePoint', () => {
    it('모든 유효한 파이프라인 포인트를 지원해야 한다', () => {
      const points: PipelinePoint[] = [
        'turn.pre',
        'turn.post',
        'step.pre',
        'step.config',
        'step.tools',
        'step.blocks',
        'step.llmCall',
        'step.llmError',
        'step.post',
        'toolCall.pre',
        'toolCall.exec',
        'toolCall.post',
        'workspace.repoAvailable',
        'workspace.worktreeMounted',
      ];

      expect(points.length).toBe(14);
    });
  });

  describe('AgentChangesetPolicy', () => {
    it('allowed.files로 허용 파일 패턴을 지정할 수 있다', () => {
      const policy: AgentChangesetPolicy = {
        allowed: {
          files: ['prompts/**', 'resources/**'],
        },
      };

      expect(policy.allowed?.files).toEqual(['prompts/**', 'resources/**']);
    });
  });

  describe('AgentResource 타입', () => {
    it('완전한 Agent 리소스를 정의할 수 있다', () => {
      const resource: AgentResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Agent',
        metadata: {
          name: 'planner',
          labels: {
            role: 'planner',
          },
        },
        spec: {
          modelConfig: {
            modelRef: { kind: 'Model', name: 'openai-gpt-5' },
            params: {
              temperature: 0.5,
              maxTokens: 4096,
            },
          },
          prompts: {
            systemRef: './prompts/planner.system.md',
          },
          tools: [
            { kind: 'Tool', name: 'fileRead' },
            'Tool/webSearch',
            {
              selector: { kind: 'Tool', matchLabels: { tier: 'base' } },
              overrides: { spec: { errorMessageLimit: 2000 } },
            },
          ],
          extensions: [
            { kind: 'Extension', name: 'skills' },
            { kind: 'Extension', name: 'compaction' },
          ],
          hooks: [
            {
              id: 'notify-on-turn-complete',
              point: 'turn.post',
              priority: 0,
              action: {
                runtime: 'node',
                entry: './hooks/slack.ts',
                export: 'notify',
                input: {
                  channel: { expr: '$.turn.origin.channel' },
                  text: { expr: '$.turn.summary' },
                },
              },
            },
          ],
          changesets: {
            allowed: {
              files: ['prompts/**', 'resources/**'],
            },
          },
        },
      };

      expect(resource.kind).toBe('Agent');
      expect(resource.spec.modelConfig.modelRef).toEqual({
        kind: 'Model',
        name: 'openai-gpt-5',
      });
      expect(resource.spec.prompts.systemRef).toBe('./prompts/planner.system.md');
      expect(resource.spec.tools?.length).toBe(3);
      expect(resource.spec.hooks?.length).toBe(1);
    });
  });
});
