/**
 * 패키지 참조 파싱 테스트
 * @see /docs/specs/bundle_package.md - 3. Bundle Package Ref 형식
 */

import { describe, it, expect } from 'vitest';
import {
  parsePackageRef,
  formatPackageRef,
  normalizePackageRef,
  isGitRef,
  isLocalRef,
  isRegistryRef,
  parseScope,
  parseVersion,
} from '../../../src/bundle/package/ref-parser.js';
import type { PackageRef } from '../../../src/bundle/package/types.js';
import { PackageRefParseError } from '../../../src/bundle/package/errors.js';

describe('Package Ref Parser', () => {
  describe('parsePackageRef', () => {
    describe('레지스트리 참조 파싱', () => {
      it('scope/name@version 형식을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('@goondan/base@1.0.0');

        expect(ref.type).toBe('registry');
        expect(ref.scope).toBe('@goondan');
        expect(ref.name).toBe('base');
        expect(ref.version).toBe('1.0.0');
      });

      it('scope/name 형식은 @latest로 취급해야 한다', () => {
        const ref = parsePackageRef('@goondan/base');

        expect(ref.type).toBe('registry');
        expect(ref.scope).toBe('@goondan');
        expect(ref.name).toBe('base');
        expect(ref.version).toBe('latest');
      });

      it('scope 없는 name@version 형식을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('simple-package@2.1.0');

        expect(ref.type).toBe('registry');
        expect(ref.scope).toBeUndefined();
        expect(ref.name).toBe('simple-package');
        expect(ref.version).toBe('2.1.0');
      });

      it('beta 버전을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('@myorg/custom-tools@2.1.0-beta.1');

        expect(ref.version).toBe('2.1.0-beta.1');
      });

      it('dist-tag를 버전으로 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('@goondan/base@latest');
        expect(ref.version).toBe('latest');

        const betaRef = parsePackageRef('@goondan/base@beta');
        expect(betaRef.version).toBe('beta');
      });

      it('semver 범위를 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('@goondan/core-utils@^0.5.0');
        expect(ref.version).toBe('^0.5.0');
      });
    });

    describe('Git 참조 파싱', () => {
      it('git+https:// 형식을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('git+https://github.com/goondan/slack-tools.git#v1.0.0');

        expect(ref.type).toBe('git');
        expect(ref.url).toBe('https://github.com/goondan/slack-tools.git');
        expect(ref.ref).toBe('v1.0.0');
      });

      it('git+ssh:// 형식을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('git+ssh://git@github.com/company/tools.git#main');

        expect(ref.type).toBe('git');
        expect(ref.url).toBe('ssh://git@github.com/company/tools.git');
        expect(ref.ref).toBe('main');
      });

      it('ref가 없는 git URL을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('git+https://github.com/goondan/tools.git');

        expect(ref.type).toBe('git');
        expect(ref.ref).toBeUndefined();
      });

      it('commit hash를 ref로 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('git+https://github.com/goondan/tools.git#abc1234');

        expect(ref.ref).toBe('abc1234');
      });

      it('github: 축약 형식을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('github:goondan/slack-tools#v1.0.0');

        expect(ref.type).toBe('git');
        expect(ref.url).toBe('https://github.com/goondan/slack-tools.git');
        expect(ref.ref).toBe('v1.0.0');
      });
    });

    describe('로컬 참조 파싱', () => {
      it('file: 프로토콜을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('file:../shared-extensions');

        expect(ref.type).toBe('local');
        expect(ref.url).toBe('../shared-extensions');
      });

      it('file: 절대 경로를 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('file:/Users/dev/packages/my-tools');

        expect(ref.type).toBe('local');
        expect(ref.url).toBe('/Users/dev/packages/my-tools');
      });

      it('link: 프로토콜을 파싱할 수 있어야 한다', () => {
        const ref = parsePackageRef('link:../linked-package');

        expect(ref.type).toBe('local');
        expect(ref.url).toBe('../linked-package');
      });
    });

    describe('에러 케이스', () => {
      it('빈 문자열에 대해 에러를 던져야 한다', () => {
        expect(() => parsePackageRef('')).toThrow(PackageRefParseError);
      });

      it('잘못된 형식에 대해 에러를 던져야 한다', () => {
        expect(() => parsePackageRef(':::invalid')).toThrow(PackageRefParseError);
      });

      it('에러 메시지에 원본 문자열을 포함해야 한다', () => {
        try {
          parsePackageRef('');
          expect.fail('에러가 발생해야 합니다');
        } catch (error) {
          expect(error).toBeInstanceOf(PackageRefParseError);
          if (error instanceof PackageRefParseError) {
            expect(error.input).toBe('');
          }
        }
      });
    });
  });

  describe('formatPackageRef', () => {
    it('레지스트리 참조를 문자열로 포맷해야 한다', () => {
      const ref: PackageRef = {
        type: 'registry',
        url: 'https://registry.goondan.io',
        scope: '@goondan',
        name: 'base',
        version: '1.0.0',
      };

      expect(formatPackageRef(ref)).toBe('@goondan/base@1.0.0');
    });

    it('scope 없는 레지스트리 참조를 포맷해야 한다', () => {
      const ref: PackageRef = {
        type: 'registry',
        url: 'https://registry.goondan.io',
        name: 'simple-package',
        version: '1.0.0',
      };

      expect(formatPackageRef(ref)).toBe('simple-package@1.0.0');
    });

    it('git 참조를 문자열로 포맷해야 한다', () => {
      const ref: PackageRef = {
        type: 'git',
        url: 'https://github.com/goondan/tools.git',
        ref: 'v1.0.0',
      };

      expect(formatPackageRef(ref)).toBe('git+https://github.com/goondan/tools.git#v1.0.0');
    });

    it('ref 없는 git 참조를 포맷해야 한다', () => {
      const ref: PackageRef = {
        type: 'git',
        url: 'https://github.com/goondan/tools.git',
      };

      expect(formatPackageRef(ref)).toBe('git+https://github.com/goondan/tools.git');
    });

    it('로컬 참조를 문자열로 포맷해야 한다', () => {
      const ref: PackageRef = {
        type: 'local',
        url: '../shared-extensions',
      };

      expect(formatPackageRef(ref)).toBe('file:../shared-extensions');
    });
  });

  describe('normalizePackageRef', () => {
    it('문자열을 PackageRef로 정규화해야 한다', () => {
      const ref = normalizePackageRef('@goondan/base@1.0.0');

      expect(ref.type).toBe('registry');
    });

    it('이미 PackageRef인 경우 그대로 반환해야 한다', () => {
      const original: PackageRef = {
        type: 'git',
        url: 'https://github.com/test/repo.git',
      };

      const ref = normalizePackageRef(original);

      expect(ref).toBe(original);
    });
  });

  describe('타입 판별 함수', () => {
    describe('isGitRef', () => {
      it('git+https로 시작하면 true를 반환해야 한다', () => {
        expect(isGitRef('git+https://github.com/test/repo.git')).toBe(true);
      });

      it('git+ssh로 시작하면 true를 반환해야 한다', () => {
        expect(isGitRef('git+ssh://git@github.com/test/repo.git')).toBe(true);
      });

      it('github:로 시작하면 true를 반환해야 한다', () => {
        expect(isGitRef('github:user/repo')).toBe(true);
      });

      it('일반 문자열에 대해 false를 반환해야 한다', () => {
        expect(isGitRef('@goondan/base@1.0.0')).toBe(false);
      });
    });

    describe('isLocalRef', () => {
      it('file:로 시작하면 true를 반환해야 한다', () => {
        expect(isLocalRef('file:../path')).toBe(true);
      });

      it('link:로 시작하면 true를 반환해야 한다', () => {
        expect(isLocalRef('link:../path')).toBe(true);
      });

      it('일반 문자열에 대해 false를 반환해야 한다', () => {
        expect(isLocalRef('@goondan/base')).toBe(false);
      });
    });

    describe('isRegistryRef', () => {
      it('@scope/name 형식이면 true를 반환해야 한다', () => {
        expect(isRegistryRef('@goondan/base')).toBe(true);
      });

      it('name@version 형식이면 true를 반환해야 한다', () => {
        expect(isRegistryRef('package@1.0.0')).toBe(true);
      });

      it('git 또는 로컬 참조에 대해 false를 반환해야 한다', () => {
        expect(isRegistryRef('git+https://github.com/test.git')).toBe(false);
        expect(isRegistryRef('file:../path')).toBe(false);
      });
    });
  });

  describe('헬퍼 함수', () => {
    describe('parseScope', () => {
      it('@로 시작하는 scope를 추출해야 한다', () => {
        expect(parseScope('@goondan/base')).toBe('@goondan');
      });

      it('scope가 없으면 undefined를 반환해야 한다', () => {
        expect(parseScope('simple-package')).toBeUndefined();
      });
    });

    describe('parseVersion', () => {
      it('@version을 추출해야 한다', () => {
        expect(parseVersion('package@1.0.0')).toBe('1.0.0');
        expect(parseVersion('@goondan/base@1.0.0')).toBe('1.0.0');
      });

      it('버전이 없으면 undefined를 반환해야 한다', () => {
        expect(parseVersion('@goondan/base')).toBeUndefined();
      });
    });
  });
});
