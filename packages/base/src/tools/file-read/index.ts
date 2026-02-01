import fs from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, ToolHandler } from '@goondan/core';

interface FileReadInput {
  path: string;
  encoding?: BufferEncoding;
  maxBytes?: number;
}

export const handlers: Record<string, ToolHandler> = {
  'file.read': async (_ctx, input) => {
    const payload = input as Partial<FileReadInput>;
    const target = String(payload.path || '');
    if (!target) {
      throw new Error('path가 필요합니다.');
    }

    const encoding = payload.encoding || 'utf8';
    const maxBytes = payload.maxBytes ?? 100_000;
    const resolved = path.isAbsolute(target) ? target : path.join(process.cwd(), target);

    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new Error('파일만 읽을 수 있습니다.');
    }

    const content = await fs.readFile(resolved, encoding);
    const truncated = content.length > maxBytes;
    const output = truncated ? content.slice(0, maxBytes) : content;

    const result: JsonObject = {
      path: resolved,
      size: stat.size,
      truncated,
      content: output,
    };

    return result;
  },
};
