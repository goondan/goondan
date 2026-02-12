import type { CliDependencies, ExitCode, LogStream } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type LogsCommand = Extract<GdnCommand, { action: 'logs' }>;

interface LogsContext {
  cmd: LogsCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleLogs({ cmd, deps, globals }: LogsContext): Promise<ExitCode> {
  const stream: LogStream = cmd.stream;
  const lines = cmd.lines;
  const processName = cmd.process;

  const result = await deps.logs.read({
    instanceKey: cmd.instanceKey ?? undefined,
    process: processName,
    stream,
    lines,
    stateRoot: globals.stateRoot ?? undefined,
  });

  deps.io.out(`Logs instance=${result.instanceKey} process=${result.process} stream=${stream} lines=${lines}`);
  for (const chunk of result.chunks) {
    deps.io.out(`--- ${chunk.stream} (${chunk.path}) ---`);
    if (chunk.lines.length === 0) {
      deps.io.out('(empty)');
      continue;
    }
    deps.io.out(chunk.lines.join('\n'));
  }

  return 0;
}
