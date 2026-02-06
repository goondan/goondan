/**
 * OAuthStore - 토큰/세션 저장소
 * @see /docs/specs/oauth.md - 5. OAuthStore 구조
 */

import { mkdir, readFile, writeFile, unlink, readdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import type {
  OAuthGrantRecord,
  AuthSessionRecord,
  ObjectRef,
  ObjectRefLike,
} from './types.js';

/**
 * NodeJS.ErrnoException 타입 가드
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * OAuthStore 인터페이스
 */
export interface OAuthStore {
  // Grant 관련
  getGrant(grantId: string): Promise<OAuthGrantRecord | null>;
  saveGrant(grant: OAuthGrantRecord): Promise<void>;
  revokeGrant(grantId: string): Promise<void>;
  deleteGrant(grantId: string): Promise<void>;

  // Session 관련
  getSession(sessionId: string): Promise<AuthSessionRecord | null>;
  saveSession(session: AuthSessionRecord): Promise<void>;
  updateSessionStatus(
    sessionId: string,
    status: AuthSessionRecord['spec']['status'],
    reason?: string
  ): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  cleanupExpiredSessions(): Promise<void>;
}

/**
 * Grant ID 생성
 * oauthAppRef와 subject로 결정적 ID를 생성
 */
export function generateGrantId(
  oauthAppRef: ObjectRefLike,
  subject: string
): string {
  const ref = normalizeObjectRef(oauthAppRef);
  const key = `${ref.kind}/${ref.name}:${subject}`;
  const hash = createHash('sha256').update(key).digest('hex').substring(0, 16);
  return `grant-${hash}`;
}

/**
 * ObjectRefLike를 ObjectRef로 정규화
 */
function normalizeObjectRef(ref: ObjectRefLike): ObjectRef {
  if (typeof ref === 'string') {
    const parts = ref.split('/');
    const kind = parts[0];
    const name = parts[1];
    if (parts.length === 2 && kind !== undefined && name !== undefined) {
      return { kind, name };
    }
    throw new Error(`Invalid ObjectRefLike string: ${ref}`);
  }
  return ref;
}

/**
 * OAuth ID 유효성 검사 (경로 순회 방지)
 */
function validateOAuthId(id: string, label: string): void {
  if (!id) {
    throw new Error(`${label} cannot be empty`);
  }
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error(`Invalid ${label}: ${id}`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ${label}: ${id}. Only alphanumeric, hyphen, and underscore are allowed.`);
  }
}

/**
 * 파일 시스템 기반 OAuthStore 생성
 */
export function createOAuthStore(baseDir: string): OAuthStore {
  const oauthDir = join(baseDir, 'oauth');
  const grantsDir = join(oauthDir, 'grants');
  const sessionsDir = join(oauthDir, 'sessions');

  async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async function readJsonFile<T>(path: string): Promise<T | null> {
    try {
      const content = await readFile(path, 'utf8');
      // JSON.parse 결과를 제네릭 T로 변환 (readJsonFile/writeJsonFile 대칭 구조)
      const parsed: unknown = JSON.parse(content);
      return parsed as T;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async function writeJsonFile(path: string, data: unknown): Promise<void> {
    const dir = join(path, '..');
    await ensureDir(dir);
    await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  }

  async function deleteFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      // ENOENT (파일 없음)이면 무시, 그 외 에러는 전파
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  return {
    // ========================================================================
    // Grant 관련
    // ========================================================================

    async getGrant(grantId: string): Promise<OAuthGrantRecord | null> {
      validateOAuthId(grantId, 'grantId');
      const path = join(grantsDir, `${grantId}.json`);
      return readJsonFile<OAuthGrantRecord>(path);
    },

    async saveGrant(grant: OAuthGrantRecord): Promise<void> {
      const path = join(grantsDir, `${grant.metadata.name}.json`);
      await writeJsonFile(path, grant);
    },

    async revokeGrant(grantId: string): Promise<void> {
      const grant = await this.getGrant(grantId);
      if (!grant) {
        return;
      }

      grant.spec.revoked = true;
      grant.spec.revokedAt = new Date().toISOString();
      grant.spec.updatedAt = new Date().toISOString();

      await this.saveGrant(grant);
    },

    async deleteGrant(grantId: string): Promise<void> {
      validateOAuthId(grantId, 'grantId');
      const path = join(grantsDir, `${grantId}.json`);
      await deleteFile(path);
    },

    // ========================================================================
    // Session 관련
    // ========================================================================

    async getSession(sessionId: string): Promise<AuthSessionRecord | null> {
      validateOAuthId(sessionId, 'sessionId');
      const path = join(sessionsDir, `${sessionId}.json`);
      return readJsonFile<AuthSessionRecord>(path);
    },

    async saveSession(session: AuthSessionRecord): Promise<void> {
      const path = join(sessionsDir, `${session.metadata.name}.json`);
      await writeJsonFile(path, session);
    },

    async updateSessionStatus(
      sessionId: string,
      status: AuthSessionRecord['spec']['status'],
      reason?: string
    ): Promise<void> {
      const session = await this.getSession(sessionId);
      if (!session) {
        return;
      }

      session.spec.status = status;
      if (reason !== undefined) {
        session.spec.statusReason = reason;
      }

      await this.saveSession(session);
    },

    async deleteSession(sessionId: string): Promise<void> {
      validateOAuthId(sessionId, 'sessionId');
      const path = join(sessionsDir, `${sessionId}.json`);
      await deleteFile(path);
    },

    async cleanupExpiredSessions(): Promise<void> {
      try {
        const files = await readdir(sessionsDir);
        const now = Date.now();

        for (const file of files) {
          if (!file.endsWith('.json')) {
            continue;
          }

          const sessionId = file.replace('.json', '');
          const session = await this.getSession(sessionId);

          if (session) {
            const expiresAt = new Date(session.spec.expiresAt).getTime();
            if (expiresAt < now) {
              await this.deleteSession(sessionId);
            }
          }
        }
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          // 디렉토리가 없으면 정리할 것도 없음
          return;
        }
        throw error;
      }
    },
  };
}
