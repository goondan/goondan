/**
 * Secrets 저장소
 * @see /docs/specs/workspace.md - 섹션 8.1: secrets 디렉터리
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SecretEntry } from './types.js';

/**
 * 시크릿 이름 유효성 검사
 */
function validateSecretName(name: string): void {
  if (!name) {
    throw new Error('Secret name cannot be empty');
  }

  // 경로 traversal 방지
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`Invalid secret name: ${name}`);
  }

  // 안전한 문자만 허용
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid secret name: ${name}. Only alphanumeric, hyphen, and underscore are allowed.`);
  }
}

/**
 * SecretsStore - 시크릿 저장소 클래스
 */
export class SecretsStore {
  constructor(private readonly secretsDir: string) {}

  /**
   * 시크릿 파일 경로 반환
   */
  getPath(name: string): string {
    return path.join(this.secretsDir, `${name}.json`);
  }

  /**
   * 시크릿 저장
   */
  async set(name: string, entry: SecretEntry): Promise<void> {
    validateSecretName(name);

    await fs.mkdir(this.secretsDir, { recursive: true });
    const filePath = this.getPath(name);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');
  }

  /**
   * 시크릿 조회
   */
  async get(name: string): Promise<SecretEntry | undefined> {
    const filePath = this.getPath(name);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as SecretEntry;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * 시크릿 삭제
   */
  async delete(name: string): Promise<void> {
    const filePath = this.getPath(name);

    try {
      await fs.unlink(filePath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        // 파일이 없으면 무시
        return;
      }
      throw err;
    }
  }

  /**
   * 시크릿 존재 여부 확인
   */
  async has(name: string): Promise<boolean> {
    const filePath = this.getPath(name);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 모든 시크릿 이름 나열
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.secretsDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.slice(0, -5)); // .json 제거
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }
}

// Re-export SecretEntry for convenience
export type { SecretEntry } from './types.js';
