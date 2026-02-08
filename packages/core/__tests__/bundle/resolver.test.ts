/**
 * Bundle Resolver 테스트
 * @see /docs/specs/bundle.md - 2. ObjectRef 상세
 */

import { describe, it, expect } from 'vitest';
import {
  resolveObjectRef,
  resolveAllReferences,
  detectCircularReferences,
  createResourceIndex,
} from '../../src/bundle/resolver.js';
import { ReferenceError } from '../../src/bundle/errors.js';
import type { Resource } from '../../src/types/index.js';

describe('Bundle Resolver', () => {
  describe('createResourceIndex', () => {
    it('리소스를 kind/name 형식으로 인덱싱해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'gpt-5' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'fileRead' },
          spec: { runtime: 'node', entry: './index.ts', exports: [] },
        },
      ];
      const index = createResourceIndex(resources);
      expect(index.get('Model/gpt-5')).toBeDefined();
      expect(index.get('Tool/fileRead')).toBeDefined();
      expect(index.get('Model/unknown')).toBeUndefined();
    });
  });

  describe('resolveObjectRef', () => {
    const resources: Resource[] = [
      {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Model',
        metadata: { name: 'gpt-5' },
        spec: { provider: 'openai', name: 'gpt-5' },
      },
      {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'fileRead' },
        spec: { runtime: 'node', entry: './index.ts', exports: [] },
      },
    ];
    const index = createResourceIndex(resources);

    it('문자열 ObjectRef를 해석해야 한다', () => {
      const result = resolveObjectRef('Model/gpt-5', index);
      expect(result).toBeDefined();
      expect(result?.kind).toBe('Model');
      expect(result?.metadata.name).toBe('gpt-5');
    });

    it('객체형 ObjectRef를 해석해야 한다', () => {
      const result = resolveObjectRef(
        { kind: 'Tool', name: 'fileRead' },
        index
      );
      expect(result).toBeDefined();
      expect(result?.kind).toBe('Tool');
    });

    it('존재하지 않는 참조에 대해 undefined를 반환해야 한다', () => {
      const result = resolveObjectRef('Model/unknown', index);
      expect(result).toBeUndefined();
    });

    it('package 스코프가 지정되면 해당 패키지와 일치할 때만 해석해야 한다', () => {
      const scopedResources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: {
            name: 'fileRead',
            annotations: {
              'goondan.io/package': '@goondan/base',
              'goondan.io/package-version': '1.0.0',
            },
          },
          spec: { runtime: 'node', entry: './index.ts', exports: [] },
        },
      ];
      const scopedIndex = createResourceIndex(scopedResources);

      expect(
        resolveObjectRef(
          { kind: 'Tool', name: 'fileRead', package: '@goondan/base' },
          scopedIndex
        )
      ).toBeDefined();
      expect(
        resolveObjectRef(
          { kind: 'Tool', name: 'fileRead', package: '@goondan/other@1.0.0' },
          scopedIndex
        )
      ).toBeUndefined();
    });
  });

  describe('resolveAllReferences', () => {
    it('모든 유효한 참조를 검증해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'gpt-5' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'planner' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
            prompts: { system: 'test' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'default' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'planner' },
            agents: [{ kind: 'Agent', name: 'planner' }],
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors).toHaveLength(0);
    });

    it('ObjectRef.package가 지정되면 해당 패키지 스코프로 참조를 제한해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: {
            name: 'shared-oauth',
            annotations: {
              'goondan.io/package': '@goondan/base',
              'goondan.io/package-version': '1.0.0',
            },
          },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: { value: 'id' },
              clientSecret: { value: 'secret' },
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write'],
            redirect: { callbackPath: '/callback' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'scoped-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            auth: {
              oauthAppRef: {
                kind: 'OAuthApp',
                name: 'shared-oauth',
                package: '@goondan/base',
              },
              scopes: ['chat:write'],
            },
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        },
      ];

      const errors = resolveAllReferences(resources);
      expect(errors).toHaveLength(0);
    });

    it('ObjectRef.package가 잘못되면 참조를 실패해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: {
            name: 'shared-oauth',
            annotations: {
              'goondan.io/package': '@goondan/base',
              'goondan.io/package-version': '1.0.0',
            },
          },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: { value: 'id' },
              clientSecret: { value: 'secret' },
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write'],
            redirect: { callbackPath: '/callback' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'wrong-scope-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            auth: {
              oauthAppRef: {
                kind: 'OAuthApp',
                name: 'shared-oauth',
                package: '@goondan/other@2.0.0',
              },
              scopes: ['chat:write'],
            },
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        },
      ];

      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.message.includes('not found in package'))).toBe(
        true
      );
    });

    it('package 미지정 참조는 유일 매칭을 강제해야 한다', () => {
      const baseOAuthSpec = {
        provider: 'slack',
        flow: 'authorizationCode',
        subjectMode: 'global',
        client: {
          clientId: { value: 'id' },
          clientSecret: { value: 'secret' },
        },
        endpoints: {
          authorizationUrl: 'https://example.com/auth',
          tokenUrl: 'https://example.com/token',
        },
        scopes: ['chat:write'],
        redirect: { callbackPath: '/callback' },
      };

      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: {
            name: 'shared-oauth',
            annotations: {
              'goondan.io/package': '@goondan/base',
              'goondan.io/package-version': '1.0.0',
            },
          },
          spec: baseOAuthSpec,
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: {
            name: 'shared-oauth',
            annotations: {
              'goondan.io/package': '@goondan/tools',
              'goondan.io/package-version': '2.0.0',
            },
          },
          spec: baseOAuthSpec,
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'ambiguous-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            auth: {
              oauthAppRef: { kind: 'OAuthApp', name: 'shared-oauth' },
              scopes: ['chat:write'],
            },
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        },
      ];

      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.message.includes('Ambiguous reference'))).toBe(
        true
      );
    });

    it('존재하지 않는 참조에 대해 오류를 반환해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'planner' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'nonexistent' } },
            prompts: { system: 'test' },
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toBeInstanceOf(ReferenceError);
    });

    it('Agent의 tools 참조를 검증해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'gpt-5' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'planner' },
          spec: {
            modelConfig: { modelRef: 'Model/gpt-5' },
            prompts: { system: 'test' },
            tools: ['Tool/nonexistent'],
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes('Tool/nonexistent'))).toBe(
        true
      );
    });

    it('Swarm의 entrypoint가 agents에 포함되어야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'agent-1' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
            prompts: { system: 'test' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'agent-2' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
            prompts: { system: 'test' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'default' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'agent-1' },
            agents: [{ kind: 'Agent', name: 'agent-2' }], // entrypoint가 agents에 없음
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.message.includes('entrypoint'))).toBe(true);
    });

    it('Tool.auth.scopes가 OAuthApp.scopes의 부분집합인지 검증해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'slack-bot' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: { value: 'id' },
              clientSecret: { value: 'secret' },
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write', 'channels:read'],
            redirect: { callbackPath: '/callback' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'slack-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            auth: {
              oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
              scopes: ['chat:write', 'files:write'], // files:write는 OAuthApp에 없음
            },
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.message.includes('files:write'))).toBe(true);
    });

    it('Tool.exports[].auth.scopes가 Tool.auth.scopes의 부분집합인지 검증해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'slack-bot' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: { value: 'id' },
              clientSecret: { value: 'secret' },
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write', 'channels:read'],
            redirect: { callbackPath: '/callback' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'slack-tool' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            auth: {
              oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
              scopes: ['chat:write', 'channels:read'],
            },
            exports: [
              {
                name: 'slack.postMessage',
                description: 'post message',
                parameters: { type: 'object' },
                auth: { scopes: ['chat:write'] },
              },
              {
                name: 'slack.uploadFile',
                description: 'upload file',
                parameters: { type: 'object' },
                auth: { scopes: ['files:write'] },
              },
            ],
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.path === '/spec/exports/1/auth/scopes')).toBe(true);
      expect(errors.some((e) => e.message.includes('files:write'))).toBe(true);
    });

    it('Tool.auth.scopes가 없는데 export-level scopes가 있으면 오류를 반환해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'no-tool-scopes' },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            exports: [
              {
                name: 'slack.postMessage',
                description: 'post message',
                parameters: { type: 'object' },
                auth: { scopes: ['chat:write'] },
              },
            ],
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.path === '/spec/exports/0/auth/scopes')).toBe(true);
      expect(errors.some((e) => e.message.includes('Tool.auth.scopes'))).toBe(true);
    });

    it('Connection의 connectorRef를 검증해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'cli' },
          spec: { type: 'cli' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'default' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'agent-1' },
            agents: [{ kind: 'Agent', name: 'agent-1' }],
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'agent-1' },
          spec: {
            modelConfig: { modelRef: { kind: 'Model', name: 'gpt-5' } },
            prompts: { system: 'test' },
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'cli-to-default' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'cli' },
            ingress: {
              rules: [
                {
                  route: {
                    agentRef: { kind: 'Agent', name: 'agent-1' },
                  },
                },
              ],
            },
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      // Model/gpt-5가 없어서 Agent 참조 오류가 발생하지만, Connection 참조는 유효
      const connectionErrors = errors.filter(
        (e) => 'sourceKind' in e && e.sourceKind === 'Connection'
      );
      expect(connectionErrors).toHaveLength(0);
    });

    it('Connection의 존재하지 않는 connectorRef에 대해 오류를 반환해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'bad-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'nonexistent' },
            rules: [],
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.message.includes('Connector/nonexistent'))).toBe(true);
    });

    it('Connection의 ingress.rules[].route.agentRef를 검증해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'cli' },
          spec: { runtime: 'node', entry: './index.ts', triggers: [{ type: 'cli' }] },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'bad-rules' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'cli' },
            ingress: {
              rules: [
                {
                  route: {
                    agentRef: { kind: 'Agent', name: 'nonexistent' },
                  },
                },
              ],
            },
          },
        },
      ];
      const errors = resolveAllReferences(resources);
      expect(errors.some((e) => e.message.includes('Agent/nonexistent'))).toBe(true);
    });

    it('Selector를 가진 참조도 처리해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'gpt-5' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Tool',
          metadata: { name: 'fileRead', labels: { tier: 'base' } },
          spec: {
            runtime: 'node',
            entry: './index.ts',
            exports: [
              { name: 'test', description: 'test', parameters: { type: 'object' } },
            ],
          },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'planner' },
          spec: {
            modelConfig: { modelRef: 'Model/gpt-5' },
            prompts: { system: 'test' },
            tools: [
              {
                selector: { kind: 'Tool', matchLabels: { tier: 'base' } },
              },
            ],
          },
        },
      ];
      // Selector는 참조 무결성 검증 시 개별 검증하지 않음 (런타임에 해석)
      const errors = resolveAllReferences(resources);
      expect(errors).toHaveLength(0);
    });
  });

  describe('detectCircularReferences', () => {
    it('순환 참조가 없으면 빈 배열을 반환해야 한다', () => {
      const resources: Resource[] = [
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Model',
          metadata: { name: 'gpt-5' },
          spec: { provider: 'openai', name: 'gpt-5' },
        },
        {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Agent',
          metadata: { name: 'planner' },
          spec: {
            modelConfig: { modelRef: 'Model/gpt-5' },
            prompts: { system: 'test' },
          },
        },
      ];
      const cycles = detectCircularReferences(resources);
      expect(cycles).toHaveLength(0);
    });

    // 참고: 현재 스펙에서 순환 참조가 발생할 수 있는 구조가 제한적임
    // Extension이 다른 Extension을 참조하거나, ResourceType 핸들러 간 상호 참조 등
    // 향후 확장 시 순환 참조 탐지 로직 강화 필요
  });
});
