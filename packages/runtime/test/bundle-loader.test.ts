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
});
