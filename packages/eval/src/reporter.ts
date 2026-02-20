import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { EvalReport } from './types.js';

/**
 * 리포트를 콘솔에 테이블 형태로 출력한다.
 */
export function printReport(report: EvalReport): void {
  console.log('');
  console.log('='.repeat(72));
  console.log(`  Eval Report: ${report.sampleName} (${report.provider})`);
  console.log('='.repeat(72));
  console.log(`  Timestamp:     ${report.timestamp}`);
  console.log(`  Total Duration: ${formatDuration(report.totalDurationMs)}`);
  console.log(`  Average Score:  ${report.averageScore.toFixed(2)} / 10`);
  console.log('-'.repeat(72));
  console.log('');

  // 시나리오별 결과 테이블
  console.log(
    padRight('  Scenario', 30) +
      padRight('Score', 8) +
      padRight('Duration', 12) +
      'Deductions',
  );
  console.log('-'.repeat(72));

  for (const result of report.scenarios) {
    const deductionCount = result.deductions.length;
    const deductionText =
      deductionCount === 0 ? '-' : `${deductionCount} issue(s)`;

    console.log(
      padRight(`  ${result.scenarioName}`, 30) +
        padRight(`${result.score}/10`, 8) +
        padRight(formatDuration(result.durationMs), 12) +
        deductionText,
    );

    // 감점 상세
    for (const d of result.deductions) {
      console.log(
        `    -> -${d.pointsDeducted}pt [${d.criterion}]: ${d.reason}`,
      );
    }
  }

  console.log('');
  console.log('='.repeat(72));
  console.log('');
}

/**
 * 리포트를 JSON 파일로 저장한다.
 * 파일명: eval-{provider}-{timestamp}.json
 */
export async function saveReport(
  report: EvalReport,
  outputDir: string,
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = report.timestamp.replace(/[:.]/g, '-');
  const filename = `eval-${report.provider}-${timestamp}.json`;
  const filePath = path.join(outputDir, filename);

  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Report saved: ${filePath}`);
  return filePath;
}

// --- 유틸리티 ---

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}
