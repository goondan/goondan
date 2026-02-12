import { formatDoctorReport } from '../formatter.js';
import type { CliDependencies, ExitCode } from '../types.js';
import type { GdnArgs, GdnCommand } from '../parser.js';

type DoctorCommand = Extract<GdnCommand, { action: 'doctor' }>;

interface DoctorContext {
  cmd: DoctorCommand;
  deps: CliDependencies;
  globals: Omit<GdnArgs, 'command'>;
}

export async function handleDoctor({ cmd, deps, globals }: DoctorContext): Promise<ExitCode> {
  const report = await deps.doctor.run(globals.config, cmd.fix ?? false, globals.stateRoot ?? undefined);
  deps.io.out(formatDoctorReport(report));

  return report.errors > 0 ? 1 : 0;
}
