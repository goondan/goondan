import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir } from '../utils/fs.js';

const MANIFEST_CANDIDATES = ['bundle.yaml', 'bundle.yml', 'bundle.json'];

export interface GitBundleRef {
  host: string;
  org: string;
  repo: string;
  path: string;
  ref?: string;
  url: string;
}

export interface GitBundleInstallResult {
  ref: GitBundleRef;
  repoRoot: string;
  bundleRoot: string;
  manifestPath: string;
  commit?: string;
}

export function isGitBundleRef(input: string): boolean {
  try {
    parseGitBundleRef(input);
    return true;
  } catch {
    return false;
  }
}

export function parseGitBundleRef(input: string): GitBundleRef {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('빈 Bundle Ref입니다.');
  if (trimmed.startsWith('npm:')) throw new Error('npm spec은 Git Bundle Ref가 아닙니다.');
  if (trimmed.startsWith('@')) throw new Error('npm scope는 Git Bundle Ref가 아닙니다.');

  let normalized = trimmed;
  if (normalized.startsWith('git+')) {
    normalized = normalized.slice(4);
  }
  if (normalized.startsWith('https://')) {
    normalized = normalized.slice('https://'.length);
  } else if (normalized.startsWith('http://')) {
    normalized = normalized.slice('http://'.length);
  }
  if (normalized.endsWith('.git')) {
    normalized = normalized.slice(0, -4);
  }

  let ref: string | undefined;
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex > normalized.indexOf('/')) {
    ref = normalized.slice(atIndex + 1).trim();
    if (!ref) {
      throw new Error(`Git ref가 비어 있습니다: ${input}`);
    }
    normalized = normalized.slice(0, atIndex);
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 3) {
    throw new Error(`Git Bundle Ref 형식이 올바르지 않습니다: ${input}`);
  }

  const [host, org, repo, ...rest] = segments;
  if (!host || !org || !repo) {
    throw new Error(`Git Bundle Ref 형식이 올바르지 않습니다: ${input}`);
  }
  if (!host.includes('.') || host.startsWith('.')) {
    throw new Error(`Git 호스트 형식이 올바르지 않습니다: ${input}`);
  }
  const pathSegments = rest.filter((seg) => seg.length > 0);
  if (pathSegments.some((seg) => seg === '.' || seg === '..')) {
    throw new Error(`Bundle 경로에 상대 경로가 포함될 수 없습니다: ${input}`);
  }

  const bundlePath = pathSegments.join('/');
  const url = `https://${host}/${org}/${repo}.git`;

  return {
    host,
    org,
    repo,
    path: bundlePath,
    ref: ref || undefined,
    url,
  };
}

export async function installGitBundle(
  spec: string,
  options: { stateRootDir: string; logger?: Console }
): Promise<GitBundleInstallResult> {
  const ref = parseGitBundleRef(spec);
  const logger = options.logger || console;
  const refKey = sanitizeSegment(ref.ref || 'HEAD');
  const repoRoot = path.join(
    options.stateRootDir,
    'bundles',
    'git',
    sanitizeSegment(ref.host),
    sanitizeSegment(ref.org),
    sanitizeSegment(ref.repo),
    refKey
  );

  const hasRepo = await exists(path.join(repoRoot, '.git'));
  if (!hasRepo) {
    await ensureDir(path.dirname(repoRoot));
    await cloneRepo(ref, repoRoot, logger);
  } else {
    await updateRepo(ref, repoRoot, logger);
  }

  const bundleRoot = ref.path ? path.join(repoRoot, ref.path) : repoRoot;
  const manifestPath = await findManifest(bundleRoot);
  if (!manifestPath) {
    throw new Error(`bundle.yaml을 찾을 수 없습니다: ${bundleRoot}`);
  }

  const commit = await tryResolveCommit(repoRoot);

  return {
    ref,
    repoRoot,
    bundleRoot,
    manifestPath,
    commit: commit || undefined,
  };
}

async function cloneRepo(ref: GitBundleRef, repoRoot: string, logger: Console): Promise<void> {
  const commitish = ref.ref && isCommitish(ref.ref);
  if (!ref.ref || !commitish) {
    const args = ['clone', '--depth', '1'];
    if (ref.ref) {
      args.push('--branch', ref.ref, '--single-branch');
    }
    args.push(ref.url, repoRoot);
    await runGit(args, { logger });
    return;
  }

  await runGit(['clone', '--no-checkout', ref.url, repoRoot], { logger });
  await runGit(['-C', repoRoot, 'fetch', '--depth', '1', 'origin', ref.ref], { logger });
  await runGit(['-C', repoRoot, 'checkout', ref.ref], { logger });
}

async function updateRepo(ref: GitBundleRef, repoRoot: string, logger: Console): Promise<void> {
  await runGit(['-C', repoRoot, 'fetch', '--all', '--tags', '--prune'], { logger });

  if (ref.ref) {
    const hasRemoteBranch = await gitHasRemoteBranch(repoRoot, ref.ref, logger);
    if (hasRemoteBranch) {
      await runGit(['-C', repoRoot, 'checkout', '-B', ref.ref, `origin/${ref.ref}`], { logger });
      await runGit(['-C', repoRoot, 'pull', '--ff-only'], { logger });
      return;
    }
    await runGit(['-C', repoRoot, 'checkout', ref.ref], { logger });
    return;
  }

  const defaultBranch = await resolveDefaultBranch(repoRoot, logger);
  await runGit(['-C', repoRoot, 'checkout', defaultBranch], { logger });
  await runGit(['-C', repoRoot, 'pull', '--ff-only'], { logger });
}

async function resolveDefaultBranch(repoRoot: string, logger: Console): Promise<string> {
  try {
    const output = await runGit(['-C', repoRoot, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { logger });
    const value = output.trim();
    if (value.startsWith('origin/')) return value.slice('origin/'.length);
    if (value) return value;
  } catch {
    // ignore
  }
  return 'main';
}

async function gitHasRemoteBranch(repoRoot: string, branch: string, logger: Console): Promise<boolean> {
  try {
    await runGit(['-C', repoRoot, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { logger });
    return true;
  } catch {
    return false;
  }
}

async function tryResolveCommit(repoRoot: string): Promise<string | null> {
  try {
    const output = await runGit(['-C', repoRoot, 'rev-parse', 'HEAD']);
    return output.trim();
  } catch {
    return null;
  }
}

async function findManifest(bundleRoot: string): Promise<string | null> {
  for (const name of MANIFEST_CANDIDATES) {
    const candidate = path.join(bundleRoot, name);
    const exists = await fs.stat(candidate).then(() => true).catch(() => false);
    if (exists) return candidate;
  }
  return null;
}

async function runGit(
  args: string[],
  options: { cwd?: string; logger?: Console } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (err) => {
      reject(new Error(`git 실행 실패: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      const message = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(message || `git 명령 실패: ${args.join(' ')}`));
    });
  });
}

function isCommitish(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

function sanitizeSegment(value: string): string {
  return value.replace(/[\\/]/g, '+').replace(/\.\./g, '__');
}

async function exists(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false);
}
