/**
 * SwarmBundleManager 테스트
 * @see /docs/specs/changeset.md - 3. SwarmBundleManager 역할
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SwarmBundleManagerImpl } from '../../src/changeset/manager.js';
import { execGit } from '../../src/changeset/git.js';
import type { ChangesetPolicy } from '../../src/changeset/types.js';

describe('SwarmBundleManager', () => {
  let tempDir: string;
  let repoDir: string;
  let goondanHome: string;
  let workspaceId: string;

  beforeEach(async () => {
    // 임시 디렉터리 생성
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-manager-test-'));
    repoDir = path.join(tempDir, 'swarm-bundle');
    goondanHome = path.join(tempDir, '.goondan');
    workspaceId = 'test-workspace-id';

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(goondanHome, { recursive: true });

    // Git 레포지토리 초기화
    await execGit(repoDir, ['init']);
    await execGit(repoDir, ['config', 'user.email', 'test@example.com']);
    await execGit(repoDir, ['config', 'user.name', 'Test User']);

    // 초기 파일 생성 및 커밋
    await fs.mkdir(path.join(repoDir, 'prompts'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'resources'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'goondan.yaml'), 'kind: Swarm\nname: test');
    await fs.writeFile(path.join(repoDir, 'prompts', 'system.md'), '# System Prompt');

    await execGit(repoDir, ['add', '.']);
    await execGit(repoDir, ['commit', '-m', 'Initial commit']);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getActiveRef', () => {
    it('현재 HEAD의 SwarmBundleRef를 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const ref = await manager.getActiveRef();

      expect(ref).toMatch(/^git:[a-f0-9]{40}$/);
    });
  });

  describe('openChangeset', () => {
    it('changesetId와 workdir을 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const result = await manager.openChangeset();

      expect(result.changesetId).toMatch(/^cs-\d+-[a-f0-9]+$/);
      expect(result.baseRef).toMatch(/^git:[a-f0-9]{40}$/);
      expect(result.workdir).toContain(goondanHome);
      expect(result.workdir).toContain('changesets');
      expect(result.workdir).toContain(result.changesetId);

      // workdir이 실제로 존재하는지 확인
      const exists = await fs.access(result.workdir).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // 정리
      await manager.discardChangeset(result.changesetId);
    });

    it('reason을 전달할 수 있어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const result = await manager.openChangeset({ reason: 'Update prompts' });

      expect(result.changesetId).toBeDefined();

      // 정리
      await manager.discardChangeset(result.changesetId);
    });

    it('hint를 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const result = await manager.openChangeset();

      expect(result.hint).toBeDefined();
      expect(result.hint?.bundleRootInWorkdir).toBe('.');
      expect(result.hint?.recommendedFiles).toContain('prompts/**');

      // 정리
      await manager.discardChangeset(result.changesetId);
    });

    it('workdir에 SwarmBundle 파일들이 존재해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const result = await manager.openChangeset();

      // SwarmBundle 파일들이 복사되었는지 확인
      const goondanYamlExists = await fs.access(path.join(result.workdir, 'goondan.yaml')).then(() => true).catch(() => false);
      const systemMdExists = await fs.access(path.join(result.workdir, 'prompts', 'system.md')).then(() => true).catch(() => false);

      expect(goondanYamlExists).toBe(true);
      expect(systemMdExists).toBe(true);

      // 정리
      await manager.discardChangeset(result.changesetId);
    });

    it('여러 changeset을 동시에 열 수 있어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const result1 = await manager.openChangeset();
      const result2 = await manager.openChangeset();

      expect(result1.changesetId).not.toBe(result2.changesetId);
      expect(result1.workdir).not.toBe(result2.workdir);

      // 정리
      await manager.discardChangeset(result1.changesetId);
      await manager.discardChangeset(result2.changesetId);
    });
  });

  describe('commitChangeset', () => {
    it('변경 없이 commit하면 baseRef와 동일한 newRef를 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { changesetId, baseRef } = await manager.openChangeset();

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('ok');
      expect(result.baseRef).toBe(baseRef);
      expect(result.newRef).toBe(baseRef);
      expect(result.summary?.filesChanged).toHaveLength(0);
      expect(result.summary?.filesAdded).toHaveLength(0);
      expect(result.summary?.filesDeleted).toHaveLength(0);
    });

    it('파일 변경 후 commit하면 새 newRef를 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { changesetId, workdir, baseRef } = await manager.openChangeset();

      // 파일 수정
      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated System Prompt');

      const result = await manager.commitChangeset({
        changesetId,
        message: 'Update system prompt',
      });

      expect(result.status).toBe('ok');
      expect(result.newRef).toBeDefined();
      expect(result.newRef).not.toBe(baseRef);
      expect(result.summary?.filesChanged).toContain('prompts/system.md');
    });

    it('새 파일 추가 후 commit하면 filesAdded에 포함되어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      // 새 파일 추가
      await fs.writeFile(path.join(workdir, 'prompts', 'new-prompt.md'), '# New Prompt');

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('ok');
      expect(result.summary?.filesAdded).toContain('prompts/new-prompt.md');
    });

    it('파일 삭제 후 commit하면 filesDeleted에 포함되어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      // 파일 삭제
      await fs.rm(path.join(workdir, 'prompts', 'system.md'));

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('ok');
      expect(result.summary?.filesDeleted).toContain('prompts/system.md');
    });

    it('존재하지 않는 changesetId에 대해 failed를 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const result = await manager.commitChangeset({
        changesetId: 'non-existent-changeset-id',
      });

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('CHANGESET_NOT_FOUND');
    });

    it('commit 후 activeRef가 업데이트되어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const initialRef = await manager.getActiveRef();
      const { changesetId, workdir } = await manager.openChangeset();

      // 파일 수정
      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated');

      const result = await manager.commitChangeset({ changesetId });
      const newRef = await manager.getActiveRef();

      expect(result.status).toBe('ok');
      expect(newRef).not.toBe(initialRef);
      expect(newRef).toBe(result.newRef);
    });
  });

  describe('commitChangeset with ChangesetPolicy', () => {
    it('Swarm 정책에 따라 허용된 파일만 commit해야 한다', async () => {
      const swarmPolicy: ChangesetPolicy = {
        enabled: true,
        allowed: { files: ['prompts/**'] },
      };

      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
        swarmPolicy,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      // 허용된 파일 수정
      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated');

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('ok');
    });

    it('Swarm 정책 위반 시 rejected를 반환해야 한다', async () => {
      const swarmPolicy: ChangesetPolicy = {
        enabled: true,
        allowed: { files: ['prompts/**'] },
      };

      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
        swarmPolicy,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      // 허용되지 않은 파일 수정
      await fs.writeFile(path.join(workdir, 'goondan.yaml'), 'kind: Swarm\nname: modified');

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('rejected');
      expect(result.error?.code).toBe('POLICY_VIOLATION');
      expect(result.error?.violatedFiles).toContain('goondan.yaml');
    });

    it('Agent 정책까지 고려해야 한다', async () => {
      const swarmPolicy: ChangesetPolicy = {
        enabled: true,
        allowed: { files: ['prompts/**', 'resources/**'] },
      };

      const agentPolicy: ChangesetPolicy = {
        allowed: { files: ['prompts/**'] },
      };

      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
        swarmPolicy,
        agentPolicy,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      // resources/**는 Swarm만 허용, Agent는 불허
      await fs.mkdir(path.join(workdir, 'resources'), { recursive: true });
      await fs.writeFile(path.join(workdir, 'resources', 'config.yaml'), 'key: value');

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('rejected');
      // Git이 새 디렉토리를 'resources/'로 표시하거나 개별 파일로 표시할 수 있음
      const violatedFiles = result.error?.violatedFiles ?? [];
      const hasResourcesViolation = violatedFiles.some(
        f => f === 'resources/config.yaml' || f === 'resources/'
      );
      expect(hasResourcesViolation).toBe(true);
    });

    it('changesets.enabled=false이면 모든 변경이 거부되어야 한다', async () => {
      const swarmPolicy: ChangesetPolicy = {
        enabled: false,
      };

      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
        swarmPolicy,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated');

      const result = await manager.commitChangeset({ changesetId });

      expect(result.status).toBe('rejected');
    });
  });

  describe('discardChangeset', () => {
    it('열린 changeset을 폐기해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { changesetId, workdir } = await manager.openChangeset();

      // workdir 존재 확인
      const existsBefore = await fs.access(workdir).then(() => true).catch(() => false);
      expect(existsBefore).toBe(true);

      // 폐기
      await manager.discardChangeset(changesetId);

      // workdir가 제거되었는지 확인
      const existsAfter = await fs.access(workdir).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('존재하지 않는 changeset 폐기는 무시해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      // 오류 없이 완료되어야 함
      await expect(manager.discardChangeset('non-existent')).resolves.not.toThrow();
    });
  });

  describe('workdir 경로 규칙', () => {
    it('workdir은 goondanHome 하위에 생성되어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { workdir, changesetId } = await manager.openChangeset();

      expect(workdir.startsWith(goondanHome)).toBe(true);

      await manager.discardChangeset(changesetId);
    });

    it('workdir 경로 형식이 올바라야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const { workdir, changesetId } = await manager.openChangeset();

      // <goondanHome>/worktrees/<workspaceId>/changesets/<changesetId>/
      const expectedPattern = path.join(goondanHome, 'worktrees', workspaceId, 'changesets', changesetId);
      expect(workdir).toBe(expectedPattern);

      await manager.discardChangeset(changesetId);
    });
  });
});
