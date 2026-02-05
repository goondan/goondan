/**
 * Tool Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.2 Tool
 */
import { describe, it, expect } from 'vitest';
import type {
  ToolSpec,
  ToolAuth,
  ToolExport,
  ToolResource,
} from '../../../src/types/specs/tool.js';
import type { JsonSchema } from '../../../src/types/json-schema.js';

describe('ToolSpec 타입', () => {
  describe('ToolSpec 인터페이스', () => {
    it('runtime, entry, exports는 필수이다', () => {
      const spec: ToolSpec = {
        runtime: 'node',
        entry: './tools/file/index.js',
        exports: [
          {
            name: 'file.read',
            description: '파일을 읽습니다',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '파일 경로' },
              },
              required: ['path'],
            },
          },
        ],
      };

      expect(spec.runtime).toBe('node');
      expect(spec.entry).toBe('./tools/file/index.js');
      expect(spec.exports.length).toBe(1);
    });

    it('runtime은 node, python, deno 중 하나이다', () => {
      const nodeSpec: ToolSpec = {
        runtime: 'node',
        entry: './tools/index.js',
        exports: [],
      };
      const pythonSpec: ToolSpec = {
        runtime: 'python',
        entry: './tools/main.py',
        exports: [],
      };
      const denoSpec: ToolSpec = {
        runtime: 'deno',
        entry: './tools/mod.ts',
        exports: [],
      };

      expect(nodeSpec.runtime).toBe('node');
      expect(pythonSpec.runtime).toBe('python');
      expect(denoSpec.runtime).toBe('deno');
    });

    it('errorMessageLimit은 선택이다', () => {
      const spec: ToolSpec = {
        runtime: 'node',
        entry: './tools/index.js',
        errorMessageLimit: 1200,
        exports: [],
      };

      expect(spec.errorMessageLimit).toBe(1200);
    });
  });

  describe('ToolAuth 인터페이스', () => {
    it('oauthAppRef로 OAuth 인증을 설정할 수 있다', () => {
      const auth: ToolAuth = {
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
      };

      expect(auth.oauthAppRef?.kind).toBe('OAuthApp');
      expect(auth.oauthAppRef?.name).toBe('slack-bot');
    });

    it('scopes로 필요한 스코프를 지정할 수 있다', () => {
      const auth: ToolAuth = {
        oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
        scopes: ['chat:write', 'channels:read'],
      };

      expect(auth.scopes).toEqual(['chat:write', 'channels:read']);
    });
  });

  describe('ToolExport 인터페이스', () => {
    it('name, description, parameters는 필수이다', () => {
      const toolExport: ToolExport = {
        name: 'slack.postMessage',
        description: 'Slack 채널에 메시지를 전송합니다',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: '채널 ID' },
            text: { type: 'string', description: '메시지 내용' },
          },
          required: ['channel', 'text'],
        },
      };

      expect(toolExport.name).toBe('slack.postMessage');
      expect(toolExport.description).toBe('Slack 채널에 메시지를 전송합니다');
      expect(toolExport.parameters.type).toBe('object');
    });

    it('auth로 export 수준 인증을 설정할 수 있다', () => {
      const toolExport: ToolExport = {
        name: 'slack.postMessage',
        description: 'Slack 채널에 메시지를 전송합니다',
        parameters: { type: 'object' },
        auth: {
          scopes: ['chat:write'],
        },
      };

      expect(toolExport.auth?.scopes).toEqual(['chat:write']);
    });
  });

  describe('JsonSchema 인터페이스', () => {
    it('복잡한 스키마를 정의할 수 있다', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: '이름' },
          count: { type: 'number', description: '개수', default: 100 },
          enabled: { type: 'boolean' },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
          config: {
            type: 'object',
            properties: {
              nested: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        required: ['name'],
        additionalProperties: false,
      };

      expect(schema.type).toBe('object');
      expect(schema.properties?.name?.type).toBe('string');
      expect(schema.required).toContain('name');
    });

    it('enum을 지원해야 한다', () => {
      const schema: JsonSchema = {
        type: 'string',
        enum: ['option1', 'option2', 'option3'],
      };

      expect(schema.enum).toEqual(['option1', 'option2', 'option3']);
    });
  });

  describe('ToolResource 타입', () => {
    it('완전한 Tool 리소스를 정의할 수 있다', () => {
      const resource: ToolResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: {
          name: 'slackToolkit',
          labels: {
            tier: 'base',
            category: 'communication',
          },
        },
        spec: {
          runtime: 'node',
          entry: './tools/slack/index.js',
          errorMessageLimit: 1200,
          auth: {
            oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' },
            scopes: ['chat:write', 'channels:read'],
          },
          exports: [
            {
              name: 'slack.postMessage',
              description: 'Slack 채널에 메시지를 전송합니다',
              parameters: {
                type: 'object',
                properties: {
                  channel: { type: 'string', description: '채널 ID' },
                  text: { type: 'string', description: '메시지 내용' },
                },
                required: ['channel', 'text'],
              },
              auth: {
                scopes: ['chat:write'],
              },
            },
          ],
        },
      };

      expect(resource.kind).toBe('Tool');
      expect(resource.spec.exports.length).toBe(1);
      expect(resource.spec.auth?.oauthAppRef?.name).toBe('slack-bot');
    });
  });
});
