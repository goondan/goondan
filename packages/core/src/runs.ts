import { type AgentRunRecord, type RunKind, type Usage } from "./types.ts";

/** A usage total that has counted nothing yet. */
export function zeroUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/** Adds one model response's usage to a total; a key the model left out counts as 0. */
export function addUsage(total: Usage, usage?: Partial<Usage>): void {
  if (!usage) return;
  total.input += usage.input ?? 0;
  total.output += usage.output ?? 0;
  total.cacheRead += usage.cacheRead ?? 0;
  total.cacheWrite += usage.cacheWrite ?? 0;
}

/** The sum of the usage of every agent run record, which is the usage of the whole turn. */
export function totalUsage(records: readonly AgentRunRecord[]): Usage {
  const total = zeroUsage();
  for (const record of records) addUsage(total, record.usage);
  return total;
}

/**
 * One agent run record together with the records of the runs it started. The tree keeps the order
 * `에이전트 실행 기록` defines: a sub-run follows the run that started it and precedes the next
 * sub-run of that run.
 */
export interface RunNode { record: AgentRunRecord; children: RunNode[] }

/** Where a run that is starting puts its record: the sibling list it joins and how it was started. */
export interface RunSink { kind: RunKind; nodes: RunNode[] }
export interface RunLineage { parentInstance: string | null; parentTurnId: string | null; rootTurnId: string }

/**
 * Registers a run that is starting. The record joins the sibling list right away, so runs that are
 * awaited together keep the order in which they were started, and is completed when the run ends.
 */
export function startRun(sink: RunSink, agent: string, instance: string, turnId: string, lineage: RunLineage): RunNode {
  const node: RunNode = { record: { agent, instance, turnId, ...lineage, kind: sink.kind, usage: zeroUsage(), status: "failed" }, children: [] };
  sink.nodes.push(node);
  return node;
}

/** Records how a registered run ended. */
export function finishRun(node: RunNode, usage: Usage, finishReason: string): void {
  node.record.usage = usage;
  node.record.finishReason = finishReason;
  node.record.status = "done";
}

/**
 * Records that a registered run failed. The record keeps the usage of the model responses the run
 * received before it failed, because a run's `usage` counts every response it received, and reports
 * no finish reason, because only an entry whose `status` is `done` has one.
 */
export function failRun(node: RunNode, usage: Usage): void {
  node.record.usage = usage;
  node.record.status = "failed";
}

/** 다른 분기의 실패로 이 실행이 중단되었다고 기록합니다. */
export function abortRun(node: RunNode, usage: Usage): void {
  node.record.usage = usage;
  node.record.status = "aborted";
}

/** Records one model call a synchronous hook requested through the hook context. */
export function recordModelCall(sink: RunSink, agent: string, instance: string, turnId: string, lineage: RunLineage, outcome?: { usage: Usage; finishReason: string }): void {
  const node = startRun({ kind: "model", nodes: sink.nodes }, agent, instance, turnId, lineage);
  if (outcome) finishRun(node, outcome.usage, outcome.finishReason);
}

/**
 * The records of a turn in the order `에이전트 실행 기록` defines: a depth first walk of the tree.
 * Every record is copied, so a run the turn stopped waiting for — the body of a hook that timed out,
 * for example — cannot change the result the turn already returned.
 */
export function flattenRuns(nodes: readonly RunNode[]): AgentRunRecord[] {
  const records: AgentRunRecord[] = [];
  const walk = (list: readonly RunNode[]): void => {
    for (const node of list) { records.push({ ...node.record, usage: { ...node.record.usage } }); walk(node.children); }
  };
  walk(nodes);
  return records;
}

/** A sink that keeps no record: the runs of an operation execution and of an asynchronous hook. */
export function detachedSink(kind: RunKind): RunSink {
  return { kind, nodes: [] };
}
