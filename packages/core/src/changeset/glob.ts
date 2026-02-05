/**
 * Glob 패턴 매칭
 * @see /docs/specs/changeset.md - 6.5 Glob 매칭 규칙
 */

import { minimatch } from 'minimatch';

/**
 * 파일 경로가 glob 패턴과 매칭되는지 확인한다.
 * @param filePath - 검사할 파일 경로
 * @param pattern - glob 패턴
 * @returns 매칭 여부
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  return minimatch(filePath, pattern, {
    dot: true,        // .으로 시작하는 파일도 매칭
    matchBase: false, // 전체 경로 매칭
  });
}

/**
 * 파일 경로가 여러 패턴 중 하나라도 매칭되는지 확인한다.
 * @param filePath - 검사할 파일 경로
 * @param patterns - glob 패턴 배열
 * @returns 매칭 여부 (패턴이 비어있으면 true)
 */
export function matchAnyPattern(filePath: string, patterns: string[]): boolean {
  // 빈 패턴 배열은 모든 파일 허용
  if (patterns.length === 0) {
    return true;
  }

  return patterns.some(pattern => matchGlob(filePath, pattern));
}
