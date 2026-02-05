/**
 * OAuthStore 테스트
 * @see /docs/specs/oauth.md - 5. OAuthStore 구조
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  OAuthStore,
  createOAuthStore,
  generateGrantId,
} from '../../src/oauth/store.js';
import type {
  OAuthGrantRecord,
  AuthSessionRecord,
  EncryptedValue,
} from '../../src/oauth/types.js';

describe('OAuthStore', () => {
  let tempDir: string;
  let store: OAuthStore;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `oauth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    store = createOAuthStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('generateGrantId', () => {
    it('oauthAppRef와 subject로 결정적 ID를 생성한다', () => {
      const id1 = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');
      const id2 = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');
      expect(id1).toBe(id2);
    });

    it('다른 subject는 다른 ID를 생성한다', () => {
      const id1 = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');
      const id2 = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T222');
      expect(id1).not.toBe(id2);
    });

    it('다른 oauthAppRef는 다른 ID를 생성한다', () => {
      const id1 = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');
      const id2 = generateGrantId({ kind: 'OAuthApp', name: 'github-app' }, 'slack:team:T111');
      expect(id1).not.toBe(id2);
    });

    it('ID는 grant- 접두사로 시작한다', () => {
      const id = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');
      expect(id).toMatch(/^grant-/);
    });

    it('문자열 형태의 oauthAppRef도 지원한다', () => {
      const id1 = generateGrantId('OAuthApp/slack-bot', 'slack:team:T111');
      const id2 = generateGrantId({ kind: 'OAuthApp', name: 'slack-bot' }, 'slack:team:T111');
      expect(id1).toBe(id2);
    });
  });

  describe('Grant 저장/조회', () => {
    const mockEncryptedToken: EncryptedValue = {
      algorithm: 'aes-256-gcm',
      iv: 'test-iv',
      ciphertext: 'test-ciphertext',
      tag: 'test-tag',
    };

    const createTestGrant = (name: string): OAuthGrantRecord => ({
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'OAuthGrantRecord',
      metadata: { name },
      spec: {
        provider: 'slack',
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        subject: 'slack:team:T111',
        flow: 'authorization_code',
        scopesGranted: ['chat:write', 'channels:read'],
        token: {
          tokenType: 'bearer',
          accessToken: mockEncryptedToken,
          issuedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revoked: false,
      },
    });

    it('Grant를 저장하고 조회할 수 있다', async () => {
      const grantId = 'grant-test123';
      const grant = createTestGrant(grantId);

      await store.saveGrant(grant);
      const retrieved = await store.getGrant(grantId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata.name).toBe(grantId);
      expect(retrieved?.spec.provider).toBe('slack');
    });

    it('존재하지 않는 Grant는 null을 반환한다', async () => {
      const retrieved = await store.getGrant('non-existent');
      expect(retrieved).toBeNull();
    });

    it('Grant를 업데이트할 수 있다', async () => {
      const grantId = 'grant-update-test';
      const grant = createTestGrant(grantId);

      await store.saveGrant(grant);

      const updatedGrant: OAuthGrantRecord = {
        ...grant,
        spec: {
          ...grant.spec,
          scopesGranted: ['chat:write', 'channels:read', 'users:read'],
          updatedAt: new Date().toISOString(),
        },
      };

      await store.saveGrant(updatedGrant);
      const retrieved = await store.getGrant(grantId);

      expect(retrieved?.spec.scopesGranted).toContain('users:read');
    });

    it('Grant를 철회할 수 있다', async () => {
      const grantId = 'grant-revoke-test';
      const grant = createTestGrant(grantId);

      await store.saveGrant(grant);
      await store.revokeGrant(grantId);

      const retrieved = await store.getGrant(grantId);
      expect(retrieved?.spec.revoked).toBe(true);
      expect(retrieved?.spec.revokedAt).toBeDefined();
    });

    it('Grant를 삭제할 수 있다', async () => {
      const grantId = 'grant-delete-test';
      const grant = createTestGrant(grantId);

      await store.saveGrant(grant);
      await store.deleteGrant(grantId);

      const retrieved = await store.getGrant(grantId);
      expect(retrieved).toBeNull();
    });
  });

  describe('Session 저장/조회', () => {
    const mockEncryptedValue: EncryptedValue = {
      algorithm: 'aes-256-gcm',
      iv: 'test-iv',
      ciphertext: 'test-ciphertext',
      tag: 'test-tag',
    };

    const createTestSession = (name: string): AuthSessionRecord => ({
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'AuthSessionRecord',
      metadata: { name },
      spec: {
        provider: 'slack',
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        subjectMode: 'global',
        subject: 'slack:team:T111',
        requestedScopes: ['chat:write', 'channels:read'],
        flow: {
          type: 'authorization_code',
          pkce: {
            method: 'S256',
            codeVerifier: mockEncryptedValue,
            codeChallenge: 'test-challenge',
          },
          state: mockEncryptedValue,
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        resume: {
          swarmRef: { kind: 'Swarm', name: 'default' },
          instanceKey: '1700000000.000100',
          agentName: 'planner',
          origin: { connector: 'slack-main', channel: 'C123' },
          auth: {
            actor: { type: 'user', id: 'slack:U234567' },
            subjects: { global: 'slack:team:T111' },
          },
        },
      },
    });

    it('Session을 저장하고 조회할 수 있다', async () => {
      const sessionId = 'as-test123';
      const session = createTestSession(sessionId);

      await store.saveSession(session);
      const retrieved = await store.getSession(sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata.name).toBe(sessionId);
      expect(retrieved?.spec.status).toBe('pending');
    });

    it('존재하지 않는 Session은 null을 반환한다', async () => {
      const retrieved = await store.getSession('non-existent');
      expect(retrieved).toBeNull();
    });

    it('Session 상태를 업데이트할 수 있다', async () => {
      const sessionId = 'as-update-test';
      const session = createTestSession(sessionId);

      await store.saveSession(session);
      await store.updateSessionStatus(sessionId, 'completed');

      const retrieved = await store.getSession(sessionId);
      expect(retrieved?.spec.status).toBe('completed');
    });

    it('Session 상태를 실패로 업데이트하면 사유를 기록한다', async () => {
      const sessionId = 'as-fail-test';
      const session = createTestSession(sessionId);

      await store.saveSession(session);
      await store.updateSessionStatus(sessionId, 'failed', 'User denied access');

      const retrieved = await store.getSession(sessionId);
      expect(retrieved?.spec.status).toBe('failed');
      expect(retrieved?.spec.statusReason).toBe('User denied access');
    });

    it('Session을 삭제할 수 있다', async () => {
      const sessionId = 'as-delete-test';
      const session = createTestSession(sessionId);

      await store.saveSession(session);
      await store.deleteSession(sessionId);

      const retrieved = await store.getSession(sessionId);
      expect(retrieved).toBeNull();
    });

    it('만료된 Session을 정리할 수 있다', async () => {
      const expiredSession = createTestSession('as-expired');
      expiredSession.spec.expiresAt = new Date(Date.now() - 1000).toISOString();

      const activeSession = createTestSession('as-active');
      activeSession.spec.expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await store.saveSession(expiredSession);
      await store.saveSession(activeSession);

      await store.cleanupExpiredSessions();

      const expired = await store.getSession('as-expired');
      const active = await store.getSession('as-active');

      expect(expired).toBeNull();
      expect(active).not.toBeNull();
    });
  });

  describe('디렉토리 구조', () => {
    it('grants 디렉토리가 생성된다', async () => {
      const grantId = 'grant-dir-test';
      const grant: OAuthGrantRecord = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'OAuthGrantRecord',
        metadata: { name: grantId },
        spec: {
          provider: 'slack',
          oauthAppRef: { kind: 'OAuthApp', name: 'test' },
          subject: 'test:subject',
          flow: 'authorization_code',
          scopesGranted: ['test'],
          token: {
            tokenType: 'bearer',
            accessToken: {
              algorithm: 'aes-256-gcm',
              iv: 'iv',
              ciphertext: 'ct',
              tag: 'tag',
            },
            issuedAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revoked: false,
        },
      };

      await store.saveGrant(grant);

      const grantsDir = join(tempDir, 'oauth', 'grants');
      const stats = await stat(grantsDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('sessions 디렉토리가 생성된다', async () => {
      const sessionId = 'as-dir-test';
      const session: AuthSessionRecord = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'AuthSessionRecord',
        metadata: { name: sessionId },
        spec: {
          provider: 'slack',
          oauthAppRef: { kind: 'OAuthApp', name: 'test' },
          subjectMode: 'global',
          subject: 'test:subject',
          requestedScopes: ['test'],
          flow: {
            type: 'authorization_code',
            state: {
              algorithm: 'aes-256-gcm',
              iv: 'iv',
              ciphertext: 'ct',
              tag: 'tag',
            },
          },
          status: 'pending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          resume: {
            swarmRef: { kind: 'Swarm', name: 'default' },
            instanceKey: '1',
            agentName: 'test',
            origin: {},
            auth: {},
          },
        },
      };

      await store.saveSession(session);

      const sessionsDir = join(tempDir, 'oauth', 'sessions');
      const stats = await stat(sessionsDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });
});
