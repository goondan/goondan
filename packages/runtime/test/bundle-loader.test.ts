import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { BundleLoader } from '../src/config/bundle-loader.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) {
      continue;
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempBundle(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goondan-bundle-loader-'));
  tempRoots.push(root);
  return root;
}

describe('BundleLoader', () => {
  it('ignores local dist directory while scanning project bundle files', async () => {
    const root = await createTempBundle();
    const distDir = path.join(root, 'dist');
    await mkdir(distDir, { recursive: true });

    await writeFile(
      path.join(root, 'goondan.yaml'),
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: "@samples/test"',
        'spec:',
        '  version: "0.1.0"',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      path.join(distDir, 'goondan.yaml'),
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: "@samples/test"',
        'spec:',
        '  version: "0.1.0"',
      ].join('\n'),
      'utf8',
    );

    const loader = new BundleLoader({ loadPackageDependencies: false });
    const result = await loader.load(root);

    expect(result.errors).toHaveLength(0);
    expect(result.scannedFiles.some((entry) => entry.endsWith('/dist/goondan.yaml'))).toBe(false);
    expect(result.resources.filter((resource) => resource.kind === 'Package')).toHaveLength(1);
  });

  it('reports missing entry files for Tool resources', async () => {
    const root = await createTempBundle();

    await writeFile(
      path.join(root, 'goondan.yaml'),
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: "@samples/test"',
        'spec:',
        '  version: "0.1.0"',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Model',
        'metadata:',
        '  name: test-model',
        'spec:',
        '  provider: mock',
        '  model: mock-model',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Agent',
        'metadata:',
        '  name: assistant',
        'spec:',
        '  modelConfig:',
        '    modelRef: "Model/test-model"',
        '  prompts:',
        '    systemPrompt: "test"',
        '  tools:',
        '    - ref: "Tool/self-restart"',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Tool',
        'metadata:',
        '  name: self-restart',
        'spec:',
        '  entry: "./dist/tools/self-restart.js"',
        '  exports:',
        '    - name: request',
        '      description: "Request runtime restart"',
        '      parameters:',
        '        type: object',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Swarm',
        'metadata:',
        '  name: default',
        'spec:',
        '  entryAgent: "Agent/assistant"',
        '  agents:',
        '    - ref: "Agent/assistant"',
      ].join('\n'),
      'utf8',
    );

    const loader = new BundleLoader({ loadPackageDependencies: false });
    const result = await loader.load(root);

    const missingEntryError = result.errors.find((error) => error.code === 'E_CONFIG_ENTRY_NOT_FOUND');
    expect(missingEntryError).toBeDefined();
    expect(missingEntryError?.path).toContain('goondan.yaml#3.spec.entry');
    expect(missingEntryError?.message).toContain('Tool/self-restart entry 파일을 찾을 수 없습니다');
  });
});
