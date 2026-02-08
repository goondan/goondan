/**
 * Bundle Loader 테스트
 * @see /docs/specs/bundle.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadBundleFromString,
  loadBundleFromFile,
  loadBundleFromDirectory,
  type BundleLoadResult,
} from '../../src/bundle/loader.js';

describe('Bundle Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    // 임시 디렉토리 생성
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goondan-test-'));
  });

  afterEach(() => {
    // 임시 디렉토리 삭제
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadBundleFromString', () => {
    it('유효한 Bundle YAML을 로드해야 한다', () => {
      const yaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai
  name: gpt-5
`;
      const result = loadBundleFromString(yaml);
      expect(result.resources).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });

    it('다중 문서 YAML을 로드해야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5

---

kind: Model
metadata:
  name: model-2
spec:
  provider: anthropic
  name: claude-sonnet-4-5
`;
      const result = loadBundleFromString(yaml);
      expect(result.resources).toHaveLength(2);
    });

    it('검증 오류가 있어도 파싱은 계속되어야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: invalid-model
spec:
  # provider와 name 누락
`;
      const result = loadBundleFromString(yaml);
      expect(result.resources).toHaveLength(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('이름 중복 검증을 수행해야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: same-name
spec:
  provider: openai
  name: gpt-5

---

kind: Model
metadata:
  name: same-name
spec:
  provider: anthropic
  name: claude
`;
      const result = loadBundleFromString(yaml);
      expect(result.errors.some((e) => e.message.includes('duplicate'))).toBe(
        true
      );
    });

    it('참조 무결성 검증을 수행해야 한다', () => {
      const yaml = `
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    modelRef: Model/nonexistent
  prompts:
    system: "test"
`;
      const result = loadBundleFromString(yaml);
      expect(
        result.errors.some((e) => e.message.includes('nonexistent'))
      ).toBe(true);
    });
  });

  describe('loadBundleFromFile', () => {
    it('단일 YAML 파일을 로드해야 한다', async () => {
      const filePath = path.join(tempDir, 'bundle.yaml');
      const content = `
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai
  name: gpt-5
`;
      fs.writeFileSync(filePath, content);

      const result = await loadBundleFromFile(filePath);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.metadata.name).toBe('gpt-5');
    });

    it('.yml 확장자 파일도 로드해야 한다', async () => {
      const filePath = path.join(tempDir, 'bundle.yml');
      const content = `
kind: Model
metadata:
  name: test-model
spec:
  provider: openai
  name: gpt-5
`;
      fs.writeFileSync(filePath, content);

      const result = await loadBundleFromFile(filePath);
      expect(result.resources).toHaveLength(1);
    });

    it('존재하지 않는 파일에 대해 오류를 반환해야 한다', async () => {
      const result = await loadBundleFromFile('/nonexistent/path.yaml');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('loadBundleFromDirectory', () => {
    it('디렉토리 내 모든 YAML 파일을 로드해야 한다', async () => {
      // 여러 파일 생성
      fs.writeFileSync(
        path.join(tempDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'agents.yaml'),
        `
kind: Agent
metadata:
  name: agent-1
spec:
  modelConfig:
    modelRef: Model/model-1
  prompts:
    system: "test"
`
      );

      const result = await loadBundleFromDirectory(tempDir);
      expect(result.resources).toHaveLength(2);
      expect(result.resources.some((r) => r.kind === 'Model')).toBe(true);
      expect(result.resources.some((r) => r.kind === 'Agent')).toBe(true);
    });

    it('하위 디렉토리의 YAML 파일도 로드해야 한다', async () => {
      // 하위 디렉토리 생성
      const subDir = path.join(tempDir, 'tools');
      fs.mkdirSync(subDir);

      fs.writeFileSync(
        path.join(tempDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      fs.writeFileSync(
        path.join(subDir, 'file-tools.yaml'),
        `
kind: Tool
metadata:
  name: fileRead
spec:
  runtime: node
  entry: "./tools/file-read/index.ts"
  exports:
    - name: file.read
      description: "파일 읽기"
      parameters:
        type: object
        properties:
          path:
            type: string
        required: ["path"]
`
      );

      const result = await loadBundleFromDirectory(tempDir);
      expect(result.resources).toHaveLength(2);
    });

    it('YAML이 아닌 파일은 무시해야 한다', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      fs.writeFileSync(path.join(tempDir, 'readme.md'), '# README');
      fs.writeFileSync(
        path.join(tempDir, 'config.json'),
        '{"key": "value"}'
      );

      const result = await loadBundleFromDirectory(tempDir);
      expect(result.resources).toHaveLength(1);
    });

    it('파일 간 참조를 검증해야 한다', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai
  name: gpt-5
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'agents.yaml'),
        `
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    modelRef: Model/gpt-5
  prompts:
    system: "test"
`
      );

      const result = await loadBundleFromDirectory(tempDir);
      // Model/gpt-5가 있으므로 참조 오류 없음
      expect(
        result.errors.filter((e) => e.message.includes('not found'))
      ).toHaveLength(0);
    });

    it('존재하지 않는 디렉토리에 대해 오류를 반환해야 한다', async () => {
      const result = await loadBundleFromDirectory('/nonexistent/directory');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('glob 패턴으로 특정 파일만 로드할 수 있어야 한다', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      fs.writeFileSync(
        path.join(tempDir, 'agents.yaml'),
        `
kind: Agent
metadata:
  name: agent-1
spec:
  modelConfig:
    modelRef: Model/model-1
  prompts:
    system: "test"
`
      );

      const result = await loadBundleFromDirectory(tempDir, {
        pattern: '**/models.yaml',
      });
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.kind).toBe('Model');
    });

    it('dependency package의 spec.resources 경로가 안전하지 않으면 오류를 반환해야 한다', async () => {
      const depDir = path.join(tempDir, 'dep');
      fs.mkdirSync(path.join(depDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(depDir, 'package.yaml'),
        `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: dep
  version: "1.0.0"
spec:
  resources:
    - ../escape.yaml
  dist:
    - dist/
`
      );

      const rootDir = path.join(tempDir, 'root');
      fs.mkdirSync(rootDir, { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, 'package.yaml'),
        `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: root
  version: "1.0.0"
spec:
  dependencies:
    - "file:../dep"
  dist:
    - dist/
`
      );
      fs.writeFileSync(
        path.join(rootDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      const result = await loadBundleFromDirectory(rootDir);
      expect(result.errors.some((e) => e.message.includes('Unsafe package path'))).toBe(true);
    });

    it('dependency 리소스 spec.entry 경로가 안전하지 않으면 오류를 반환해야 한다', async () => {
      const depDir = path.join(tempDir, 'dep-entry');
      fs.mkdirSync(path.join(depDir, 'dist', 'tools'), { recursive: true });
      fs.writeFileSync(
        path.join(depDir, 'package.yaml'),
        `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: dep-entry
  version: "1.0.0"
spec:
  resources:
    - tools/tool.yaml
  dist:
    - dist/
`
      );
      fs.writeFileSync(
        path.join(depDir, 'dist', 'tools', 'tool.yaml'),
        `
kind: Tool
metadata:
  name: unsafe-tool
spec:
  runtime: node
  entry: "../outside.js"
  exports:
    - name: test
      description: test
      parameters:
        type: object
`
      );

      const rootDir = path.join(tempDir, 'root-entry');
      fs.mkdirSync(rootDir, { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, 'package.yaml'),
        `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: root-entry
  version: "1.0.0"
spec:
  dependencies:
    - "file:../dep-entry"
  dist:
    - dist/
`
      );
      fs.writeFileSync(
        path.join(rootDir, 'models.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      const result = await loadBundleFromDirectory(rootDir);
      expect(result.errors.some((e) => e.message.includes('spec.entry'))).toBe(true);
      expect(
        result.resources.some((r) => r.kind === 'Tool' && r.metadata.name === 'unsafe-tool')
      ).toBe(false);
    });

    it('동일 패키지에 대한 버전 요구가 충돌하면 오류를 반환해야 한다', async () => {
      const sharedPackageDir = path.join(
        tempDir,
        '.goondan',
        'packages',
        '@test',
        'shared'
      );
      fs.mkdirSync(path.join(sharedPackageDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(sharedPackageDir, 'package.yaml'),
        `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "@test/shared"
  version: "1.2.0"
spec:
  resources: []
  dist:
    - dist/
`
      );

      const rootDir = path.join(tempDir, 'root-version-conflict');
      fs.mkdirSync(rootDir, { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, 'package.yaml'),
        `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: root-version-conflict
  version: "1.0.0"
spec:
  dependencies:
    - "@test/shared@^1.0.0"
    - "@test/shared@^2.0.0"
  dist:
    - dist/
`
      );
      fs.writeFileSync(
        path.join(rootDir, 'model.yaml'),
        `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5
`
      );

      const result = await loadBundleFromDirectory(rootDir);
      expect(result.errors.some((e) => e.message.includes('Version conflict for @test/shared'))).toBe(
        true
      );
    });
  });

  describe('BundleLoadResult', () => {
    it('isValid()가 오류 여부를 반환해야 한다', () => {
      const validResult: BundleLoadResult = {
        resources: [],
        errors: [],
        sources: [],
        isValid: () => true,
        getResourcesByKind: () => [],
        getResource: () => undefined,
      };
      expect(validResult.isValid()).toBe(true);
    });

    it('getResourcesByKind()로 특정 kind 리소스를 조회할 수 있어야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5

---

kind: Tool
metadata:
  name: tool-1
spec:
  runtime: node
  entry: "./index.ts"
  exports: []

---

kind: Model
metadata:
  name: model-2
spec:
  provider: anthropic
  name: claude
`;
      const result = loadBundleFromString(yaml);
      const models = result.getResourcesByKind('Model');
      expect(models).toHaveLength(2);
      expect(models.every((m) => m.kind === 'Model')).toBe(true);
    });

    it('getResource()로 특정 리소스를 조회할 수 있어야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: gpt-5
spec:
  provider: openai
  name: gpt-5
`;
      const result = loadBundleFromString(yaml);
      const model = result.getResource('Model', 'gpt-5');
      expect(model).toBeDefined();
      expect(model?.metadata.name).toBe('gpt-5');

      const notFound = result.getResource('Model', 'nonexistent');
      expect(notFound).toBeUndefined();
    });
  });
});
