import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type RestartCommand = Extract<GdnCommand, { action: 'restart' }>;

interface RestartContext {
  cmd: RestartCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleRestart({ cmd, deps, globals }: RestartContext): Promise<ExitCode> {
  const agent = cmd.agent ?? undefined;
  const fresh = cmd.fresh ?? false;

  const result = await deps.runtime.restart({
    agent,
    fresh,
    stateRoot: globals.stateRoot ?? undefined,
  });

  if (result.instanceKey && typeof result.pid === 'number') {
    const target = agent ? `agent "${agent}"` : 'Orchestrator';
    const freshLabel = fresh ? ' (fresh, state cleared)' : '';
    deps.io.out(`${target} restarted: ${result.instanceKey} (pid: ${result.pid})${freshLabel}`);
    return 0;
  }

  const target = agent ? `agent "${agent}"` : result.restarted.join(', ');
  const freshLabel = fresh ? ' (fresh, state cleared)' : '';
  deps.io.out(`Restart requested for: ${target}${freshLabel}`);
  return 0;
}
