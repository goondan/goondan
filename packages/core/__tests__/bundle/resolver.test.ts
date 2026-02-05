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
