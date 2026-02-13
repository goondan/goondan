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
  return path.resolve(ctx.workdir);
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

export async function remove(ctx: ToolContext, input: JsonObject): Promise<JsonValue> {
  const filePath = requireString(input.path, "path");

  const resolved = resolveSafePath(ctx.workdir, filePath);

  try {
    const stats = await fs.stat(resolved);
    await fs.rm(resolved, { recursive: stats.isDirectory(), force: true });

    return {
      ok: true,
      path: resolved,
      deleted: true,
    };
  } catch (error) {
    return {
      ok: false,
      path: resolved,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function evolve(ctx: ToolContext, input: JsonObject): Promise<JsonValue> {
  const plan = parseEvolutionPlanFromUnknown(input);
  if (!plan) {
    throw new Error("evolve tool input 형식이 올바르지 않습니다. (summary, updates 필요)");
  }

  const projectRoot = resolveProjectRoot(ctx);
  const result = await applyEvolutionPlan({
    projectRoot,
    plan,
  });

  // 파일 업데이트 후 프로세스 재시작 트리거
  ctx.logger.info(`[evolve] 파일 업데이트 완료. 에이전트 재시작 요청: ${plan.summary}`);
  
  // 프로세스 종료 시그널 전송 (Goondan Runtime이 자동으로 재시작)
  setTimeout(() => {
    process.exit(0);
  }, 1000);

  return {
    ok: true,
    summary: plan.summary,
    changedFiles: result.changedFiles,
    restartRequested: true,
    restartReason: "tool:evolve",
  };
}

export const handlers = {
  write,
  remove,
  evolve,
};
