/**
 * Changeset 타입 테스트
 * @see /docs/specs/changeset.md
 */
import { describe, it, expect } from 'vitest';
import type {
  SwarmBundleRef,
  ParsedSwarmBundleRef,
  OpenChangesetInput,
  OpenChangesetResult,
  OpenChangesetHint,
  CommitChangesetInput,
  CommitChangesetResult,
  CommitSummary,
  CommitError,
  ChangesetPolicy,
  PolicyValidationResult,
  SwarmBundleManager,
  SwarmBundleApi,
  RevisionChangedEvent,
  ChangesetEventRecord,
  GitStatusEntry,
} from '../../src/changeset/types.js';
import { parseSwarmBundleRef, formatSwarmBundleRef } from '../../src/changeset/types.js';

describe('Changeset 타입', () => {
  describe('SwarmBundleRef', () => {
    it('git:<commit-sha> 형식의 문자열이어야 한다', () => {
      const ref: SwarmBundleRef = 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
      expect(ref.startsWith('git:')).toBe(true);
    });
  });

  describe('parseSwarmBundleRef', () => {
    it('git: 접두사가 있는 ref를 파싱해야 한다', () => {
      const ref = 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
      const parsed = parseSwarmBundleRef(ref);

      expect(parsed.type).toBe('git');
      expect(parsed.commitSha).toBe('3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b');
    });

    it('유효하지 않은 형식에 대해 오류를 던져야 한다', () => {
      expect(() => parseSwarmBundleRef('invalid-ref')).toThrow(
        'Invalid SwarmBundleRef format'
      );
    });

    it('빈 commit sha에 대해 오류를 던져야 한다', () => {
      expect(() => parseSwarmBundleRef('git:')).toThrow(
        'Invalid SwarmBundleRef format'
      );
    });
  });

  describe('formatSwarmBundleRef', () => {
    it('commit sha로 SwarmBundleRef를 생성해야 한다', () => {
      const sha = '3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
      const ref = formatSwarmBundleRef(sha);

      expect(ref).toBe('git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b');
    });
  });

  describe('OpenChangesetInput', () => {
    it('reason은 선택적이어야 한다', () => {
      const input: OpenChangesetInput = {};
      expect(input.reason).toBeUndefined();
    });

    it('reason을 포함할 수 있어야 한다', () => {
      const input: OpenChangesetInput = {
        reason: 'Update prompts for better responses',
      };
      expect(input.reason).toBe('Update prompts for better responses');
    });
  });

  describe('OpenChangesetResult', () => {
    it('필수 필드를 포함해야 한다', () => {
      const result: OpenChangesetResult = {
        changesetId: 'cs-1234567890-abcd1234',
        baseRef: 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        workdir: '/home/user/.goondan/worktrees/abc123/changesets/cs-1234567890-abcd1234',
      };

      expect(result.changesetId).toBeDefined();
      expect(result.baseRef).toBeDefined();
      expect(result.workdir).toBeDefined();
    });

    it('hint를 포함할 수 있어야 한다', () => {
      const hint: OpenChangesetHint = {
        bundleRootInWorkdir: '.',
        recommendedFiles: ['goondan.yaml', 'prompts/**'],
      };

      const result: OpenChangesetResult = {
        changesetId: 'cs-1234567890-abcd1234',
        baseRef: 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        workdir: '/home/user/.goondan/worktrees/abc123/changesets/cs-1234567890-abcd1234',
        hint,
      };

      expect(result.hint?.bundleRootInWorkdir).toBe('.');
      expect(result.hint?.recommendedFiles).toContain('goondan.yaml');
    });
  });

  describe('CommitChangesetInput', () => {
    it('changesetId는 필수이어야 한다', () => {
      const input: CommitChangesetInput = {
        changesetId: 'cs-1234567890-abcd1234',
      };
      expect(input.changesetId).toBeDefined();
    });

    it('message는 선택적이어야 한다', () => {
      const input: CommitChangesetInput = {
        changesetId: 'cs-1234567890-abcd1234',
        message: 'Update system prompt',
      };
      expect(input.message).toBe('Update system prompt');
    });
  });

  describe('CommitChangesetResult', () => {
    it('성공 상태를 표현할 수 있어야 한다', () => {
      const result: CommitChangesetResult = {
        status: 'ok',
        changesetId: 'cs-1234567890-abcd1234',
        baseRef: 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        newRef: 'git:9b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u',
        summary: {
          filesChanged: ['prompts/system.md'],
          filesAdded: [],
          filesDeleted: [],
        },
      };

      expect(result.status).toBe('ok');
      expect(result.newRef).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('거부 상태를 표현할 수 있어야 한다', () => {
      const result: CommitChangesetResult = {
        status: 'rejected',
        changesetId: 'cs-1234567890-abcd1234',
        baseRef: 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        error: {
          code: 'POLICY_VIOLATION',
          message: 'ChangesetPolicy에 의해 허용되지 않은 파일이 변경되었습니다.',
          violatedFiles: ['goondan.yaml'],
        },
      };

      expect(result.status).toBe('rejected');
      expect(result.error?.code).toBe('POLICY_VIOLATION');
      expect(result.error?.violatedFiles).toContain('goondan.yaml');
    });

    it('실패 상태를 표현할 수 있어야 한다', () => {
      const result: CommitChangesetResult = {
        status: 'failed',
        changesetId: 'cs-1234567890-abcd1234',
        baseRef: 'git:3d2a1b4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        error: {
          code: 'GIT_ERROR',
          message: 'Merge conflict detected',
        },
      };

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('GIT_ERROR');
    });
  });

  describe('ChangesetPolicy', () => {
    it('모든 필드가 선택적이어야 한다', () => {
      const policy: ChangesetPolicy = {};
      expect(policy.enabled).toBeUndefined();
    });

    it('모든 필드를 포함할 수 있어야 한다', () => {
      const policy: ChangesetPolicy = {
        enabled: true,
        applyAt: ['step.config'],
        allowed: {
          files: ['prompts/**', 'resources/**'],
        },
        emitRevisionChangedEvent: true,
      };

      expect(policy.enabled).toBe(true);
      expect(policy.applyAt).toContain('step.config');
      expect(policy.allowed?.files).toContain('prompts/**');
      expect(policy.emitRevisionChangedEvent).toBe(true);
    });
  });

  describe('PolicyValidationResult', () => {
    it('유효한 결과를 표현할 수 있어야 한다', () => {
      const result: PolicyValidationResult = {
        valid: true,
        violatedFiles: [],
      };

      expect(result.valid).toBe(true);
      expect(result.violatedFiles).toHaveLength(0);
    });

    it('유효하지 않은 결과를 표현할 수 있어야 한다', () => {
      const result: PolicyValidationResult = {
        valid: false,
        violatedFiles: ['goondan.yaml', '.gitignore'],
      };

      expect(result.valid).toBe(false);
      expect(result.violatedFiles).toHaveLength(2);
    });
  });

  describe('GitStatusEntry', () => {
    it('Git status 항목을 표현할 수 있어야 한다', () => {
      const entries: GitStatusEntry[] = [
        { status: 'A', path: 'new-file.ts' },
        { status: 'M', path: 'modified-file.ts' },
        { status: 'D', path: 'deleted-file.ts' },
        { status: '?', path: 'untracked-file.ts' },
      ];

      expect(entries[0]?.status).toBe('A');
      expect(entries[1]?.status).toBe('M');
      expect(entries[2]?.status).toBe('D');
      expect(entries[3]?.status).toBe('?');
    });
  });

  describe('SwarmBundleApi 인터페이스', () => {
    it('필수 메서드를 포함해야 한다', () => {
      // 타입 체크용 더미 구현
      const api: SwarmBundleApi = {
        openChangeset: async () => ({
          changesetId: 'cs-test',
          baseRef: 'git:abc123',
          workdir: '/tmp/test',
        }),
        commitChangeset: async () => ({
          status: 'ok',
          changesetId: 'cs-test',
          baseRef: 'git:abc123',
          newRef: 'git:def456',
          summary: { filesChanged: [], filesAdded: [], filesDeleted: [] },
        }),
        getActiveRef: () => 'git:abc123',
      };

      expect(api.openChangeset).toBeDefined();
      expect(api.commitChangeset).toBeDefined();
      expect(api.getActiveRef).toBeDefined();
    });
  });

  describe('RevisionChangedEvent', () => {
    it('revision 변경 이벤트를 표현할 수 있어야 한다', () => {
      const event: RevisionChangedEvent = {
        type: 'swarmBundle.revisionChanged',
        previousRef: 'git:abc123',
        newRef: 'git:def456',
        changesetId: 'cs-test',
        summary: {
          filesChanged: ['prompts/system.md'],
          filesAdded: [],
          filesDeleted: [],
        },
        timestamp: '2026-02-05T10:30:00.000Z',
      };

      expect(event.type).toBe('swarmBundle.revisionChanged');
      expect(event.previousRef).not.toBe(event.newRef);
    });
  });

  describe('ChangesetEventRecord', () => {
    it('changeset 이벤트 로그를 표현할 수 있어야 한다', () => {
      const record: ChangesetEventRecord = {
        type: 'agent.event',
        kind: 'changeset.committed',
        recordedAt: '2026-02-05T10:30:00.000Z',
        instanceId: 'default-cli',
        instanceKey: 'cli',
        agentName: 'planner',
        turnId: 'turn-abc',
        stepId: 'step-xyz',
        stepIndex: 3,
        data: {
          changesetId: 'cs-000123',
          baseRef: 'git:abc123',
          newRef: 'git:def456',
          status: 'ok',
          summary: {
            filesChanged: ['prompts/planner.system.md'],
            filesAdded: [],
            filesDeleted: [],
          },
        },
      };

      expect(record.type).toBe('agent.event');
      expect(record.kind).toBe('changeset.committed');
    });
  });
});
