/**
 * Secrets 저장소 테스트
 * @see /docs/specs/workspace.md - 섹션 8.1: secrets 디렉터리
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SecretsStore, SecretEntry } from '../../src/workspace/secrets.js';

describe('SecretsStore', () => {
  let tempDir: string;
  let secretsDir: string;
  let store: SecretsStore;

  beforeEach(async () => {
    // 임시 디렉터리 생성
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-test-'));
    secretsDir = path.join(tempDir, 'secrets');
    store = new SecretsStore(secretsDir);
  });

  afterEach(async () => {
    // 임시 디렉터리 정리
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('set', () => {
    it('시크릿을 저장해야 한다', async () => {
      await store.set('api-key', { value: 'secret-value-123' });

      const filePath = path.join(secretsDir, 'api-key.json');
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content) as SecretEntry;

      expect(data.value).toBe('secret-value-123');
    });

    it('디렉터리가 없으면 자동으로 생성해야 한다', async () => {
      await store.set('new-secret', { value: 'new-value' });

      const dirExists = await fs
        .stat(secretsDir)
        .then(s => s.isDirectory())
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('메타데이터와 함께 저장할 수 있다', async () => {
      await store.set('api-key', {
        value: 'secret-value',
        metadata: {
          description: 'API key for service',
          createdAt: '2026-02-01T12:00:00.000Z',
        },
      });

      const filePath = path.join(secretsDir, 'api-key.json');
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content) as SecretEntry;

      expect(data.metadata?.description).toBe('API key for service');
      expect(data.metadata?.createdAt).toBe('2026-02-01T12:00:00.000Z');
    });

    it('기존 시크릿을 덮어써야 한다', async () => {
      await store.set('api-key', { value: 'old-value' });
      await store.set('api-key', { value: 'new-value' });

      const result = await store.get('api-key');
      expect(result?.value).toBe('new-value');
    });
  });

  describe('get', () => {
    it('존재하는 시크릿을 가져와야 한다', async () => {
      await store.set('api-key', { value: 'secret-value' });

      const result = await store.get('api-key');
      expect(result?.value).toBe('secret-value');
    });

    it('존재하지 않는 시크릿은 undefined를 반환해야 한다', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('메타데이터도 함께 가져와야 한다', async () => {
      await store.set('api-key', {
        value: 'secret-value',
        metadata: { description: 'Test secret' },
      });

      const result = await store.get('api-key');
      expect(result?.metadata?.description).toBe('Test secret');
    });
  });

  describe('delete', () => {
    it('시크릿을 삭제해야 한다', async () => {
      await store.set('api-key', { value: 'secret-value' });
      await store.delete('api-key');

      const result = await store.get('api-key');
      expect(result).toBeUndefined();
    });

    it('존재하지 않는 시크릿 삭제는 무시해야 한다', async () => {
      // 에러 없이 완료되어야 함
      await expect(store.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('has', () => {
    it('존재하는 시크릿은 true를 반환해야 한다', async () => {
      await store.set('api-key', { value: 'secret-value' });

      const exists = await store.has('api-key');
      expect(exists).toBe(true);
    });

    it('존재하지 않는 시크릿은 false를 반환해야 한다', async () => {
      const exists = await store.has('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('list', () => {
    it('모든 시크릿 이름을 나열해야 한다', async () => {
      await store.set('secret-1', { value: 'value-1' });
      await store.set('secret-2', { value: 'value-2' });
      await store.set('secret-3', { value: 'value-3' });

      const names = await store.list();
      expect(names.sort()).toEqual(['secret-1', 'secret-2', 'secret-3']);
    });

    it('빈 디렉터리는 빈 배열을 반환해야 한다', async () => {
      const names = await store.list();
      expect(names).toEqual([]);
    });

    it('.json 확장자만 나열해야 한다', async () => {
      await store.set('valid-secret', { value: 'value' });
      // 직접 다른 파일 생성
      await fs.mkdir(secretsDir, { recursive: true });
      await fs.writeFile(path.join(secretsDir, 'not-a-secret.txt'), 'text');

      const names = await store.list();
      expect(names).toEqual(['valid-secret']);
    });
  });

  describe('getPath', () => {
    it('시크릿 파일 경로를 반환해야 한다', () => {
      const secretPath = store.getPath('api-key');
      expect(secretPath).toBe(path.join(secretsDir, 'api-key.json'));
    });
  });

  describe('시크릿 이름 유효성', () => {
    it('알파벳, 숫자, 하이픈, 언더스코어를 허용해야 한다', async () => {
      await expect(store.set('valid-secret_123', { value: 'value' })).resolves.toBeUndefined();
    });

    it('빈 이름을 거부해야 한다', async () => {
      await expect(store.set('', { value: 'value' })).rejects.toThrow();
    });

    it('경로 traversal을 방지해야 한다', async () => {
      await expect(store.set('../escape', { value: 'value' })).rejects.toThrow();
      await expect(store.set('../../etc/passwd', { value: 'value' })).rejects.toThrow();
    });

    it('슬래시를 포함한 이름을 거부해야 한다', async () => {
      await expect(store.set('path/to/secret', { value: 'value' })).rejects.toThrow();
    });
  });
});
