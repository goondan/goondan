/**
 * Glob 패턴 매칭 테스트
 * @see /docs/specs/changeset.md - 6.5 Glob 매칭 규칙
 */
import { describe, it, expect } from 'vitest';
import { matchGlob, matchAnyPattern } from '../../src/changeset/glob.js';

describe('Glob 패턴 매칭', () => {
  describe('matchGlob', () => {
    describe('기본 패턴', () => {
      it('정확한 파일명을 매칭해야 한다', () => {
        expect(matchGlob('README.md', 'README.md')).toBe(true);
        expect(matchGlob('README.md', 'CHANGELOG.md')).toBe(false);
      });

      it('경로가 포함된 파일명을 매칭해야 한다', () => {
        expect(matchGlob('docs/README.md', 'docs/README.md')).toBe(true);
        expect(matchGlob('docs/README.md', 'README.md')).toBe(false);
      });
    });

    describe('* (단일 디렉터리 내 임의 문자열)', () => {
      it('*.md 패턴을 매칭해야 한다', () => {
        expect(matchGlob('README.md', '*.md')).toBe(true);
        expect(matchGlob('CHANGELOG.md', '*.md')).toBe(true);
        expect(matchGlob('index.ts', '*.md')).toBe(false);
      });

      it('디렉터리 내 패턴을 매칭해야 한다', () => {
        expect(matchGlob('prompts/system.md', 'prompts/*.md')).toBe(true);
        expect(matchGlob('prompts/user.md', 'prompts/*.md')).toBe(true);
        expect(matchGlob('prompts/nested/system.md', 'prompts/*.md')).toBe(false);
      });

      it('파일 이름 중간에 *를 사용할 수 있어야 한다', () => {
        expect(matchGlob('test.config.ts', 'test.*.ts')).toBe(true);
        expect(matchGlob('test.spec.ts', 'test.*.ts')).toBe(true);
        expect(matchGlob('other.config.ts', 'test.*.ts')).toBe(false);
      });
    });

    describe('** (임의 깊이의 디렉터리)', () => {
      it('prompts/** 패턴을 매칭해야 한다', () => {
        expect(matchGlob('prompts/system.md', 'prompts/**')).toBe(true);
        expect(matchGlob('prompts/agents/planner.md', 'prompts/**')).toBe(true);
        expect(matchGlob('prompts/a/b/c/d.md', 'prompts/**')).toBe(true);
        expect(matchGlob('resources/config.yaml', 'prompts/**')).toBe(false);
      });

      it('**/파일 패턴을 매칭해야 한다', () => {
        expect(matchGlob('index.ts', '**/*.ts')).toBe(true);
        expect(matchGlob('src/index.ts', '**/*.ts')).toBe(true);
        expect(matchGlob('src/deep/nested/file.ts', '**/*.ts')).toBe(true);
        expect(matchGlob('src/index.js', '**/*.ts')).toBe(false);
      });

      it('중간에 **를 사용할 수 있어야 한다', () => {
        expect(matchGlob('tools/fileRead/index.ts', 'tools/**/index.ts')).toBe(true);
        expect(matchGlob('tools/a/b/c/index.ts', 'tools/**/index.ts')).toBe(true);
        expect(matchGlob('tools/fileRead/src/index.ts', 'tools/**/index.ts')).toBe(true);
      });
    });

    describe('? (단일 문자)', () => {
      it('단일 문자를 매칭해야 한다', () => {
        expect(matchGlob('file1.txt', 'file?.txt')).toBe(true);
        expect(matchGlob('fileA.txt', 'file?.txt')).toBe(true);
        expect(matchGlob('file12.txt', 'file?.txt')).toBe(false);
        expect(matchGlob('file.txt', 'file?.txt')).toBe(false);
      });
    });

    describe('[abc] (문자 집합)', () => {
      it('문자 집합을 매칭해야 한다', () => {
        expect(matchGlob('file1.txt', 'file[123].txt')).toBe(true);
        expect(matchGlob('file2.txt', 'file[123].txt')).toBe(true);
        expect(matchGlob('file3.txt', 'file[123].txt')).toBe(true);
        expect(matchGlob('file4.txt', 'file[123].txt')).toBe(false);
      });

      it('문자 범위를 매칭해야 한다', () => {
        expect(matchGlob('fileA.txt', 'file[A-Z].txt')).toBe(true);
        expect(matchGlob('fileZ.txt', 'file[A-Z].txt')).toBe(true);
        expect(matchGlob('filea.txt', 'file[A-Z].txt')).toBe(false);
      });
    });

    describe('dot 파일 처리', () => {
      it('.으로 시작하는 파일을 매칭해야 한다', () => {
        expect(matchGlob('.gitignore', '*')).toBe(true);
        expect(matchGlob('.env', '.*')).toBe(true);
        expect(matchGlob('.github/workflows/ci.yml', '.github/**')).toBe(true);
      });

      it('** 패턴이 dot 파일을 매칭해야 한다', () => {
        expect(matchGlob('.gitignore', '**')).toBe(true);
        expect(matchGlob('src/.hidden', '**')).toBe(true);
      });
    });

    describe('전체 경로 매칭', () => {
      it('패턴은 전체 경로와 매칭되어야 한다', () => {
        // matchBase: false이므로 패턴이 전체 경로와 일치해야 함
        expect(matchGlob('src/index.ts', 'index.ts')).toBe(false);
        expect(matchGlob('src/index.ts', 'src/index.ts')).toBe(true);
        expect(matchGlob('src/index.ts', '**/index.ts')).toBe(true);
      });
    });
  });

  describe('matchAnyPattern', () => {
    it('여러 패턴 중 하나라도 매칭되면 true를 반환해야 한다', () => {
      const patterns = ['prompts/**', 'resources/**', 'tools/**'];

      expect(matchAnyPattern('prompts/system.md', patterns)).toBe(true);
      expect(matchAnyPattern('resources/config.yaml', patterns)).toBe(true);
      expect(matchAnyPattern('tools/fileRead/index.ts', patterns)).toBe(true);
    });

    it('모든 패턴에 매칭되지 않으면 false를 반환해야 한다', () => {
      const patterns = ['prompts/**', 'resources/**'];

      expect(matchAnyPattern('goondan.yaml', patterns)).toBe(false);
      expect(matchAnyPattern('tools/index.ts', patterns)).toBe(false);
    });

    it('빈 패턴 배열은 true를 반환해야 한다 (모든 파일 허용)', () => {
      expect(matchAnyPattern('any-file.ts', [])).toBe(true);
    });
  });
});
