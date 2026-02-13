import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface EvolutionUpdate {
  path: string;
  content: string;
}

export interface EvolutionPlan {
  summary: string;
  updates: EvolutionUpdate[];
}

export interface ApplyEvolutionPlanOptions {
  projectRoot: string;
  plan: EvolutionPlan;
  validate?: () => Promise<void> | void;
}

export interface ApplyEvolutionPlanResult {
  changedFiles: string[];
}

const ALLOWED_ROOT_FILES = new Set(['goondan.yaml', 'package.json', 'tsconfig.json', 'README.md', 'AGENTS.md']);
const ALLOWED_TS_DIR_PREFIX = 'src/';
const ALLOWED_PROMPT_DIR_PREFIX = 'prompts/';
const ALLOWED_TEST_DIR_PREFIX = 'test/';

function normalizeRelativePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }

  if (path.isAbsolute(trimmed)) {
    return '';
  }

  const normalized = path.posix.normalize(trimmed.replaceAll(path.win32.sep, path.posix.sep));
  if (normalized.startsWith('../') || normalized === '..') {
    return '';
  }

  return normalized;
}

export function isAllowedEvolutionPath(rawPath: string): boolean {
  const relativePath = normalizeRelativePath(rawPath);
  if (relativePath.length === 0) {
    return false;
  }

  if (ALLOWED_ROOT_FILES.has(relativePath)) {
    return true;
  }

  const ext = path.extname(relativePath);
  if (relativePath.startsWith(ALLOWED_TS_DIR_PREFIX)) {
    return ext === '.ts';
  }

  if (relativePath.startsWith(ALLOWED_PROMPT_DIR_PREFIX)) {
    return ext === '.md';
  }

  if (relativePath.startsWith(ALLOWED_TEST_DIR_PREFIX)) {
    return ext === '.ts';
  }

  return false;
}

export function parseEvolutionPlanFromUnknown(
  value: unknown,
): EvolutionPlan | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const summaryValue = value.summary;
  if (typeof summaryValue !== 'string' || summaryValue.trim().length === 0) {
    return null;
  }

  const updatesValue = value.updates;
  if (!Array.isArray(updatesValue) || updatesValue.length === 0) {
    return null;
  }

  const updates: EvolutionUpdate[] = [];
  for (const item of updatesValue) {
    if (!isObjectRecord(item)) {
      return null;
    }

    const updatePath = item.path;
    const content = item.content;
    if (typeof updatePath !== 'string' || updatePath.trim().length === 0) {
      return null;
    }

    if (typeof content !== 'string') {
      return null;
    }

    const normalized = normalizeRelativePath(updatePath);
    if (normalized.length === 0 || !isAllowedEvolutionPath(normalized)) {
      return null;
    }

    updates.push({ path: normalized, content });
  }

  if (updates.length === 0) {
    return null;
  }

  return {
    summary: summaryValue.trim(),
    updates,
  };
}

export async function applyEvolutionPlan(
  options: ApplyEvolutionPlanOptions,
): Promise<ApplyEvolutionPlanResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const plan = parseEvolutionPlanFromUnknown(options.plan);
  if (!plan) {
    throw new Error('evolve 계획 형식이 올바르지 않습니다.');
  }

  const roots: Array<{ path: string; previous?: string; existed: boolean }> = [];
  const changedFiles: string[] = [];

  try {
    for (const update of plan.updates) {
      const resolved = path.resolve(projectRoot, update.path);
      if (!resolved.startsWith(`${projectRoot}${path.sep}`) && resolved !== projectRoot) {
        throw new Error(`경로가 허용되지 않습니다: ${update.path}`);
      }

      let existed = true;
      let previous: string | undefined;
      try {
        previous = await fs.readFile(resolved, 'utf8');
      } catch {
        existed = false;
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, update.content, 'utf8');
      roots.push({ path: resolved, previous, existed });
      changedFiles.push(update.path);
    }

    if (options.validate) {
      await options.validate();
    }

    return {
      changedFiles,
    };
  } catch (error) {
    for (const item of [...roots].reverse()) {
      if (item.existed) {
        if (item.previous !== undefined) {
          await fs.writeFile(item.path, item.previous, 'utf8');
        }
      } else {
        await fs.rm(item.path, { force: true });
      }
    }

    throw error;
  }
}

export async function evolve(input: EvolutionPlan): Promise<string> {
  const plan = parseEvolutionPlanFromUnknown(input);
  if (!plan) {
    throw new Error('evolve 입력 형식이 올바르지 않습니다.');
  }

  const projectRoot = process.cwd();
  const result = await applyEvolutionPlan({
    projectRoot,
    plan,
  });

  const summaryLines = [`📝 ${plan.summary}`];
  for (const file of result.changedFiles) {
    summaryLines.push(`- ${file}`);
  }
  return summaryLines.join('\n');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
