/**
 * Workspace 설정 테스트
 * @see /docs/specs/workspace.md - 섹션 2: 경로 결정 규칙
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import {
  resolveGoondanHome,
  generateWorkspaceId,
  generateInstanceId,
  DEFAULT_LAYOUT,
} from '../../src/workspace/config.js';

describe('Workspace 설정', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 환경변수 초기화
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.GOONDAN_STATE_ROOT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveGoondanHome', () => {
    it('CLI 옵션이 최우선이다', () => {
      process.env.GOONDAN_STATE_ROOT = '/env/path';
      const result = resolveGoondanHome({
        cliStateRoot: '/cli/path',
        envStateRoot: '/opt/path',
      });
      expect(result).toBe(path.resolve('/cli/path'));
    });

    it('CLI 옵션이 없으면 환경변수를 사용한다', () => {
      process.env.GOONDAN_STATE_ROOT = '/env/path';
      const result = resolveGoondanHome({});
      expect(result).toBe(path.resolve('/env/path'));
    });

    it('옵션의 envStateRoot가 process.env보다 우선한다', () => {
      process.env.GOONDAN_STATE_ROOT = '/process/env/path';
      const result = resolveGoondanHome({
        envStateRoot: '/options/env/path',
      });
      expect(result).toBe(path.resolve('/options/env/path'));
    });

    it('모든 옵션이 없으면 기본값 ~/.goondan을 사용한다', () => {
      const result = resolveGoondanHome({});
      expect(result).toBe(path.join(os.homedir(), '.goondan'));
    });

    it('상대 경로를 절대 경로로 변환해야 한다', () => {
      const result = resolveGoondanHome({
        cliStateRoot: './relative/path',
      });
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('generateWorkspaceId', () => {
    it('디렉토리명-해시8자 형식의 workspaceId를 반환해야 한다', () => {
      const workspaceId = generateWorkspaceId('/Users/alice/projects/my-agent');
      expect(workspaceId).toMatch(/^my-agent-[a-f0-9]{8}$/);
    });

    it('동일한 경로는 항상 동일한 workspaceId를 생성해야 한다 (결정론적)', () => {
      const path1 = '/Users/alice/projects/my-agent';
      const id1 = generateWorkspaceId(path1);
      const id2 = generateWorkspaceId(path1);
      expect(id1).toBe(id2);
    });

    it('다른 경로는 다른 workspaceId를 생성해야 한다', () => {
      const id1 = generateWorkspaceId('/path/to/project1');
      const id2 = generateWorkspaceId('/path/to/project2');
      expect(id1).not.toBe(id2);
    });

    it('경로를 정규화하여 해시해야 한다', () => {
      // 상대 경로와 절대 경로가 같은 실제 경로를 가리키면 같은 ID
      const cwd = process.cwd();
      const id1 = generateWorkspaceId(cwd);
      const id2 = generateWorkspaceId(path.resolve('.'));
      expect(id1).toBe(id2);
    });
  });

  describe('generateInstanceId', () => {
    it('swarmName과 instanceKey를 조합해야 한다', () => {
      const instanceId = generateInstanceId('default', 'cli');
      expect(instanceId).toBe('default-cli');
    });

    it('특수문자를 -로 치환해야 한다', () => {
      // Slack thread_ts 형식
      const instanceId = generateInstanceId('default', '1700000000.000100');
      expect(instanceId).toBe('default-1700000000-000100');
    });

    it('알파벳, 숫자, _, -만 허용해야 한다', () => {
      const instanceId = generateInstanceId('my@swarm!', 'test#key$');
      expect(/^[a-zA-Z0-9_-]+$/.test(instanceId)).toBe(true);
    });

    it('128자로 제한되어야 한다', () => {
      const longName = 'a'.repeat(100);
      const longKey = 'b'.repeat(100);
      const instanceId = generateInstanceId(longName, longKey);
      expect(instanceId.length).toBeLessThanOrEqual(128);
    });

    it('빈 문자열도 처리해야 한다', () => {
      const instanceId = generateInstanceId('', '');
      expect(instanceId).toBe('-');
    });
  });

  describe('DEFAULT_LAYOUT', () => {
    it('기본 configFile이 goondan.yaml이어야 한다', () => {
      expect(DEFAULT_LAYOUT.configFile).toBe('goondan.yaml');
    });

    it('기본 resourceDirs가 ["resources"]이어야 한다', () => {
      expect(DEFAULT_LAYOUT.resourceDirs).toEqual(['resources']);
    });

    it('기본 promptsDir이 prompts이어야 한다', () => {
      expect(DEFAULT_LAYOUT.promptsDir).toBe('prompts');
    });

    it('기본 toolsDir이 tools이어야 한다', () => {
      expect(DEFAULT_LAYOUT.toolsDir).toBe('tools');
    });

    it('기본 extensionsDir이 extensions이어야 한다', () => {
      expect(DEFAULT_LAYOUT.extensionsDir).toBe('extensions');
    });

    it('기본 connectorsDir이 connectors이어야 한다', () => {
      expect(DEFAULT_LAYOUT.connectorsDir).toBe('connectors');
    });

    it('기본 bundleManifest가 bundle.yaml이어야 한다', () => {
      expect(DEFAULT_LAYOUT.bundleManifest).toBe('bundle.yaml');
    });
  });
});
