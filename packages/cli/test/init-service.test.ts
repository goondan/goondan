import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { InitTemplate } from '../src/types.js';
import { DefaultInitService } from '../src/services/init.js';

async function readManifest(targetDir: string): Promise<string> {
  const manifestPath = path.join(targetDir, 'goondan.yaml');
  return await readFile(manifestPath, 'utf8');
}

function firstYamlDoc(manifest: string): string {
  const docs = manifest.split('\n---\n');
  return docs[0] ?? '';
}

describe('DefaultInitService', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it.each<InitTemplate>(['default', 'multi-agent', 'minimal', 'package'])(
    '%s 템플릿은 첫 문서로 kind: Package를 생성한다',
    async (template) => {
      const targetDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-init-'));
      createdDirs.push(targetDir);

      const service = new DefaultInitService();
      await service.init({
        targetDir,
        name: 'my-swarm',
        template,
        git: false,
        force: false,
      });

      const manifest = await readManifest(targetDir);
      const firstDoc = firstYamlDoc(manifest);
      expect(firstDoc).toContain('kind: Package');
      expect(firstDoc).toContain('name: "my-swarm"');
    },
  );
});
