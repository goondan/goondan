/**
 * Bash Tool 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import { handlers } from '../../../src/tools/bash/index.js';
import type { ToolContext, JsonValue } from '@goondan/core';

/**
 * bash.exec 출력 타입 가드
 * 타입 단언(as) 대신 타입 가드 함수 사용
 */
interface BashExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal: string | null;
  success: boolean;
}

function isBashExecResult(value: JsonValue): value is BashExecResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const obj = value;
  return (
    typeof obj['exitCode'] === 'number' &&
    typeof obj['stdout'] === 'string' &&
    typeof obj['stderr'] === 'string' &&
    (obj['signal'] === null || typeof obj['signal'] === 'string') &&
    typeof obj['success'] === 'boolean'
  );
}

// Mock ToolContext 생성 헬퍼
function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const baseContext: ToolContext = {
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
    turn: {
      id: 'test-turn',
      messages: [],
      toolResults: [],
    },
    step: {
      id: 'test-step',
      index: 0,
    },
    toolCatalog: [],
    swarmBundle: {
      openChangeset: vi.fn().mockResolvedValue({ changesetId: 'test' }),
      commitChangeset: vi.fn().mockResolvedValue({ success: true }),
    },
    oauth: {
      getAccessToken: vi.fn().mockResolvedValue({ status: 'error', error: { code: 'not_configured', message: 'Not configured' } }),
    },
    events: {},
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      assert: vi.fn(),
      clear: vi.fn(),
      count: vi.fn(),
      countReset: vi.fn(),
      dir: vi.fn(),
      dirxml: vi.fn(),
      group: vi.fn(),
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      table: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(),
      timeLog: vi.fn(),
      trace: vi.fn(),
      profile: vi.fn(),
      profileEnd: vi.fn(),
      timeStamp: vi.fn(),
      Console: vi.fn(),
    },
  };

  return { ...baseContext, ...overrides };
}

describe('bash.exec handler', () => {
  const handler = handlers['bash.exec'];

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  describe('정상 명령어 실행', () => {
    it('should execute simple command', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "hello"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.success).toBe(true);
        expect(result.stdout.trim()).toBe('hello');
      }
    });

    it('should handle command with pipes', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "line1\nline2\nline3" | wc -l' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('3');
      }
    });

    it('should handle environment variables', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo $HOME' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBeTruthy();
      }
    });

    it('should use default timeout if not specified', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "quick"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe('exitCode 반환', () => {
    it('should return zero exit code for successful command', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'true' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.success).toBe(true);
      }
    });

    it('should return non-zero exit code for failed command', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'exit 1' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(1);
        expect(result.success).toBe(false);
      }
    });

    it('should return custom exit code', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'exit 42' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(42);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('stdout/stderr 캡처', () => {
    it('should capture stdout', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "stdout message"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.stdout.trim()).toBe('stdout message');
        expect(result.stderr).toBe('');
      }
    });

    it('should capture stderr', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "error message" >&2' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.stderr.trim()).toBe('error message');
      }
    });

    it('should capture both stdout and stderr simultaneously', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "out" && echo "err" >&2' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.stdout.trim()).toBe('out');
        expect(result.stderr.trim()).toBe('err');
      }
    });

    it('should return empty strings for commands with no output', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'true' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
      }
    });
  });

  describe('signal 필드 반환', () => {
    it('should return null signal for normally terminated command', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "test"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.signal).toBeNull();
      }
    });
  });

  describe('timeout 처리', () => {
    it('should timeout for long-running command', async () => {
      const ctx = createMockContext();

      // 100ms 타임아웃으로 5초 sleep 실행
      await expect(
        handler(ctx, { command: 'sleep 5', timeout: 100 })
      ).rejects.toThrow(/타임아웃/);
    }, 5000);

    it('should include stdout/stderr in timeout error message', async () => {
      const ctx = createMockContext();

      try {
        await handler(ctx, { command: 'echo "partial output" && sleep 5', timeout: 100 });
        // 타임아웃이 발생해야 함
        expect(true).toBe(false);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        if (error instanceof Error) {
          expect(error.message).toContain('타임아웃');
          expect(error.message).toContain('partial output');
        }
      }
    }, 10000);

    it('should succeed with sufficient timeout', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'sleep 0.1 && echo "done"', timeout: 5000 });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('done');
      }
    });

    it('should ignore invalid timeout (negative) and use default', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "test"', timeout: -100 });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
      }
    });

    it('should ignore invalid timeout (zero) and use default', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "test"', timeout: 0 });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe('cwd 옵션', () => {
    it('should use custom cwd', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'pwd', cwd: '/tmp' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        // macOS에서는 /tmp가 /private/tmp로 심볼릭 링크될 수 있음
        expect(result.stdout.trim()).toMatch(/\/(tmp|private\/tmp)$/);
      }
    });

    it('should fail gracefully for non-existent cwd', async () => {
      const ctx = createMockContext();

      await expect(
        handler(ctx, { command: 'pwd', cwd: '/non/existent/path/12345' })
      ).rejects.toThrow();
    });

    it('should use current directory if cwd is empty string', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'pwd', cwd: '' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBeTruthy();
      }
    });

    it('should use current directory if cwd is whitespace only', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'pwd', cwd: '   ' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBeTruthy();
      }
    });
  });

  describe('에러 케이스', () => {
    it('should throw error for empty command', async () => {
      const ctx = createMockContext();

      await expect(handler(ctx, { command: '' })).rejects.toThrow(
        'command는 비어있지 않은 문자열이어야 합니다.'
      );
    });

    it('should throw error for whitespace-only command', async () => {
      const ctx = createMockContext();

      await expect(handler(ctx, { command: '   ' })).rejects.toThrow(
        'command는 비어있지 않은 문자열이어야 합니다.'
      );
    });

    it('should throw error for non-string command', async () => {
      const ctx = createMockContext();

      await expect(handler(ctx, { command: 123 })).rejects.toThrow(
        'command는 문자열이어야 합니다.'
      );
    });

    it('should throw error for null command', async () => {
      const ctx = createMockContext();

      await expect(handler(ctx, { command: null })).rejects.toThrow(
        'command는 문자열이어야 합니다.'
      );
    });

    it('should throw error for undefined command', async () => {
      const ctx = createMockContext();

      await expect(handler(ctx, {})).rejects.toThrow(
        'command는 문자열이어야 합니다.'
      );
    });

    it('should throw error for command not found', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'nonexistentcommand12345' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).not.toBe(0);
        expect(result.success).toBe(false);
        expect(result.stderr).toContain('not found');
      }
    });
  });

  describe('특수 문자 및 복잡한 명령어', () => {
    it('should handle quotes in command', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: "echo 'single quotes' && echo \"double quotes\"" });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('single quotes');
        expect(result.stdout).toContain('double quotes');
      }
    });

    it('should handle special characters', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "hello\\nworld"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
      }
    });

    it('should handle multi-line output', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo -e "line1\\nline2\\nline3"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        const lines = result.stdout.trim().split('\n');
        expect(lines.length).toBe(3);
      }
    });

    it('should handle command substitution', async () => {
      const ctx = createMockContext();
      const result = await handler(ctx, { command: 'echo "Today is $(date +%A)"' });

      expect(isBashExecResult(result)).toBe(true);
      if (isBashExecResult(result)) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Today is');
      }
    });
  });
});
