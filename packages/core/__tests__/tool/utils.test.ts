/**
 * Tool 유틸리티 함수 테스트
 * @see /docs/specs/tool.md - 7.2 오류 메시지 제한 구현
 */
import { describe, it, expect } from 'vitest';
import {
  truncateErrorMessage,
  createToolErrorResult,
  createToolSuccessResult,
  createToolPendingResult,
  isAsyncToolResult,
} from '../../src/tool/utils.js';
import type { Resource } from '../../src/types/resource.js';
import type { ToolSpec } from '../../src/types/specs/tool.js';
import type { JsonValue } from '../../src/types/json.js';

describe('Tool 유틸리티', () => {
  describe('truncateErrorMessage()', () => {
    it('limit 이하의 메시지는 그대로 반환한다', () => {
      const message = 'Short message';
      const result = truncateErrorMessage(message, 1000);
      expect(result).toBe('Short message');
    });

    it('limit 초과 메시지는 truncate하고 suffix를 붙인다', () => {
      const message = 'x'.repeat(1500);
      const result = truncateErrorMessage(message, 1000);

      expect(result.length).toBe(1000);
      expect(result).toContain('... (truncated)');
    });

    it('정확히 limit 길이의 메시지는 그대로 반환한다', () => {
      const message = 'x'.repeat(1000);
      const result = truncateErrorMessage(message, 1000);
      expect(result).toBe(message);
    });

    it('빈 메시지는 빈 문자열을 반환한다', () => {
      const result = truncateErrorMessage('', 1000);
      expect(result).toBe('');
    });

    it('기본 limit은 1000이다', () => {
      const message = 'x'.repeat(1500);
      const result = truncateErrorMessage(message);
      expect(result.length).toBe(1000);
    });
  });

  describe('createToolErrorResult()', () => {
    it('Error에서 ToolResult를 생성한다', () => {
      const error = new Error('Something went wrong');
      const result = createToolErrorResult('call_123', 'my.tool', error);

      expect(result.toolCallId).toBe('call_123');
      expect(result.toolName).toBe('my.tool');
      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('Something went wrong');
      expect(result.error?.name).toBe('Error');
    });

    it('커스텀 Error name을 보존한다', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error');
      const result = createToolErrorResult('call_123', 'my.tool', error);

      expect(result.error?.name).toBe('CustomError');
    });

    it('Error에 code가 있으면 보존한다', () => {
      const error = new Error('API error');
      (error as Error & { code: string }).code = 'E_API';

      const result = createToolErrorResult('call_123', 'my.tool', error);

      expect(result.error?.code).toBe('E_API');
    });

    it('Tool 리소스의 errorMessageLimit을 적용한다', () => {
      const error = new Error('x'.repeat(500));
      const toolResource: Resource<ToolSpec> = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Tool',
        metadata: { name: 'test' },
        spec: {
          runtime: 'node',
          entry: './index.js',
          errorMessageLimit: 100,
          exports: [],
        },
      };

      const result = createToolErrorResult(
        'call_123',
        'my.tool',
        error,
        toolResource
      );

      expect(result.error?.message.length).toBeLessThanOrEqual(100);
    });

    it('errorMessageLimit이 없으면 기본 1000을 사용한다', () => {
      const error = new Error('x'.repeat(1500));
      const result = createToolErrorResult('call_123', 'my.tool', error);

      expect(result.error?.message.length).toBe(1000);
    });

    it('Error가 아닌 값도 처리한다', () => {
      const result = createToolErrorResult('call_123', 'my.tool', 'string error');

      expect(result.status).toBe('error');
      expect(result.error?.message).toBe('string error');
      expect(result.error?.name).toBe('UnknownError');
    });
  });

  describe('createToolSuccessResult()', () => {
    it('성공 결과를 생성한다', () => {
      const output: JsonValue = { result: 42, message: 'success' };
      const result = createToolSuccessResult('call_123', 'calc.add', output);

      expect(result.toolCallId).toBe('call_123');
      expect(result.toolName).toBe('calc.add');
      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ result: 42, message: 'success' });
    });

    it('null output도 처리한다', () => {
      const result = createToolSuccessResult('call_123', 'my.tool', null);

      expect(result.status).toBe('ok');
      expect(result.output).toBeNull();
    });

    it('undefined output은 생략된다', () => {
      const result = createToolSuccessResult('call_123', 'my.tool', undefined);

      expect(result.status).toBe('ok');
      expect('output' in result).toBe(false);
    });
  });

  describe('createToolPendingResult()', () => {
    it('pending 결과를 생성한다', () => {
      const result = createToolPendingResult(
        'call_123',
        'build.start',
        'build-handle-123',
        { message: '빌드 시작됨' }
      );

      expect(result.toolCallId).toBe('call_123');
      expect(result.toolName).toBe('build.start');
      expect(result.status).toBe('pending');
      expect(result.handle).toBe('build-handle-123');
      expect(result.output).toEqual({ message: '빌드 시작됨' });
    });

    it('output 없이도 생성할 수 있다', () => {
      const result = createToolPendingResult(
        'call_123',
        'build.start',
        'build-handle-123'
      );

      expect(result.status).toBe('pending');
      expect(result.handle).toBe('build-handle-123');
      expect('output' in result).toBe(false);
    });
  });

  describe('isAsyncToolResult()', () => {
    it('__async: true인 결과를 감지한다', () => {
      const result = {
        __async: true,
        handle: 'handle-123',
        message: 'Started',
      };

      expect(isAsyncToolResult(result)).toBe(true);
    });

    it('일반 결과는 false를 반환한다', () => {
      const result = { success: true, data: 42 };
      expect(isAsyncToolResult(result)).toBe(false);
    });

    it('null은 false를 반환한다', () => {
      expect(isAsyncToolResult(null)).toBe(false);
    });

    it('undefined는 false를 반환한다', () => {
      expect(isAsyncToolResult(undefined)).toBe(false);
    });

    it('primitive는 false를 반환한다', () => {
      expect(isAsyncToolResult('string')).toBe(false);
      expect(isAsyncToolResult(42)).toBe(false);
      expect(isAsyncToolResult(true)).toBe(false);
    });
  });
});
