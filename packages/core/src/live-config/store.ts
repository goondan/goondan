import fs from 'node:fs/promises';
import path from 'node:path';
import { appendJsonl, ensureDir, readJsonl, readLastJsonl, readYamlIfExists, writeYaml } from '../utils/fs.js';
import type { JsonObject } from '../sdk/types.js';

interface LiveConfigStoreOptions {
  rootDir: string;
  hasStatusLog?: boolean;
  logger?: Console;
}

export class LiveConfigStore {
  rootDir: string;
  logger: Console;
  patchLogPath: string;
  statusLogPath: string | null;
  cursorPath: string;
  overlayPath: string;
  effectiveDir: string;

  constructor({ rootDir, hasStatusLog = true, logger }: LiveConfigStoreOptions) {
    this.rootDir = rootDir;
    this.logger = logger || console;
    this.patchLogPath = path.join(rootDir, 'patches.jsonl');
    this.statusLogPath = hasStatusLog ? path.join(rootDir, 'patch-status.jsonl') : null;
    this.cursorPath = path.join(rootDir, 'cursor.yaml');
    this.overlayPath = path.join(rootDir, 'overlay.state.yaml');
    this.effectiveDir = path.join(rootDir, 'effective');
  }

  async ensure(): Promise<void> {
    await ensureDir(this.rootDir);
    await fs.chmod(this.rootDir, 0o700);
    if (this.statusLogPath) {
      await ensureDir(path.dirname(this.statusLogPath));
    }
  }

  async appendPatch(record: unknown): Promise<void> {
    await appendJsonl(this.patchLogPath, record);
    await fs.chmod(this.patchLogPath, 0o600);
  }

  async appendStatus(record: unknown): Promise<void> {
    if (!this.statusLogPath) return;
    await appendJsonl(this.statusLogPath, record);
    await fs.chmod(this.statusLogPath, 0o600);
  }

  async readPatches<T = JsonObject>(): Promise<T[]> {
    return readJsonl<T>(this.patchLogPath);
  }

  async readLastPatch<T = JsonObject>(): Promise<T | null> {
    return readLastJsonl<T>(this.patchLogPath);
  }

  async readCursor<T = JsonObject>(): Promise<T | null> {
    return readYamlIfExists<T>(this.cursorPath);
  }

  async writeCursor(cursor: unknown): Promise<void> {
    await writeYaml(this.cursorPath, cursor);
    await fs.chmod(this.cursorPath, 0o600);
  }

  async writeOverlay(overlay: unknown): Promise<void> {
    await writeYaml(this.overlayPath, overlay);
    await fs.chmod(this.overlayPath, 0o600);
  }

  async writeEffectiveSnapshot(revision: number, snapshot: unknown): Promise<void> {
    await ensureDir(this.effectiveDir);
    const filePath = path.join(this.effectiveDir, `effective-${revision}.yaml`);
    await writeYaml(filePath, snapshot);
    await fs.chmod(filePath, 0o600);
  }
}
