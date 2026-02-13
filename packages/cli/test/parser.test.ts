import { describe, expect, it } from 'vitest';
import { parseArgv } from '../src/parser.js';

describe('parseArgv', () => {
  it('validate 명령의 위치 인자/옵션을 파싱한다', () => {
    const result = parseArgv([
      'validate',
      './bundle',
      '--format',
      'json',
      '--strict',
      '--state-root',
      '/tmp/state',
      '-q',
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('validate');
      const cmd = result.value.command;
      if (cmd.action === 'validate') {
        expect(cmd.target).toBe('./bundle');
        expect(cmd.format).toBe('json');
        expect(cmd.strict).toBe(true);
      }
      expect(result.value.stateRoot).toBe('/tmp/state');
      expect(result.value.quiet).toBe(true);
    }
  });

  it('package add 명령의 단축 옵션을 파싱한다', () => {
    const result = parseArgv(['package', 'add', '@goondan/base', '-D', '-E', '--registry', 'https://r.example']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('package.add');
      const cmd = result.value.command;
      if (cmd.action === 'package.add') {
        expect(cmd.ref).toBe('@goondan/base');
        expect(cmd.dev).toBe(true);
        expect(cmd.exact).toBe(true);
        expect(cmd.registry).toBe('https://r.example');
      }
    }
  });

  it('logs 명령의 옵션을 파싱한다', () => {
    const result = parseArgv(['logs', '--instance-key', 'inst-1', '--process', 'orchestrator', '--stream', 'stderr', '--lines', '40']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('logs');
      const cmd = result.value.command;
      if (cmd.action === 'logs') {
        expect(cmd.instanceKey).toBe('inst-1');
        expect(cmd.process).toBe('orchestrator');
        expect(cmd.stream).toBe('stderr');
        expect(cmd.lines).toBe(40);
      }
    }
  });

  it('run 명령 기본값을 파싱한다', () => {
    const result = parseArgv(['run', '--watch']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('run');
      const cmd = result.value.command;
      if (cmd.action === 'run') {
        expect(cmd.watch).toBe(true);
      }
    }
  });

  it('instance delete 명령을 파싱한다', () => {
    const result = parseArgv(['instance', 'delete', 'my-key', '--force']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('instance.delete');
      const cmd = result.value.command;
      if (cmd.action === 'instance.delete') {
        expect(cmd.key).toBe('my-key');
        expect(cmd.force).toBe(true);
      }
    }
  });


  it('instance restart 명령을 파싱한다', () => {
    const result = parseArgv(['instance', 'restart', 'my-key', '--fresh']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('instance.restart');
      const cmd = result.value.command;
      if (cmd.action === 'instance.restart') {
        expect(cmd.key).toBe('my-key');
        expect(cmd.fresh).toBe(true);
      }
    }
  });

  it('doctor 명령을 파싱한다', () => {
    const result = parseArgv(['doctor', '--fix']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('doctor');
      const cmd = result.value.command;
      if (cmd.action === 'doctor') {
        expect(cmd.fix).toBe(true);
      }
    }
  });

  it('restart 명령을 파싱한다', () => {
    const result = parseArgv(['restart', '--agent', 'coder', '--fresh']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('restart');
      const cmd = result.value.command;
      if (cmd.action === 'restart') {
        expect(cmd.agent).toBe('coder');
        expect(cmd.fresh).toBe(true);
      }
    }
  });

  it('잘못된 명령은 파싱 실패한다', () => {
    const result = parseArgv(['unknown']);

    expect(result.success).toBe(false);
  });

  it('잘못된 choice 값은 파싱 실패한다', () => {
    const result = parseArgv(['validate', '.', '--format', 'invalid']);

    expect(result.success).toBe(false);
  });

  it('global options 기본값을 설정한다', () => {
    const result = parseArgv(['doctor']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.config).toBe('goondan.yaml');
      expect(result.value.stateRoot).toBeUndefined();
      expect(result.value.json).toBeUndefined();
    }
  });

  it('package publish 기본값을 설정한다', () => {
    const result = parseArgv(['package', 'publish']);

    expect(result.success).toBe(true);
    if (result.success) {
      const cmd = result.value.command;
      if (cmd.action === 'package.publish') {
        expect(cmd.tag).toBe('latest');
        expect(cmd.access).toBe('public');
      }
    }
  });

  it('init 명령을 파싱한다', () => {
    const result = parseArgv(['init', 'my-project', '--name', 'my-swarm', '--template', 'multi-agent', '--force']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('init');
      const cmd = result.value.command;
      if (cmd.action === 'init') {
        expect(cmd.initPath).toBe('my-project');
        expect(cmd.name).toBe('my-swarm');
        expect(cmd.template).toBe('multi-agent');
        expect(cmd.force).toBe(true);
      }
    }
  });

  it('init 명령 기본값을 설정한다', () => {
    const result = parseArgv(['init']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.command.action).toBe('init');
      const cmd = result.value.command;
      if (cmd.action === 'init') {
        expect(cmd.initPath).toBeUndefined();
        expect(cmd.name).toBeUndefined();
        expect(cmd.template).toBe('default');
        expect(cmd.git).toBe(true);
        expect(cmd.force).toBeUndefined();
        expect(cmd.asPackage).toBeUndefined();
      }
    }
  });

  it('init --package 옵션을 파싱한다', () => {
    const result = parseArgv(['init', '--package', '--template', 'package']);

    expect(result.success).toBe(true);
    if (result.success) {
      const cmd = result.value.command;
      if (cmd.action === 'init') {
        expect(cmd.asPackage).toBe(true);
        expect(cmd.template).toBe('package');
      }
    }
  });

  it('init --no-git 옵션을 파싱한다', () => {
    const result = parseArgv(['init', '--no-git']);

    expect(result.success).toBe(true);
    if (result.success) {
      const cmd = result.value.command;
      if (cmd.action === 'init') {
        expect(cmd.noGit).toBe(true);
      }
    }
  });

  it('init 잘못된 template 값은 파싱 실패한다', () => {
    const result = parseArgv(['init', '--template', 'invalid']);

    expect(result.success).toBe(false);
  });

  it('bare instance 명령은 파싱 실패한다 (라우터에서 interactive 폴백)', () => {
    const result = parseArgv(['instance']);

    // Optique or()는 토큰 미소비 브랜치를 허용하지 않으므로
    // bare "instance"는 파싱 실패 → 라우터에서 interactive로 폴백
    expect(result.success).toBe(false);
  });
});
