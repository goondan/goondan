/**
 * Bundle Package 에러 타입 테스트
 * @see /docs/specs/bundle_package.md
 */

import { describe, it, expect } from 'vitest';
import {
  PackageError,
  PackageRefParseError,
  PackageFetchError,
  PackageIntegrityError,
  PackageNotFoundError,
  DependencyResolutionError,
  isPackageError,
} from '../../../src/bundle/package/errors.js';

describe('Bundle Package Errors', () => {
  describe('PackageError', () => {
    it('기본 PackageError를 생성할 수 있어야 한다', () => {
      const error = new PackageError('test error');

      expect(error).toBeInstanceOf(PackageError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('test error');
      expect(error.name).toBe('PackageError');
    });

    it('원인(cause)을 포함할 수 있어야 한다', () => {
      const cause = new Error('original error');
      const error = new PackageError('wrapper error', { cause });

      expect(error.cause).toBe(cause);
    });
  });

  describe('PackageRefParseError', () => {
    it('파싱 오류를 생성할 수 있어야 한다', () => {
      const error = new PackageRefParseError('Invalid package ref', {
        input: 'invalid:::ref',
      });

      expect(error).toBeInstanceOf(PackageRefParseError);
      expect(error).toBeInstanceOf(PackageError);
      expect(error.input).toBe('invalid:::ref');
    });

    it('예상 형식을 포함할 수 있어야 한다', () => {
      const error = new PackageRefParseError('Invalid format', {
        input: 'bad-input',
        expectedFormat: '@scope/name@version',
      });

      expect(error.expectedFormat).toBe('@scope/name@version');
    });
  });

  describe('PackageFetchError', () => {
    it('fetch 오류를 생성할 수 있어야 한다', () => {
      const error = new PackageFetchError('Failed to fetch package', {
        packageRef: '@goondan/base@1.0.0',
        url: 'https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz',
      });

      expect(error).toBeInstanceOf(PackageFetchError);
      expect(error.packageRef).toBe('@goondan/base@1.0.0');
      expect(error.url).toBe('https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz');
    });

    it('HTTP 상태 코드를 포함할 수 있어야 한다', () => {
      const error = new PackageFetchError('HTTP error', {
        packageRef: '@goondan/base@1.0.0',
        url: 'https://registry.goondan.io/@goondan/base',
        statusCode: 404,
      });

      expect(error.statusCode).toBe(404);
    });
  });

  describe('PackageIntegrityError', () => {
    it('무결성 오류를 생성할 수 있어야 한다', () => {
      const error = new PackageIntegrityError('Integrity check failed', {
        packageRef: '@goondan/base@1.0.0',
        expected: 'sha512-AAAA...',
        actual: 'sha512-BBBB...',
      });

      expect(error).toBeInstanceOf(PackageIntegrityError);
      expect(error.packageRef).toBe('@goondan/base@1.0.0');
      expect(error.expected).toBe('sha512-AAAA...');
      expect(error.actual).toBe('sha512-BBBB...');
    });
  });

  describe('PackageNotFoundError', () => {
    it('패키지 없음 오류를 생성할 수 있어야 한다', () => {
      const error = new PackageNotFoundError('Package not found', {
        packageRef: '@goondan/unknown@1.0.0',
        registry: 'https://registry.goondan.io',
      });

      expect(error).toBeInstanceOf(PackageNotFoundError);
      expect(error.packageRef).toBe('@goondan/unknown@1.0.0');
      expect(error.registry).toBe('https://registry.goondan.io');
    });

    it('검색한 버전들을 포함할 수 있어야 한다', () => {
      const error = new PackageNotFoundError('Version not found', {
        packageRef: '@goondan/base@999.0.0',
        availableVersions: ['1.0.0', '1.1.0', '2.0.0'],
      });

      expect(error.availableVersions).toEqual(['1.0.0', '1.1.0', '2.0.0']);
    });
  });

  describe('DependencyResolutionError', () => {
    it('의존성 해석 오류를 생성할 수 있어야 한다', () => {
      const error = new DependencyResolutionError('Circular dependency detected', {
        packageRef: '@goondan/a@1.0.0',
        dependencyChain: ['@goondan/a@1.0.0', '@goondan/b@1.0.0', '@goondan/a@1.0.0'],
      });

      expect(error).toBeInstanceOf(DependencyResolutionError);
      expect(error.packageRef).toBe('@goondan/a@1.0.0');
      expect(error.dependencyChain).toHaveLength(3);
    });

    it('충돌하는 버전들을 포함할 수 있어야 한다', () => {
      const error = new DependencyResolutionError('Version conflict', {
        packageRef: '@goondan/utils',
        conflictingVersions: ['1.0.0', '2.0.0'],
      });

      expect(error.conflictingVersions).toEqual(['1.0.0', '2.0.0']);
    });
  });

  describe('isPackageError', () => {
    it('PackageError 인스턴스를 확인할 수 있어야 한다', () => {
      const packageError = new PackageError('test');
      const parseError = new PackageRefParseError('test', { input: 'x' });
      const normalError = new Error('test');

      expect(isPackageError(packageError)).toBe(true);
      expect(isPackageError(parseError)).toBe(true);
      expect(isPackageError(normalError)).toBe(false);
      expect(isPackageError(null)).toBe(false);
      expect(isPackageError('string')).toBe(false);
    });
  });
});
