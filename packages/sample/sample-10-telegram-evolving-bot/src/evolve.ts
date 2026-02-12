import fs from "node:fs/promises";
import path from "node:path";

import { parseJsonObjectFromText, requestAnthropicText } from "./anthropic.js";
import type { ConversationTurn } from "./state.js";

export interface EvolutionUpdate {
  path: string;
  content: string;
}

export interface EvolutionPlan {
  summary: string;
  updates: EvolutionUpdate[];
}

export interface RequestEvolutionPlanInput {
  apiKey: string;
  model: string;
  maxTokens: number;
  instruction: string;
  goondanYaml: string;
  turns: ConversationTurn[];
  fetchImpl?: typeof fetch;
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

function createEvolutionPrompt(instruction: string, goondanYaml: string): string {
  return [
    "다음 요구사항에 맞춰 self-evolve 계획을 JSON으로 반환하세요.",
    "반드시 JSON 객체만 반환하세요.",
    "형식:",
    '{"summary":"...","updates":[{"path":"goondan.yaml","content":"..."}]}',
    "규칙:",
    "- path는 상대 경로만 사용",
    "- goondan.yaml 변경이 필요하면 반드시 포함",
    "- content는 전체 파일 내용으로 제공",
    "",
    "사용자 지시:",
    instruction,
    "",
    "현재 goondan.yaml:",
    goondanYaml,
  ].join("\n");
}

export async function requestEvolutionPlan(input: RequestEvolutionPlanInput): Promise<EvolutionPlan> {
  const responseText = await requestAnthropicText({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt:
      "You are a careful software evolution assistant. Return strict JSON only and never include markdown wrapper unless explicitly asked.",
    maxTokens: input.maxTokens,
    turns: input.turns,
    userInput: createEvolutionPrompt(input.instruction, input.goondanYaml),
    fetchImpl: input.fetchImpl,
  });

  const parsed = parseJsonObjectFromText(responseText);
  if (parsed === null) {
    throw new Error("evolution 응답에서 JSON 객체를 파싱할 수 없습니다.");
  }

  const plan = parseEvolutionPlan(parsed);
  if (plan === null) {
    throw new Error("evolution 계획 형식이 잘못되었습니다.");
  }

  return plan;
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
