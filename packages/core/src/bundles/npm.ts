import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { ensureDir } from '../utils/fs.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const MANIFEST_CANDIDATES = ['bundle.yaml', 'bundle.yml', 'goondan.bundle.yaml', 'goondan.bundle.yml'];

export interface NpmBundleInstallResult {
  name: string;
  version: string;
  registry: string;
  packageRoot: string;
  manifestPath: string;
}

export async function installNpmBundle(spec: string, options: { stateRootDir: string; registry?: string }) {
  const registry = options.registry || process.env.NPM_CONFIG_REGISTRY || DEFAULT_REGISTRY;
  const { name, versionSpec } = parseNpmSpec(spec);
  const metadata = await fetchJson(`${normalizeRegistry(registry)}/${encodePackageName(name)}`);
  const version = resolveVersion(metadata, versionSpec);
  const tarball = metadata?.versions?.[version]?.dist?.tarball as string | undefined;
  if (!tarball) {
    throw new Error(`npm tarball을 찾을 수 없습니다: ${name}@${version}`);
  }

  const installDir = path.join(options.stateRootDir, 'bundles', 'npm', sanitizeName(name), version);
  const packageRoot = path.join(installDir, 'package');
  const manifestPath = await findManifest(packageRoot);
  if (manifestPath) {
    return { name, version, registry, packageRoot, manifestPath } satisfies NpmBundleInstallResult;
  }

  await ensureDir(installDir);
  const archivePath = path.join(installDir, 'package.tgz');
  const buffer = Buffer.from(await (await fetch(tarball)).arrayBuffer());
  await fs.writeFile(archivePath, buffer);
  await tar.x({ file: archivePath, cwd: installDir });

  const resolvedManifest = await findManifest(packageRoot);
  if (!resolvedManifest) {
    throw new Error(`bundle manifest를 찾을 수 없습니다: ${name}@${version}`);
  }

  return { name, version, registry, packageRoot, manifestPath: resolvedManifest } satisfies NpmBundleInstallResult;
}

function normalizeRegistry(value: string): string {
  return value.replace(/\/$/, '');
}

function encodePackageName(name: string): string {
  if (name.startsWith('@')) {
    return name.replace('/', '%2f');
  }
  return name;
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/]/g, '+');
}

function parseNpmSpec(spec: string): { name: string; versionSpec?: string } {
  const normalized = spec.startsWith('npm:') ? spec.slice(4) : spec;
  if (normalized.startsWith('@')) {
    const atIndex = normalized.lastIndexOf('@');
    if (atIndex > normalized.indexOf('/')) {
      return { name: normalized.slice(0, atIndex), versionSpec: normalized.slice(atIndex + 1) };
    }
    return { name: normalized };
  }
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex > 0) {
    return { name: normalized.slice(0, atIndex), versionSpec: normalized.slice(atIndex + 1) };
  }
  return { name: normalized };
}

function resolveVersion(metadata: any, versionSpec?: string): string {
  if (versionSpec) {
    if (metadata?.versions?.[versionSpec]) return versionSpec;
    if (metadata?.['dist-tags']?.[versionSpec]) return metadata['dist-tags'][versionSpec];
    throw new Error(`npm 버전을 찾을 수 없습니다: ${versionSpec}`);
  }
  const latest = metadata?.['dist-tags']?.latest;
  if (!latest) throw new Error('npm latest 버전을 찾을 수 없습니다.');
  return latest;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`npm registry 오류: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function findManifest(packageRoot: string): Promise<string | null> {
  for (const name of MANIFEST_CANDIDATES) {
    const candidate = path.join(packageRoot, name);
    const exists = await fs.stat(candidate).then(() => true).catch(() => false);
    if (exists) return candidate;
  }
  return null;
}
