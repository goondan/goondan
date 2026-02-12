import path from 'node:path';
import { DEFAULT_BUNDLE_FILE } from '../constants.js';

export function resolveManifestPath(cwd: string, inputPath: string): string {
  const resolved = path.resolve(cwd, inputPath);
  const isYaml = resolved.endsWith('.yaml') || resolved.endsWith('.yml');
  if (isYaml) {
    return resolved;
  }
  return path.join(resolved, DEFAULT_BUNDLE_FILE);
}

export function packagePathParts(packageName: string): { scope?: string; name: string } {
  if (packageName.startsWith('@')) {
    const slash = packageName.indexOf('/');
    if (slash > 1 && slash < packageName.length - 1) {
      return {
        scope: packageName.slice(1, slash),
        name: packageName.slice(slash + 1),
      };
    }
  }

  return {
    name: packageName,
  };
}
