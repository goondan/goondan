import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

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
  const root = await mkdtemp(path.join(os.tmpdir(), 'goondan-agent-plan-test-'));
  tempRoots.push(root);
  return root;
}

function createPlanArgs(bundleDir: string): AgentRunnerArguments {
  return {
    bundleDir,
    agentName: 'coordinator',
    instanceKey: 'test-instance',
    stateRoot: path.join(bundleDir, '.goondan'),
    swarmName: 'brain',
  };
}

describe('buildAgentProcessPlan requiredTools', () => {
  it('injects required-tools-guard extension config from Agent.spec.requiredTools', async () => {
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
      [
        'export function register() {',
        '  // no-op for plan build test',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(root, 'goondan.yaml'),
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: "@samples/test-required-tools"',
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
        '    modelRef: "Model/fast-model"',
        '  prompts:',
        '    systemPrompt: "You are coordinator"',
        '  requiredTools:',
        '    - "slack__send"',
        '  tools:',
        '    - ref: "Tool/slack"',
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

    const plan = await buildAgentProcessPlan(createPlanArgs(root));
    const guard = plan.extensionResources.find((resource) => resource.metadata.name === 'required-tools-guard');

    expect(guard).toBeDefined();
    expect(guard?.spec.config).toEqual({
      requiredTools: ['slack__send'],
    });
  });

  it('throws when Agent.spec.requiredTools references tool not in catalog', async () => {
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
        '  name: "@samples/test-required-tools-invalid"',
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
        '    modelRef: "Model/fast-model"',
        '  prompts:',
        '    systemPrompt: "You are coordinator"',
        '  requiredTools:',
        '    - "slack__send"',
        '    - "telegram__send"',
        '  tools:',
        '    - ref: "Tool/slack"',
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

    await expect(buildAgentProcessPlan(createPlanArgs(root))).rejects.toThrow('spec.requiredTools(telegram__send)');
  });
});
