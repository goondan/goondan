import { describe, expect, it } from 'vitest';

import { WorkspacePaths } from '../src/workspace/paths.js';

describe('WorkspacePaths.workspaceId', () => {
  it('workspaceName 기반으로 정규화된 workspaceId를 생성한다', () => {
    const paths = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: 'Main Swarm:Prod',
    });

    expect(paths.workspaceId).toBe('main-swarm-prod');
    expect(paths.workspaceId.includes('/')).toBe(false);
  });

  it('같은 workspaceName에서 동일한 workspaceId를 반환한다 (deterministic)', () => {
    const first = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: 'default',
    });

    const second = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/another-folder',
      workspaceName: 'default',
    });

    expect(first.workspaceId).toBe(second.workspaceId);
  });

  it('workspaceName이 달라지면 workspaceId가 달라진다', () => {
    const base = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: 'default',
    });

    const changed = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: 'review',
    });

    expect(changed.workspaceId).not.toBe(base.workspaceId);
  });

  it('workspaceName의 특수 문자를 안전한 slug로 정규화한다', () => {
    const paths = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: '///@@@:::',
    });

    expect(paths.workspaceId).toBe('default');
  });

  it('workspaceName이 매우 길어도 128자 이내로 제한한다', () => {
    const veryLongName = 'swarm-' + 'a'.repeat(300);
    const paths = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: veryLongName,
    });

    expect(paths.workspaceId.startsWith('swarm-')).toBe(true);
    expect(paths.workspaceId.length).toBeLessThanOrEqual(128);
  });

  it('workspaceName이 없거나 비어 있으면 default를 사용한다', () => {
    const withoutName = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
    });

    const blankName = new WorkspacePaths({
      stateRoot: '/tmp/.goondan',
      projectRoot: '/Users/alice/workspace/goondan/sample-10',
      workspaceName: '   ',
    });

    expect(withoutName.workspaceId).toBe('default');
    expect(blankName.workspaceId).toBe('default');
  });
});
