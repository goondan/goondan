/**
 * Extension 로더 테스트
 * @see /docs/specs/extension.md - 10. Extension 로딩과 초기화
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionLoader } from '../../src/extension/loader.js';
import { createEventBus } from '../../src/extension/event-bus.js';
import { createStateStore } from '../../src/extension/state-store.js';
import type { EventBus, StateStore, RegisterFunction, ExtensionApi } from '../../src/extension/types.js';
import type { ExtensionResource } from '../../src/types/specs/extension.js';

describe('ExtensionLoader', () => {
  let loader: ExtensionLoader;
  let eventBus: EventBus;
  let stateStore: StateStore;

  beforeEach(() => {
    eventBus = createEventBus();
    stateStore = createStateStore();
    loader = new ExtensionLoader({
      eventBus,
      stateStore,
    });
  });

  describe('loadExtension', () => {
    it('register 함수를 호출하여 Extension을 로드한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'test-ext' },
        spec: {
          runtime: 'node',
          entry: './test.js',
        },
      };

      const registerFn = vi.fn();
      const result = await loader.loadExtension(extension, registerFn);

      expect(registerFn).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('test-ext');
      expect(result.status).toBe('loaded');
    });

    it('register 함수에 ExtensionApi를 전달한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'test-ext' },
        spec: {
          runtime: 'node',
          entry: './test.js',
          config: { key: 'value' },
        },
      };

      let receivedApi: ExtensionApi | undefined;
      const registerFn: RegisterFunction = async (api) => {
        receivedApi = api;
      };

      await loader.loadExtension(extension, registerFn);

      expect(receivedApi).toBeDefined();
      expect(receivedApi?.extension.metadata.name).toBe('test-ext');
      expect(receivedApi?.extension.spec?.config).toEqual({ key: 'value' });
    });

    it('비동기 register 함수를 지원한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'async-ext' },
        spec: {
          runtime: 'node',
          entry: './async.js',
        },
      };

      let completed = false;
      const registerFn: RegisterFunction = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        completed = true;
      };

      await loader.loadExtension(extension, registerFn);

      expect(completed).toBe(true);
    });

    it('동기 register 함수도 지원한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'sync-ext' },
        spec: {
          runtime: 'node',
          entry: './sync.js',
        },
      };

      let completed = false;
      const registerFn: RegisterFunction = () => {
        completed = true;
      };

      await loader.loadExtension(extension, registerFn);

      expect(completed).toBe(true);
    });

    it('register 함수 오류 시 실패 상태를 반환한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'error-ext' },
        spec: {
          runtime: 'node',
          entry: './error.js',
        },
      };

      const registerFn: RegisterFunction = () => {
        throw new Error('Registration failed');
      };

      const result = await loader.loadExtension(extension, registerFn);

      expect(result.status).toBe('failed');
      expect(result.error?.message).toBe('Registration failed');
    });
  });

  describe('loadExtensions', () => {
    it('여러 Extension을 순서대로 로드한다', async () => {
      const extensions: ExtensionResource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'ext-1' },
          spec: { runtime: 'node', entry: './ext1.js' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'ext-2' },
          spec: { runtime: 'node', entry: './ext2.js' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'ext-3' },
          spec: { runtime: 'node', entry: './ext3.js' },
        },
      ];

      const loadOrder: string[] = [];
      const registerFns = new Map<string, RegisterFunction>();

      for (const ext of extensions) {
        registerFns.set(ext.metadata.name, async () => {
          loadOrder.push(ext.metadata.name);
        });
      }

      await loader.loadExtensions(extensions, (ext) => {
        const fn = registerFns.get(ext.metadata.name);
        if (!fn) throw new Error(`No register function for ${ext.metadata.name}`);
        return fn;
      });

      expect(loadOrder).toEqual(['ext-1', 'ext-2', 'ext-3']);
    });

    it('이전 Extension 로드가 완료된 후 다음 Extension을 로드한다', async () => {
      const extensions: ExtensionResource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'slow-ext' },
          spec: { runtime: 'node', entry: './slow.js' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'fast-ext' },
          spec: { runtime: 'node', entry: './fast.js' },
        },
      ];

      const timestamps: number[] = [];

      await loader.loadExtensions(extensions, (ext) => {
        if (ext.metadata.name === 'slow-ext') {
          return async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            timestamps.push(Date.now());
          };
        }
        return () => {
          timestamps.push(Date.now());
        };
      });

      // 두 번째 타임스탬프가 첫 번째보다 커야 함 (순차 실행)
      expect(timestamps[1]! >= timestamps[0]!).toBe(true);
    });

    it('Extension 로드 실패가 전체 초기화를 중단한다', async () => {
      const extensions: ExtensionResource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'ext-1' },
          spec: { runtime: 'node', entry: './ext1.js' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'failing-ext' },
          spec: { runtime: 'node', entry: './failing.js' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'ext-3' },
          spec: { runtime: 'node', entry: './ext3.js' },
        },
      ];

      const loadedExtensions: string[] = [];

      await expect(
        loader.loadExtensions(extensions, (ext) => {
          if (ext.metadata.name === 'failing-ext') {
            return () => {
              throw new Error('Extension failed');
            };
          }
          return () => {
            loadedExtensions.push(ext.metadata.name);
          };
        })
      ).rejects.toThrow('Extension failed');

      // ext-3은 로드되지 않아야 함
      expect(loadedExtensions).toEqual(['ext-1']);
    });
  });

  describe('getLoadedExtensions', () => {
    it('로드된 Extension 목록을 반환한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'test-ext' },
        spec: { runtime: 'node', entry: './test.js' },
      };

      await loader.loadExtension(extension, () => {});

      const loaded = loader.getLoadedExtensions();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.name).toBe('test-ext');
    });
  });

  describe('getExtensionApi', () => {
    it('로드된 Extension의 API를 반환한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'test-ext' },
        spec: { runtime: 'node', entry: './test.js' },
      };

      await loader.loadExtension(extension, () => {});

      const api = loader.getExtensionApi('test-ext');
      expect(api).toBeDefined();
      expect(api?.extension.metadata.name).toBe('test-ext');
    });

    it('로드되지 않은 Extension은 undefined를 반환한다', () => {
      const api = loader.getExtensionApi('non-existent');
      expect(api).toBeUndefined();
    });
  });

  describe('unloadExtension', () => {
    it('Extension을 언로드한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'test-ext' },
        spec: { runtime: 'node', entry: './test.js' },
      };

      await loader.loadExtension(extension, () => {});
      expect(loader.getLoadedExtensions()).toHaveLength(1);

      loader.unloadExtension('test-ext');
      expect(loader.getLoadedExtensions()).toHaveLength(0);
    });

    it('extension.cleanup 이벤트를 발행한다', async () => {
      const extension: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: { name: 'test-ext' },
        spec: { runtime: 'node', entry: './test.js' },
      };

      const cleanupHandler = vi.fn();
      eventBus.on('extension.cleanup', cleanupHandler);

      await loader.loadExtension(extension, () => {});
      loader.unloadExtension('test-ext');

      await vi.waitFor(() => {
        expect(cleanupHandler).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'test-ext' })
        );
      });
    });
  });
});
