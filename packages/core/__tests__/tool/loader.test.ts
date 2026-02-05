/**
 * ToolLoader 테스트
 * @see /docs/specs/tool.md - 4.2 핸들러 모듈 형식
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolLoader } from '../../src/tool/loader.js';
import type { ToolHandler } from '../../src/tool/types.js';
import type { Resource } from '../../src/types/resource.js';
import type { ToolSpec } from '../../src/types/specs/tool.js';

describe('ToolLoader', () => {
  let loader: ToolLoader;

  beforeEach(() => {
    loader = new ToolLoader();
  });

  describe('loadHandlers()', () => {
    it('entry 파일에서 handlers 객체를 로드한다', async () => {
      // Mock dynamic import
      const mockHandlers: Record<string, ToolHandler> = {
        'calc.add': vi.fn(),
        'calc.multiply': vi.fn(),
      };

      const mockImport = vi.fn().mockResolvedValue({ handlers: mockHandlers });
      loader.setImportFunction(mockImport);

      const handlers = await loader.loadHandlers('./tools/calc/index.js', '/root');

      expect(mockImport).toHaveBeenCalledWith('/root/tools/calc/index.js');
      expect(handlers).toBe(mockHandlers);
    });

    it('handlers export가 없으면 에러를 던진다', async () => {
      const mockImport = vi.fn().mockResolvedValue({ default: {} });
      loader.setImportFunction(mockImport);

      await expect(
        loader.loadHandlers('./tools/invalid/index.js', '/root')
      ).rejects.toThrow('handlers');
    });

    it('handlers가 객체가 아니면 에러를 던진다', async () => {
      const mockImport = vi.fn().mockResolvedValue({ handlers: 'not an object' });
      loader.setImportFunction(mockImport);

      await expect(
        loader.loadHandlers('./tools/invalid/index.js', '/root')
      ).rejects.toThrow('object');
    });

    it('파일 로드 실패 시 에러를 던진다', async () => {
      const mockImport = vi.fn().mockRejectedValue(new Error('Module not found'));
      loader.setImportFunction(mockImport);

      await expect(
        loader.loadHandlers('./tools/missing/index.js', '/root')
      ).rejects.toThrow('Module not found');
    });
  });

  describe('loadFromToolResource()', () => {
    it('Tool 리소스에서 핸들러를 로드한다', async () => {
      const mockHandlers: Record<string, ToolHandler> = {
        'slack.postMessage': vi.fn(),
        'slack.listChannels': vi.fn(),
      };

      const mockImport = vi.fn().mockResolvedValue({ handlers: mockHandlers });
      loader.setImportFunction(mockImport);

      const toolResource: Resource<ToolSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'slackToolkit' },
        spec: {
          runtime: 'node',
          entry: './tools/slack/index.js',
          exports: [
            {
              name: 'slack.postMessage',
              description: 'Send message',
              parameters: { type: 'object' },
            },
            {
              name: 'slack.listChannels',
              description: 'List channels',
              parameters: { type: 'object' },
            },
          ],
        },
      };

      const handlers = await loader.loadFromToolResource(toolResource, '/bundle');

      expect(handlers['slack.postMessage']).toBeDefined();
      expect(handlers['slack.listChannels']).toBeDefined();
    });

    it('export에 대응하는 handler가 없으면 경고한다', async () => {
      const mockHandlers: Record<string, ToolHandler> = {
        'slack.postMessage': vi.fn(),
        // slack.listChannels handler 누락
      };

      const mockImport = vi.fn().mockResolvedValue({ handlers: mockHandlers });
      loader.setImportFunction(mockImport);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toolResource: Resource<ToolSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'slackToolkit' },
        spec: {
          runtime: 'node',
          entry: './tools/slack/index.js',
          exports: [
            {
              name: 'slack.postMessage',
              description: 'Send message',
              parameters: { type: 'object' },
            },
            {
              name: 'slack.listChannels',
              description: 'List channels',
              parameters: { type: 'object' },
            },
          ],
        },
      };

      const handlers = await loader.loadFromToolResource(toolResource, '/bundle');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('slack.listChannels')
      );
      expect(handlers['slack.listChannels']).toBeUndefined();

      warnSpy.mockRestore();
    });
  });

  describe('경로 처리', () => {
    it('상대 경로를 절대 경로로 변환한다', async () => {
      const mockImport = vi.fn().mockResolvedValue({ handlers: {} });
      loader.setImportFunction(mockImport);

      await loader.loadHandlers('./tools/index.js', '/bundle/root');

      expect(mockImport).toHaveBeenCalledWith('/bundle/root/tools/index.js');
    });

    it('./ 없이 시작하는 경로도 처리한다', async () => {
      const mockImport = vi.fn().mockResolvedValue({ handlers: {} });
      loader.setImportFunction(mockImport);

      await loader.loadHandlers('tools/index.js', '/bundle/root');

      expect(mockImport).toHaveBeenCalledWith('/bundle/root/tools/index.js');
    });

    it('절대 경로는 그대로 사용한다', async () => {
      const mockImport = vi.fn().mockResolvedValue({ handlers: {} });
      loader.setImportFunction(mockImport);

      await loader.loadHandlers('/absolute/path/index.js', '/bundle/root');

      expect(mockImport).toHaveBeenCalledWith('/absolute/path/index.js');
    });
  });

  describe('validateHandlers()', () => {
    it('모든 export에 대응하는 handler가 있으면 true를 반환한다', () => {
      const handlers: Record<string, ToolHandler> = {
        'calc.add': vi.fn(),
        'calc.multiply': vi.fn(),
      };

      const exports = [
        { name: 'calc.add', description: '', parameters: { type: 'object' as const } },
        { name: 'calc.multiply', description: '', parameters: { type: 'object' as const } },
      ];

      const result = loader.validateHandlers(handlers, exports);

      expect(result.valid).toBe(true);
      expect(result.missingHandlers).toEqual([]);
    });

    it('누락된 handler가 있으면 false와 목록을 반환한다', () => {
      const handlers: Record<string, ToolHandler> = {
        'calc.add': vi.fn(),
      };

      const exports = [
        { name: 'calc.add', description: '', parameters: { type: 'object' as const } },
        { name: 'calc.multiply', description: '', parameters: { type: 'object' as const } },
        { name: 'calc.divide', description: '', parameters: { type: 'object' as const } },
      ];

      const result = loader.validateHandlers(handlers, exports);

      expect(result.valid).toBe(false);
      expect(result.missingHandlers).toContain('calc.multiply');
      expect(result.missingHandlers).toContain('calc.divide');
    });
  });
});
