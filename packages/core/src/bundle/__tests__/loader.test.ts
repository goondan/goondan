/**
 * Bundle Loader 테스트
 * @see /docs/specs/bundle_package.md
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadBundleFromString, loadBundleFromDirectory } from '../loader.js';

describe('loadBundleFromString', () => {
  it('단일 리소스 파싱', () => {
    const yaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: test-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5
`;
    const result = loadBundleFromString(yaml);
    expect(result.isValid()).toBe(true);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.kind).toBe('Model');
    expect(result.resources[0]?.metadata.name).toBe('test-model');
  });

  it('다중 문서 파싱', () => {
    const yaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: model-1
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: model-2
spec:
  provider: openai
  name: gpt-4
`;
    const result = loadBundleFromString(yaml);
    expect(result.isValid()).toBe(true);
    expect(result.resources).toHaveLength(2);
    expect(result.getResource('Model', 'model-1')).toBeDefined();
    expect(result.getResource('Model', 'model-2')).toBeDefined();
  });

  it('Kind별 리소스 조회', () => {
    const yaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: test-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: test-tool
spec:
  runtime: node
  entry: "./test.js"
  exports: []
`;
    const result = loadBundleFromString(yaml);
    expect(result.getResourcesByKind('Model')).toHaveLength(1);
    expect(result.getResourcesByKind('Tool')).toHaveLength(1);
  });
});

describe('loadBundleFromDirectory - Dependency Loading', () => {
  const testDir = path.join(process.cwd(), '__test_bundle_loader__');
  const packageDir = path.join(testDir, '.goondan', 'packages', '@test', 'base');
  const distDir = path.join(packageDir, 'dist');

  beforeAll(async () => {
    // 테스트 디렉토리 구조 생성
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.mkdir(path.join(distDir, 'tools', 'test-tool'), { recursive: true });

    // 패키지 package.yaml 생성
    const packageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "@test/base"
  version: "1.0.0"
spec:
  dependencies: []
  resources:
    - tools/test-tool/tool.yaml
  dist:
    - dist/
`;
    await fs.promises.writeFile(path.join(packageDir, 'package.yaml'), packageYaml);

    // 도구 YAML 생성
    const toolYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: test-tool-from-package
spec:
  runtime: node
  entry: "./tools/test-tool/index.js"
  exports:
    - name: test.run
      description: "테스트 도구"
      parameters:
        type: object
        properties:
          input:
            type: string
        required: ["input"]
`;
    await fs.promises.writeFile(path.join(distDir, 'tools', 'test-tool', 'tool.yaml'), toolYaml);

    // 프로젝트 package.yaml 생성
    const projectPackageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "test-project"
  version: "0.1.0"
spec:
  dependencies:
    - "@test/base@1.0.0"
  resources:
    - goondan.yaml
`;
    await fs.promises.writeFile(path.join(testDir, 'package.yaml'), projectPackageYaml);

    // 프로젝트 goondan.yaml 생성
    const goondanYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: project-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: test-agent
spec:
  modelConfig:
    modelRef: { kind: Model, name: project-model }
    params:
      temperature: 0.5
  tools:
    - { kind: Tool, name: test-tool-from-package }
`;
    await fs.promises.writeFile(path.join(testDir, 'goondan.yaml'), goondanYaml);
  });

  afterAll(async () => {
    // 테스트 디렉토리 정리
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it('dependency 패키지에서 리소스 자동 로드', async () => {
    const result = await loadBundleFromDirectory(testDir);

    expect(result.isValid()).toBe(true);

    // 패키지에서 로드된 Tool
    const tool = result.getResource('Tool', 'test-tool-from-package');
    expect(tool).toBeDefined();
    expect(tool?.metadata.annotations?.['goondan.io/package']).toBe('@test/base');
    expect(tool?.metadata.annotations?.['goondan.io/package-version']).toBe('1.0.0');

    // 프로젝트에서 로드된 리소스
    expect(result.getResource('Model', 'project-model')).toBeDefined();
    expect(result.getResource('Agent', 'test-agent')).toBeDefined();
  });

  it('entry 경로가 패키지 dist 기준 절대 경로로 변환됨', async () => {
    const result = await loadBundleFromDirectory(testDir);

    const tool = result.getResource('Tool', 'test-tool-from-package');
    expect(tool).toBeDefined();

    const spec = tool?.spec as Record<string, unknown>;
    const entry = spec?.['entry'] as string;

    // 절대 경로로 변환되었는지 확인
    expect(path.isAbsolute(entry)).toBe(true);
    expect(entry).toContain('dist');
    expect(entry).toContain('tools/test-tool/index.js');
  });
});

describe('loadBundleFromDirectory - Resource Override', () => {
  const testDir = path.join(process.cwd(), '__test_bundle_override__');
  const packageDir = path.join(testDir, '.goondan', 'packages', '@test', 'base');
  const distDir = path.join(packageDir, 'dist');

  beforeAll(async () => {
    // 테스트 디렉토리 구조 생성
    await fs.promises.mkdir(distDir, { recursive: true });

    // 패키지 package.yaml 생성
    const packageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "@test/base"
  version: "1.0.0"
spec:
  resources:
    - model.yaml
  dist:
    - dist/
`;
    await fs.promises.writeFile(path.join(packageDir, 'package.yaml'), packageYaml);

    // 패키지의 model.yaml
    const packageModelYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: shared-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5
`;
    await fs.promises.writeFile(path.join(distDir, 'model.yaml'), packageModelYaml);

    // 프로젝트 package.yaml
    const projectPackageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "test-project"
  version: "0.1.0"
spec:
  dependencies:
    - "@test/base@1.0.0"
`;
    await fs.promises.writeFile(path.join(testDir, 'package.yaml'), projectPackageYaml);

    // 프로젝트의 goondan.yaml (동일 이름 리소스로 오버라이드)
    const goondanYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: shared-model
spec:
  provider: openai
  name: gpt-4
`;
    await fs.promises.writeFile(path.join(testDir, 'goondan.yaml'), goondanYaml);
  });

  afterAll(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it('프로젝트 리소스가 패키지 리소스를 오버라이드', async () => {
    const result = await loadBundleFromDirectory(testDir);

    expect(result.isValid()).toBe(true);

    // 동일 Kind/name 리소스는 1개만 존재해야 함
    const models = result.getResourcesByKind('Model');
    expect(models).toHaveLength(1);

    // 프로젝트 리소스가 덮어썼으므로 openai/gpt-4여야 함
    const model = result.getResource('Model', 'shared-model');
    expect(model).toBeDefined();
    const spec = model?.spec as Record<string, unknown>;
    expect(spec?.['provider']).toBe('openai');
    expect(spec?.['name']).toBe('gpt-4');

    // 패키지 annotation이 없어야 함 (프로젝트 리소스이므로)
    expect(model?.metadata.annotations?.['goondan.io/package']).toBeUndefined();
  });
});

describe('parseDependencyRef', () => {
  // parseDependencyRef는 내부 함수이므로 loadBundleFromDirectory를 통해 간접 테스트

  it('@scope/name@version 형식 처리', async () => {
    const testDir = path.join(process.cwd(), '__test_dep_ref__');
    const packageDir = path.join(testDir, '.goondan', 'packages', '@my-scope', 'my-package');

    await fs.promises.mkdir(packageDir, { recursive: true });

    // 빈 패키지
    const packageYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "@my-scope/my-package"
  version: "2.0.0"
spec:
  resources: []
`;
    await fs.promises.writeFile(path.join(packageDir, 'package.yaml'), packageYaml);

    // 프로젝트
    const projectYaml = `
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "test"
  version: "0.1.0"
spec:
  dependencies:
    - "@my-scope/my-package@2.0.0"
`;
    await fs.promises.writeFile(path.join(testDir, 'package.yaml'), projectYaml);

    const result = await loadBundleFromDirectory(testDir);
    // 오류 없이 로드되면 성공
    expect(result.errors).toHaveLength(0);

    await fs.promises.rm(testDir, { recursive: true, force: true });
  });
});
