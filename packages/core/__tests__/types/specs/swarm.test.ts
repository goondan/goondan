/**
 * Swarm Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.5 Swarm
 */
import { describe, it, expect } from 'vitest';
import type {
  SwarmSpec,
  SwarmPolicy,
  SwarmLifecyclePolicy,
  SwarmChangesetPolicy,
  LiveConfigPolicy,
  SwarmResource,
} from '../../../src/types/specs/swarm.js';

describe('SwarmSpec 타입', () => {
  describe('SwarmSpec 인터페이스', () => {
    it('entrypoint와 agents는 필수이다', () => {
      const spec: SwarmSpec = {
        entrypoint: { kind: 'Agent', name: 'planner' },
        agents: [
          { kind: 'Agent', name: 'planner' },
          { kind: 'Agent', name: 'executor' },
        ],
      };

      expect(spec.entrypoint).toEqual({ kind: 'Agent', name: 'planner' });
      expect(spec.agents.length).toBe(2);
    });

    it('entrypoint에 문자열 형식을 사용할 수 있다', () => {
      const spec: SwarmSpec = {
        entrypoint: 'Agent/planner',
        agents: ['Agent/planner', 'Agent/executor'],
      };

      expect(spec.entrypoint).toBe('Agent/planner');
    });
  });

  describe('SwarmPolicy', () => {
    it('maxStepsPerTurn을 지정할 수 있다', () => {
      const policy: SwarmPolicy = {
        maxStepsPerTurn: 32,
      };

      expect(policy.maxStepsPerTurn).toBe(32);
    });

    it('queueMode를 지정할 수 있다', () => {
      const policy: SwarmPolicy = {
        queueMode: 'serial',
      };

      expect(policy.queueMode).toBe('serial');
    });

    it('retry 정책을 지정할 수 있다', () => {
      const policy: SwarmPolicy = {
        retry: {
          maxRetries: 3,
          backoffMs: 1000,
        },
      };

      expect(policy.retry?.maxRetries).toBe(3);
      expect(policy.retry?.backoffMs).toBe(1000);
    });

    it('timeout 정책을 지정할 수 있다', () => {
      const policy: SwarmPolicy = {
        timeout: {
          stepTimeoutMs: 30000,
          turnTimeoutMs: 120000,
        },
      };

      expect(policy.timeout?.stepTimeoutMs).toBe(30000);
      expect(policy.timeout?.turnTimeoutMs).toBe(120000);
    });

    describe('SwarmLifecyclePolicy', () => {
      it('autoPauseIdleSeconds를 지정할 수 있다', () => {
        const lifecycle: SwarmLifecyclePolicy = {
          autoPauseIdleSeconds: 300,
        };

        expect(lifecycle.autoPauseIdleSeconds).toBe(300);
      });

      it('ttlSeconds를 지정할 수 있다', () => {
        const lifecycle: SwarmLifecyclePolicy = {
          ttlSeconds: 86400,
        };

        expect(lifecycle.ttlSeconds).toBe(86400);
      });

      it('gcGraceSeconds를 지정할 수 있다', () => {
        const lifecycle: SwarmLifecyclePolicy = {
          gcGraceSeconds: 3600,
        };

        expect(lifecycle.gcGraceSeconds).toBe(3600);
      });

      it('모든 라이프사이클 필드를 조합할 수 있다', () => {
        const lifecycle: SwarmLifecyclePolicy = {
          autoPauseIdleSeconds: 300,
          ttlSeconds: 86400,
          gcGraceSeconds: 3600,
        };

        const policy: SwarmPolicy = {
          lifecycle,
        };

        expect(policy.lifecycle?.autoPauseIdleSeconds).toBe(300);
        expect(policy.lifecycle?.ttlSeconds).toBe(86400);
        expect(policy.lifecycle?.gcGraceSeconds).toBe(3600);
      });
    });

    describe('SwarmChangesetPolicy', () => {
      it('enabled로 활성화 여부를 지정할 수 있다', () => {
        const policy: SwarmChangesetPolicy = {
          enabled: true,
        };

        expect(policy.enabled).toBe(true);
      });

      it('applyAt으로 적용 시점을 지정할 수 있다', () => {
        const policy: SwarmChangesetPolicy = {
          enabled: true,
          applyAt: ['step.config'],
        };

        expect(policy.applyAt).toContain('step.config');
      });

      it('allowed.files로 허용 파일 패턴을 지정할 수 있다', () => {
        const policy: SwarmChangesetPolicy = {
          enabled: true,
          allowed: {
            files: ['resources/**', 'prompts/**', 'tools/**'],
          },
        };

        expect(policy.allowed?.files).toEqual([
          'resources/**',
          'prompts/**',
          'tools/**',
        ]);
      });

      it('emitRevisionChangedEvent로 이벤트 발행을 설정할 수 있다', () => {
        const policy: SwarmChangesetPolicy = {
          enabled: true,
          emitRevisionChangedEvent: true,
        };

        expect(policy.emitRevisionChangedEvent).toBe(true);
      });
    });

    describe('LiveConfigPolicy', () => {
      it('enabled로 활성화 여부를 지정할 수 있다', () => {
        const policy: LiveConfigPolicy = {
          enabled: true,
        };

        expect(policy.enabled).toBe(true);
      });

      it('applyAt으로 적용 시점을 지정할 수 있다', () => {
        const policy: LiveConfigPolicy = {
          enabled: true,
          applyAt: ['step.config'],
        };

        expect(policy.applyAt).toContain('step.config');
      });

      it('allowedPaths로 허용 경로를 지정할 수 있다', () => {
        const policy: LiveConfigPolicy = {
          enabled: true,
          allowedPaths: {
            agentRelative: ['/spec/tools', '/spec/extensions'],
            swarmRelative: ['/spec/policy'],
          },
        };

        expect(policy.allowedPaths?.agentRelative).toEqual([
          '/spec/tools',
          '/spec/extensions',
        ]);
        expect(policy.allowedPaths?.swarmRelative).toEqual(['/spec/policy']);
      });
    });
  });

  describe('SwarmResource 타입', () => {
    it('완전한 Swarm 리소스를 정의할 수 있다', () => {
      const resource: SwarmResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Swarm',
        metadata: {
          name: 'default',
          labels: {
            env: 'production',
          },
        },
        spec: {
          entrypoint: { kind: 'Agent', name: 'planner' },
          agents: [
            { kind: 'Agent', name: 'planner' },
            { kind: 'Agent', name: 'executor' },
            { kind: 'Agent', name: 'reviewer' },
          ],
          policy: {
            maxStepsPerTurn: 32,
            queueMode: 'serial',
            lifecycle: {
              autoPauseIdleSeconds: 300,
              ttlSeconds: 86400,
              gcGraceSeconds: 3600,
            },
            retry: {
              maxRetries: 3,
              backoffMs: 1000,
            },
            timeout: {
              stepTimeoutMs: 30000,
              turnTimeoutMs: 120000,
            },
            changesets: {
              enabled: true,
              applyAt: ['step.config'],
              allowed: {
                files: ['resources/**', 'prompts/**', 'tools/**', 'extensions/**'],
              },
              emitRevisionChangedEvent: true,
            },
            liveConfig: {
              enabled: true,
              applyAt: ['step.config'],
              allowedPaths: {
                agentRelative: ['/spec/tools', '/spec/extensions'],
              },
            },
          },
        },
      };

      expect(resource.kind).toBe('Swarm');
      expect(resource.spec.agents.length).toBe(3);
      expect(resource.spec.policy?.maxStepsPerTurn).toBe(32);
      expect(resource.spec.policy?.queueMode).toBe('serial');
      expect(resource.spec.policy?.lifecycle?.autoPauseIdleSeconds).toBe(300);
      expect(resource.spec.policy?.retry?.maxRetries).toBe(3);
      expect(resource.spec.policy?.timeout?.stepTimeoutMs).toBe(30000);
      expect(resource.spec.policy?.changesets?.enabled).toBe(true);
      expect(resource.spec.policy?.liveConfig?.enabled).toBe(true);
    });
  });
});
