import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultBundleValidator } from '../src/services/validator.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('DefaultBundleValidator', () => {
  it('Swarm이 없으면 warning을 반환하고 strict에서는 오류로 승격한다', async () => {
    const dir = await createTempDir('goondan-cli-validator-');
    const manifestPath = path.join(dir, 'goondan.yaml');
    await writeFile(
      manifestPath,
      [
        'apiVersion: goondan.ai/v1',
        'kind: Model',
        'metadata:',
        '  name: claude',
        'spec:',
        '  provider: anthropic',
        '  model: claude-3-5-sonnet',
        '',
      ].join('\n'),
      'utf8',
    );

    const validator = new DefaultBundleValidator(dir);
    const normal = await validator.validate('.', false, false);
    expect(normal.valid).toBe(true);
    expect(normal.warnings.some((issue) => issue.code === 'SWARM_MISSING')).toBe(true);

    const strict = await validator.validate('.', true, false);
    expect(strict.valid).toBe(false);
    expect(strict.errors.some((issue) => issue.code === 'STRICT_SWARM_MISSING')).toBe(true);
  });

  it('Package 문서가 첫 문서가 아니면 오류를 반환한다', async () => {
    const dir = await createTempDir('goondan-cli-validator-package-');
    const manifestPath = path.join(dir, 'goondan.yaml');
    await writeFile(
      manifestPath,
      [
        'apiVersion: goondan.ai/v1',
        'kind: Model',
        'metadata:',
        '  name: claude',
        'spec:',
        '  provider: anthropic',
        '  model: claude-3-5-sonnet',
        '---',
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: sample',
        'spec:',
        '  version: "0.1.0"',
        '',
      ].join('\n'),
      'utf8',
    );

    const validator = new DefaultBundleValidator(dir);
    const result = await validator.validate('.', false, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'E_CONFIG_PACKAGE_DOC_POSITION')).toBe(true);
  });

  it('fix 옵션은 누락된 apiVersion을 자동으로 보정한다', async () => {
    const dir = await createTempDir('goondan-cli-validator-fix-');
    const manifestPath = path.join(dir, 'goondan.yaml');
    await writeFile(
      manifestPath,
      [
        'kind: Model',
        'metadata:',
        '  name: claude',
        'spec:',
        '  provider: anthropic',
        '  model: claude-3-5-sonnet',
        '',
      ].join('\n'),
      'utf8',
    );

    const validator = new DefaultBundleValidator(dir);
    const result = await validator.validate('.', false, true);
    expect(result.errors.some((issue) => issue.code === 'E_CONFIG_UNSUPPORTED_API_VERSION')).toBe(false);
    expect(result.warnings.some((issue) => issue.code === 'API_VERSION_FIXED')).toBe(true);

    const updated = await readFile(manifestPath, 'utf8');
    expect(updated.includes('apiVersion: goondan.ai/v1')).toBe(true);
  });

  it('Tool/Extension/Connector entry 파일이 없으면 오류를 반환한다', async () => {
    const dir = await createTempDir('goondan-cli-validator-entry-');
    const manifestPath = path.join(dir, 'goondan.yaml');
    await writeFile(
      manifestPath,
      [
        'apiVersion: goondan.ai/v1',
        'kind: Package',
        'metadata:',
        '  name: sample',
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
        'kind: Swarm',
        'metadata:',
        '  name: default',
        'spec:',
        '  entryAgent: "Agent/assistant"',
        '  agents:',
        '    - ref: "Agent/assistant"',
        '',
      ].join('\n'),
      'utf8',
    );

    const validator = new DefaultBundleValidator(dir);
    const result = await validator.validate('.', false, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === 'E_CONFIG_ENTRY_NOT_FOUND')).toBe(true);
  });
});
