/**
 * File Read Tool - 파일 읽기
 */

import * as fs from 'node:fs/promises';
import type { ToolHandler, ToolContext, JsonValue, JsonObject } from '@goondan/core';

export const handlers: Record<string, ToolHandler> = {
  'file.read': async (ctx: ToolContext, input: JsonObject): Promise<JsonValue> => {
    const filePath = input['path'];

    if (typeof filePath !== 'string') {
      throw new Error('path는 문자열이어야 합니다.');
    }

    ctx.logger?.debug?.(`[file.read] Reading: ${filePath}`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return {
        success: true,
        path: filePath,
        content,
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
