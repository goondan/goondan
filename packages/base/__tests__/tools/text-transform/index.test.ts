/**
 * Text Transform Tool 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import { handlers } from '../../../src/tools/text-transform/index.js';
import type { ToolContext, JsonValue, JsonObject } from '@goondan/core';

// =============================================================================
// 타입 가드
// =============================================================================

interface TemplateResult {
  result: string;
  success: boolean;
}

function isTemplateResult(value: JsonValue): value is TemplateResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return typeof value['result'] === 'string' && typeof value['success'] === 'boolean';
}

interface RegexMatchResult {
  matches: string[];
  found: boolean;
  count: number;
  success: boolean;
}

function isRegexMatchResult(value: JsonValue): value is RegexMatchResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    Array.isArray(value['matches']) &&
    typeof value['found'] === 'boolean' &&
    typeof value['count'] === 'number' &&
    typeof value['success'] === 'boolean'
  );
}

interface RegexReplaceResult {
  result: string;
  success: boolean;
}

function isRegexReplaceResult(value: JsonValue): value is RegexReplaceResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return typeof value['result'] === 'string' && typeof value['success'] === 'boolean';
}

interface RegexTestResult {
  found: boolean;
  success: boolean;
}

function isRegexTestResult(value: JsonValue): value is RegexTestResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return typeof value['found'] === 'boolean' && typeof value['success'] === 'boolean';
}

interface FormatResult {
  result: string;
  from: string;
  to: string;
  success: boolean;
}

function isFormatResult(value: JsonValue): value is FormatResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof value['result'] === 'string' &&
    typeof value['from'] === 'string' &&
    typeof value['to'] === 'string' &&
    typeof value['success'] === 'boolean'
  );
}

// =============================================================================
// Mock ToolContext
// =============================================================================

function createMockContext(): ToolContext {
  return {
    instance: { id: 'test-instance', swarmName: 'test-swarm', status: 'running' },
    swarm: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Swarm',
      metadata: { name: 'test-swarm' },
      spec: { agents: [], entrypoint: '' },
    },
    agent: {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Agent',
      metadata: { name: 'test-agent' },
      spec: { model: { ref: '' } },
    },
    turn: { id: 'test-turn', messages: [], toolResults: [] },
    step: { id: 'test-step', index: 0 },
    toolCatalog: [],
    swarmBundle: {
      openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test' }),
      commitChangeset: vi.fn().mockResolvedValue({ success: true }),
    },
    oauth: {
      getAccessToken: vi.fn().mockResolvedValue({ status: 'error', error: { code: 'not_configured', message: 'Not configured' } }),
    },
    events: {},
    workdir: process.cwd(),
    agents: {
      delegate: vi.fn().mockResolvedValue({ success: false, agentName: '', instanceId: '', error: 'not implemented' }),
      listInstances: vi.fn().mockResolvedValue([]),
    },
    logger: {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(),
      assert: vi.fn(), clear: vi.fn(), count: vi.fn(), countReset: vi.fn(),
      dir: vi.fn(), dirxml: vi.fn(), group: vi.fn(), groupCollapsed: vi.fn(),
      groupEnd: vi.fn(), table: vi.fn(), time: vi.fn(), timeEnd: vi.fn(),
      timeLog: vi.fn(), trace: vi.fn(), profile: vi.fn(), profileEnd: vi.fn(),
      timeStamp: vi.fn(), Console: vi.fn(),
    },
  };
}

// =============================================================================
// text.template 테스트
// =============================================================================

describe('text.template handler', () => {
  const handler = handlers['text.template'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should render simple template', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: 'Hello, {{name}}!',
      variables: '{"name": "World"}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('Hello, World!');
      expect(result.success).toBe(true);
    }
  });

  it('should render multiple variables', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: '{{greeting}}, {{name}}! You are {{age}} years old.',
      variables: '{"greeting": "Hi", "name": "Alice", "age": 30}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('Hi, Alice! You are 30 years old.');
    }
  });

  it('should render empty string for undefined variables', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: 'Hello, {{name}}!',
      variables: '{}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('Hello, !');
    }
  });

  it('should render conditional section when truthy', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: '{{#show}}visible{{/show}}',
      variables: '{"show": true}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('visible');
    }
  });

  it('should hide conditional section when falsy', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: '{{#show}}hidden{{/show}}',
      variables: '{"show": false}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('');
    }
  });

  it('should render inverted section when falsy', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: '{{^show}}no items{{/show}}',
      variables: '{"show": false}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('no items');
    }
  });

  it('should hide inverted section when truthy', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: '{{^show}}hidden{{/show}}',
      variables: '{"show": true}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('');
    }
  });

  it('should render array items in section', async () => {
    const ctx = createMockContext();
    const result = await handler(ctx, {
      template: '{{#items}}{{.}}, {{/items}}',
      variables: '{"items": ["a", "b", "c"]}',
    });

    expect(isTemplateResult(result)).toBe(true);
    if (isTemplateResult(result)) {
      expect(result.result).toBe('a, b, c, ');
    }
  });

  it('should throw for non-string template', async () => {
    const ctx = createMockContext();
    await expect(
      handler(ctx, { template: 123, variables: '{}' })
    ).rejects.toThrow('template은 문자열이어야 합니다.');
  });

  it('should throw for non-string variables', async () => {
    const ctx = createMockContext();
    await expect(
      handler(ctx, { template: 'test', variables: 123 })
    ).rejects.toThrow('variables는 JSON 문자열이어야 합니다.');
  });

  it('should throw for non-object variables', async () => {
    const ctx = createMockContext();
    await expect(
      handler(ctx, { template: 'test', variables: '"string"' })
    ).rejects.toThrow('variables는 JSON 객체여야 합니다.');
  });

  it('should throw for invalid JSON variables', async () => {
    const ctx = createMockContext();
    await expect(
      handler(ctx, { template: 'test', variables: '{invalid}' })
    ).rejects.toThrow('유효하지 않은 JSON');
  });
});

// =============================================================================
// text.regex 테스트
// =============================================================================

describe('text.regex handler', () => {
  const handler = handlers['text.regex'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  describe('match operation', () => {
    it('should match pattern', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'hello world',
        pattern: 'hello',
        operation: 'match',
      });

      expect(isRegexMatchResult(result)).toBe(true);
      if (isRegexMatchResult(result)) {
        expect(result.found).toBe(true);
        expect(result.matches).toContain('hello');
      }
    });

    it('should match with global flag', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'abc 123 def 456',
        pattern: '\\d+',
        operation: 'match',
        flags: 'g',
      });

      expect(isRegexMatchResult(result)).toBe(true);
      if (isRegexMatchResult(result)) {
        expect(result.found).toBe(true);
        expect(result.count).toBe(2);
        expect(result.matches).toContain('123');
        expect(result.matches).toContain('456');
      }
    });

    it('should return empty matches when not found', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'hello world',
        pattern: 'xyz',
        operation: 'match',
      });

      expect(isRegexMatchResult(result)).toBe(true);
      if (isRegexMatchResult(result)) {
        expect(result.found).toBe(false);
        expect(result.count).toBe(0);
        expect(result.matches).toEqual([]);
      }
    });

    it('should match case-insensitively', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'Hello World',
        pattern: 'hello',
        operation: 'match',
        flags: 'i',
      });

      expect(isRegexMatchResult(result)).toBe(true);
      if (isRegexMatchResult(result)) {
        expect(result.found).toBe(true);
      }
    });
  });

  describe('replace operation', () => {
    it('should replace first match', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'foo bar foo',
        pattern: 'foo',
        operation: 'replace',
        replacement: 'baz',
      });

      expect(isRegexReplaceResult(result)).toBe(true);
      if (isRegexReplaceResult(result)) {
        expect(result.result).toBe('baz bar foo');
      }
    });

    it('should replace all matches with global flag', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'foo bar foo',
        pattern: 'foo',
        operation: 'replace',
        replacement: 'baz',
        flags: 'g',
      });

      expect(isRegexReplaceResult(result)).toBe(true);
      if (isRegexReplaceResult(result)) {
        expect(result.result).toBe('baz bar baz');
      }
    });

    it('should support capture group references', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: '2024-01-15',
        pattern: '(\\d{4})-(\\d{2})-(\\d{2})',
        operation: 'replace',
        replacement: '$2/$3/$1',
      });

      expect(isRegexReplaceResult(result)).toBe(true);
      if (isRegexReplaceResult(result)) {
        expect(result.result).toBe('01/15/2024');
      }
    });

    it('should throw when replacement is missing', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { text: 'test', pattern: 'test', operation: 'replace' })
      ).rejects.toThrow('replace 작업에는 replacement가 필요합니다.');
    });
  });

  describe('test operation', () => {
    it('should return true when pattern matches', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'hello@example.com',
        pattern: '@\\w+\\.\\w+',
        operation: 'test',
      });

      expect(isRegexTestResult(result)).toBe(true);
      if (isRegexTestResult(result)) {
        expect(result.found).toBe(true);
      }
    });

    it('should return false when pattern does not match', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        text: 'hello world',
        pattern: '^\\d+$',
        operation: 'test',
      });

      expect(isRegexTestResult(result)).toBe(true);
      if (isRegexTestResult(result)) {
        expect(result.found).toBe(false);
      }
    });
  });

  describe('error cases', () => {
    it('should throw for non-string text', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { text: 123, pattern: 'test', operation: 'match' })
      ).rejects.toThrow('text는 문자열이어야 합니다.');
    });

    it('should throw for non-string pattern', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { text: 'test', pattern: 123, operation: 'match' })
      ).rejects.toThrow('pattern은 문자열이어야 합니다.');
    });

    it('should throw for invalid operation', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { text: 'test', pattern: 'test', operation: 'invalid' })
      ).rejects.toThrow('operation은 match, replace, test 중 하나여야 합니다.');
    });

    it('should throw for invalid regex pattern', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { text: 'test', pattern: '[invalid', operation: 'match' })
      ).rejects.toThrow('유효하지 않은 정규식');
    });

    it('should throw for invalid flags', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { text: 'test', pattern: 'test', operation: 'match', flags: 'z' })
      ).rejects.toThrow('지원하지 않는 정규식 플래그');
    });
  });
});

// =============================================================================
// text.format 테스트
// =============================================================================

describe('text.format handler', () => {
  const handler = handlers['text.format'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  describe('JSON to YAML', () => {
    it('should convert simple JSON to YAML', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: '{"name": "Alice", "age": 30}',
        from: 'json',
        to: 'yaml',
      });

      expect(isFormatResult(result)).toBe(true);
      if (isFormatResult(result)) {
        expect(result.result).toContain('name: Alice');
        expect(result.result).toContain('age: 30');
        expect(result.success).toBe(true);
      }
    });
  });

  describe('YAML to JSON', () => {
    it('should convert simple YAML to JSON', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: 'name: Alice\nage: 30',
        from: 'yaml',
        to: 'json',
      });

      expect(isFormatResult(result)).toBe(true);
      if (isFormatResult(result)) {
        const parsed: unknown = JSON.parse(result.result);
        expect(parsed).toEqual({ name: 'Alice', age: 30 });
      }
    });
  });

  describe('JSON to CSV', () => {
    it('should convert JSON array to CSV', async () => {
      const ctx = createMockContext();
      const data = JSON.stringify([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
      const result = await handler(ctx, {
        data,
        from: 'json',
        to: 'csv',
      });

      expect(isFormatResult(result)).toBe(true);
      if (isFormatResult(result)) {
        const lines = result.result.split('\n');
        expect(lines[0]).toBe('name,age');
        expect(lines[1]).toBe('Alice,30');
        expect(lines[2]).toBe('Bob,25');
      }
    });
  });

  describe('CSV to JSON', () => {
    it('should convert CSV to JSON array', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: 'name,age\nAlice,30\nBob,25',
        from: 'csv',
        to: 'json',
      });

      expect(isFormatResult(result)).toBe(true);
      if (isFormatResult(result)) {
        const parsed: unknown = JSON.parse(result.result);
        expect(parsed).toEqual([
          { name: 'Alice', age: '30' },
          { name: 'Bob', age: '25' },
        ]);
      }
    });
  });

  describe('same format', () => {
    it('should return same data when from === to', async () => {
      const ctx = createMockContext();
      const data = '{"test": true}';
      const result = await handler(ctx, { data, from: 'json', to: 'json' });

      expect(isFormatResult(result)).toBe(true);
      if (isFormatResult(result)) {
        expect(result.result).toBe(data);
      }
    });
  });

  describe('CSV with special characters', () => {
    it('should handle quoted CSV fields', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, {
        data: 'name,desc\nAlice,"Hello, World"\nBob,"He said ""hi"""',
        from: 'csv',
        to: 'json',
      });

      expect(isFormatResult(result)).toBe(true);
      if (isFormatResult(result)) {
        const parsed: unknown = JSON.parse(result.result);
        expect(parsed).toEqual([
          { name: 'Alice', desc: 'Hello, World' },
          { name: 'Bob', desc: 'He said "hi"' },
        ]);
      }
    });
  });

  describe('error cases', () => {
    it('should throw for non-string data', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: 123, from: 'json', to: 'yaml' })
      ).rejects.toThrow('data는 문자열이어야 합니다.');
    });

    it('should throw for invalid from format', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{}', from: 'xml', to: 'json' })
      ).rejects.toThrow('from은 json, yaml, csv 중 하나여야 합니다.');
    });

    it('should throw for invalid to format', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{}', from: 'json', to: 'xml' })
      ).rejects.toThrow('to는 json, yaml, csv 중 하나여야 합니다.');
    });

    it('should throw for invalid JSON data', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{invalid}', from: 'json', to: 'yaml' })
      ).rejects.toThrow('유효하지 않은 JSON');
    });

    it('should throw when converting non-array to CSV', async () => {
      const ctx = createMockContext();
      await expect(
        handler(ctx, { data: '{"key": "value"}', from: 'json', to: 'csv' })
      ).rejects.toThrow('CSV로 변환하려면 데이터가 배열이어야 합니다.');
    });
  });
});
