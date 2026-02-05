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
 * SwarmBundleRoot의 절대 경로를 정규화하고 SHA-256 해시의 처음 12자를 반환
 */
export function generateWorkspaceId(swarmBundleRoot: string): string {
  const normalized = path.resolve(swarmBundleRoot);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return hash.slice(0, 12);
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
