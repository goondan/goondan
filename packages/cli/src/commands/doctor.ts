import { formatDoctorReport } from '../formatter.js';
import { usageError } from '../errors.js';
import { getBooleanOption } from '../options.js';
import type { CommandHandler } from './context.js';

export const handleDoctor: CommandHandler = async ({ parsed, deps, globals }) => {
  if (parsed.rest.length > 0) {
    throw usageError('doctor 명령은 위치 인자를 지원하지 않습니다.', 'gdn doctor [--fix] 형태를 사용하세요.');
  }

  const report = await deps.doctor.run(globals.configPath, getBooleanOption(parsed, 'fix'), globals.stateRoot);
  deps.io.out(formatDoctorReport(report));

  return report.errors > 0 ? 1 : 0;
};
