import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CliDependencies, TerminalIO } from '../types.js';
import { isObjectRecord } from '../utils.js';
import { DefaultDoctorService } from './doctor.js';
import { DefaultInitService } from './init.js';
import { FileInstanceStore } from './instances.js';
import { FileLogService } from './logs.js';
import { DefaultPackageService } from './package.js';
import { HttpRegistryClient } from './registry.js';
import { LocalRuntimeController } from './runtime.js';
import { DefaultBundleValidator } from './validator.js';

async function readCliVersion(cwd: string): Promise<string> {
  const localPackageJson = path.join(cwd, 'package.json');
  try {
    const raw = await readFile(localPackageJson, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isObjectRecord(parsed)) {
      const version = parsed['version'];
      if (typeof version === 'string') {
        return version;
      }
    }
  } catch {
    return '0.0.0';
  }

  return '0.0.0';
}

export function createDefaultDependencies(): CliDependencies {
  const cwd = process.cwd();
  const env = process.env;
  const validator = new DefaultBundleValidator(cwd);
  const registry = new HttpRegistryClient();

  const io = {
    out(message: string): void {
      process.stdout.write(`${message}\n`);
    },
    err(message: string): void {
      process.stderr.write(`${message}\n`);
    },
  };

  const terminal: TerminalIO = {
    stdinIsTTY: !!process.stdin.isTTY,
    stdoutIsTTY: !!process.stdout.isTTY,
    columns: process.stdout.columns ?? 80,
    setRawMode(enable: boolean): void {
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(enable);
      }
    },
    onData(cb: (data: Buffer) => void): void {
      process.stdin.on('data', cb);
    },
    offData(cb: (data: Buffer) => void): void {
      process.stdin.removeListener('data', cb);
    },
    resume(): void {
      process.stdin.resume();
    },
    pause(): void {
      process.stdin.pause();
    },
    write(data: string): void {
      process.stdout.write(data);
    },
  };

  const runtime = new LocalRuntimeController(cwd, env);
  const instances = new FileInstanceStore(env);
  const logs = new FileLogService(env);
  const packages = new DefaultPackageService(cwd, env, registry, validator);
  const doctor = new DefaultDoctorService(cwd, env, validator);
  const init = new DefaultInitService();

  const deps: CliDependencies = {
    io,
    terminal,
    env,
    cwd,
    version: '0.0.0',
    runtime,
    validator,
    instances,
    packages,
    doctor,
    logs,
    init,
  };

  void readCliVersion(cwd).then((version) => {
    deps.version = version;
  });

  return deps;
}
