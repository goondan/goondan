/**
 * Bundle Parser 테스트
 * @see /docs/specs/bundle.md - 1. 공통 규칙
 */

import { describe, it, expect } from 'vitest';
import {
  parseYaml,
  parseMultiDocument,
  DEFAULT_API_VERSION,
} from '../../src/bundle/parser.js';
import { ParseError } from '../../src/bundle/errors.js';

describe('Bundle Parser', () => {
  describe('parseYaml', () => {
    it('단일 YAML 문서를 파싱할 수 있어야 한다', () => {
      const yaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: test-model
spec:
  provider: openai
  name: gpt-5
`;
      const result = parseYaml(yaml);
      expect(result).toEqual({
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'test-model' },
        spec: { provider: 'openai', name: 'gpt-5' },
      });
    });

    it('잘못된 YAML 문법에 대해 ParseError를 던져야 한다', () => {
      // 명확하게 잘못된 YAML - 중복 키와 잘못된 인덴테이션
      const invalidYaml = `
kind: Model
kind: Tool
  - invalid: [broken
`;
      expect(() => parseYaml(invalidYaml)).toThrow(ParseError);
    });

    it('빈 문자열에 대해 null을 반환해야 한다', () => {
      expect(parseYaml('')).toBeNull();
      expect(parseYaml('   ')).toBeNull();
    });
  });

  describe('parseMultiDocument', () => {
    it('--- 구분자로 여러 문서를 파싱할 수 있어야 한다', () => {
      const yaml = `
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5

---

apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: model-2
spec:
  provider: anthropic
  name: claude-sonnet-4-5
`;
      const results = parseMultiDocument(yaml);
      expect(results).toHaveLength(2);
      expect(results[0]?.metadata.name).toBe('model-1');
      expect(results[1]?.metadata.name).toBe('model-2');
    });

    it('빈 문서(--- 만 있는 경우)를 무시해야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: model-1
spec:
  provider: openai
  name: gpt-5

---

---

kind: Model
metadata:
  name: model-2
spec:
  provider: anthropic
  name: claude-sonnet-4-5
`;
      const results = parseMultiDocument(yaml);
      expect(results).toHaveLength(2);
    });

    it('apiVersion이 생략된 경우 기본값을 적용해야 한다', () => {
      const yaml = `
kind: Model
metadata:
  name: test-model
spec:
  provider: openai
  name: gpt-5
`;
      const results = parseMultiDocument(yaml);
      expect(results).toHaveLength(1);
      expect(results[0]?.apiVersion).toBe(DEFAULT_API_VERSION);
    });

    it('labels와 annotations를 파싱할 수 있어야 한다', () => {
      const yaml = `
kind: Tool
metadata:
  name: my-tool
  labels:
    tier: base
    category: filesystem
  annotations:
    description: "파일 시스템 도구"
spec:
  runtime: node
  entry: "./index.ts"
  exports: []
`;
      const results = parseMultiDocument(yaml);
      expect(results[0]?.metadata.labels).toEqual({
        tier: 'base',
        category: 'filesystem',
      });
      expect(results[0]?.metadata.annotations).toEqual({
        description: '파일 시스템 도구',
      });
    });

    it('객체형 ObjectRef를 파싱할 수 있어야 한다', () => {
      const yaml = `
kind: Agent
metadata:
  name: test-agent
spec:
  modelConfig:
    modelRef: { kind: Model, name: gpt-5 }
  prompts:
    system: "Test prompt"
`;
      const results = parseMultiDocument(yaml);
      const agent = results[0];
      expect(agent?.spec.modelConfig.modelRef).toEqual({
        kind: 'Model',
        name: 'gpt-5',
      });
    });

    it('문자열 축약 ObjectRef를 파싱할 수 있어야 한다', () => {
      const yaml = `
kind: Agent
metadata:
  name: test-agent
spec:
  modelConfig:
    modelRef: Model/gpt-5
  prompts:
    system: "Test prompt"
  tools:
    - Tool/fileRead
    - Tool/webSearch
`;
      const results = parseMultiDocument(yaml);
      const agent = results[0];
      expect(agent?.spec.modelConfig.modelRef).toBe('Model/gpt-5');
      expect(agent?.spec.tools).toEqual(['Tool/fileRead', 'Tool/webSearch']);
    });

    it('파싱 오류 시 소스 정보를 포함해야 한다', () => {
      const yaml = `
kind: Model
  bad: indentation
`;
      try {
        parseMultiDocument(yaml, 'test-file.yaml');
        expect.fail('ParseError가 발생해야 합니다');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        if (error instanceof ParseError) {
          expect(error.source).toBe('test-file.yaml');
        }
      }
    });
  });

  describe('DEFAULT_API_VERSION', () => {
    it('기본 apiVersion이 올바르게 설정되어야 한다', () => {
      expect(DEFAULT_API_VERSION).toBe('agents.example.io/v1alpha1');
    });
  });
});
