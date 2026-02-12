import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}


export async function resolveBundlePath(cwd: string, configuredPath: string): Promise<string> {
  const candidate = path.resolve(cwd, configuredPath);
  const candidateExists = await exists(candidate);
  if (candidateExists) {
    return candidate;
  }

  return candidate;
}

export async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
  const ok = await exists(filePath);
  if (!ok) {
    return undefined;
  }

  return readFile(filePath, 'utf8');
}

export function trimQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

export function formatDate(input: Date): string {
  const year = String(input.getFullYear());
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  const hour = String(input.getHours()).padStart(2, '0');
  const minute = String(input.getMinutes()).padStart(2, '0');
  const second = String(input.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function splitYamlDocuments(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const documents: string[][] = [[]];

  for (const line of lines) {
    if (line.trim() === '---') {
      documents.push([]);
      continue;
    }

    const lastIndex = documents.length - 1;
    const lastDocument = documents[lastIndex];
    if (lastDocument) {
      lastDocument.push(line);
    }
  }

  const normalized = documents
    .map((doc) => doc.join('\n').trimEnd())
    .filter((doc) => doc.length > 0);

  if (normalized.length === 0) {
    return [''];
  }

  return normalized;
}
