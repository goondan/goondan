import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ConfigRegistry, type Resource } from './registry.js';

interface LoaderOptions {
  baseDir?: string;
}

export async function loadConfigResources(paths: string[] | string, options: LoaderOptions = {}): Promise<Resource[]> {
  const files = Array.isArray(paths) ? paths : [paths];
  const baseDir = options.baseDir || process.cwd();
  const resources: Resource[] = [];

  for (const filePath of files) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    const content = await fs.readFile(absolutePath, 'utf8');
    const docs = YAML.parseAllDocuments(content);
    for (const doc of docs) {
      const firstError = doc.errors?.[0];
      if (firstError) {
        throw new Error(`YAML 파싱 오류 (${filePath}): ${firstError.message || 'unknown'}`);
      }
      const value = doc.toJSON() as Resource | null;
      if (!value) continue;
      resources.push(value);
    }
  }

  return resources;
}

export async function loadConfigFiles(paths: string[] | string, options: LoaderOptions = {}) {
  const baseDir = options.baseDir || process.cwd();
  const resources = await loadConfigResources(paths, { baseDir });
  return new ConfigRegistry(resources, { baseDir });
}
