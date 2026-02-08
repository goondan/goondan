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

      it('queueMode가 serial이 아니면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'agent-1' },
            agents: [{ kind: 'Agent', name: 'agent-1' }],
            policy: { queueMode: 'parallel' },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/policy/queueMode')).toBe(true);
      });

      it('lifecycle의 양수가 아닌 값에 대해 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'agent-1' },
            agents: [{ kind: 'Agent', name: 'agent-1' }],
            policy: {
              lifecycle: {
                autoPauseIdleSeconds: -1,
                ttlSeconds: 0,
              },
            },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/policy/lifecycle/autoPauseIdleSeconds')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/policy/lifecycle/ttlSeconds')).toBe(true);
      });

      it('유효한 Swarm policy는 오류가 없어야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Swarm',
          metadata: { name: 'test-swarm' },
          spec: {
            entrypoint: { kind: 'Agent', name: 'agent-1' },
            agents: [{ kind: 'Agent', name: 'agent-1' }],
            policy: {
              maxStepsPerTurn: 32,
              queueMode: 'serial',
              lifecycle: {
                autoPauseIdleSeconds: 3600,
                ttlSeconds: 604800,
                gcGraceSeconds: 86400,
              },
            },
          },
        };
        const errors = validateResources([resource]);
        const swarmErrors = errors.filter(
          (e) => e.kind === 'Swarm' && e.level !== 'warning'
        );
        expect(swarmErrors).toHaveLength(0);
      });
    });

    describe('Connector', () => {
      it('runtime이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            entry: './connectors/test/index.ts',
            triggers: [{ type: 'cli' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/runtime')).toBe(true);
      });

      it('entry가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            triggers: [{ type: 'cli' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/entry')).toBe(true);
      });

      it('triggers가 없거나 빈 배열이면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/triggers')).toBe(true);
      });

      it('http trigger에서 endpoint가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [{ type: 'http' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path?.includes('/endpoint'))).toBe(true);
      });

      it('http trigger에서 endpoint.path가 /로 시작하지 않으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [
              { type: 'http', endpoint: { path: 'webhook/slack', method: 'POST' } },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path?.includes('/endpoint/path'))).toBe(true);
      });

      it('cron trigger에서 schedule이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [{ type: 'cron' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path?.includes('/schedule'))).toBe(true);
      });

      it('cron trigger에서 유효하지 않은 schedule이면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [{ type: 'cron', schedule: 'invalid cron' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/triggers/0/schedule')).toBe(true);
      });

      it('CLI trigger가 2개 이상이면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [{ type: 'cli' }, { type: 'cli' }],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/triggers')).toBe(true);
      });

      it('events 이름이 중복되면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [{ type: 'cli' }],
            events: [
              { name: 'message' },
              { name: 'message' },
            ],
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.message.includes('not unique'))).toBe(true);
      });

      it('유효한 Connector는 오류가 없어야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'test-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/test/index.ts',
            triggers: [
              { type: 'http', endpoint: { path: '/webhook/test', method: 'POST' } },
            ],
            events: [
              { name: 'message', properties: { channel_id: { type: 'string' } } },
            ],
          },
        };
        const errors = validateResources([resource]);
        const connectorErrors = errors.filter(
          (e) => e.kind === 'Connector' && e.level !== 'warning'
        );
        expect(connectorErrors).toHaveLength(0);
      });

      it('custom trigger를 포함한 Connector는 유효해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'telegram-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/telegram/index.ts',
            triggers: [
              { type: 'custom' },
              { type: 'http', endpoint: { path: '/telegram/webhook', method: 'POST' } },
            ],
            events: [
              { name: 'telegram.message', properties: { chatId: { type: 'string' } } },
            ],
          },
        };
        const errors = validateResources([resource]);
        const connectorErrors = errors.filter(
          (e) => e.kind === 'Connector' && e.level !== 'warning'
        );
        expect(connectorErrors).toHaveLength(0);
      });

      it('custom trigger만 있는 Connector도 유효해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connector',
          metadata: { name: 'polling-conn' },
          spec: {
            runtime: 'node',
            entry: './connectors/polling/index.ts',
            triggers: [{ type: 'custom' }],
            events: [{ name: 'update' }],
          },
        };
        const errors = validateResources([resource]);
        const connectorErrors = errors.filter(
          (e) => e.kind === 'Connector' && e.level !== 'warning'
        );
        expect(connectorErrors).toHaveLength(0);
      });
    });

    describe('Connection', () => {
      it('connectorRef가 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            ingress: {
              rules: [{ route: {} }],
            },
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
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/auth')).toBe(true);
      });

      it('auth.staticToken이 잘못된 ValueSource면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'bad-static-token' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'slack' },
            auth: {
              staticToken: {
                value: 'token',
                valueFrom: { env: 'TOKEN' },
              },
            },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/auth/staticToken')).toBe(true);
      });

      it('verify.webhook.signingSecret이 잘못된 ValueSource면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'bad-signing-secret' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'slack' },
            verify: {
              webhook: {
                signingSecret: {
                  valueFrom: {
                    env: 'A',
                    secretRef: { ref: 'Secret/slack', key: 'signing' },
                  },
                },
              },
            },
          },
        };
        const errors = validateResources([resource]);
        expect(
          errors.some((e) => e.path === '/spec/verify/webhook/signingSecret')
        ).toBe(true);
      });

      it('유효한 swarmRef가 있으면 오류가 없어야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'swarmref-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'cli' },
            swarmRef: { kind: 'Swarm', name: 'my-swarm' },
          },
        };
        const errors = validateResources([resource]);
        const connectionErrors = errors.filter(
          (e) => e.kind === 'Connection' && e.level !== 'warning'
        );
        expect(connectionErrors).toHaveLength(0);
      });

      it('잘못된 swarmRef 형식이면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'bad-swarmref' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'cli' },
            swarmRef: 42,
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/swarmRef')).toBe(true);
      });

      it('유효한 Connection은 오류가 없어야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'Connection',
          metadata: { name: 'test-connection' },
          spec: {
            connectorRef: { kind: 'Connector', name: 'cli' },
            ingress: {
              rules: [{ route: {} }],
            },
          },
        };
        const errors = validateResources([resource]);
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
        expect(errors.some((e) => e.path === '/spec/client')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/endpoints/tokenUrl')).toBe(
          true
        );
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

      it('client.clientId/clientSecret이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'missing-client-credentials' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {},
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write'],
            redirect: { callbackPath: '/oauth/callback' },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/client/clientId')).toBe(true);
        expect(errors.some((e) => e.path === '/spec/client/clientSecret')).toBe(
          true
        );
      });

      it('endpoints.tokenUrl이 없으면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'missing-token-url' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: { valueFrom: { env: 'SLACK_CLIENT_ID' } },
              clientSecret: { valueFrom: { env: 'SLACK_CLIENT_SECRET' } },
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
            },
            scopes: ['chat:write'],
            redirect: { callbackPath: '/oauth/callback' },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/endpoints/tokenUrl')).toBe(
          true
        );
      });

      it('deviceCode flow는 현재 런타임에서 거부되어야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'device-code-app' },
          spec: {
            provider: 'github',
            flow: 'deviceCode',
            subjectMode: 'user',
            client: {
              clientId: { value: 'id' },
              clientSecret: { value: 'secret' },
            },
            endpoints: {
              tokenUrl: 'https://github.com/login/oauth/access_token',
            },
            scopes: ['repo'],
            redirect: { callbackPath: '/oauth/callback/github' },
          },
        };

        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/flow')).toBe(true);
        expect(errors.some((e) => e.message.includes('deviceCode'))).toBe(true);
      });

      it('client.clientId가 잘못된 ValueSource면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'bad-client-id' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: {
                value: 'id',
                valueFrom: { env: 'SLACK_CLIENT_ID' },
              },
              clientSecret: {
                valueFrom: { env: 'SLACK_CLIENT_SECRET' },
              },
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write'],
            redirect: { callbackPath: '/oauth/callback' },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/client/clientId')).toBe(true);
      });

      it('client.clientSecret이 잘못된 ValueSource면 오류를 반환해야 한다', () => {
        const resource: Resource = {
          apiVersion: 'agents.example.io/v1alpha1',
          kind: 'OAuthApp',
          metadata: { name: 'bad-client-secret' },
          spec: {
            provider: 'slack',
            flow: 'authorizationCode',
            subjectMode: 'global',
            client: {
              clientId: {
                valueFrom: { env: 'SLACK_CLIENT_ID' },
              },
              clientSecret: {},
            },
            endpoints: {
              authorizationUrl: 'https://example.com/auth',
              tokenUrl: 'https://example.com/token',
            },
            scopes: ['chat:write'],
            redirect: { callbackPath: '/oauth/callback' },
          },
        };
        const errors = validateResources([resource]);
        expect(errors.some((e) => e.path === '/spec/client/clientSecret')).toBe(true);
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
