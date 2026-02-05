/**
 * ResourceType Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.8 ResourceType
 */
import { describe, it, expect } from 'vitest';
import type {
  ResourceTypeSpec,
  ResourceTypeNames,
  ResourceTypeVersion,
  ResourceTypeResource,
} from '../../../src/types/specs/resource-type.js';

describe('ResourceTypeSpec 타입', () => {
  describe('ResourceTypeSpec 인터페이스', () => {
    it('group, names, versions, handlerRef는 필수이다', () => {
      const spec: ResourceTypeSpec = {
        group: 'rag.acme.io',
        names: {
          kind: 'Retrieval',
          plural: 'retrievals',
        },
        versions: [
          { name: 'v1alpha1', served: true, storage: true },
        ],
        handlerRef: { kind: 'ExtensionHandler', name: 'retrieval-handler' },
      };

      expect(spec.group).toBe('rag.acme.io');
      expect(spec.names.kind).toBe('Retrieval');
      expect(spec.versions.length).toBe(1);
      expect(spec.handlerRef.name).toBe('retrieval-handler');
    });
  });

  describe('ResourceTypeNames', () => {
    it('kind와 plural은 필수이다', () => {
      const names: ResourceTypeNames = {
        kind: 'Retrieval',
        plural: 'retrievals',
      };

      expect(names.kind).toBe('Retrieval');
      expect(names.plural).toBe('retrievals');
    });

    it('shortNames는 선택이다', () => {
      const names: ResourceTypeNames = {
        kind: 'Retrieval',
        plural: 'retrievals',
        shortNames: ['ret', 'retr'],
      };

      expect(names.shortNames).toEqual(['ret', 'retr']);
    });
  });

  describe('ResourceTypeVersion', () => {
    it('name, served, storage는 필수이다', () => {
      const version: ResourceTypeVersion = {
        name: 'v1alpha1',
        served: true,
        storage: true,
      };

      expect(version.name).toBe('v1alpha1');
      expect(version.served).toBe(true);
      expect(version.storage).toBe(true);
    });

    it('여러 버전을 정의할 수 있다', () => {
      const versions: ResourceTypeVersion[] = [
        { name: 'v1alpha1', served: true, storage: true },
        { name: 'v1beta1', served: true, storage: false },
        { name: 'v1', served: false, storage: false },
      ];

      expect(versions.length).toBe(3);
      expect(versions.filter(v => v.storage).length).toBe(1);
    });
  });

  describe('ResourceTypeResource 타입', () => {
    it('완전한 ResourceType 리소스를 정의할 수 있다', () => {
      const resource: ResourceTypeResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'ResourceType',
        metadata: {
          name: 'rag.acme.io/Retrieval',
        },
        spec: {
          group: 'rag.acme.io',
          names: {
            kind: 'Retrieval',
            plural: 'retrievals',
            shortNames: ['ret'],
          },
          versions: [
            { name: 'v1alpha1', served: true, storage: true },
            { name: 'v1beta1', served: true, storage: false },
          ],
          handlerRef: {
            kind: 'ExtensionHandler',
            name: 'retrieval-handler',
          },
        },
      };

      expect(resource.kind).toBe('ResourceType');
      expect(resource.spec.group).toBe('rag.acme.io');
      expect(resource.spec.names.kind).toBe('Retrieval');
      expect(resource.spec.versions.length).toBe(2);
    });

    it('Memory ResourceType 리소스를 정의할 수 있다', () => {
      const resource: ResourceTypeResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'ResourceType',
        metadata: {
          name: 'memory.acme.io/Memory',
        },
        spec: {
          group: 'memory.acme.io',
          names: {
            kind: 'Memory',
            plural: 'memories',
          },
          versions: [
            { name: 'v1alpha1', served: true, storage: true },
          ],
          handlerRef: {
            kind: 'ExtensionHandler',
            name: 'memory-handler',
          },
        },
      };

      expect(resource.kind).toBe('ResourceType');
      expect(resource.spec.names.plural).toBe('memories');
    });
  });
});
