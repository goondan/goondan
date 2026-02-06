/**
 * File System Tool 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlers } from '../../../src/tools/file-system/index.js';
import type { ToolContext, JsonValue, JsonObject } from '@goondan/core';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// =============================================================================
// 타입 가드
// =============================================================================

interface FsReadResult {
  content: string;
  path: string;
  encoding: string;
  size: number;
  truncated: boolean;
  success: boolean;
}

function isFsReadResult(value: JsonValue): value is FsReadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof value['content'] === 'string' &&
    typeof value['path'] === 'string' &&
    typeof value['encoding'] === 'string' &&
    typeof value['size'] === 'number' &&
    typeof value['truncated'] === 'boolean' &&
    typeof value['success'] === 'boolean'
  );
}

interface FsWriteResult {
  path: string;
  mode: string;
  bytesWritten: number;
  success: boolean;
}

function isFsWriteResult(value: JsonValue): value is FsWriteResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof value['path'] === 'string' &&
    typeof value['mode'] === 'string' &&
    typeof value['bytesWritten'] === 'number' &&
    typeof value['success'] === 'boolean'
  );
}

interface FsListEntry {
  name: string;
  type: string;
  path: string;
}

function isFsListEntry(value: JsonValue): value is FsListEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof value['name'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['path'] === 'string'
  );
}

interface FsListResult {
  path: string;
  recursive: boolean;
  entries: JsonValue[];
  count: number;
  success: boolean;
}

function isFsListResult(value: JsonValue): value is FsListResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof value['path'] === 'string' &&
    typeof value['recursive'] === 'boolean' &&
    Array.isArray(value['entries']) &&
    typeof value['count'] === 'number' &&
    typeof value['success'] === 'boolean'
  );
}

interface FsExistsResult {
  path: string;
  exists: boolean;
  type: string | null;
  success: boolean;
}

function isFsExistsResult(value: JsonValue): value is FsExistsResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof value['path'] === 'string' &&
    typeof value['exists'] === 'boolean' &&
    typeof value['success'] === 'boolean'
  );
}

// =============================================================================
// Mock ToolContext
// =============================================================================

function createMockContext(): ToolContext {
  return {
    instance: { id: 'test-instance', swarmName: 'test-swarm', status: 'running' },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { agents: [], entrypoint: '' },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: { id: 'test-turn', messages: [], toolResults: [] },
    step: { id: 'test-step', index: 0 },
    toolCatalog: [],
    swarmBundle: {
      openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test' }),
      commitChangeset: vi.fn().mockResolvedValue({ success: true }),
    },
    oauth: {
      getAccessToken: vi.fn().mockResolvedValue({ status: 'error', error: { code: 'not_configured', message: 'Not configured' } }),
    },
    events: {},
    logger: {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(),
      assert: vi.fn(), clear: vi.fn(), count: vi.fn(), countReset: vi.fn(),
      dir: vi.fn(), dirxml: vi.fn(), group: vi.fn(), groupCollapsed: vi.fn(),
      groupEnd: vi.fn(), table: vi.fn(), time: vi.fn(), timeEnd: vi.fn(),
      timeLog: vi.fn(), trace: vi.fn(), profile: vi.fn(), profileEnd: vi.fn(),
      timeStamp: vi.fn(), Console: vi.fn(),
    },
  };
}

// =============================================================================
// 테스트
// =============================================================================

describe('file-system tool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'goondan-fs-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // fs.read
  // ===========================================================================

  describe('fs.read', () => {
    const handler = handlers['fs.read'];

    it('should be defined', () => {
      expect(handler).toBeDefined();
    });

    it('should read a text file', async () => {
      const filePath = join(tmpDir, 'test.txt');
      await writeFile(filePath, 'Hello, World!', 'utf-8');

      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath });

      expect(isFsReadResult(result)).toBe(true);
      if (isFsReadResult(result)) {
        expect(result.content).toBe('Hello, World!');
        expect(result.size).toBe(13);
        expect(result.truncated).toBe(false);
        expect(result.success).toBe(true);
      }
    });

    it('should read with specified encoding', async () => {
      const filePath = join(tmpDir, 'test.txt');
      await writeFile(filePath, 'abc', 'utf-8');

      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath, encoding: 'utf-8' });

      expect(isFsReadResult(result)).toBe(true);
      if (isFsReadResult(result)) {
        expect(result.content).toBe('abc');
        expect(result.encoding).toBe('utf-8');
      }
    });

    it('should throw for non-existent file', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: join(tmpDir, 'nonexistent.txt') })
      ).rejects.toThrow();
    });

    it('should throw for empty path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: '' })
      ).rejects.toThrow('path는 비어있지 않은 문자열이어야 합니다.');
    });

    it('should throw for non-string path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: 123 })
      ).rejects.toThrow('path는 비어있지 않은 문자열이어야 합니다.');
    });

    it('should throw for unsupported encoding', async () => {
      const filePath = join(tmpDir, 'test.txt');
      await writeFile(filePath, 'test', 'utf-8');

      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: filePath, encoding: 'invalid-enc' })
      ).rejects.toThrow('지원하지 않는 인코딩');
    });

    it('should read multi-line file', async () => {
      const filePath = join(tmpDir, 'multi.txt');
      const content = 'line1\nline2\nline3';
      await writeFile(filePath, content, 'utf-8');

      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath });

      expect(isFsReadResult(result)).toBe(true);
      if (isFsReadResult(result)) {
        expect(result.content).toBe(content);
      }
    });

    it('should read empty file', async () => {
      const filePath = join(tmpDir, 'empty.txt');
      await writeFile(filePath, '', 'utf-8');

      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath });

      expect(isFsReadResult(result)).toBe(true);
      if (isFsReadResult(result)) {
        expect(result.content).toBe('');
        expect(result.size).toBe(0);
      }
    });
  });

  // ===========================================================================
  // fs.write
  // ===========================================================================

  describe('fs.write', () => {
    const handler = handlers['fs.write'];

    it('should be defined', () => {
      expect(handler).toBeDefined();
    });

    it('should write a new file', async () => {
      const filePath = join(tmpDir, 'output.txt');
      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath, content: 'Hello!' });

      expect(isFsWriteResult(result)).toBe(true);
      if (isFsWriteResult(result)) {
        expect(result.success).toBe(true);
        expect(result.mode).toBe('overwrite');
        expect(result.bytesWritten).toBe(6);
      }

      // 실제로 파일이 작성되었는지 확인
      const readHandler = handlers['fs.read'];
      const readResult = await readHandler(ctx, { path: filePath });
      if (isFsReadResult(readResult)) {
        expect(readResult.content).toBe('Hello!');
      }
    });

    it('should overwrite existing file', async () => {
      const filePath = join(tmpDir, 'overwrite.txt');
      await writeFile(filePath, 'old content', 'utf-8');

      const ctx = createMockContext();
      await handler(ctx, { path: filePath, content: 'new content' });

      const readHandler = handlers['fs.read'];
      const readResult = await readHandler(ctx, { path: filePath });
      if (isFsReadResult(readResult)) {
        expect(readResult.content).toBe('new content');
      }
    });

    it('should append to file', async () => {
      const filePath = join(tmpDir, 'append.txt');
      await writeFile(filePath, 'first', 'utf-8');

      const ctx = createMockContext();
      await handler(ctx, { path: filePath, content: ' second', mode: 'append' });

      const readHandler = handlers['fs.read'];
      const readResult = await readHandler(ctx, { path: filePath });
      if (isFsReadResult(readResult)) {
        expect(readResult.content).toBe('first second');
      }
    });

    it('should create directories recursively', async () => {
      const filePath = join(tmpDir, 'deep', 'nested', 'dir', 'file.txt');
      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath, content: 'deep content' });

      expect(isFsWriteResult(result)).toBe(true);
      if (isFsWriteResult(result)) {
        expect(result.success).toBe(true);
      }

      const readHandler = handlers['fs.read'];
      const readResult = await readHandler(ctx, { path: filePath });
      if (isFsReadResult(readResult)) {
        expect(readResult.content).toBe('deep content');
      }
    });

    it('should throw for empty path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: '', content: 'test' })
      ).rejects.toThrow('path는 비어있지 않은 문자열이어야 합니다.');
    });

    it('should throw for non-string content', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: join(tmpDir, 'test.txt'), content: 123 })
      ).rejects.toThrow('content는 문자열이어야 합니다.');
    });

    it('should throw for invalid mode', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: join(tmpDir, 'test.txt'), content: 'test', mode: 'invalid' })
      ).rejects.toThrow('지원하지 않는 모드');
    });
  });

  // ===========================================================================
  // fs.list
  // ===========================================================================

  describe('fs.list', () => {
    const handler = handlers['fs.list'];

    it('should be defined', () => {
      expect(handler).toBeDefined();
    });

    it('should list directory contents', async () => {
      await writeFile(join(tmpDir, 'file1.txt'), 'content1', 'utf-8');
      await writeFile(join(tmpDir, 'file2.txt'), 'content2', 'utf-8');
      await mkdir(join(tmpDir, 'subdir'));

      const ctx = createMockContext();
      const result = await handler(ctx, { path: tmpDir });

      expect(isFsListResult(result)).toBe(true);
      if (isFsListResult(result)) {
        expect(result.success).toBe(true);
        expect(result.count).toBe(3);

        const names = result.entries
          .filter(isFsListEntry)
          .map(e => e.name)
          .sort();
        expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir']);
      }
    });

    it('should list recursively', async () => {
      await writeFile(join(tmpDir, 'root.txt'), 'root', 'utf-8');
      await mkdir(join(tmpDir, 'sub'));
      await writeFile(join(tmpDir, 'sub', 'nested.txt'), 'nested', 'utf-8');

      const ctx = createMockContext();
      const result = await handler(ctx, { path: tmpDir, recursive: true });

      expect(isFsListResult(result)).toBe(true);
      if (isFsListResult(result)) {
        expect(result.recursive).toBe(true);
        expect(result.count).toBe(3); // root.txt, sub/, sub/nested.txt

        const paths = result.entries
          .filter(isFsListEntry)
          .map(e => e.path)
          .sort();
        expect(paths).toContain('root.txt');
        expect(paths).toContain('sub');
        expect(paths).toContain(join('sub', 'nested.txt'));
      }
    });

    it('should list empty directory', async () => {
      const emptyDir = join(tmpDir, 'empty');
      await mkdir(emptyDir);

      const ctx = createMockContext();
      const result = await handler(ctx, { path: emptyDir });

      expect(isFsListResult(result)).toBe(true);
      if (isFsListResult(result)) {
        expect(result.count).toBe(0);
        expect(result.entries).toEqual([]);
      }
    });

    it('should throw for non-directory path', async () => {
      const filePath = join(tmpDir, 'file.txt');
      await writeFile(filePath, 'content', 'utf-8');

      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: filePath })
      ).rejects.toThrow('디렉토리가 아닙니다');
    });

    it('should throw for non-existent path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: join(tmpDir, 'nonexistent') })
      ).rejects.toThrow();
    });

    it('should throw for empty path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: '' })
      ).rejects.toThrow('path는 비어있지 않은 문자열이어야 합니다.');
    });
  });

  // ===========================================================================
  // fs.exists
  // ===========================================================================

  describe('fs.exists', () => {
    const handler = handlers['fs.exists'];

    it('should be defined', () => {
      expect(handler).toBeDefined();
    });

    it('should return true for existing file', async () => {
      const filePath = join(tmpDir, 'exists.txt');
      await writeFile(filePath, 'content', 'utf-8');

      const ctx = createMockContext();
      const result = await handler(ctx, { path: filePath });

      expect(isFsExistsResult(result)).toBe(true);
      if (isFsExistsResult(result)) {
        expect(result.exists).toBe(true);
        expect(result.type).toBe('file');
        expect(result.success).toBe(true);
      }
    });

    it('should return true for existing directory', async () => {
      const dirPath = join(tmpDir, 'existsdir');
      await mkdir(dirPath);

      const ctx = createMockContext();
      const result = await handler(ctx, { path: dirPath });

      expect(isFsExistsResult(result)).toBe(true);
      if (isFsExistsResult(result)) {
        expect(result.exists).toBe(true);
        expect(result.type).toBe('directory');
      }
    });

    it('should return false for non-existent path', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { path: join(tmpDir, 'nope.txt') });

      expect(isFsExistsResult(result)).toBe(true);
      if (isFsExistsResult(result)) {
        expect(result.exists).toBe(false);
        expect(result.type).toBeNull();
      }
    });

    it('should throw for empty path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: '' })
      ).rejects.toThrow('path는 비어있지 않은 문자열이어야 합니다.');
    });

    it('should throw for non-string path', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { path: 42 })
      ).rejects.toThrow('path는 비어있지 않은 문자열이어야 합니다.');
    });
  });
});
