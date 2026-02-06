/**
 * File System Tool - 파일 시스템 읽기/쓰기/목록/존재 확인
 *
 * Node.js fs/promises API를 사용하여 파일 시스템 작업을 수행합니다.
 *
 * @see /docs/specs/tool.md
 */

import { readFile, writeFile, appendFile, readdir, stat, access, mkdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

/** 파일 내용 최대 길이 (1MB) */
const MAX_READ_LENGTH = 1_000_000;

/** 유효한 인코딩 목록 */
const VALID_ENCODINGS = new Set([
  'utf-8', 'utf8', 'ascii', 'latin1', 'base64', 'hex',
]);

/** 유효한 쓰기 모드 */
type WriteMode = 'overwrite' | 'append';
const VALID_WRITE_MODES = new Set<string>(['overwrite', 'append']);

function isValidWriteMode(value: string): value is WriteMode {
  return VALID_WRITE_MODES.has(value);
}

/**
 * BufferEncoding으로 변환 가능한 인코딩인지 확인
 */
function isValidEncoding(value: string): value is BufferEncoding {
  return VALID_ENCODINGS.has(value.toLowerCase());
}

/**
 * 읽은 내용을 최대 길이로 자름
 */
function truncateContent(content: string, maxLength: number): { text: string; truncated: boolean } {
  if (content.length <= maxLength) {
    return { text: content, truncated: false };
  }
  return {
    text: content.slice(0, maxLength) + '\n... (content truncated)',
    truncated: true,
  };
}

// =============================================================================
// fs.read
// =============================================================================

interface FsReadInput {
  path: string;
  encoding: BufferEncoding;
}

function parseFsReadInput(input: JsonObject): FsReadInput {
  const path = input['path'];
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('path는 비어있지 않은 문자열이어야 합니다.');
  }

  let encoding: BufferEncoding = 'utf-8';
  const encodingInput = input['encoding'];
  if (typeof encodingInput === 'string') {
    if (!isValidEncoding(encodingInput)) {
      throw new Error(`지원하지 않는 인코딩: ${encodingInput}. 지원: ${[...VALID_ENCODINGS].join(', ')}`);
    }
    encoding = encodingInput;
  }

  return { path: resolve(path), encoding };
}

// =============================================================================
// fs.write
// =============================================================================

interface FsWriteInput {
  path: string;
  content: string;
  mode: WriteMode;
}

function parseFsWriteInput(input: JsonObject): FsWriteInput {
  const path = input['path'];
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('path는 비어있지 않은 문자열이어야 합니다.');
  }

  const content = input['content'];
  if (typeof content !== 'string') {
    throw new Error('content는 문자열이어야 합니다.');
  }

  let mode: WriteMode = 'overwrite';
  const modeInput = input['mode'];
  if (typeof modeInput === 'string') {
    if (!isValidWriteMode(modeInput)) {
      throw new Error(`지원하지 않는 모드: ${modeInput}. 지원: overwrite, append`);
    }
    mode = modeInput;
  }

  return { path: resolve(path), content, mode };
}

// =============================================================================
// fs.list
// =============================================================================

interface FsListInput {
  path: string;
  recursive: boolean;
}

function parseFsListInput(input: JsonObject): FsListInput {
  const path = input['path'];
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('path는 비어있지 않은 문자열이어야 합니다.');
  }

  const recursive = input['recursive'] === true;

  return { path: resolve(path), recursive };
}

/** 디렉토리 항목 정보 */
interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

/**
 * 디렉토리 내용을 재귀적으로 조회
 */
async function listDirectory(dirPath: string, recursive: boolean, basePath: string): Promise<DirEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const results: DirEntry[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relativePath = fullPath.slice(basePath.length + 1);

    if (entry.isDirectory()) {
      results.push({ name: entry.name, type: 'directory', path: relativePath });
      if (recursive) {
        const subEntries = await listDirectory(fullPath, true, basePath);
        results.push(...subEntries);
      }
    } else if (entry.isFile()) {
      results.push({ name: entry.name, type: 'file', path: relativePath });
    }
  }

  return results;
}

// =============================================================================
// fs.exists
// =============================================================================

interface FsExistsInput {
  path: string;
}

function parseFsExistsInput(input: JsonObject): FsExistsInput {
  const path = input['path'];
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('path는 비어있지 않은 문자열이어야 합니다.');
  }

  return { path: resolve(path) };
}

// =============================================================================
// Tool handlers
// =============================================================================

export const handlers: Record<string, ToolHandler> = {
  /**
   * fs.read - 파일 읽기
   */
  'fs.read': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseFsReadInput(input);

    ctx.logger?.debug?.(`[fs.read] Reading: ${parsed.path} (encoding: ${parsed.encoding})`);

    const raw = await readFile(parsed.path, { encoding: parsed.encoding });
    const { text, truncated } = truncateContent(raw, MAX_READ_LENGTH);

    return {
      content: text,
      path: parsed.path,
      encoding: parsed.encoding,
      size: raw.length,
      truncated,
      success: true,
    };
  },

  /**
   * fs.write - 파일 쓰기
   */
  'fs.write': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseFsWriteInput(input);

    ctx.logger?.debug?.(`[fs.write] Writing: ${parsed.path} (mode: ${parsed.mode})`);

    // 디렉토리가 없으면 자동 생성
    const dir = dirname(parsed.path);
    await mkdir(dir, { recursive: true });

    if (parsed.mode === 'append') {
      await appendFile(parsed.path, parsed.content, { encoding: 'utf-8' });
    } else {
      await writeFile(parsed.path, parsed.content, { encoding: 'utf-8' });
    }

    return {
      path: parsed.path,
      mode: parsed.mode,
      bytesWritten: Buffer.byteLength(parsed.content, 'utf-8'),
      success: true,
    };
  },

  /**
   * fs.list - 디렉토리 목록 조회
   */
  'fs.list': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseFsListInput(input);

    ctx.logger?.debug?.(`[fs.list] Listing: ${parsed.path} (recursive: ${String(parsed.recursive)})`);

    // 디렉토리인지 확인
    const stats = await stat(parsed.path);
    if (!stats.isDirectory()) {
      throw new Error(`${parsed.path}는 디렉토리가 아닙니다.`);
    }

    const entries = await listDirectory(parsed.path, parsed.recursive, parsed.path);

    return {
      path: parsed.path,
      recursive: parsed.recursive,
      entries: entries.map((e): JsonObject => ({
        name: e.name,
        type: e.type,
        path: e.path,
      })),
      count: entries.length,
      success: true,
    };
  },

  /**
   * fs.exists - 파일/디렉토리 존재 확인
   */
  'fs.exists': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const parsed = parseFsExistsInput(input);

    ctx.logger?.debug?.(`[fs.exists] Checking: ${parsed.path}`);

    let exists = false;
    let type: string | null = null;

    try {
      await access(parsed.path);
      exists = true;

      const stats = await stat(parsed.path);
      if (stats.isFile()) {
        type = 'file';
      } else if (stats.isDirectory()) {
        type = 'directory';
      } else if (stats.isSymbolicLink()) {
        type = 'symlink';
      } else {
        type = 'other';
      }
    } catch {
      // 파일이 존재하지 않으면 exists = false
    }

    return {
      path: parsed.path,
      exists,
      type,
      success: true,
    };
  },
};
