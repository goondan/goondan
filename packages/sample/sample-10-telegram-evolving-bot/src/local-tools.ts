import fs from "node:fs/promises";
import path from "node:path";

import type { JsonObject, JsonValue, ToolContext } from "@goondan/types";

import { applyEvolutionPlan, parseEvolutionPlanFromUnknown } from "./evolve.js";

function requireString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function resolveSafePath(workdir: string, target: string): string {
  if (path.isAbsolute(target)) {
    throw new Error("absolute path is not allowed");
  }

  const normalized = path.posix.normalize(target);
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("path traversal is not allowed");
  }

  return path.resolve(workdir, normalized);
}

function resolveProjectRoot(ctx: ToolContext): string {
  const fromEnv = process.env.BOT_PROJECT_ROOT;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }

  return path.resolve(ctx.workdir);
}

function resolveBackupRoot(projectRoot: string): string {
  const fromEnv = process.env.BOT_BACKUP_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return path.resolve(projectRoot, fromEnv);
  }

  return path.resolve(projectRoot, ".evolve-backups");
}

export async function write(ctx: ToolContext, input: JsonObject): Promise<JsonValue> {
  const filePath = requireString(input.path, "path");
  const content = requireString(input.content, "content");

  const resolved = resolveSafePath(ctx.workdir, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");

  return {
    ok: true,
    path: resolved,
    bytes: Buffer.byteLength(content),
  };
}

export async function evolve(ctx: ToolContext, input: JsonObject): Promise<JsonValue> {
  const plan = parseEvolutionPlanFromUnknown(input);
  if (!plan) {
    throw new Error("evolve tool input 형식이 올바르지 않습니다. (summary, updates 필요)");
  }

  const projectRoot = resolveProjectRoot(ctx);
  const backupRootDir = resolveBackupRoot(projectRoot);

  const result = await applyEvolutionPlan({
    projectRoot,
    backupRootDir,
    plan,
  });

  return {
    ok: true,
    summary: plan.summary,
    changedFiles: result.changedFiles,
    backupDir: result.backupDir,
  };
}

export const handlers = {
  write,
  evolve,
};
