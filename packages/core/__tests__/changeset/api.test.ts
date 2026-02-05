/**
 * SwarmBundleApi 테스트
 * @see /docs/specs/changeset.md - 11. TypeScript 인터페이스
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createSwarmBundleApi } from '../../src/changeset/api.js';
import { SwarmBundleManagerImpl } from '../../src/changeset/manager.js';
import { execGit } from '../../src/changeset/git.js';
import type { ChangesetPolicy } from '../../src/changeset/types.js';

describe('SwarmBundleApi', () => {
  let tempDir: string;
  let repoDir: string;
  let goondanHome: string;
  let workspaceId: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-api-test-'));
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
    await fs.writeFile(path.join(repoDir, 'goondan.yaml'), 'kind: Swarm\nname: test');
    await fs.writeFile(path.join(repoDir, 'prompts', 'system.md'), '# System Prompt');

    await execGit(repoDir, ['add', '.']);
    await execGit(repoDir, ['commit', '-m', 'Initial commit']);
  });

  afterEach(async () => {
    // 약간의 지연 후 삭제 (파일 핸들 해제 대기)
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createSwarmBundleApi', () => {
    it('SwarmBundleApi 인터페이스를 반환해야 한다', () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const api = createSwarmBundleApi(manager);

      expect(api.openChangeset).toBeDefined();
      expect(api.commitChangeset).toBeDefined();
      expect(api.getActiveRef).toBeDefined();
    });
  });

  describe('api.openChangeset', () => {
    it('Manager의 openChangeset을 호출해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const api = createSwarmBundleApi(manager);

      const result = await api.openChangeset();

      expect(result.changesetId).toBeDefined();
      expect(result.baseRef).toBeDefined();
      expect(result.workdir).toBeDefined();

      // 정리
      await manager.discardChangeset(result.changesetId);
    });

    it('reason을 전달할 수 있어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const api = createSwarmBundleApi(manager);

      const result = await api.openChangeset({ reason: 'Test reason' });

      expect(result.changesetId).toBeDefined();

      await manager.discardChangeset(result.changesetId);
    });
  });

  describe('api.commitChangeset', () => {
    it('Manager의 commitChangeset을 호출해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const api = createSwarmBundleApi(manager);

      const { changesetId, workdir } = await api.openChangeset();

      // 파일 수정
      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated');

      const result = await api.commitChangeset({ changesetId });

      expect(result.status).toBe('ok');
      expect(result.newRef).toBeDefined();
    });

    it('message를 전달할 수 있어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      const api = createSwarmBundleApi(manager);

      const { changesetId, workdir } = await api.openChangeset();

      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated');

      const result = await api.commitChangeset({
        changesetId,
        message: 'Custom commit message',
      });

      expect(result.status).toBe('ok');
    });
  });

  describe('api.getActiveRef', () => {
    it('현재 활성 Ref를 반환해야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      // 먼저 getActiveRef를 호출하여 캐시 초기화
      await manager.getActiveRef();

      const api = createSwarmBundleApi(manager);

      const ref = api.getActiveRef();

      expect(ref).toMatch(/^git:[a-f0-9]{40}$/);
    });

    it('commit 후 Ref가 업데이트되어야 한다', async () => {
      const manager = new SwarmBundleManagerImpl({
        swarmBundleRoot: repoDir,
        goondanHome,
        workspaceId,
      });

      // 먼저 getActiveRef를 호출하여 캐시 초기화
      const initialRef = await manager.getActiveRef();

      const api = createSwarmBundleApi(manager);

      const { changesetId, workdir } = await api.openChangeset();
      await fs.writeFile(path.join(workdir, 'prompts', 'system.md'), '# Updated');
      await api.commitChangeset({ changesetId });

      // commit 후에는 캐시된 ref가 업데이트됨
      const newRef = api.getActiveRef();

      expect(newRef).not.toBe(initialRef);
    });
  });

  describe('정책 적용', () => {
    it('Swarm 정책이 Api에 적용되어야 한다', async () => {
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

      const api = createSwarmBundleApi(manager);

      const { changesetId, workdir } = await api.openChangeset();

      // 허용되지 않은 파일 수정
      await fs.writeFile(path.join(workdir, 'goondan.yaml'), 'modified');

      const result = await api.commitChangeset({ changesetId });

      expect(result.status).toBe('rejected');
      expect(result.error?.code).toBe('POLICY_VIOLATION');
    });
  });
});
