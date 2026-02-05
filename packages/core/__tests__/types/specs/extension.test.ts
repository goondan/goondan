/**
 * Extension Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.3 Extension
 */
import { describe, it, expect } from 'vitest';
import type {
  ExtensionSpec,
  McpExtensionConfig,
  McpTransport,
  McpAttach,
  McpExpose,
  ExtensionResource,
} from '../../../src/types/specs/extension.js';

describe('ExtensionSpec 타입', () => {
  describe('ExtensionSpec 인터페이스', () => {
    it('runtime과 entry는 필수이다', () => {
      const spec: ExtensionSpec = {
        runtime: 'node',
        entry: './extensions/skills/index.js',
      };

      expect(spec.runtime).toBe('node');
      expect(spec.entry).toBe('./extensions/skills/index.js');
    });

    it('config로 Extension별 설정을 지정할 수 있다', () => {
      const spec: ExtensionSpec = {
        runtime: 'node',
        entry: './extensions/compaction/index.js',
        config: {
          maxTokens: 8000,
          enableLogging: true,
        },
      };

      expect(spec.config).toEqual({
        maxTokens: 8000,
        enableLogging: true,
      });
    });
  });

  describe('MCP Extension 설정', () => {
    describe('McpTransport', () => {
      it('stdio 타입을 지원해야 한다', () => {
        const transport: McpTransport = {
          type: 'stdio',
          command: ['npx', '-y', '@modelcontextprotocol/server-github'],
        };

        expect(transport.type).toBe('stdio');
        expect(transport.command).toEqual(['npx', '-y', '@modelcontextprotocol/server-github']);
      });

      it('http 타입을 지원해야 한다', () => {
        const transport: McpTransport = {
          type: 'http',
          url: 'http://localhost:3001/mcp',
        };

        expect(transport.type).toBe('http');
        expect(transport.url).toBe('http://localhost:3001/mcp');
      });
    });

    describe('McpAttach', () => {
      it('stateful 모드와 instance 스코프를 지원해야 한다', () => {
        const attach: McpAttach = {
          mode: 'stateful',
          scope: 'instance',
        };

        expect(attach.mode).toBe('stateful');
        expect(attach.scope).toBe('instance');
      });

      it('stateless 모드와 agent 스코프를 지원해야 한다', () => {
        const attach: McpAttach = {
          mode: 'stateless',
          scope: 'agent',
        };

        expect(attach.mode).toBe('stateless');
        expect(attach.scope).toBe('agent');
      });
    });

    describe('McpExpose', () => {
      it('노출할 기능을 선택적으로 지정할 수 있다', () => {
        const expose: McpExpose = {
          tools: true,
          resources: true,
          prompts: false,
        };

        expect(expose.tools).toBe(true);
        expect(expose.resources).toBe(true);
        expect(expose.prompts).toBe(false);
      });
    });

    describe('McpExtensionConfig', () => {
      it('완전한 MCP Extension 설정을 정의할 수 있다', () => {
        const config: McpExtensionConfig = {
          transport: {
            type: 'stdio',
            command: ['npx', '-y', '@modelcontextprotocol/server-github'],
          },
          attach: {
            mode: 'stateful',
            scope: 'instance',
          },
          expose: {
            tools: true,
            resources: true,
            prompts: true,
          },
        };

        expect(config.transport.type).toBe('stdio');
        expect(config.attach.mode).toBe('stateful');
        expect(config.expose.tools).toBe(true);
      });
    });
  });

  describe('ExtensionResource 타입', () => {
    it('일반 Extension 리소스를 정의할 수 있다', () => {
      const resource: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: {
          name: 'skills',
          labels: {
            category: 'skills',
          },
        },
        spec: {
          runtime: 'node',
          entry: './extensions/skills/index.js',
          config: {
            discovery: {
              repoSkillDirs: ['.claude/skills', '.agent/skills'],
            },
          },
        },
      };

      expect(resource.kind).toBe('Extension');
      expect(resource.spec.runtime).toBe('node');
    });

    it('MCP Extension 리소스를 정의할 수 있다', () => {
      const resource: ExtensionResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Extension',
        metadata: {
          name: 'mcp-github',
          labels: {
            category: 'mcp',
          },
        },
        spec: {
          runtime: 'node',
          entry: './extensions/mcp/index.js',
          config: {
            transport: {
              type: 'stdio',
              command: ['npx', '-y', '@modelcontextprotocol/server-github'],
            },
            attach: {
              mode: 'stateful',
              scope: 'instance',
            },
            expose: {
              tools: true,
              resources: true,
              prompts: true,
            },
          },
        },
      };

      expect(resource.kind).toBe('Extension');
      expect(resource.metadata.labels?.category).toBe('mcp');
    });
  });
});
