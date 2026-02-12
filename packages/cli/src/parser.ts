import { merge, object, or } from '@optique/core/constructs';
import { optional, withDefault } from '@optique/core/modifiers';
import { argument, command, constant, option } from '@optique/core/primitives';
import { choice, integer, string } from '@optique/core/valueparser';
import { parse } from '@optique/core/parser';
import type { InferValue, Result } from '@optique/core/parser';
import { formatMessage } from '@optique/core/message';
import { DEFAULT_BUNDLE_FILE } from './constants.js';

// ---------------------------------------------------------------------------
// Global options (shared across all commands)
// ---------------------------------------------------------------------------

const globalOptions = object('Global Options', {
  config: withDefault(option('-c', '--config', string({ metavar: 'PATH' })), DEFAULT_BUNDLE_FILE),
  stateRoot: optional(option('--state-root', string({ metavar: 'PATH' }))),
  json: optional(option('--json')),
  verbose: optional(option('-v', '--verbose')),
  quiet: optional(option('-q', '--quiet')),
  noColor: optional(option('--no-color')),
});

// ---------------------------------------------------------------------------
// Command parsers
// ---------------------------------------------------------------------------

const initCommand = command(
  'init',
  object({
    action: constant('init' as const),
    initPath: optional(argument(string({ metavar: 'PATH' }))),
    name: optional(option('-n', '--name', string({ metavar: 'NAME' }))),
    template: withDefault(option('-t', '--template', choice(['default', 'multi-agent', 'package', 'minimal'])), 'default'),
    asPackage: optional(option('--package')),
    git: withDefault(option('--git'), true),
    noGit: optional(option('--no-git')),
    force: optional(option('-f', '--force')),
  }),
);

const runCommand = command(
  'run',
  object({
    action: constant('run' as const),
    bundlePath: optional(argument(string({ metavar: 'BUNDLE_PATH' }))),
    swarm: optional(option('-s', '--swarm', string({ metavar: 'NAME' }))),
    instanceKey: optional(option('-i', '--instance-key', string({ metavar: 'KEY' }))),
    watch: optional(option('-w', '--watch')),
    interactive: optional(option('--interactive')),
    input: optional(option('--input', string())),
    inputFile: optional(option('--input-file', string({ metavar: 'FILE' }))),
    noInstall: optional(option('--no-install')),
    envFile: optional(option('--env-file', string({ metavar: 'FILE' }))),
  }),
);

const restartCommand = command(
  'restart',
  object({
    action: constant('restart' as const),
    agent: optional(option('-a', '--agent', string({ metavar: 'NAME' }))),
    fresh: optional(option('--fresh')),
  }),
);

const validateCommand = command(
  'validate',
  object({
    action: constant('validate' as const),
    target: optional(argument(string({ metavar: 'PATH' }))),
    strict: optional(option('--strict')),
    fix: optional(option('--fix')),
    format: withDefault(option('--format', choice(['text', 'json', 'github'])), 'text'),
  }),
);

const instanceListCommand = command(
  'list',
  object({
    action: constant('instance.list' as const),
    agent: optional(option('-a', '--agent', string({ metavar: 'NAME' }))),
    limit: withDefault(option('-n', '--limit', integer({ min: 1 })), 20),
    all: optional(option('--all')),
  }),
);

const instanceDeleteCommand = command(
  'delete',
  object({
    action: constant('instance.delete' as const),
    key: argument(string({ metavar: 'KEY' })),
    force: optional(option('-f', '--force')),
  }),
);

const instanceCommand = command('instance', or(instanceListCommand, instanceDeleteCommand));

const packageAddCommand = command(
  'add',
  object({
    action: constant('package.add' as const),
    ref: argument(string({ metavar: 'PACKAGE_REF' })),
    dev: optional(option('-D', '--dev')),
    exact: optional(option('-E', '--exact')),
    registry: optional(option('--registry', string({ metavar: 'URL' }))),
  }),
);

const packageInstallCommand = command(
  'install',
  object({
    action: constant('package.install' as const),
    frozenLockfile: optional(option('--frozen-lockfile')),
    registry: optional(option('--registry', string({ metavar: 'URL' }))),
  }),
);

const packagePublishCommand = command(
  'publish',
  object({
    action: constant('package.publish' as const),
    publishPath: optional(argument(string({ metavar: 'PATH' }))),
    tag: withDefault(option('--tag', string()), 'latest'),
    access: withDefault(option('--access', choice(['public', 'restricted'])), 'public'),
    dryRun: optional(option('--dry-run')),
    registry: optional(option('--registry', string({ metavar: 'URL' }))),
  }),
);

const packageCommand = command('package', or(packageAddCommand, packageInstallCommand, packagePublishCommand));

const doctorCommand = command(
  'doctor',
  object({
    action: constant('doctor' as const),
    fix: optional(option('--fix')),
  }),
);

const logsCommand = command(
  'logs',
  object({
    action: constant('logs' as const),
    instanceKey: optional(option('-i', '--instance-key', string({ metavar: 'KEY' }))),
    process: withDefault(option('-p', '--process', string({ metavar: 'NAME' })), 'orchestrator'),
    stream: withDefault(option('--stream', choice(['stdout', 'stderr', 'both'])), 'both'),
    lines: withDefault(option('-l', '--lines', integer({ min: 1 })), 200),
  }),
);

// ---------------------------------------------------------------------------
// Top-level parser: global options + command union
// ---------------------------------------------------------------------------

const allCommands = or(
  initCommand,
  runCommand,
  restartCommand,
  validateCommand,
  instanceCommand,
  packageCommand,
  doctorCommand,
  logsCommand,
);

export const gdnParser = merge(globalOptions, object({ command: allCommands }));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type GdnArgs = InferValue<typeof gdnParser>;
export type GdnCommand = GdnArgs['command'];

// ---------------------------------------------------------------------------
// Test-friendly parse wrapper (no process.exit)
// ---------------------------------------------------------------------------

export function parseArgv(argv: readonly string[]): Result<GdnArgs> {
  return parse(gdnParser, argv);
}

export function formatParseError(result: Result<GdnArgs>): string {
  if (result.success) {
    return '';
  }
  return formatMessage(result.error);
}
