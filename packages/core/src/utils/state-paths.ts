import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export function expandHomeDir(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function defaultStateRootDir(): string {
  return path.join(os.homedir(), '.goondan');
}

export function resolveStateRootDir(options: { stateRootDir?: string | null; baseDir?: string } = {}): string {
  const baseDir = options.baseDir || process.cwd();
  const raw = options.stateRootDir || process.env.GOONDAN_STATE_ROOT || defaultStateRootDir();
  const expanded = expandHomeDir(raw);
  return path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
}

export function resolveDir(input: string, baseDir: string): string {
  const expanded = expandHomeDir(input);
  return path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
}

export function deriveWorkspaceId(workspaceDir: string): string {
  const normalized = path.resolve(workspaceDir);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

