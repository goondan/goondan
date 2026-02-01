import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Block, ExtensionApi, JsonObject } from '@goondan/core';

interface SkillEntry extends JsonObject {
  name: string;
  skillPath: string;
  dir: string;
}

interface SkillExtensionState {
  catalog: SkillEntry[];
  rootDir: string;
}

interface SkillExtensionConfig {
  rootDir?: string;
}

export async function register(api: ExtensionApi<SkillExtensionState, SkillExtensionConfig>): Promise<void> {
  const extState = api.extState?.() || {
    catalog: [],
    rootDir: process.cwd(),
  };

  extState.rootDir = resolveRootDir(api);
  extState.catalog = await scanSkills(extState.rootDir);

  api.pipelines.mutate('step.blocks', (ctx) => {
    const blocks: Block[] = ctx.blocks ? [...ctx.blocks] : [];
    blocks.push({
      type: 'skills.catalog',
      items: extState.catalog,
    });
    return { ...ctx, blocks };
  });

  api.tools.register({
    name: 'skills.list',
    handler: async () => ({ items: extState.catalog }),
  });

  api.tools.register({
    name: 'skills.open',
    handler: async (_ctx, input: JsonObject) => {
      const skillPath = String(input.path || '');
      if (!skillPath) {
        throw new Error('path가 필요합니다.');
      }
      const content = await fs.readFile(skillPath, 'utf8');
      return { path: skillPath, content };
    },
  });

  api.tools.register({
    name: 'skills.run',
    handler: async (_ctx, input: JsonObject) => {
      const command = String(input.command || '');
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      const cwd = input.cwd ? String(input.cwd) : undefined;
      if (!command) {
        throw new Error('command가 필요합니다.');
      }
      const result = await runCommand(command, args, cwd || extState.rootDir);
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    },
  });

  api.events.on?.('workspace.repoAvailable', async (payload) => {
    const payloadObj = payload as JsonObject;
    const repoPath = typeof payloadObj?.path === 'string' ? payloadObj.path : extState.rootDir;
    extState.catalog = await scanSkills(repoPath);
  });
}

function resolveRootDir(api: ExtensionApi<SkillExtensionState, SkillExtensionConfig>): string {
  return api.extension?.spec?.config?.rootDir || process.cwd();
}

async function scanSkills(rootDir: string): Promise<SkillEntry[]> {
  const results: SkillEntry[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        const dir = path.dirname(fullPath);
        results.push({
          name: path.basename(dir),
          skillPath: fullPath,
          dir,
        });
      }
    }
  }

  return results;
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
