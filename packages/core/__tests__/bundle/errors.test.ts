/**
 * Bundle Error 테스트
 * @see /docs/specs/bundle.md
 */

import { describe, it, expect } from 'vitest';
import {
  BundleError,
  ParseError,
  ValidationError,
  ReferenceError,
  isBundleError,
} from '../../src/bundle/errors.js';

describe('Bundle Errors', () => {
  describe('BundleError', () => {
    it('기본 BundleError를 생성할 수 있어야 한다', () => {
      const error = new BundleError('test error');
      expect(error).toBeInstanceOf(BundleError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('test error');
      expect(error.name).toBe('BundleError');
    });

    it('원인(cause)을 포함할 수 있어야 한다', () => {
      const cause = new Error('original error');
      const error = new BundleError('wrapper error', { cause });
      expect(error.errorCause).toBe(cause);
    });
  });

  describe('ParseError', () => {
    it('YAML 파싱 오류를 생성할 수 있어야 한다', () => {
      const error = new ParseError('Invalid YAML syntax', {
        source: 'test.yaml',
        line: 5,
        column: 10,
      });
      expect(error).toBeInstanceOf(ParseError);
      expect(error).toBeInstanceOf(BundleError);
      expect(error.source).toBe('test.yaml');
      expect(error.line).toBe(5);
      expect(error.column).toBe(10);
    });

    it('문서 인덱스를 포함할 수 있어야 한다', () => {
      const error = new ParseError('Invalid document', {
        source: 'test.yaml',
        documentIndex: 2,
      });
      expect(error.documentIndex).toBe(2);
    });
  });

  describe('ValidationError', () => {
    it('검증 오류를 생성할 수 있어야 한다', () => {
      const error = new ValidationError('Invalid field', {
        path: '/spec/runtime',
        kind: 'Tool',
        resourceName: 'myTool',
      });
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.path).toBe('/spec/runtime');
      expect(error.kind).toBe('Tool');
      expect(error.resourceName).toBe('myTool');
    });

    it('예상 값과 실제 값을 포함할 수 있어야 한다', () => {
      const error = new ValidationError('Type mismatch', {
        path: '/spec/runtime',
        expected: 'node | python | deno',
        actual: 'ruby',
      });
      expect(error.expected).toBe('node | python | deno');
      expect(error.actual).toBe('ruby');
    });
  });

  describe('ReferenceError', () => {
    it('참조 오류를 생성할 수 있어야 한다', () => {
      const error = new ReferenceError('Resource not found', {
        sourceKind: 'Agent',
        sourceName: 'planner',
        targetKind: 'Model',
        targetName: 'gpt-5',
      });
      expect(error).toBeInstanceOf(ReferenceError);
      expect(error.sourceKind).toBe('Agent');
      expect(error.sourceName).toBe('planner');
      expect(error.targetKind).toBe('Model');
      expect(error.targetName).toBe('gpt-5');
    });
  });

  describe('isBundleError', () => {
    it('BundleError 인스턴스를 확인할 수 있어야 한다', () => {
      const bundleError = new BundleError('test');
      const parseError = new ParseError('test', { source: 'test.yaml' });
      const normalError = new Error('test');

      expect(isBundleError(bundleError)).toBe(true);
      expect(isBundleError(parseError)).toBe(true);
      expect(isBundleError(normalError)).toBe(false);
      expect(isBundleError(null)).toBe(false);
      expect(isBundleError('string')).toBe(false);
    });
  });
});
