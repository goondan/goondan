/**
 * ExtensionHandler Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.9 ExtensionHandler
 */
import { describe, it, expect } from 'vitest';
import type {
  ExtensionHandlerSpec,
  ExtensionHandlerExport,
  ExtensionHandlerResource,
} from '../../../src/types/specs/extension-handler.js';

describe('ExtensionHandlerSpec 타입', () => {
  describe('ExtensionHandlerSpec 인터페이스', () => {
    it('runtime, entry, exports는 필수이다', () => {
      const spec: ExtensionHandlerSpec = {
        runtime: 'node',
        entry: './extensions/retrieval/handler.js',
        exports: ['validate', 'default', 'materialize'],
      };

      expect(spec.runtime).toBe('node');
      expect(spec.entry).toBe('./extensions/retrieval/handler.js');
      expect(spec.exports.length).toBe(3);
    });

    it('runtime은 node, python, deno 중 하나이다', () => {
      const nodeSpec: ExtensionHandlerSpec = {
        runtime: 'node',
        entry: './handler.js',
        exports: ['validate'],
      };
      const pythonSpec: ExtensionHandlerSpec = {
        runtime: 'python',
        entry: './handler.py',
        exports: ['validate'],
      };
      const denoSpec: ExtensionHandlerSpec = {
        runtime: 'deno',
        entry: './handler.ts',
        exports: ['validate'],
      };

      expect(nodeSpec.runtime).toBe('node');
      expect(pythonSpec.runtime).toBe('python');
      expect(denoSpec.runtime).toBe('deno');
    });
  });

  describe('ExtensionHandlerExport', () => {
    it('validate, default, materialize 중 하나 이상이어야 한다', () => {
      const exports1: ExtensionHandlerExport[] = ['validate'];
      const exports2: ExtensionHandlerExport[] = ['validate', 'default'];
      const exports3: ExtensionHandlerExport[] = ['validate', 'default', 'materialize'];

      expect(exports1.length).toBe(1);
      expect(exports2.length).toBe(2);
      expect(exports3.length).toBe(3);
    });

    it('모든 export 타입을 지원해야 한다', () => {
      const allExports: ExtensionHandlerExport[] = ['validate', 'default', 'materialize'];

      expect(allExports).toContain('validate');
      expect(allExports).toContain('default');
      expect(allExports).toContain('materialize');
    });
  });

  describe('ExtensionHandlerResource 타입', () => {
    it('완전한 ExtensionHandler 리소스를 정의할 수 있다', () => {
      const resource: ExtensionHandlerResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'ExtensionHandler',
        metadata: {
          name: 'retrieval-handler',
        },
        spec: {
          runtime: 'node',
          entry: './extensions/retrieval/handler.js',
          exports: ['validate', 'default', 'materialize'],
        },
      };

      expect(resource.kind).toBe('ExtensionHandler');
      expect(resource.spec.runtime).toBe('node');
      expect(resource.spec.exports.length).toBe(3);
    });

    it('validate만 export하는 Handler를 정의할 수 있다', () => {
      const resource: ExtensionHandlerResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'ExtensionHandler',
        metadata: {
          name: 'simple-handler',
        },
        spec: {
          runtime: 'node',
          entry: './extensions/simple/handler.js',
          exports: ['validate'],
        },
      };

      expect(resource.spec.exports).toEqual(['validate']);
    });

    it('Python runtime Handler를 정의할 수 있다', () => {
      const resource: ExtensionHandlerResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'ExtensionHandler',
        metadata: {
          name: 'python-handler',
        },
        spec: {
          runtime: 'python',
          entry: './extensions/ml/handler.py',
          exports: ['validate', 'materialize'],
        },
      };

      expect(resource.spec.runtime).toBe('python');
      expect(resource.spec.entry).toBe('./extensions/ml/handler.py');
    });
  });
});
