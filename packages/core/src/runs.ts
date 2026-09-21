import { type AgentRunRecord, type FinishReason, type RunKind, type Usage } from "./types.ts";

export function zeroUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; }

export function addUsage(total: Usage, usage?: Partial<Usage>): void {
  if (!usage) return;
  total.input += usage.input ?? 0;
  total.output += usage.output ?? 0;
  total.cacheRead += usage.cacheRead ?? 0;
  total.cacheWrite += usage.cacheWrite ?? 0;
}

export function totalUsage(records: readonly AgentRunRecord[]): Usage {
  const total = zeroUsage();
  for (const record of records) addUsage(total, record.usage);
  return total;
}

export interface RunNode { record: AgentRunRecord; children: RunNode[] }
export interface RunSink { kind: RunKind; nodes: RunNode[] }
export interface RunCause { parentExecutionId?: string; operationId?: string }

export function startRun(
  sink: RunSink,
  agent: string,
  instance: string,
  executionId: string,
  turnId: string,
  cause: RunCause,
): RunNode {
  const record: AgentRunRecord = {
    agent,
    instance,
    executionId,
    turnId,
    kind: sink.kind,
    usage: zeroUsage(),
    status: "failed",
  };
  if (cause.parentExecutionId !== undefined) record.parentExecutionId = cause.parentExecutionId;
  if (cause.operationId !== undefined) record.operationId = cause.operationId;
  const node: RunNode = { record, children: [] };
  sink.nodes.push(node);
  return node;
}

export function finishRun(node: RunNode, usage: Usage, finishReason: FinishReason): void {
  node.record.usage = usage;
  node.record.finishReason = finishReason;
  node.record.status = "done";
}

export function failRun(node: RunNode, usage: Usage): void {
  node.record.usage = usage;
  node.record.status = "failed";
  delete node.record.finishReason;
}

export function flattenRuns(nodes: readonly RunNode[]): AgentRunRecord[] {
  const records: AgentRunRecord[] = [];
  const walk = (list: readonly RunNode[]): void => {
    for (const node of list) {
      records.push(structuredClone(node.record));
      walk(node.children);
    }
  };
  walk(nodes);
  return records;
}

export function detachedSink(kind: RunKind): RunSink { return { kind, nodes: [] }; }
