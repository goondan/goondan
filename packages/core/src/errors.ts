import { sortIssues } from "./json.ts";
import { type ConfigIssue, type ErrorLocation, type ToolCall, type TurnError } from "./types.ts";

export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => `- ${issue.path === "" ? "(root)" : issue.path}: ${issue.message} [${issue.code}]`);
  return ["Invalid Goondan configuration:", ...lines].join("\n");
}

/**
 * Every configuration failure both hosts report. `issues` is deduplicated by path and code, sorted
 * by path and code, and always has at least one entry.
 */
export class GoondanConfigError extends Error {
  readonly issues: readonly ConfigIssue[];
  constructor(issues: readonly ConfigIssue[], options?: ErrorOptions) {
    const sorted = sortIssues(issues);
    super(formatConfigIssues(sorted), options);
    this.name = "GoondanConfigError";
    this.issues = sorted;
  }
}

export function isGoondanConfigError(value: unknown): value is GoondanConfigError {
  return value instanceof GoondanConfigError;
}

/** What a failure declares; `attempt` is filled in by the agent run that reports the failure. */
export type ExecutionErrorDetail = Omit<TurnError, "attempt"> & { attempt?: number };

/**
 * Every execution failure the runtime reports. The fields of `실행 오류` are properties of the
 * exception, so the value the `error` stage receives and the value a failed turn throws carry the
 * same information: `where`, `codes`, `message`, `attempt` and, for a `tool` failure, `toolCall`.
 * An aborted execution is the failure whose `where` is `runtime` and whose `codes` are `["aborted"]`.
 */
export class GoondanExecutionError extends Error implements TurnError {
  readonly where: ErrorLocation;
  readonly codes: string[];
  readonly attempt: number;
  readonly toolCall?: ToolCall;
  constructor(detail: ExecutionErrorDetail, options?: ErrorOptions) {
    super(detail.message, options);
    this.name = "GoondanExecutionError";
    this.where = detail.where;
    this.codes = detail.codes;
    this.attempt = detail.attempt ?? 1;
    if (detail.toolCall !== undefined) this.toolCall = detail.toolCall;
  }
}

export function isGoondanExecutionError(value: unknown): value is GoondanExecutionError {
  return value instanceof GoondanExecutionError;
}

/** Raises the collected issues of one validation phase, or returns when the phase is clean. */
export function raiseIssues(issues: readonly ConfigIssue[]): void {
  if (issues.length > 0) throw new GoondanConfigError(issues);
}
