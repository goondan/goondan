import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, readFileIfExists } from '../utils/fs.js';
import { readBundleManifests } from './loader.js';
import type { BundleManifest, BundleRegistration } from '../sdk/types.js';

interface BundleRegistryOptions {
  rootDir: string;
  logger?: Console;
}

export class BundleRegistry {
  private registryPath: string;
  private logger: Console;
  private entries: BundleRegistration[] = [];
  private loaded = false;

  constructor(options: BundleRegistryOptions) {
    this.registryPath = path.join(options.rootDir, 'bundles.json');
    this.logger = options.logger || console;
  }

  async load(): Promise<BundleRegistration[]> {
    if (this.loaded) return this.entries;
    const content = await readFileIfExists(this.registryPath);
    if (!content) {
      this.entries = [];
      this.loaded = true;
      return this.entries;
    }
    try {
      this.entries = JSON.parse(content) as BundleRegistration[];
    } catch (err) {
      this.logger.warn('bundles.json 파싱 실패. 새로 초기화합니다.');
      this.entries = [];
    }
    this.loaded = true;
    return this.entries;
  }

  list(): BundleRegistration[] {
    return [...this.entries];
  }

  get(name: string): BundleRegistration | null {
    return this.entries.find((entry) => entry.name === name) || null;
  }

  async add(
    manifestPath: string,
    nameOverride?: string,
    metadata: Partial<BundleRegistration> = {}
  ): Promise<BundleRegistration> {
    await this.load();
    const resolvedPath = await resolveBundleManifestPath(manifestPath);
    const manifest = await readSingleManifest(resolvedPath);
    const name = nameOverride || manifest.metadata?.name || path.basename(resolvedPath, path.extname(resolvedPath));
    const fingerprint = await computeFingerprint(resolvedPath);
    const entry: BundleRegistration = {
      name,
      path: resolvedPath,
      enabled: true,
      fingerprint: fingerprint || undefined,
      updatedAt: new Date().toISOString(),
      ...metadata,
    };
    this.entries = this.entries.filter((item) => item.name !== name);
    this.entries.push(entry);
    await this.save();
    return entry;
  }

  async enable(name: string): Promise<boolean> {
    return this.setEnabled(name, true);
  }

  async disable(name: string): Promise<boolean> {
    return this.setEnabled(name, false);
  }

  async refresh(name: string): Promise<BundleRegistration | null> {
    await this.load();
    const entry = this.entries.find((item) => item.name === name);
    if (!entry) return null;
    const fingerprint = await computeFingerprint(entry.path);
    entry.fingerprint = fingerprint || undefined;
    entry.updatedAt = new Date().toISOString();
    await this.save();
    return entry;
  }

  async remove(name: string): Promise<boolean> {
    await this.load();
    const before = this.entries.length;
    this.entries = this.entries.filter((item) => item.name !== name);
    if (this.entries.length === before) return false;
    await this.save();
    return true;
  }

  resolveEnabledPaths(): string[] {
    return this.entries.filter((entry) => entry.enabled !== false).map((entry) => entry.path);
  }

  private async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    await this.load();
    const entry = this.entries.find((item) => item.name === name);
    if (!entry) return false;
    entry.enabled = enabled;
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    await ensureDir(path.dirname(this.registryPath));
    await fs.writeFile(this.registryPath, JSON.stringify(this.entries, null, 2), 'utf8');
  }
}

async function resolveBundleManifestPath(inputPath: string): Promise<string> {
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat) {
    throw new Error(`Bundle 경로를 찾을 수 없습니다: ${inputPath}`);
  }
  if (stat.isFile()) return absolute;

  const candidates = ['bundle.yaml', 'bundle.yml', 'bundle.json'];
  for (const file of candidates) {
    const candidate = path.join(absolute, file);
    const candidateStat = await fs.stat(candidate).catch(() => null);
    if (candidateStat?.isFile()) return candidate;
  }
  throw new Error(`Bundle manifest를 찾을 수 없습니다: ${inputPath}`);
}

async function readSingleManifest(manifestPath: string): Promise<BundleManifest> {
  const manifests = await readBundleManifests(manifestPath);
  if (manifests.length === 0) {
    throw new Error(`Bundle manifest가 비어 있습니다: ${manifestPath}`);
  }
  if (manifests.length > 1) {
    throw new Error(`Bundle manifest가 여러 개입니다. 하나의 Bundle만 포함해야 합니다: ${manifestPath}`);
  }
  return manifests[0]?.manifest as BundleManifest;
}

async function computeFingerprint(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}
