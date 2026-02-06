/**
 * Bundle Validator 테스트
 * @see /docs/specs/bundle.md - 6. Validation 포인트 확장
 */

import { describe, it, expect } from 'vitest';
import {
  validateResource,
  validateResources,
  validateNameUniqueness,
  validateObjectRef,
  validateValueSource,
  validateScopesSubset,
} from '../../src/bundle/validator.js';
import { ValidationError, ReferenceError } from '../../src/bundle/errors.js';
import type { Resource } from '../../src/types/index.js';

describe('Bundle Validator', () => {
  describe('validateResource', () => {
    it('유효한 리소스를 검증해야 한다', () => {
      const resource: Resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'test-model' },
        spec: {
          provider: 'openai',
          name: 'gpt-5',
        },
      };
      const errors = validateResource(resource);
      expect(errors).toHaveLength(0);
    });

    it('apiVersion이 없으면 오류를 반환해야 한다', () => {
      const resource = {
        kind: 'Model',
        metadata: { name: 'test-model' },
        spec: { provider: 'openai', name: 'gpt-5' },
      } as unknown as Resource;
      const errors = validateResource(resource);
      expect(errors.some((e) => e.path === '/apiVersion')).toBe(true);
    });

    it('kind가 없으면 오류를 반환해야 한다', () => {
      const resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        metadata: { name: 'test-model' },
        spec: {},
      } as unknown as Resource;
      const errors = validateResource(resource);
      expect(errors.some((e) => e.path === '/kind')).toBe(true);
    });

    it('metadata.name이 없으면 오류를 반환해야 한다', () => {
      const resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: {},
        spec: {},
      } as unknown as Resource;
      const errors = validateResource(resource);
      expect(errors.some((e) => e.path === '/metadata/name')).toBe(true);
    });

    it('metadata.name 형식이 잘못되면 경고를 반환해야 한다', () => {
      const resource: Resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'Invalid_Name' },
        spec: { provider: 'openai', name: 'gpt-5' },
      };
      const errors = validateResource(resource);
      const nameWarning = errors.find(
        (e) => e.path === '/metadata/name' && e.level === 'warning'
      );
      expect(nameWarning).toBeDefined();
    });

    it('metadata.labels 값이 문자열이 아니면 오류를 반환해야 한다', () => {
      const resource: Resource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: {
          name: 'test-model',
          labels: { tier: 123 } as unknown as Record<string, string>,
        },
        spec: { provider: 'openai', name: 'gpt-5' },
      };
      const errors = validateResource(resource);
      expect(errors.some((e) => e.path?.includes('/metadata/labels'))).toBe(
        true
      );
    });
  });

  describe('validateResources - Kind별 필수 필드', () => {
    describe('Model', () => {
      it('provider가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'test-model' },
          spec: { name: 'gpt-5' },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/provider')).toBe(true);
      });

      it('name이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'test-model' },
          spec: { provider: 'openai' },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/name')).toBe(true);
      });
    });

    describe('Tool', () => {
      it('runtime이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'test-tool' },
          spec: {
            entry: './index.ts',
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/runtime')).toBe(true);
      });

      it('runtime이 유효하지 않으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'test-tool' },
          spec: {
            runtime: 'ruby',
            entry: './index.ts',
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/runtime')).toBe(true);
      });

      it('entry가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'test-tool' },
          spec: {
            runtime: 'node',
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/entry')).toBe(true);
      });

      it('exports가 없거나 빈 배열이면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'test-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            exports: [],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/exports')).toBe(true);
      });

      it('export에 name이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'test-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            exports: [
              { description: 'test', parameters: { type: 'object' } },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path?.includes('/spec/exports'))).toBe(true);
      });
    });

    describe('Extension', () => {
      it('runtime이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'test-ext' },
          spec: { entry: './index.ts' },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/runtime')).toBe(true);
      });

      it('entry가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Extension',
          metadata: { name: 'test-ext' },
          spec: { runtime: 'node' },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/entry')).toBe(true);
      });
    });

    describe('Agent', () => {
      it('modelConfig.modelRef가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'test-agent' },
          spec: {
            modelConfig: {},
            prompts: { system: 'test' },
          },
        };
        const errors = validateResources([resource]);
        expect(
          errors.some((e) => e.path === '/spec/modelConfig/modelRef')
        ).toBe(true);
      });

      it('prompts.system과 systemRef가 모두 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'test-agent' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'test' } },
            prompts: {},
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/prompts')).toBe(true);
      });

      it('prompts.system과 systemRef가 동시에 있으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'test-agent' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'test' } },
            prompts: { system: 'test', systemRef: './test.md' },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/prompts')).toBe(true);
      });
    });

    describe('Swarm', () => {
      it('entrypoint가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: {
            agents: [{ kind: 'Agent', name: 'agent-1' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/entrypoint')).toBe(true);
      });

      it('agents가 없거나 빈 배열이면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'agent-1' },
            agents: [],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/agents')).toBe(true);
      });
    });

    describe('Connector', () => {
      it('type이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {},
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/type')).toBe(true);
      });

      it('custom 타입에서 runtime과 entry가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            type: 'custom',
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/runtime')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/entry')).toBe(true);
      });
    });

    describe('Connection', () => {
      it('connectorRef가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            rules: [
              {
                route: {
                  swarmRef: { kind: 'Swarm', name: 'test' },
                  instanceKeyFrom: '$.id',
                  inputFrom: '$.text',
                },
              },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/connectorRef')).toBe(true);
      });

      it('auth에서 oauthAppRef와 staticToken이 동시에 있으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'slack' },
            auth: {
              oauthAppRef: { kind: 'OAuthApp', name: 'slack' },
              staticToken: { value: 'token' },
            },
            rules: [],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/auth')).toBe(true);
      });

      it('유효한 Connection은 오류가 없어야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'cli' },
            rules: [
              {
                route: {
                  swarmRef: { kind: 'Swarm', name: 'default' },
                  instanceKeyFrom: '$.instanceKey',
                  inputFrom: '$.text',
                },
              },
            ],
          },
        };
        const errors = validateResources([resource]);
        // 공통 검증 오류만 확인 (Connection 자체의 kind별 검증은 통과해야 함)
        const connectionErrors = errors.filter(
          (e) => e.kind === 'Connection' && e.level !== 'warning'
        );
        expect(connectionErrors).toHaveLength(0);
      });
    });

    describe('OAuthApp', () => {
      it('필수 필드가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'test-oauth' },
          spec: {},
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/provider')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/flow')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/subjectMode')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/scopes')).toBe(true);
      });

      it('authorizationCode flow에서 필수 필드가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'test-oauth' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: { value: 'id' },
              clientSecret: { value: 'secret' },
            },
            endpoints: {
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['read'],
            redirect: {},
          },
        };
        const errors = validateResources([resource]);
        expect(
          errors.some((e) => e.path === '/spec/endpoints/authorizationUrl')
        ).toBe(true);
        expect(
          errors.some((e) => e.path === '/spec/redirect/callbackPath')
        ).toBe(true);
      });
    });
  });

  describe('validateNameUniqueness', () => {
    it('동일 kind 내 중복 이름을 탐지해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'same-name' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'same-name' },
          spec: { provider: 'anthropic', name: 'claude' },
        },
      ];
      const errors = validateNameUniqueness(resources);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.message).toContain('duplicate');
    });

    it('다른 kind에서는 같은 이름을 허용해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'same-name' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'same-name' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        },
      ];
      const errors = validateNameUniqueness(resources);
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateObjectRef', () => {
    it('유효한 문자열 ObjectRef를 검증해야 한다', () => {
      const errors = validateObjectRef('Tool/fileRead');
      expect(errors).toHaveLength(0);
    });

    it('유효한 객체형 ObjectRef를 검증해야 한다', () => {
      const errors = validateObjectRef({ kind: 'Tool', name: 'fileRead' });
      expect(errors).toHaveLength(0);
    });

    it('잘못된 문자열 형식에 대해 오류를 반환해야 한다', () => {
      expect(validateObjectRef('fileRead')).toHaveLength(1);
      expect(validateObjectRef('Tool/slack/postMessage')).toHaveLength(1);
      expect(validateObjectRef('Tool/')).toHaveLength(1);
      expect(validateObjectRef('/name')).toHaveLength(1);
    });

    it('객체형에서 kind가 없으면 오류를 반환해야 한다', () => {
      const errors = validateObjectRef({ name: 'test' } as unknown);
      expect(errors).toHaveLength(1);
    });

    it('객체형에서 name이 없으면 오류를 반환해야 한다', () => {
      const errors = validateObjectRef({ kind: 'Tool' } as unknown);
      expect(errors).toHaveLength(1);
    });
  });

  describe('validateValueSource', () => {
    it('value를 가진 ValueSource를 검증해야 한다', () => {
      const errors = validateValueSource({ value: 'test-value' });
      expect(errors).toHaveLength(0);
    });

    it('valueFrom.env를 가진 ValueSource를 검증해야 한다', () => {
      const errors = validateValueSource({
        valueFrom: { env: 'MY_ENV_VAR' },
      });
      expect(errors).toHaveLength(0);
    });

    it('valueFrom.secretRef를 가진 ValueSource를 검증해야 한다', () => {
      const errors = validateValueSource({
        valueFrom: {
          secretRef: { ref: 'Secret/my-secret', key: 'api_key' },
        },
      });
      expect(errors).toHaveLength(0);
    });

    it('value와 valueFrom이 동시에 있으면 오류를 반환해야 한다', () => {
      const errors = validateValueSource({
        value: 'test',
        valueFrom: { env: 'TEST' },
      } as unknown);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('mutually exclusive');
    });

    it('value와 valueFrom이 모두 없으면 오류를 반환해야 한다', () => {
      const errors = validateValueSource({});
      expect(errors).toHaveLength(1);
    });

    it('valueFrom에서 env와 secretRef가 동시에 있으면 오류를 반환해야 한다', () => {
      const errors = validateValueSource({
        valueFrom: {
          env: 'TEST',
          secretRef: { ref: 'Secret/test', key: 'key' },
        },
      } as unknown);
      expect(errors).toHaveLength(1);
    });

    it('secretRef.ref 형식이 잘못되면 오류를 반환해야 한다', () => {
      const errors = validateValueSource({
        valueFrom: {
          secretRef: { ref: 'invalid-format', key: 'key' },
        },
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('Secret/');
    });
  });

  describe('validateScopesSubset', () => {
    it('부분집합인 경우 오류가 없어야 한다', () => {
      const parentScopes = ['read', 'write', 'admin'];
      const childScopes = ['read', 'write'];
      const errors = validateScopesSubset(childScopes, parentScopes, '/test');
      expect(errors).toHaveLength(0);
    });

    it('동일한 경우 오류가 없어야 한다', () => {
      const scopes = ['read', 'write'];
      const errors = validateScopesSubset(scopes, scopes, '/test');
      expect(errors).toHaveLength(0);
    });

    it('부분집합이 아닌 경우 오류를 반환해야 한다', () => {
      const parentScopes = ['read', 'write'];
      const childScopes = ['read', 'admin'];
      const errors = validateScopesSubset(childScopes, parentScopes, '/test');
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('admin');
    });

    it('빈 배열은 유효한 부분집합이어야 한다', () => {
      const parentScopes = ['read', 'write'];
      const errors = validateScopesSubset([], parentScopes, '/test');
      expect(errors).toHaveLength(0);
    });
  });
});
