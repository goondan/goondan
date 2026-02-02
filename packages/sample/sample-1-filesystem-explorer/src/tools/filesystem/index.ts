/**
 * 파일시스템 탐색 도구
 *
 * fs.list - 디렉터리 목록 조회
 * fs.stat - 파일/디렉터리 상세 정보
 * fs.tree - 디렉터리 트리 구조 출력
 * fs.search - 파일명 패턴 검색
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, ToolHandler } from '@goondan/core';

interface FsListInput {
  path?: string;
  showHidden?: boolean;
  sortBy?: 'name' | 'size' | 'modified';
}

interface FsStatInput {
  path: string;
}

interface FsTreeInput {
  path?: string;
  maxDepth?: number;
  showHidden?: boolean;
}

interface FsSearchInput {
  pattern: string;
  path?: string;
  maxDepth?: number;
  maxResults?: number;
}

interface FileInfo {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
  permissions: string;
}

function formatPermissions(mode: number): string {
  const types = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const owner = types[(mode >> 6) & 7];
  const group = types[(mode >> 3) & 7];
  const others = types[mode & 7];
  if (owner === undefined || group === undefined || others === undefined) {
    return '?????????';
  }
  return `${owner}${group}${others}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function getFileInfo(filePath: string, name: string): Promise<FileInfo> {
  const stat = await fs.lstat(filePath);
  let type: FileInfo['type'] = 'other';
  if (stat.isFile()) type = 'file';
  else if (stat.isDirectory()) type = 'directory';
  else if (stat.isSymbolicLink()) type = 'symlink';

  return {
    name,
    type,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    permissions: formatPermissions(stat.mode),
  };
}

async function buildTree(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  showHidden: boolean,
  prefix: string = ''
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));
  const sorted = filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (!entry) continue;
    const isLast = i === sorted.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const icon = entry.isDirectory() ? '📁 ' : '📄 ';
    lines.push(`${prefix}${connector}${icon}${entry.name}`);

    if (entry.isDirectory() && currentDepth < maxDepth) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      const subTree = await buildTree(
        path.join(dirPath, entry.name),
        currentDepth + 1,
        maxDepth,
        showHidden,
        newPrefix
      );
      lines.push(...subTree);
    }
  }
  return lines;
}

async function searchFiles(
  dirPath: string,
  pattern: RegExp,
  currentDepth: number,
  maxDepth: number,
  results: string[],
  maxResults: number
): Promise<void> {
  if (currentDepth > maxDepth || results.length >= maxResults) return;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(dirPath, entry.name);

      if (pattern.test(entry.name)) {
        results.push(fullPath);
      }

      if (entry.isDirectory() && currentDepth < maxDepth) {
        await searchFiles(fullPath, pattern, currentDepth + 1, maxDepth, results, maxResults);
      }
    }
  } catch {
    // 접근 권한이 없는 디렉터리는 건너뛰기
  }
}

function resolvePath(input: string | undefined): string {
  const target = input || '.';
  return path.isAbsolute(target) ? target : path.join(process.cwd(), target);
}

export const handlers: Record<string, ToolHandler> = {
  /**
   * 디렉터리 내용 목록 조회
   */
  'fs.list': async (_ctx, input) => {
    const payload = input as Partial<FsListInput>;
    const dirPath = resolvePath(payload.path);
    const showHidden = payload.showHidden ?? false;
    const sortBy = payload.sortBy ?? 'name';

    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`${dirPath}는 디렉터리가 아닙니다.`);
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));

    const items: FileInfo[] = [];
    for (const entry of filtered) {
      const fullPath = path.join(dirPath, entry.name);
      items.push(await getFileInfo(fullPath, entry.name));
    }

    // 정렬
    items.sort((a, b) => {
      // 디렉터리 우선
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;

      switch (sortBy) {
        case 'size':
          return b.size - a.size;
        case 'modified':
          return new Date(b.modified).getTime() - new Date(a.modified).getTime();
        default:
          return a.name.localeCompare(b.name);
      }
    });

    const summary = `${items.filter((i) => i.type === 'directory').length}개 디렉터리, ${items.filter((i) => i.type === 'file').length}개 파일`;

    const result: JsonObject = {
      path: dirPath,
      count: items.length,
      summary,
      items: items.map((item) => ({
        name: item.name,
        type: item.type,
        size: item.type === 'file' ? formatSize(item.size) : '-',
        modified: item.modified.split('T')[0],
        permissions: item.permissions,
      })),
    };

    return result;
  },

  /**
   * 파일/디렉터리 상세 정보 조회
   */
  'fs.stat': async (_ctx, input) => {
    const payload = input as Partial<FsStatInput>;
    const target = payload.path;
    if (!target) {
      throw new Error('path가 필요합니다.');
    }

    const fullPath = resolvePath(target);
    const stat = await fs.stat(fullPath);
    const lstat = await fs.lstat(fullPath);

    let type = 'other';
    if (stat.isFile()) type = 'file';
    else if (stat.isDirectory()) type = 'directory';
    else if (lstat.isSymbolicLink()) type = 'symlink';

    const result: JsonObject = {
      path: fullPath,
      name: path.basename(fullPath),
      type,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      permissions: formatPermissions(stat.mode),
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      accessed: stat.atime.toISOString(),
    };

    if (type === 'symlink') {
      result.linkTarget = await fs.readlink(fullPath);
    }

    if (type === 'directory') {
      const entries = await fs.readdir(fullPath);
      result.itemCount = entries.length;
    }

    return result;
  },

  /**
   * 디렉터리 트리 구조 출력
   */
  'fs.tree': async (_ctx, input) => {
    const payload = input as Partial<FsTreeInput>;
    const dirPath = resolvePath(payload.path);
    const maxDepth = payload.maxDepth ?? 3;
    const showHidden = payload.showHidden ?? false;

    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`${dirPath}는 디렉터리가 아닙니다.`);
    }

    const lines = [`📁 ${path.basename(dirPath)}/`];
    const tree = await buildTree(dirPath, 1, maxDepth, showHidden, '');
    lines.push(...tree);

    const result: JsonObject = {
      path: dirPath,
      maxDepth,
      tree: lines.join('\n'),
    };

    return result;
  },

  /**
   * 파일명 패턴 검색
   */
  'fs.search': async (_ctx, input) => {
    const payload = input as Partial<FsSearchInput>;
    const patternStr = payload.pattern;
    if (!patternStr) {
      throw new Error('pattern이 필요합니다.');
    }

    const dirPath = resolvePath(payload.path);
    const maxDepth = payload.maxDepth ?? 5;
    const maxResults = payload.maxResults ?? 50;

    // glob 패턴을 정규식으로 변환
    const regexPattern = patternStr
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const pattern = new RegExp(regexPattern, 'i');

    const results: string[] = [];
    await searchFiles(dirPath, pattern, 0, maxDepth, results, maxResults);

    const result: JsonObject = {
      pattern: patternStr,
      searchPath: dirPath,
      count: results.length,
      truncated: results.length >= maxResults,
      files: results.map((p) => path.relative(dirPath, p) || p),
    };

    return result;
  },
};
