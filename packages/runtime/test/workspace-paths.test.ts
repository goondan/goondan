import { describe, expect, it } from 'vitest';

import { WorkspacePaths } from '../src/workspace/paths.js';

describe('WorkspacePaths.workspaceId', () => {
  it('폴더 경로와 package name 기반의 human-readable 해시 slug를 생성한다 (spec §3.2)', () => {
    const paths = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      packageName: '@goondan/sample-10-telegram-evolving-bot',
    });

    // Format: word-word-word-word
    expect(paths.workspaceId).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
    expect(paths.workspaceId.includes('/')).toBe(false);
  });

  it('같은 입력에서 동일한 workspaceId를 반환한다 (deterministic)', () => {
    const first = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      packageName: '@goondan/sample-10-telegram-evolving-bot',
    });

    const second = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      packageName: '@goondan/sample-10-telegram-evolving-bot',
    });

    expect(first.workspaceId).toBe(second.workspaceId);
  });

  it('입력(Project Root 또는 Package name)이 달라지면 workspaceId가 달라진다', () => {
    const base = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      packageName: '@goondan/sample-10-telegram-evolving-bot',
    });

    const changedPackage = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      packageName: '@goondan/sample-10-other',
    });

    const changedProject = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/another-folder',
      packageName: '@goondan/sample-10-telegram-evolving-bot',
    });

    expect(changedPackage.workspaceId).not.toBe(base.workspaceId);
    expect(changedProject.workspaceId).not.toBe(base.workspaceId);
  });

  it('입력에 특수 문자가 있어도 출력은 slug 형식을 유지한다', () => {
    const paths = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/my projects/sample-10',
      packageName: '@goondan/sample-10',
    });

    expect(paths.workspaceId).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
  });

  it('입력이 매우 길어도 slug 길이는 안정적으로 유지된다', () => {
    const veryLongPath = '/Users/alice/' + 'a'.repeat(200);
    const paths = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: veryLongPath,
      packageName: '@goondan/sample-10',
    });

    expect(paths.workspaceId).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
    expect(paths.workspaceId.length).toBeLessThanOrEqual(80);
  });

  it('packageName이 없을 때와 있을 때의 workspaceId는 달라진다', () => {
    const withoutPackage = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
    });

    const withPackage = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      packageName: '@goondan/sample-10',
    });

    expect(withoutPackage.workspaceId).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
    expect(withoutPackage.workspaceId).not.toBe(withPackage.workspaceId);
  });
});
