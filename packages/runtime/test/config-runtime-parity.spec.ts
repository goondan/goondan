import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { BundleLoader } from '../src/config/bundle-loader.js';
import { buildAgentProcessPlan } from '../src/runner/agent-process-plan.js';
import type { AgentRunnerArguments } from '../src/runner/agent-runner.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempBundleRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goondan-config-runtime-parity-'));
  tempRoots.push(root);
  return root;
}

function createPlanArgs(bundleDir: string): AgentRunnerArguments {
  return {
    bundleDir,
    agentName: 'coordinator',
    instanceKey: 'brain',
    stateRoot: path.join(bundleDir, '.goondan'),
    swarmName: 'brain',
  };
}

describe('config-runtime parity', () => {
  it('nested ref object를 validate/runtime plan에서 동일하게 해석한다', async () => {
    const root = await createTempBundleRoot();
    await mkdir(path.join(root, 'tools'), { recursive: true });
    await mkdir(path.join(root, 'extensions'), { recursive: true });

    await writeFile(
      path.join(root, 'tools', 'slack.ts'),
      [
        'export const handlers = {',
        '  async send() {',
        "    return { ok: true };",
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(root, 'extensions', 'required-tools-guard.ts'),
      'export function register() {}\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'goondan.yaml'),
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: "@samples/test-config-runtime-parity"',
        'spec:',
        '  version: "0.1.0"',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Model',
        'metadata:',
        '  name: fast-model',
        'spec:',
        '  provider: mock',
        '  model: mock-model',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Tool',
        'metadata:',
        '  name: slack',
        'spec:',
        '  entry: "./tools/slack.ts"',
        '  exports:',
        '    - name: send',
        '      description: "Send to Slack"',
        '      parameters:',
        '        type: object',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Extension',
        'metadata:',
        '  name: required-tools-guard',
        'spec:',
        '  entry: "./extensions/required-tools-guard.ts"',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Agent',
        'metadata:',
        '  name: coordinator',
        'spec:',
        '  modelConfig:',
        '    modelRef:',
        '      kind: Model',
        '      name: fast-model',
        '  requiredTools:',
        '    - "slack__send"',
        '  tools:',
        '    - ref:',
        '        kind: Tool',
        '        name: slack',
        '  extensions:',
        '    - ref:',
        '        kind: Extension',
        '        name: required-tools-guard',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Swarm',
        'metadata:',
        '  name: brain',
        'spec:',
        '  entryAgent:',
        '    kind: Agent',
        '    name: coordinator',
        '  agents:',
        '    - ref:',
        '        kind: Agent',
        '        name: coordinator',
        '',
      ].join('\n'),
      'utf8',
    );

    const loader = new BundleLoader({
      stateRoot: path.join(root, '.goondan'),
      loadPackageDependencies: false,
    });
    const loaded = await loader.load(root);
    expect(loaded.errors).toHaveLength(0);

    const plan = await buildAgentProcessPlan(createPlanArgs(root));
    expect(plan.entryAgent).toBe('coordinator');
    expect(plan.availableAgents).toEqual(['coordinator']);
    expect(plan.toolCatalog.map((item) => item.name)).toEqual(['slack__send']);
    expect(plan.extensionResources.map((resource) => resource.metadata.name)).toEqual(['required-tools-guard']);
  });

  it('잘못된 nested ref는 validate/runtime plan 모두 실패한다', async () => {
    const root = await createTempBundleRoot();
    await writeFile(
      path.join(root, 'goondan.yaml'),
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: "@samples/test-config-runtime-parity-invalid"',
        'spec:',
        '  version: "0.1.0"',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Model',
        'metadata:',
        '  name: fast-model',
        'spec:',
        '  provider: mock',
        '  model: mock-model',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Agent',
        'metadata:',
        '  name: coordinator',
        'spec:',
        '  modelConfig:',
        '    modelRef: "Model/fast-model"',
        '  tools:',
        '    - ref:',
        '        kind: Tool',
        '        name: missing-tool',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Swarm',
        'metadata:',
        '  name: brain',
        'spec:',
        '  entryAgent: "Agent/coordinator"',
        '  agents:',
        '    - ref: "Agent/coordinator"',
        '',
      ].join('\n'),
      'utf8',
    );

    const loader = new BundleLoader({
      stateRoot: path.join(root, '.goondan'),
      loadPackageDependencies: false,
    });
    const loaded = await loader.load(root);
    expect(loaded.errors.some((error) => error.code === 'E_CONFIG_REF_NOT_FOUND')).toBe(true);

    await expect(buildAgentProcessPlan(createPlanArgs(root))).rejects.toThrow('Tool/missing-tool 참조를 찾을 수 없습니다.');
  });
});
