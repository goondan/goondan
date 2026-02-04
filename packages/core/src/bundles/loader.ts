import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { deepClone } from '../utils/json.js';
import { resolveStateRootDir } from '../utils/state-paths.js';
import type { BundleManifest, Resource } from '../sdk/types.js';
import { installGitBundle, isGitBundleRef } from './git.js';

interface BundleSource {
  manifest: BundleManifest;
  manifestPath: string;
  baseDir: string;
}

interface BundleLoadOptions {
  baseDir?: string;
  stateRootDir?: string;
  resolveDependencies?: boolean;
}

export async function readBundleManifests(
  paths: string[] | string,
  options: BundleLoadOptions = {}
): Promise<BundleSource[]> {
  const files = Array.isArray(paths) ? paths : [paths];
  const baseDir = options.baseDir || process.cwd();
  const bundles: BundleSource[] = [];

  for (const filePath of files) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    const content = await fs.readFile(absolutePath, 'utf8');
    const docs = YAML.parseAllDocuments(content);
    for (const doc of docs) {
      const firstError = doc.errors?.[0];
      if (firstError) {
        throw new Error(`Bundle YAML 파싱 오류 (${filePath}): ${firstError.message || 'unknown'}`);
      }
      const value = doc.toJSON() as BundleManifest | null;
      if (!value) continue;
      if (value.kind !== 'Bundle') {
        continue;
      }
      validateBundleManifest(value, absolutePath);
      const manifestBase = path.dirname(absolutePath);
      bundles.push({ manifest: value, manifestPath: absolutePath, baseDir: manifestBase });
    }
  }

  return bundles;
}

export async function loadBundleResources(
  paths: string[] | string,
  options: BundleLoadOptions = {}
): Promise<Resource[]> {
  const bundles = await collectBundleSources(paths, options);
  const resources: Resource[] = [];
  for (const bundle of bundles) {
    const includeResources = await loadBundleIncludeResources(bundle);
    resources.push(...expandBundleResources(bundle, includeResources));
  }
  return resources;
}

function expandBundleResources(bundle: BundleSource, resources: Resource[]): Resource[] {
  const bundleName = bundle.manifest.metadata?.name;
  const resolved: Resource[] = [];

  for (const resource of resources) {
    const cloned = deepClone(resource) as Resource;
    if (!cloned.metadata) {
      cloned.metadata = { name: 'unknown' };
    }
    if (!cloned.metadata.labels) {
      cloned.metadata.labels = {};
    }
    if (bundleName) {
      cloned.metadata.labels.bundle = bundleName;
    }

    const spec = cloned.spec as { entry?: string } | undefined;
    if (spec?.entry && typeof spec.entry === 'string' && !path.isAbsolute(spec.entry)) {
      spec.entry = path.join(bundle.baseDir, spec.entry);
    }

    resolved.push(cloned);
  }

  return resolved;
}

function validateBundleManifest(manifest: BundleManifest, manifestPath: string): void {
  const spec = manifest.spec as { include?: unknown; dependencies?: unknown; resources?: unknown } | undefined;
  if (!spec || typeof spec !== 'object') {
    throw new Error(`Bundle spec가 없습니다: ${manifestPath}`);
  }
  if (Array.isArray(spec.resources)) {
    throw new Error(`spec.resources는 더 이상 지원되지 않습니다. spec.include로 마이그레이션하세요: ${manifestPath}`);
  }
  if (!Array.isArray(spec.include) || spec.include.length === 0) {
    throw new Error(`Bundle include 목록이 비어 있습니다: ${manifestPath}`);
  }
  for (const item of spec.include) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`Bundle include 항목이 유효하지 않습니다: ${manifestPath}`);
    }
  }
  if (spec.dependencies !== undefined) {
    if (!Array.isArray(spec.dependencies)) {
      throw new Error(`Bundle dependencies 형식이 올바르지 않습니다: ${manifestPath}`);
    }
    for (const item of spec.dependencies) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new Error(`Bundle dependencies 항목이 유효하지 않습니다: ${manifestPath}`);
      }
    }
  }
}

async function loadBundleIncludeResources(bundle: BundleSource): Promise<Resource[]> {
  const includeList = bundle.manifest.spec.include || [];
  const resources: Resource[] = [];
  for (const includePath of includeList) {
    const resolved = path.isAbsolute(includePath) ? includePath : path.join(bundle.baseDir, includePath);
    const content = await fs.readFile(resolved, 'utf8').catch(() => null);
    if (content === null) {
      throw new Error(`Bundle include 파일을 찾을 수 없습니다: ${includePath} (${bundle.manifestPath})`);
    }
    const docs = YAML.parseAllDocuments(content);
    for (const doc of docs) {
      const firstError = doc.errors?.[0];
      if (firstError) {
        throw new Error(`Bundle include YAML 파싱 오류 (${includePath}): ${firstError.message || 'unknown'}`);
      }
      const value = doc.toJSON() as Resource | null;
      if (!value) continue;
      resources.push(value);
    }
  }
  return resources;
}

async function collectBundleSources(
  paths: string[] | string,
  options: BundleLoadOptions
): Promise<BundleSource[]> {
  const files = Array.isArray(paths) ? paths : [paths];
  const baseDir = options.baseDir || process.cwd();
  const ordered: BundleSource[] = [];
  const visited = new Set<string>();

  for (const filePath of files) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    const manifestPath = await resolveBundleManifestPath(absolutePath);
    const bundles = await readBundleManifests(manifestPath, { baseDir });
    for (const bundle of bundles) {
      await visitBundle(bundle);
    }
  }

  return ordered;

  async function visitBundle(bundle: BundleSource): Promise<void> {
    if (visited.has(bundle.manifestPath)) return;
    visited.add(bundle.manifestPath);

    const dependencies = bundle.manifest.spec?.dependencies || [];
    if (options.resolveDependencies !== false && dependencies.length > 0) {
      for (const dependency of dependencies) {
        const dependencyManifest = await resolveBundleDependency(dependency, bundle, options);
        const depBundles = await readBundleManifests(dependencyManifest, { baseDir: process.cwd() });
        if (depBundles.length === 0) {
          throw new Error(`Bundle dependency manifest가 비어 있습니다: ${dependency}`);
        }
        if (depBundles.length > 1) {
          throw new Error(`Bundle dependency manifest가 여러 개입니다: ${dependency}`);
        }
        const depBundle = depBundles[0];
        if (!depBundle) {
          throw new Error(`Bundle dependency manifest가 비어 있습니다: ${dependency}`);
        }
        await visitBundle(depBundle);
      }
    }

    ordered.push(bundle);
  }
}

async function resolveBundleDependency(
  dependency: string,
  parent: BundleSource,
  options: BundleLoadOptions
): Promise<string> {
  if (isLocalPath(dependency)) {
    const target = path.isAbsolute(dependency) ? dependency : path.join(parent.baseDir, dependency);
    return resolveBundleManifestPath(target);
  }

  if (!isGitBundleRef(dependency)) {
    throw new Error(`지원하지 않는 Bundle dependency입니다: ${dependency}`);
  }

  const stateRootDir = resolveStateRootDir({ stateRootDir: options.stateRootDir, baseDir: process.cwd() });
  const installed = await installGitBundle(dependency, { stateRootDir });
  return installed.manifestPath;
}

function isLocalPath(value: string): boolean {
  return value.startsWith('.') || value.startsWith('/') || value.startsWith('..');
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
