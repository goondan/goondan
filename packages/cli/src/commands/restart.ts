import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type RestartCommand = Extract<GdnCommand, { action: 'restart' }>;

interface RestartContext {
  cmd: RestartCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleRestart({ cmd, deps, globals }: RestartContext): Promise<ExitCode> {
  const result = await deps.runtime.restart({
    agent: cmd.agent ?? undefined,
    fresh: cmd.fresh ?? false,
    stateRoot: globals.stateRoot ?? undefined,
  });

  if (result.instanceKey && typeof result.pid === 'number') {
    deps.io.out(`Orchestrator restarted: ${result.instanceKey} (pid: ${result.pid})`);
    return 0;
  }

  deps.io.out(`Restart requested for: ${result.restarted.join(', ')}`);
  return 0;
}
