/**
 * 패키지 참조 파싱
 * @see /docs/specs/bundle_package.md - 3. Bundle Package Ref 형식
 */

import type { PackageRef, PackageRefLike } from './types.js';
import { PackageRefParseError } from './errors.js';

/**
 * 패키지 참조 문자열을 PackageRef로 파싱
 *
 * 지원 형식:
 * - 레지스트리: @scope/name@version, name@version
 * - Git: git+https://..., git+ssh://..., github:owner/repo
 * - 로컬: file:..., link:...
 */
export function parsePackageRef(input: string): PackageRef {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new PackageRefParseError('Package ref cannot be empty', {
      input,
      expectedFormat: '@scope/name@version | git+https://... | file:...',
    });
  }

  // Git 참조 확인
  if (isGitRef(trimmed)) {
    return parseGitRef(trimmed);
  }

  // 로컬 참조 확인
  if (isLocalRef(trimmed)) {
    return parseLocalRef(trimmed);
  }

  // 레지스트리 참조로 처리
  if (isRegistryRef(trimmed)) {
    return parseRegistryRef(trimmed);
  }

  throw new PackageRefParseError(`Invalid package ref format: ${input}`, {
    input,
    expectedFormat: '@scope/name@version | git+https://... | file:...',
  });
}

/**
 * Git 참조인지 확인
 */
export function isGitRef(input: string): boolean {
  return (
    input.startsWith('git+https://') ||
    input.startsWith('git+ssh://') ||
    input.startsWith('git+http://') ||
    input.startsWith('github:') ||
    input.startsWith('gitlab:') ||
    input.startsWith('bitbucket:')
  );
}

/**
 * 로컬 참조인지 확인
 */
export function isLocalRef(input: string): boolean {
  return input.startsWith('file:') || input.startsWith('link:');
}

/**
 * 레지스트리 참조인지 확인
 */
export function isRegistryRef(input: string): boolean {
  // git이나 local이 아니면 레지스트리로 간주
  // @scope/name 또는 name@version 형태
  if (isGitRef(input) || isLocalRef(input)) {
    return false;
  }

  // 유효한 패키지 이름 패턴 확인
  // @scope/name, @scope/name@version, name, name@version
  // semver 범위 문자(^, ~, >, <, =)도 버전에 허용
  const registryPattern = /^(@[\w-]+\/)?[\w.-]+(@[\^~><=]*[\w.-]+)?$/;
  return registryPattern.test(input);
}

/**
 * Git 참조 파싱
 */
function parseGitRef(input: string): PackageRef {
  let url: string;
  let ref: string | undefined;

  // github: 축약 형식 처리
  if (input.startsWith('github:')) {
    const rest = input.slice('github:'.length);
    const hashIndex = rest.indexOf('#');

    if (hashIndex === -1) {
      url = `https://github.com/${rest}.git`;
    } else {
      const path = rest.slice(0, hashIndex);
      ref = rest.slice(hashIndex + 1);
      url = `https://github.com/${path}.git`;
    }

    return { type: 'git', url, ref };
  }

  // gitlab: 축약 형식 처리
  if (input.startsWith('gitlab:')) {
    const rest = input.slice('gitlab:'.length);
    const hashIndex = rest.indexOf('#');

    if (hashIndex === -1) {
      url = `https://gitlab.com/${rest}.git`;
    } else {
      const path = rest.slice(0, hashIndex);
      ref = rest.slice(hashIndex + 1);
      url = `https://gitlab.com/${path}.git`;
    }

    return { type: 'git', url, ref };
  }

  // bitbucket: 축약 형식 처리
  if (input.startsWith('bitbucket:')) {
    const rest = input.slice('bitbucket:'.length);
    const hashIndex = rest.indexOf('#');

    if (hashIndex === -1) {
      url = `https://bitbucket.org/${rest}.git`;
    } else {
      const path = rest.slice(0, hashIndex);
      ref = rest.slice(hashIndex + 1);
      url = `https://bitbucket.org/${path}.git`;
    }

    return { type: 'git', url, ref };
  }

  // git+protocol:// 형식 처리
  const withoutPrefix = input.replace(/^git\+/, '');
  const hashIndex = withoutPrefix.indexOf('#');

  if (hashIndex === -1) {
    url = withoutPrefix;
  } else {
    url = withoutPrefix.slice(0, hashIndex);
    ref = withoutPrefix.slice(hashIndex + 1);
  }

  return { type: 'git', url, ref };
}

/**
 * 로컬 참조 파싱
 */
function parseLocalRef(input: string): PackageRef {
  // file: 또는 link: 접두사 제거
  const url = input.replace(/^(file:|link:)/, '');

  return { type: 'local', url };
}

/**
 * 레지스트리 참조 파싱
 */
function parseRegistryRef(input: string): PackageRef {
  const scope = parseScope(input);
  const version = parseVersion(input);

  let name: string;

  if (scope) {
    // @scope/name 또는 @scope/name@version
    const withoutScope = input.slice(scope.length + 1); // scope 뒤의 '/' 포함
    const atIndex = withoutScope.lastIndexOf('@');

    if (atIndex > 0) {
      name = withoutScope.slice(0, atIndex);
    } else {
      name = withoutScope;
    }
  } else {
    // name 또는 name@version
    const atIndex = input.lastIndexOf('@');

    if (atIndex > 0) {
      name = input.slice(0, atIndex);
    } else {
      name = input;
    }
  }

  return {
    type: 'registry',
    url: 'https://goondan-registry.yechanny.workers.dev', // 기본 레지스트리
    scope,
    name,
    version: version ?? 'latest',
  };
}

/**
 * scope 추출 (@org)
 */
export function parseScope(input: string): string | undefined {
  if (!input.startsWith('@')) {
    return undefined;
  }

  const slashIndex = input.indexOf('/');
  if (slashIndex === -1) {
    return undefined;
  }

  return input.slice(0, slashIndex);
}

/**
 * 버전 추출 (@version)
 */
export function parseVersion(input: string): string | undefined {
  // scope가 있는 경우와 없는 경우를 구분
  const scope = parseScope(input);
  const rest = scope ? input.slice(scope.length + 1) : input;

  const atIndex = rest.lastIndexOf('@');
  if (atIndex <= 0) {
    return undefined;
  }

  return rest.slice(atIndex + 1);
}

/**
 * PackageRef를 문자열로 포맷
 */
export function formatPackageRef(ref: PackageRef): string {
  switch (ref.type) {
    case 'registry': {
      const scopePart = ref.scope ? `${ref.scope}/` : '';
      const versionPart = ref.version ? `@${ref.version}` : '';
      return `${scopePart}${ref.name ?? ''}${versionPart}`;
    }

    case 'git': {
      const refPart = ref.ref ? `#${ref.ref}` : '';
      return `git+${ref.url}${refPart}`;
    }

    case 'local': {
      return `file:${ref.url}`;
    }

    default:
      throw new PackageRefParseError(`Unknown ref type: ${ref.type}`, {
        input: JSON.stringify(ref),
      });
  }
}

/**
 * PackageRefLike를 PackageRef로 정규화
 */
export function normalizePackageRef(ref: PackageRefLike): PackageRef {
  if (typeof ref === 'string') {
    return parsePackageRef(ref);
  }
  return ref;
}
