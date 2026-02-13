import fs from "node:fs/promises";
import path from "node:path";

export interface EvolutionUpdate {
  path: string;
  content: string;
}

export interface EvolutionPlan {
  summary: string;
  updates: EvolutionUpdate[];
}

export interface ApplyEvolutionInput {
  projectRoot: string;
  backupRootDir: string;
  plan: EvolutionPlan;
  validate?: (projectRoot: string) => Promise<void>;
}

export interface ApplyEvolutionResult {
  changedFiles: string[];
  backupDir: string;
}

const ALLOWED_FILES = new Set([
  "goondan.yaml",
  "package.json",
  "tsconfig.json",
  "README.md",
  "AGENTS.md",
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: string): boolean {
  if (path.isAbsolute(value)) {
    return false;
  }

  if (value.includes("\\")) {
    return false;
  }

  const normalized = path.posix.normalize(value);
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }

  if (ALLOWED_FILES.has(normalized)) {
    return true;
  }

  if (normalized.startsWith("src/") && normalized.endsWith(".ts")) {
    return true;
  }

  if (normalized.startsWith("test/") && normalized.endsWith(".ts")) {
    return true;
  }

  if (normalized.startsWith("prompts/") && normalized.endsWith(".md")) {
    return true;
  }

  return false;
}

function parseEvolutionPlan(raw: Record<string, unknown>): EvolutionPlan | null {
  const summaryValue = raw.summary;
  if (typeof summaryValue !== "string" || summaryValue.trim().length === 0) {
    return null;
  }

  const updatesValue = raw.updates;
  if (!Array.isArray(updatesValue) || updatesValue.length === 0) {
    return null;
  }

  const updates: EvolutionUpdate[] = [];
  for (const item of updatesValue) {
    if (!isObjectRecord(item)) {
      return null;
    }

    const filePath = item.path;
    const content = item.content;
    if (typeof filePath !== "string" || typeof content !== "string") {
      return null;
    }

    if (!isSafeRelativePath(filePath)) {
      return null;
    }

    updates.push({
      path: filePath,
      content,
    });
  }

  return {
    summary: summaryValue.trim(),
    updates,
  };
}

export function parseEvolutionPlanFromUnknown(raw: unknown): EvolutionPlan | null {
  if (!isObjectRecord(raw)) {
    return null;
  }

  return parseEvolutionPlan(raw);
}

export async function validateGoondanBundle(projectRoot: string): Promise<void> {
  const goondanPath = path.resolve(projectRoot, "goondan.yaml");
  const source = await fs.readFile(goondanPath, "utf8");

  const hasApiVersion = /apiVersion:\s*goondan\.ai\/v1/.test(source);
  if (!hasApiVersion) {
    throw new Error("goondan.yaml 검증 실패: apiVersion goondan.ai/v1 이 필요합니다.");
  }

  const hasSwarm = /kind:\s*Swarm/.test(source);
  if (!hasSwarm) {
    throw new Error("goondan.yaml 검증 실패: Swarm 리소스가 필요합니다.");
  }

  const hasAgent = /kind:\s*Agent/.test(source);
  if (!hasAgent) {
    throw new Error("goondan.yaml 검증 실패: Agent 리소스가 필요합니다.");
  }
}

export async function applyEvolutionPlan(input: ApplyEvolutionInput): Promise<ApplyEvolutionResult> {
  const validate = input.validate ?? validateGoondanBundle;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(input.backupRootDir, timestamp);

  await fs.mkdir(backupDir, { recursive: true });

  const applied: string[] = [];
  try {
    for (const update of input.plan.updates) {
      const normalized = path.posix.normalize(update.path);
      if (!isSafeRelativePath(normalized)) {
        throw new Error(`허용되지 않은 경로입니다: ${update.path}`);
      }

      const targetPath = path.resolve(input.projectRoot, normalized);
      const backupPath = path.resolve(backupDir, `${normalized}.bak`);
      await fs.mkdir(path.dirname(backupPath), { recursive: true });

      try {
        const existing = await fs.readFile(targetPath);
        await fs.writeFile(backupPath, existing);
      } catch {
        await fs.writeFile(backupPath, "");
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, update.content, "utf8");
      applied.push(normalized);
    }

    await validate(input.projectRoot);

    return {
      changedFiles: applied,
      backupDir,
    };
  } catch (error) {
    for (const changedPath of applied) {
      const targetPath = path.resolve(input.projectRoot, changedPath);
      const backupPath = path.resolve(backupDir, `${changedPath}.bak`);
      try {
        const backup = await fs.readFile(backupPath);
        if (backup.length === 0) {
          await fs.rm(targetPath, { force: true });
        } else {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, backup);
        }
      } catch {
        // rollback best effort
      }
    }

    throw error;
  }
}

export function isAllowedEvolutionPath(value: string): boolean {
  return isSafeRelativePath(value);
}
