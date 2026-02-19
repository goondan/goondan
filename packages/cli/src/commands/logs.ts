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
    agent: cmd.agent ?? undefined,
    trace: cmd.trace ?? undefined,
    process: processName,
    stream,
    lines,
    stateRoot: globals.stateRoot ?? undefined,
  });

  const filters: string[] = [];
  if (cmd.agent) filters.push(`agent=${cmd.agent}`);
  if (cmd.trace) filters.push(`trace=${cmd.trace}`);
  const filterLabel = filters.length > 0 ? ` [${filters.join(', ')}]` : '';

  deps.io.out(`Logs instance=${result.instanceKey} process=${result.process} stream=${stream} lines=${lines}${filterLabel}`);
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
