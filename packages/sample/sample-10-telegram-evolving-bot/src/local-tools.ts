import fs from "node:fs/promises";
import path from "node:path";

interface ToolContext {
  workdir: string;
}

interface JsonObject {
  [key: string]: unknown;
}

function requireString(value: unknown, field: string): string {
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

export async function write(ctx: ToolContext, input: JsonObject): Promise<JsonObject> {
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

export const handlers = {
  write,
};
