/**
 * File Toolkit - 파일 읽기/쓰기/목록 도구
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { JsonObject, JsonValue, ToolContext, ToolHandler } from '@goondan/core';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

function resolvePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(process.cwd(), inputPath);
}

function readPath(input: JsonObject): string {
  const filePath = input['path'];
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('path는 비어있지 않은 문자열이어야 합니다.');
  }
  return resolvePath(filePath);
}

function readContent(input: JsonObject): string {
  const content = input['content'];
  if (typeof content !== 'string') {
    throw new Error('content는 문자열이어야 합니다.');
  }
  return content;
}

function readRecursive(input: JsonObject): boolean {
  const recursive = input['recursive'];
  if (recursive === undefined) {
    return false;
  }
  if (typeof recursive !== 'boolean') {
    throw new Error('recursive는 boolean이어야 합니다.');
  }
  return recursive;
}

async function listDirectory(
  dirPath: string,
  recursive: boolean
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const entry: FileEntry = {
      name: item.name,
      path: itemPath,
      type: item.isDirectory() ? 'directory' : 'file',
    };
    entries.push(entry);

    if (recursive && item.isDirectory()) {
      const subEntries = await listDirectory(itemPath, true);
      entries.push(...subEntries);
    }
  }

  return entries;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const handlers: Record<string, ToolHandler> = {
  'file.read': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const filePath = readPath(input);
    ctx.logger?.debug?.(`[file.read] ${filePath}`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return {
        success: true,
        path: filePath,
        content,
        size: content.length,
      };
    } catch (error) {
      return {
        success: false,
        path: filePath,
        error: formatError(error),
      };
    }
  },

  'file.write': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const filePath = readPath(input);
    const content = readContent(input);
    ctx.logger?.debug?.(`[file.write] ${filePath}`);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return {
        success: true,
        path: filePath,
        written: content.length,
      };
    } catch (error) {
      return {
        success: false,
        path: filePath,
        error: formatError(error),
      };
    }
  },

  'file.list': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const dirPath = readPath(input);
    const recursive = readRecursive(input);
    ctx.logger?.debug?.(`[file.list] ${dirPath} (recursive=${String(recursive)})`);

    try {
      const entries = await listDirectory(dirPath, recursive);
      return {
        success: true,
        path: dirPath,
        entries,
        count: entries.length,
      };
    } catch (error) {
      return {
        success: false,
        path: dirPath,
        error: formatError(error),
      };
    }
  },
};
