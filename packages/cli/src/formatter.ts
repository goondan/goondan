import type { CliError } from './errors.js';
import type { DiagnosticIssue, DoctorReport, InstanceRecord, OutputFormat, ValidationResult } from './types.js';
import { formatDate } from './utils.js';

function issueDetailLines(issue: DiagnosticIssue): string[] {
  const lines: string[] = [];
  lines.push(`  - [${issue.code}] ${issue.message}`);
  if (issue.path) {
    lines.push(`    path: ${issue.path}`);
  }
  if (issue.resource) {
    lines.push(`    resource: ${issue.resource}`);
  }
  if (issue.field) {
    lines.push(`    field: ${issue.field}`);
  }
  if (issue.suggestion) {
    lines.push(`    suggestion: ${issue.suggestion}`);
  }
  if (issue.helpUrl) {
    lines.push(`    help: ${issue.helpUrl}`);
  }

  return lines;
}

export function formatValidationResult(result: ValidationResult, format: OutputFormat, targetPath: string): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (format === 'github') {
    const lines: string[] = [];
    for (const error of result.errors) {
      const file = error.path ?? targetPath;
      const message = `[${error.code}] ${error.message}`;
      lines.push(`::error file=${file}::${message}`);
      if (error.suggestion) {
        lines.push(`::notice file=${file}::suggestion: ${error.suggestion}`);
      }
      if (error.helpUrl) {
        lines.push(`::notice file=${file}::help: ${error.helpUrl}`);
      }
    }

    for (const warning of result.warnings) {
      const file = warning.path ?? targetPath;
      const message = `[${warning.code}] ${warning.message}`;
      lines.push(`::warning file=${file}::${message}`);
      if (warning.suggestion) {
        lines.push(`::notice file=${file}::suggestion: ${warning.suggestion}`);
      }
      if (warning.helpUrl) {
        lines.push(`::notice file=${file}::help: ${warning.helpUrl}`);
      }
    }

    if (lines.length === 0) {
      lines.push('::notice::validation passed');
    }

    return lines.join('\n');
  }

  const output: string[] = [];
  output.push(`Validating ${targetPath}...`);
  if (result.errors.length === 0 && result.warnings.length === 0) {
    output.push('✓ Validation passed');
  } else {
    if (result.errors.length > 0) {
      output.push('Errors:');
      for (const issue of result.errors) {
        output.push(...issueDetailLines(issue));
      }
    }

    if (result.warnings.length > 0) {
      output.push('Warnings:');
      for (const issue of result.warnings) {
        output.push(...issueDetailLines(issue));
      }
    }
  }

  output.push(`Summary: errors=${result.errors.length}, warnings=${result.warnings.length}`);
  return output.join('\n');
}

export function formatCliError(error: CliError, json: boolean): string {
  if (json) {
    return JSON.stringify(
      {
        code: error.code,
        message: error.message,
        suggestion: error.suggestion,
        helpUrl: error.helpUrl,
        exitCode: error.exitCode,
      },
      null,
      2,
    );
  }

  const lines = [`[${error.code}] ${error.message}`];
  if (error.suggestion) {
    lines.push(`suggestion: ${error.suggestion}`);
  }
  if (error.helpUrl) {
    lines.push(`help: ${error.helpUrl}`);
  }
  return lines.join('\n');
}

function pad(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return value + ' '.repeat(width - value.length);
}

export function formatInstanceList(records: InstanceRecord[]): string {
  if (records.length === 0) {
    return 'No instances found.';
  }

  const header = [
    pad('INSTANCE KEY', 20),
    pad('AGENT', 14),
    pad('STATUS', 12),
    pad('CREATED', 20),
    pad('UPDATED', 20),
  ].join(' ');

  const lines = [header];
  for (const record of records) {
    lines.push(
      [
        pad(record.key, 20),
        pad(record.agent, 14),
        pad(record.status, 12),
        pad(record.createdAt, 20),
        pad(record.updatedAt, 20),
      ].join(' '),
    );
  }

  return lines.join('\n');
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ['Goondan Doctor', ''];

  for (const check of report.checks) {
    const prefix = check.level === 'ok' ? '✓' : check.level === 'warn' ? '⚠' : '✗';
    lines.push(`${prefix} [${check.category}] ${check.name}: ${check.detail}`);
    if (check.suggestion) {
      lines.push(`  suggestion: ${check.suggestion}`);
    }
  }

  lines.push('');
  lines.push(`Summary: ${report.passed} passed, ${report.warnings} warnings, ${report.errors} errors`);
  return lines.join('\n');
}

export function nowDateText(): string {
  return formatDate(new Date());
}
