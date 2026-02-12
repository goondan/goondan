import { describe, expect, it } from 'vitest';
import { executeCli } from '../src/router.js';
import { createMockDeps, issue } from './helpers.js';

describe('validate output', () => {
  it('text 포맷에서 구조화 오류 정보를 출력한다', async () => {
    const { deps, state } = createMockDeps({
      validateResult: {
        valid: false,
        errors: [
          issue('FILE_NOT_FOUND', 'File not found', {
            path: 'tools/missing/index.ts',
            resource: 'Tool/missing',
            field: 'spec.entry',
            suggestion: '파일을 생성하거나 경로를 수정하세요.',
            helpUrl: 'https://docs.goondan.io/errors/FILE_NOT_FOUND',
          }),
        ],
        warnings: [],
      },
    });

    const code = await executeCli(['validate', '.', '--format', 'text'], deps);

    expect(code).toBe(4);
    const out = state.outs.join('\n');
    expect(out).toContain('[FILE_NOT_FOUND] File not found');
    expect(out).toContain('suggestion: 파일을 생성하거나 경로를 수정하세요.');
    expect(out).toContain('help: https://docs.goondan.io/errors/FILE_NOT_FOUND');
    expect(state.errs.join('\n')).toContain('[VALIDATION_ERROR]');
  });

  it('json 포맷을 출력한다', async () => {
    const { deps, state } = createMockDeps({
      validateResult: {
        valid: true,
        errors: [],
        warnings: [],
      },
    });

    const code = await executeCli(['validate', '.', '--format', 'json'], deps);

    expect(code).toBe(0);
    const out = state.outs.join('\n');
    expect(out).toContain('"valid": true');
  });
});
