/**
 * File Write Tool - 파일 쓰기
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

export const handlers: Record<string, ToolHandler> = {
  'file.write': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const filePath = input['path'];
    const content = input['content'];

    if (typeof filePath !== 'string') {
      throw new Error('path는 문자열이어야 합니다.');
    }
    if (typeof content !== 'string') {
      throw new Error('content는 문자열이어야 합니다.');
    }

    ctx.logger?.debug?.(`[file.write] Writing: ${filePath}`);

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, 'utf-8');
      return {
        success: true,
        path: filePath,
        bytesWritten: content.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        path: filePath,
        error: message,
      };
    }
  },
};
