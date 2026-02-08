/**
 * ToolContext Builder 테스트
 * @see /docs/specs/tool.md - 4.3 ToolContext 구조
 */
import { describe, it, expect } from 'vitest';
import { ToolContextBuilder } from '../../src/tool/context.js';
import type { ToolContext, ToolCatalogItem } from '../../src/tool/types.js';
import type { Resource } from '../../src/types/resource.js';
import type { SwarmSpec, AgentSpec } from '../../src/types/index.js';

describe('ToolContextBuilder', () => {
  describe('build()', () => {
    it('모든 필드가 포함된 ToolContext를 생성한다', () => {
      const mockSwarm: Resource<SwarmSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Swarm',
        metadata: { name: 'test-swarm' },
        spec: {
          version: 'v1',
          entrypoint: { ref: 'Agent/main' },
        },
      };

      const mockAgent: Resource<AgentSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Agent',
        metadata: { name: 'test-agent' },
        spec: {
          model: { ref: 'Model/gpt-4' },
        },
      };

      const mockCatalog: ToolCatalogItem[] = [
        { name: 'tool1', description: 'Test tool 1' },
        { name: 'tool2', description: 'Test tool 2' },
      ];

      const builder = new ToolContextBuilder();

      const ctx = builder
        .setInstance({
          id: 'instance_123',
          swarmName: 'test-swarm',
          status: 'running',
        } as ToolContext['instance'])
        .setSwarm(mockSwarm)
        .setAgent(mockAgent)
        .setTurn({
          id: 'turn_123',
          instanceId: 'instance_123',
          agentName: 'test-agent',
          messages: [],
          toolResults: new Map(),
        })
        .setStep({
          id: 'step_1',
          index: 0,
          turnId: 'turn_123',
        })
        .setToolCatalog(mockCatalog)
        .setSwarmBundleApi({} as ToolContext['swarmBundle'])
        .setOAuthApi({} as ToolContext['oauth'])
        .setEventBus({} as ToolContext['events'])
        .setLogger(console)
        .setWorkdir('/test/workdir')
        .setAgentsApi({} as ToolContext['agents'])
        .build();

      expect(ctx.instance.id).toBe('instance_123');
      expect(ctx.swarm.metadata.name).toBe('test-swarm');
      expect(ctx.agent.metadata.name).toBe('test-agent');
      expect(ctx.turn.id).toBe('turn_123');
      expect(ctx.step.id).toBe('step_1');
      expect(ctx.toolCatalog).toHaveLength(2);
      expect(ctx.logger).toBe(console);
      expect(ctx.workdir).toBe('/test/workdir');
    });

    it('필수 필드가 없으면 에러를 던진다', () => {
      const builder = new ToolContextBuilder();

      expect(() => builder.build()).toThrow();
    });

    it('instance가 없으면 에러를 던진다', () => {
      const builder = new ToolContextBuilder()
        .setSwarm({} as ToolContext['swarm'])
        .setAgent({} as ToolContext['agent'])
        .setTurn({} as ToolContext['turn'])
        .setStep({} as ToolContext['step'])
        .setToolCatalog([])
        .setSwarmBundleApi({} as ToolContext['swarmBundle'])
        .setOAuthApi({} as ToolContext['oauth'])
        .setEventBus({} as ToolContext['events'])
        .setLogger(console)
        .setWorkdir('/test')
        .setAgentsApi({} as ToolContext['agents']);

      expect(() => builder.build()).toThrow('instance');
    });

    it('swarm이 없으면 에러를 던진다', () => {
      const builder = new ToolContextBuilder()
        .setInstance({} as ToolContext['instance'])
        .setAgent({} as ToolContext['agent'])
        .setTurn({} as ToolContext['turn'])
        .setStep({} as ToolContext['step'])
        .setToolCatalog([])
        .setSwarmBundleApi({} as ToolContext['swarmBundle'])
        .setOAuthApi({} as ToolContext['oauth'])
        .setEventBus({} as ToolContext['events'])
        .setLogger(console)
        .setWorkdir('/test')
        .setAgentsApi({} as ToolContext['agents']);

      expect(() => builder.build()).toThrow('swarm');
    });
  });

  describe('clone()', () => {
    it('기존 컨텍스트를 기반으로 새 빌더를 생성한다', () => {
      const existingCtx: ToolContext = {
        instance: { id: 'inst_1' } as ToolContext['instance'],
        swarm: { metadata: { name: 'swarm1' } } as ToolContext['swarm'],
        agent: { metadata: { name: 'agent1' } } as ToolContext['agent'],
        turn: { id: 'turn_1' } as ToolContext['turn'],
        step: { id: 'step_1', index: 0 } as ToolContext['step'],
        toolCatalog: [{ name: 'tool1' }],
        swarmBundle: {} as ToolContext['swarmBundle'],
        oauth: {} as ToolContext['oauth'],
        events: {} as ToolContext['events'],
        logger: console,
        workdir: '/test/workdir',
        agents: {} as ToolContext['agents'],
      };

      const newCtx = ToolContextBuilder.from(existingCtx)
        .setStep({ id: 'step_2', index: 1, turnId: 'turn_1' })
        .build();

      expect(newCtx.instance.id).toBe('inst_1');
      expect(newCtx.step.id).toBe('step_2');
      expect(newCtx.step.index).toBe(1);
    });
  });

  describe('withToolCatalog()', () => {
    it('Tool Catalog만 변경한 새 컨텍스트를 생성한다', () => {
      const existingCtx: ToolContext = {
        instance: { id: 'inst_1' } as ToolContext['instance'],
        swarm: { metadata: { name: 'swarm1' } } as ToolContext['swarm'],
        agent: { metadata: { name: 'agent1' } } as ToolContext['agent'],
        turn: { id: 'turn_1' } as ToolContext['turn'],
        step: { id: 'step_1', index: 0 } as ToolContext['step'],
        toolCatalog: [{ name: 'original-tool' }],
        swarmBundle: {} as ToolContext['swarmBundle'],
        oauth: {} as ToolContext['oauth'],
        events: {} as ToolContext['events'],
        logger: console,
        workdir: '/test/workdir',
        agents: {} as ToolContext['agents'],
      };

      const newCatalog: ToolCatalogItem[] = [
        { name: 'new-tool-1' },
        { name: 'new-tool-2' },
      ];

      const newCtx = ToolContextBuilder.withToolCatalog(existingCtx, newCatalog);

      expect(newCtx.toolCatalog).toHaveLength(2);
      expect(newCtx.toolCatalog[0].name).toBe('new-tool-1');
      // 원본은 변경되지 않음
      expect(existingCtx.toolCatalog).toHaveLength(1);
    });
  });
});
