import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LiveConfigManager } from '../src/live-config/manager.js';
import { ConfigRegistry } from '../src/config/registry.js';

describe('LiveConfigManager', () => {
  it('applies patch at step.config safe point', async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-live-config-'));

    const swarm = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'default' },
      spec: {
        entrypoint: { kind: 'Agent', name: 'planner' },
        agents: [{ kind: 'Agent', name: 'planner' }],
        policy: {
          liveConfig: {
            enabled: true,
            allowedPaths: { agentRelative: ['/spec/tools'] },
          },
        },
      },
    };

    const agent = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'planner' },
      spec: { tools: [] },
    };

    const registry = new ConfigRegistry([swarm, agent]);
    const manager = new LiveConfigManager({
      instanceId: 'test-instance',
      swarmConfig: swarm,
      registry,
      stateDir: tempDir,
      logger: console,
    });

    await manager.initAgent('planner', agent);

    await manager.proposePatch({
      scope: 'agent',
      applyAt: 'step.config',
      patch: {
        type: 'json6902',
        ops: [{ op: 'add', path: '/spec/tools/-', value: { kind: 'Tool', name: 'slackToolkit' } }],
      },
      source: { type: 'system', name: 'test' },
      reason: 'test',
    }, { agentName: 'planner' });

    const effective = await manager.applyAtSafePoint({ agentName: 'planner', stepId: 'step-1' });

    expect(effective?.revision).toBe(1);
    expect((effective?.agent as { spec?: { tools?: unknown[] } })?.spec?.tools?.length).toBe(1);
  });
});
