import path from 'node:path';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import type { DeleteInstanceRequest, InstanceRecord, InstanceStore, ListInstancesRequest } from '../types.js';
import { exists, formatDate, isObjectRecord } from '../utils.js';
import { resolveStateRoot } from './config.js';

function parseMeta(raw: string): { agent?: string; status?: string; createdAt?: string; updatedAt?: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return {};
    }

    const agentValue = parsed['agent'];
    const statusValue = parsed['status'];
    const createdValue = parsed['createdAt'];
    const updatedValue = parsed['updatedAt'];

    return {
      agent: typeof agentValue === 'string' ? agentValue : undefined,
      status: typeof statusValue === 'string' ? statusValue : undefined,
      createdAt: typeof createdValue === 'string' ? createdValue : undefined,
      updatedAt: typeof updatedValue === 'string' ? updatedValue : undefined,
    };
  } catch {
    return {};
  }
}

export class FileInstanceStore implements InstanceStore {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env;
  }

  async list(request: ListInstancesRequest): Promise<InstanceRecord[]> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const workspacesRoot = path.join(stateRoot, 'workspaces');

    const hasRoot = await exists(workspacesRoot);
    if (!hasRoot) {
      return [];
    }

    const entries = await readdir(workspacesRoot, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    const rows: InstanceRecord[] = [];
    for (const directory of directories) {
      const key = directory.name;
      const instanceDir = path.join(workspacesRoot, key);

      const metaPath = path.join(instanceDir, 'meta.json');
      const hasMeta = await exists(metaPath);

      let metaAgent: string | undefined;
      let metaStatus: string | undefined;
      let metaCreatedAt: string | undefined;
      let metaUpdatedAt: string | undefined;

      if (hasMeta) {
        const rawMeta = await readFile(metaPath, 'utf8');
        const parsed = parseMeta(rawMeta);
        metaAgent = parsed.agent;
        metaStatus = parsed.status;
        metaCreatedAt = parsed.createdAt;
        metaUpdatedAt = parsed.updatedAt;
      }

      const stats = await stat(instanceDir);
      const createdAt = metaCreatedAt ?? formatDate(stats.birthtime);
      const updatedAt = metaUpdatedAt ?? formatDate(stats.mtime);

      rows.push({
        key,
        agent: metaAgent ?? 'unknown',
        status: metaStatus ?? 'idle',
        createdAt,
        updatedAt,
      });
    }

    const filtered = request.agent
      ? rows.filter((row) => row.agent.toLowerCase() === request.agent?.toLowerCase())
      : rows;

    const sorted = filtered.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));

    if (request.all) {
      return sorted;
    }

    return sorted.slice(0, Math.max(0, request.limit));
  }

  async delete(request: DeleteInstanceRequest): Promise<boolean> {
    const stateRoot = resolveStateRoot(request.stateRoot, this.env);
    const instancePath = path.join(stateRoot, 'workspaces', request.key);
    const hasTarget = await exists(instancePath);
    if (!hasTarget) {
      return false;
    }

    await rm(instancePath, { recursive: true, force: true });
    return true;
  }
}
