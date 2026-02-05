/**
 * ChangesetPolicy 검증 테스트
 * @see /docs/specs/changeset.md - 6. ChangesetPolicy 검증
 */
import { describe, it, expect } from 'vitest';
import { validateChangesetPolicy } from '../../src/changeset/policy.js';
import type { ChangesetPolicy } from '../../src/changeset/types.js';

describe('ChangesetPolicy 검증', () => {
  describe('validateChangesetPolicy', () => {
    describe('기본 동작', () => {
      it('정책이 없으면 모든 파일이 허용되어야 한다', () => {
        const result = validateChangesetPolicy(
          ['any-file.ts', 'another.md'],
          undefined,
          undefined
        );

        expect(result.valid).toBe(true);
        expect(result.violatedFiles).toHaveLength(0);
      });

      it('빈 변경 목록은 항상 유효해야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: { files: ['prompts/**'] },
        };

        const result = validateChangesetPolicy([], swarmPolicy, undefined);

        expect(result.valid).toBe(true);
        expect(result.violatedFiles).toHaveLength(0);
      });
    });

    describe('enabled 플래그', () => {
      it('enabled가 false이면 모든 변경이 거부되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: false,
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md', 'tools/index.ts'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(false);
        expect(result.violatedFiles).toEqual(['prompts/system.md', 'tools/index.ts']);
      });

      it('enabled가 true이면 정책에 따라 검증해야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: { files: ['prompts/**'] },
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(true);
      });

      it('enabled가 undefined이면 true로 간주해야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          allowed: { files: ['prompts/**'] },
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(true);
      });
    });

    describe('Swarm 정책만 있는 경우', () => {
      it('allowed.files 패턴에 매칭되는 파일은 허용되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**', 'resources/**', 'tools/**'],
          },
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md', 'resources/config.yaml', 'tools/myTool/index.ts'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(true);
        expect(result.violatedFiles).toHaveLength(0);
      });

      it('allowed.files 패턴에 매칭되지 않는 파일은 거부되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**'],
          },
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md', 'goondan.yaml', '.gitignore'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(false);
        expect(result.violatedFiles).toEqual(['goondan.yaml', '.gitignore']);
      });

      it('allowed.files가 비어있으면 모든 파일이 허용되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: { files: [] },
        };

        const result = validateChangesetPolicy(
          ['any-file.ts'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(true);
      });

      it('allowed가 undefined이면 모든 파일이 허용되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
        };

        const result = validateChangesetPolicy(
          ['any-file.ts'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(true);
      });
    });

    describe('Swarm + Agent 정책 조합', () => {
      it('Swarm과 Agent 정책 모두 만족해야 허용되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**', 'resources/**', 'tools/**'],
          },
        };

        const agentPolicy: ChangesetPolicy = {
          allowed: {
            files: ['prompts/**', 'resources/**'],
          },
        };

        // prompts/**는 둘 다 허용 -> OK
        const result1 = validateChangesetPolicy(
          ['prompts/system.md'],
          swarmPolicy,
          agentPolicy
        );
        expect(result1.valid).toBe(true);

        // tools/**는 Swarm만 허용, Agent는 허용 안함 -> 거부
        const result2 = validateChangesetPolicy(
          ['tools/myTool.ts'],
          swarmPolicy,
          agentPolicy
        );
        expect(result2.valid).toBe(false);
        expect(result2.violatedFiles).toContain('tools/myTool.ts');
      });

      it('Swarm이 허용하지 않으면 Agent가 허용해도 거부되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**'],
          },
        };

        const agentPolicy: ChangesetPolicy = {
          allowed: {
            files: ['prompts/**', 'tools/**'],
          },
        };

        const result = validateChangesetPolicy(
          ['tools/myTool.ts'],
          swarmPolicy,
          agentPolicy
        );

        expect(result.valid).toBe(false);
        expect(result.violatedFiles).toContain('tools/myTool.ts');
      });

      it('Agent 정책이 없으면 Swarm 정책만 적용되어야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**', 'tools/**'],
          },
        };

        const result = validateChangesetPolicy(
          ['tools/myTool.ts'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(true);
      });

      it('Agent allowed가 비어있으면 Swarm 패턴으로 폴백해야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**'],
          },
        };

        const agentPolicy: ChangesetPolicy = {
          allowed: { files: [] },
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md'],
          swarmPolicy,
          agentPolicy
        );

        expect(result.valid).toBe(true);
      });
    });

    describe('복합 시나리오', () => {
      it('일부 파일만 위반한 경우 위반된 파일만 반환해야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**', 'resources/**'],
          },
        };

        const result = validateChangesetPolicy(
          ['prompts/system.md', 'goondan.yaml', 'resources/config.yaml', '.env'],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(false);
        expect(result.violatedFiles).toEqual(['goondan.yaml', '.env']);
      });

      it('다양한 중첩 경로를 올바르게 검증해야 한다', () => {
        const swarmPolicy: ChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['prompts/**', 'tools/**/*.ts'],
          },
        };

        const result = validateChangesetPolicy(
          [
            'prompts/agents/planner/system.md',
            'tools/fileRead/index.ts',
            'tools/fileRead/README.md', // *.ts 패턴에 맞지 않음
          ],
          swarmPolicy,
          undefined
        );

        expect(result.valid).toBe(false);
        expect(result.violatedFiles).toEqual(['tools/fileRead/README.md']);
      });
    });
  });
});
