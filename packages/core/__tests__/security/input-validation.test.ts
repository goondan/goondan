/**
 * 보안: 입력 검증 테스트
 *
 * 경로 순회, 악의적 입력, YAML bomb 등에 대한 방어 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SecretsStore } from '../../src/workspace/secrets.js';
import { parseYaml, parseMultiDocument } from '../../src/bundle/parser.js';
import { ParseError } from '../../src/bundle/errors.js';
import { normalizeObjectRef } from '../../src/types/utils.js';

describe('Security: Input Validation', () => {
  // =========================================================================
  // SecretsStore 경로 순회 방지
  // =========================================================================
  describe('SecretsStore path traversal prevention', () => {
    let tempDir: string;
    let store: SecretsStore;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goondan-security-test-'));
      store = new SecretsStore(path.join(tempDir, 'secrets'));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('경로 순회 문자열이 포함된 이름을 거부해야 한다 (set)', async () => {
      await expect(store.set('../../../etc/passwd', { value: 'malicious' }))
        .rejects.toThrow('Invalid secret name');
    });

    it('경로 순회 문자열이 포함된 이름을 거부해야 한다 (get)', async () => {
      await expect(store.get('../../../etc/passwd'))
        .rejects.toThrow('Invalid secret name');
    });

    it('경로 순회 문자열이 포함된 이름을 거부해야 한다 (delete)', async () => {
      await expect(store.delete('../../../etc/passwd'))
        .rejects.toThrow('Invalid secret name');
    });

    it('경로 순회 문자열이 포함된 이름을 거부해야 한다 (has)', async () => {
      await expect(store.has('../../../etc/passwd'))
        .rejects.toThrow('Invalid secret name');
    });

    it('슬래시가 포함된 이름을 거부해야 한다', async () => {
      await expect(store.set('foo/bar', { value: 'test' }))
        .rejects.toThrow('Invalid secret name');
    });

    it('백슬래시가 포함된 이름을 거부해야 한다', async () => {
      await expect(store.set('foo\\bar', { value: 'test' }))
        .rejects.toThrow('Invalid secret name');
    });

    it('빈 이름을 거부해야 한다', async () => {
      await expect(store.set('', { value: 'test' }))
        .rejects.toThrow('Secret name cannot be empty');
    });

    it('특수 문자가 포함된 이름을 거부해야 한다', async () => {
      await expect(store.set('secret;rm -rf /', { value: 'test' }))
        .rejects.toThrow('Invalid secret name');
    });

    it('점만으로 된 이름을 거부해야 한다', async () => {
      await expect(store.set('..', { value: 'test' }))
        .rejects.toThrow('Invalid secret name');
    });

    it('유효한 이름은 허용해야 한다', async () => {
      await expect(store.set('valid-secret_123', { value: 'test' }))
        .resolves.not.toThrow();
    });
  });

  // =========================================================================
  // YAML 파싱 보안
  // =========================================================================
  describe('YAML parsing security', () => {
    it('MAX_YAML_SIZE를 초과하는 입력을 거부해야 한다', () => {
      // 1MB 초과 문자열 생성
      const hugeYaml = 'a: ' + 'x'.repeat(1_100_000);

      expect(() => parseYaml(hugeYaml)).toThrow(ParseError);
      expect(() => parseYaml(hugeYaml)).toThrow('exceeds maximum size');
    });

    it('parseMultiDocument도 MAX_YAML_SIZE를 초과하는 입력을 거부해야 한다', () => {
      const hugeYaml = 'a: ' + 'x'.repeat(1_100_000);

      expect(() => parseMultiDocument(hugeYaml)).toThrow(ParseError);
      expect(() => parseMultiDocument(hugeYaml)).toThrow('exceeds maximum size');
    });

    it('과도한 수의 YAML 문서를 거부해야 한다', () => {
      // 101개 문서 생성
      const docs = Array.from({ length: 110 }, (_, i) =>
        `kind: Model\nmetadata:\n  name: model-${i}\nspec:\n  provider: test\n  name: test`
      ).join('\n---\n');

      expect(() => parseMultiDocument(docs)).toThrow(ParseError);
      expect(() => parseMultiDocument(docs)).toThrow('Too many YAML documents');
    });

    it('정상적인 크기의 YAML은 파싱되어야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: test
spec:
  provider: openai
  name: gpt-5
`;
      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('prototype pollution 시도를 안전하게 처리해야 한다', () => {
      // __proto__ 키가 있는 YAML
      const yaml = `
kind: Model
metadata:
  name: test
spec:
  __proto__:
    polluted: true
`;
      const result = parseYaml(yaml);
      expect(result).toBeDefined();
      // Object.prototype이 오염되지 않았는지 확인
      const emptyObj: Record<string, unknown> = {};
      expect(emptyObj['polluted']).toBeUndefined();
    });
  });

  // =========================================================================
  // ObjectRef 보안
  // =========================================================================
  describe('ObjectRef validation security', () => {
    it('빈 kind를 거부해야 한다', () => {
      expect(() => normalizeObjectRef('/name')).toThrow('Invalid ObjectRef');
    });

    it('빈 name을 거부해야 한다', () => {
      expect(() => normalizeObjectRef('Kind/')).toThrow('Invalid ObjectRef');
    });

    it('슬래시가 없는 문자열을 거부해야 한다', () => {
      expect(() => normalizeObjectRef('invalid')).toThrow('Invalid ObjectRef');
    });
  });
});
