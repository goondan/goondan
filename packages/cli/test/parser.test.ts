import { describe, expect, it } from 'vitest';
import { parseArguments } from '../src/parser.js';

describe('parseArguments', () => {
  it('validate 명령의 위치 인자/옵션을 파싱한다', () => {
    const parsed = parseArguments([
      'validate',
      './bundle',
      '--format',
      'json',
      '--strict',
      '--state-root',
      '/tmp/state',
      '-q',
    ]);

    expect(parsed.command).toBe('validate');
    expect(parsed.subcommand).toBe('./bundle');
    expect(parsed.options['format']).toBe('json');
    expect(parsed.options['strict']).toBe(true);
    expect(parsed.options['state-root']).toBe('/tmp/state');
    expect(parsed.globalOptions['quiet']).toBe(true);
  });

  it('package add 명령의 단축 옵션을 파싱한다', () => {
    const parsed = parseArguments(['package', 'add', '@goondan/base', '-DE', '--registry', 'https://r.example']);

    expect(parsed.command).toBe('package');
    expect(parsed.subcommand).toBe('add');
    expect(parsed.rest[0]).toBe('@goondan/base');
    expect(parsed.options['dev']).toBe(true);
    expect(parsed.options['exact']).toBe(true);
    expect(parsed.options['registry']).toBe('https://r.example');
  });
});
