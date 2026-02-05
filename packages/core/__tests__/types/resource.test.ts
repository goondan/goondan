/**
 * Resource 타입 테스트
 * @see /docs/specs/resources.md - 1. 리소스 공통 형식, 2. Metadata 구조
 */
import { describe, it, expect } from 'vitest';
import type {
  Resource,
  ResourceMetadata,
  KnownKind,
} from '../../src/types/resource.js';
import { isResource, isResourceOfKind } from '../../src/types/utils.js';

describe('Resource 타입', () => {
  describe('ResourceMetadata', () => {
    it('name 필드는 필수이다', () => {
      const metadata: ResourceMetadata = {
        name: 'my-resource',
      };
      expect(metadata.name).toBe('my-resource');
    });

    it('labels 필드는 선택이다', () => {
      const metadata: ResourceMetadata = {
        name: 'my-resource',
        labels: {
          tier: 'base',
          env: 'production',
        },
      };
      expect(metadata.labels).toEqual({ tier: 'base', env: 'production' });
    });

    it('annotations 필드는 선택이다', () => {
      const metadata: ResourceMetadata = {
        name: 'my-resource',
        annotations: {
          description: '테스트 리소스',
          author: 'team-a',
        },
      };
      expect(metadata.annotations).toEqual({
        description: '테스트 리소스',
        author: 'team-a',
      });
    });

    it('namespace 필드는 선택이다', () => {
      const metadata: ResourceMetadata = {
        name: 'my-resource',
        namespace: 'default',
      };
      expect(metadata.namespace).toBe('default');
    });
  });

  describe('Resource<T>', () => {
    it('기본 필드들을 모두 가져야 한다', () => {
      const resource: Resource<{ provider: string }> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'my-model' },
        spec: { provider: 'openai' },
      };

      expect(resource.apiVersion).toBe('agents.example.io/v1alpha1');
      expect(resource.kind).toBe('Model');
      expect(resource.metadata.name).toBe('my-model');
      expect(resource.spec.provider).toBe('openai');
    });

    it('제네릭 타입 파라미터로 spec 타입을 지정할 수 있다', () => {
      interface TestSpec {
        value: string;
        count: number;
      }

      const resource: Resource<TestSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Test',
        metadata: { name: 'test' },
        spec: { value: 'hello', count: 42 },
      };

      expect(resource.spec.value).toBe('hello');
      expect(resource.spec.count).toBe(42);
    });
  });

  describe('KnownKind', () => {
    it('알려진 Kind들을 포함해야 한다', () => {
      const kinds: KnownKind[] = [
        'Model',
        'Tool',
        'Extension',
        'Agent',
        'Swarm',
        'Connector',
        'OAuthApp',
        'ResourceType',
        'ExtensionHandler',
        'Bundle',
        'Package',
      ];

      expect(kinds.length).toBe(11);
    });
  });

  describe('isResource 타입 가드', () => {
    it('유효한 Resource 객체에 대해 true를 반환해야 한다', () => {
      const resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'my-model' },
        spec: { provider: 'openai', name: 'gpt-5' },
      };

      expect(isResource(resource)).toBe(true);
    });

    it('apiVersion이 없으면 false를 반환해야 한다', () => {
      const invalid = {
        kind: 'Model',
        metadata: { name: 'my-model' },
        spec: {},
      };

      expect(isResource(invalid)).toBe(false);
    });

    it('kind가 없으면 false를 반환해야 한다', () => {
      const invalid = {
        apiVersion: 'agents.example.io/v1alpha1',
        metadata: { name: 'my-model' },
        spec: {},
      };

      expect(isResource(invalid)).toBe(false);
    });

    it('metadata가 없으면 false를 반환해야 한다', () => {
      const invalid = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        spec: {},
      };

      expect(isResource(invalid)).toBe(false);
    });

    it('spec이 없으면 false를 반환해야 한다', () => {
      const invalid = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'my-model' },
      };

      expect(isResource(invalid)).toBe(false);
    });

    it('null에 대해 false를 반환해야 한다', () => {
      expect(isResource(null)).toBe(false);
    });

    it('undefined에 대해 false를 반환해야 한다', () => {
      expect(isResource(undefined)).toBe(false);
    });

    it('primitive 값에 대해 false를 반환해야 한다', () => {
      expect(isResource('string')).toBe(false);
      expect(isResource(42)).toBe(false);
      expect(isResource(true)).toBe(false);
    });
  });

  describe('isResourceOfKind 타입 가드', () => {
    it('지정된 Kind와 일치하면 true를 반환해야 한다', () => {
      const resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'my-model' },
        spec: { provider: 'openai', name: 'gpt-5' },
      };

      expect(isResourceOfKind(resource, 'Model')).toBe(true);
    });

    it('지정된 Kind와 일치하지 않으면 false를 반환해야 한다', () => {
      const resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'my-model' },
        spec: { provider: 'openai', name: 'gpt-5' },
      };

      expect(isResourceOfKind(resource, 'Tool')).toBe(false);
    });

    it('Resource가 아니면 false를 반환해야 한다', () => {
      const invalid = { some: 'object' };
      expect(isResourceOfKind(invalid, 'Model')).toBe(false);
    });
  });
});
