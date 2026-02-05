/**
 * File Toolkit - 파일 읽기/쓰기/목록 도구
 *
 * @goondan/core의 Tool API를 사용하여 파일시스템 작업을 제공합니다.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolContext, ToolResult } from '@goondan/core/tool';

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * file.read - 파일 내용 읽기
 */
export async function read(
  params: { path: string },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const filePath = resolvePath(params.path, ctx);
    const content = await fs.readFile(filePath, 'utf-8');

    return {
      success: true,
      data: {
        path: params.path,
        content,
        size: content.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

/**
 * file.write - 파일 쓰기
 */
export async function write(
  params: { path: string; content: string },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const filePath = resolvePath(params.path, ctx);

    // 디렉토리가 없으면 생성
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // 파일 쓰기
    await fs.writeFile(filePath, params.content, 'utf-8');

    return {
      success: true,
      data: {
        path: params.path,
        written: params.content.length,
        message: `File written successfully: ${params.path}`,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

/**
 * file.list - 디렉토리 목록 조회
 */
export async function list(
  params: { path: string; recursive?: boolean },
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const dirPath = resolvePath(params.path, ctx);
    const recursive = params.recursive ?? false;

    const entries = await listDirectory(dirPath, recursive);

    return {
      success: true,
      data: {
        path: params.path,
        entries,
        count: entries.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 경로를 workspace 기준으로 resolve
 */
function resolvePath(inputPath: string, ctx: ToolContext): string {
  // 절대 경로면 그대로 사용, 상대 경로면 workspace 기준으로 resolve
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  // ctx.workspace가 있으면 그 기준으로 resolve
  const basePath = ctx.workspace?.root ?? process.cwd();
  return path.resolve(basePath, inputPath);
}

/**
 * 디렉토리 목록 조회 (재귀 지원)
 */
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

    // 재귀 모드이고 디렉토리면 하위 탐색
    if (recursive && item.isDirectory()) {
      const subEntries = await listDirectory(itemPath, true);
      entries.push(...subEntries);
    }
  }

  return entries;
}

/**
 * 에러 포맷팅
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    // ENOENT: 파일/디렉토리 없음
    if ('code' in error && error.code === 'ENOENT') {
      return `File or directory not found: ${error.message}`;
    }
    // EACCES: 권한 없음
    if ('code' in error && error.code === 'EACCES') {
      return `Permission denied: ${error.message}`;
    }
    return error.message;
  }
  return String(error);
}

// ============================================================================
// Types
// ============================================================================

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

// ============================================================================
// Tool Exports (for Goondan Tool System)
// ============================================================================

/**
 * Tool handler map - Goondan이 이 export를 사용하여 도구를 등록합니다.
 */
export const tools = {
  'file.read': read,
  'file.write': write,
  'file.list': list,
};

export default tools;
