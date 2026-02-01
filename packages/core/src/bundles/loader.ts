import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { deepClone } from '../utils/json.js';
import type { BundleManifest, Resource } from '../sdk/types.js';

interface BundleSource {
  manifest: BundleManifest;
  manifestPath: string;
  baseDir: string;
}

interface BundleLoadOptions {
  baseDir?: string;
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
      const manifestBase = path.dirname(absolutePath);
      const bundleBase = resolveBundleBaseDir(value, manifestBase);
      bundles.push({ manifest: value, manifestPath: absolutePath, baseDir: bundleBase });
    }
  }

  return bundles;
}

export async function loadBundleResources(
  paths: string[] | string,
  options: BundleLoadOptions = {}
): Promise<Resource[]> {
  const bundles = await readBundleManifests(paths, options);
  const resources: Resource[] = [];
  for (const bundle of bundles) {
    resources.push(...expandBundleResources(bundle));
  }
  return resources;
}

function resolveBundleBaseDir(manifest: BundleManifest, manifestDir: string): string {
  const baseDir = manifest.spec?.baseDir;
  if (!baseDir) return manifestDir;
  return path.isAbsolute(baseDir) ? baseDir : path.join(manifestDir, baseDir);
}

function expandBundleResources(bundle: BundleSource): Resource[] {
  const bundleName = bundle.manifest.metadata?.name;
  const resources = bundle.manifest.spec?.resources || [];
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
