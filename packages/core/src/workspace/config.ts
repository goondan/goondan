/**
 * Workspace 설정 유틸리티
 * @see /docs/specs/workspace.md - 섹션 2: 경로 결정 규칙
 */
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import type { GoondanHomeOptions, SwarmBundleRootLayout } from './types.js';

/**
 * goondanHome 경로 결정
 *
 * 우선순위:
 * 1. CLI 옵션: cliStateRoot
 * 2. 환경 변수: envStateRoot 또는 process.env.GOONDAN_STATE_ROOT
 * 3. 기본값: ~/.goondan/
 */
export function resolveGoondanHome(options: GoondanHomeOptions = {}): string {
  if (options.cliStateRoot) {
    return path.resolve(options.cliStateRoot);
  }
  if (options.envStateRoot) {
    return path.resolve(options.envStateRoot);
  }
  if (process.env.GOONDAN_STATE_ROOT) {
    return path.resolve(process.env.GOONDAN_STATE_ROOT);
  }
  return path.join(os.homedir(), '.goondan');
}

/**
 * workspaceId 생성
 *
 * SwarmBundleRoot의 디렉토리명을 prefix로 사용하고 SHA-256 해시 8자를 suffix로 붙여
 * 사람이 읽을 수 있는 workspace 식별자를 생성한다.
 *
 * 예: /Users/alice/projects/my-agent → "my-agent-a1b2c3d4"
 */
export function generateWorkspaceId(swarmBundleRoot: string): string {
  const normalized = path.resolve(swarmBundleRoot);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  const dirName = path.basename(normalized);
  // 파일시스템 안전 문자로 정규화, 소문자 통일
  const sanitized = dirName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const prefix = sanitized.slice(0, 48) || 'workspace';
  return `${prefix}-${hash.slice(0, 8)}`;
}

/**
 * instanceId 생성
 *
 * swarmName과 instanceKey를 조합하고 특수문자를 -로 치환
 * 128자로 제한
 */
export function generateInstanceId(swarmName: string, instanceKey: string): string {
  const combined = `${swarmName}-${instanceKey}`;
  // 파일시스템 안전 문자로 정규화
  return combined.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
}

/**
 * SwarmBundleRoot 기본 레이아웃
 */
export const DEFAULT_LAYOUT: SwarmBundleRootLayout = {
  configFile: 'goondan.yaml',
  resourceDirs: ['resources'],
  promptsDir: 'prompts',
  toolsDir: 'tools',
  extensionsDir: 'extensions',
  connectorsDir: 'connectors',
  bundleManifest: 'bundle.yaml',
};
