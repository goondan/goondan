import type { CliDependencies, ExitCode, RuntimeStartRequest } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';
import { resolveBundlePath } from '../utils.js';

type RunCommand = Extract<GdnCommand, { action: 'run' }>;

interface RunContext {
  cmd: RunCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleRun({ cmd, deps, globals }: RunContext): Promise<ExitCode> {
  const bundleInput = cmd.bundlePath ?? globals.config;
  const bundlePath = await resolveBundlePath(deps.cwd, bundleInput);

  const request: RuntimeStartRequest = {
    bundlePath,
    swarm: cmd.swarm ?? undefined,
    instanceKey: cmd.instanceKey ?? undefined,
    watch: cmd.watch ?? false,
    interactive: cmd.interactive ?? false,
    input: cmd.input ?? undefined,
    inputFile: cmd.inputFile ?? undefined,
    noInstall: cmd.noInstall ?? false,
    envFile: cmd.envFile ?? undefined,
    stateRoot: globals.stateRoot ?? undefined,
  };

  const result = await deps.runtime.startOrchestrator(request);
  deps.io.out(`Orchestrator started (instanceKey=${result.instanceKey}${result.pid ? `, pid=${result.pid}` : ''})`);
  if (result.pid) {
    deps.io.out(`check: ps -p ${result.pid} -o pid,ppid,stat,etime,command`);
  }
  deps.io.out(`logs: gdn logs --instance-key ${result.instanceKey}`);
  return 0;
}
