import { formatInstanceList } from '../formatter.js';
import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type InstanceListCommand = Extract<GdnCommand, { action: 'instance.list' }>;
type InstanceDeleteCommand = Extract<GdnCommand, { action: 'instance.delete' }>;
type InstanceRestartCommand = Extract<GdnCommand, { action: 'instance.restart' }>;

interface InstanceListContext {
  cmd: InstanceListCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

interface InstanceDeleteContext {
  cmd: InstanceDeleteCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

interface InstanceRestartContext {
  cmd: InstanceRestartCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleInstanceList({ cmd, deps, globals }: InstanceListContext): Promise<ExitCode> {
  const items = await deps.instances.list({
    agent: cmd.agent ?? undefined,
    limit: cmd.limit,
    all: cmd.all ?? false,
    stateRoot: globals.stateRoot ?? undefined,
  });

  deps.io.out(formatInstanceList(items));
  return 0;
}

export async function handleInstanceDelete({ cmd, deps, globals }: InstanceDeleteContext): Promise<ExitCode> {
  const deleted = await deps.instances.delete({
    key: cmd.key,
    force: cmd.force ?? false,
    stateRoot: globals.stateRoot ?? undefined,
  });

  if (deleted) {
    deps.io.out(`Instance deleted: ${cmd.key}`);
  } else {
    deps.io.out(`Instance not found: ${cmd.key}`);
  }

  return 0;
}

export async function handleInstanceRestart({ cmd, deps, globals }: InstanceRestartContext): Promise<ExitCode> {
  const result = await deps.runtime.restart({
    instanceKey: cmd.key,
    fresh: cmd.fresh ?? false,
    stateRoot: globals.stateRoot ?? undefined,
  });

  const pidSuffix = typeof result.pid === 'number' ? ` (pid: ${result.pid})` : '';
  const restartedKey = result.instanceKey ?? cmd.key;
  deps.io.out(`Instance restarted: ${restartedKey}${pidSuffix}`);
  return 0;
}
