import { mergeValues } from "./compose.ts";
import { isJsonObject, isRecord, jsonIssues, ownKeys } from "./json.ts";
import { type Json, type OperationDecision, type OperationStatus, type PendingOperation, type ToolCall } from "./types.ts";

export const interruptedMessage = "Operation execution outcome is unknown because the runtime stopped";
export const validationFailedMessage = "Operation validation failed";

export function isTerminalStatus(status: OperationStatus): status is "completed" | "rejected" | "cancelled" | "failed" {
  return status === "completed" || status === "rejected" || status === "cancelled" || status === "failed";
}

export function approvalReason(name: string): string { return `Tool ${name} requires approval`; }
export function deliveryIdOf(operationId: string): string { return `operation:${operationId}:completion`; }

export function newOperation(input: {
  operationId: string;
  agent: string;
  sessionId: string;
  turnId: string;
  instance: string;
  executionId: string;
  parentExecutionId?: string;
  toolCall: ToolCall;
  reasons: readonly string[];
  execution?: Record<string, Json>;
  now: number;
}): PendingOperation {
  const operation: PendingOperation = {
    operationId: input.operationId,
    deliveryId: deliveryIdOf(input.operationId),
    agent: input.agent,
    sessionId: input.sessionId,
    turnId: input.turnId,
    instance: input.instance,
    executionId: input.executionId,
    toolCall: structuredClone(input.toolCall),
    reasons: [...input.reasons],
    status: "pending",
    deliveryStatus: "pending",
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (input.parentExecutionId !== undefined) operation.parentExecutionId = input.parentExecutionId;
  if (input.execution !== undefined) operation.execution = structuredClone(input.execution);
  return operation;
}

export function pendingToolContent(operationId: string): Record<string, Json> { return { status: "pending", operationId }; }
export function effectiveCall(operation: PendingOperation): ToolCall { return operation.resolvedToolCall ?? operation.toolCall; }

export function decisionIssue(resolution: unknown): string | undefined {
  if (!isRecord(resolution)) return "an operation decision is an object";
  if (ownKeys(resolution).some((key) => key !== "decision" && key !== "inputPatch")) return "an operation decision has only decision and inputPatch";
  if (resolution.decision !== "approved" && resolution.decision !== "rejected" && resolution.decision !== "cancelled") {
    return 'an operation decision is "approved", "rejected", or "cancelled"';
  }
  if (resolution.inputPatch !== undefined && (!isRecord(resolution.inputPatch) || jsonIssues(resolution.inputPatch).length > 0)) {
    return "an operation inputPatch is a JSON object";
  }
  return undefined;
}

export function patchIssue(resolution: OperationDecision, operation: PendingOperation): string | undefined {
  if (resolution.inputPatch === undefined) return undefined;
  if (resolution.decision !== "approved") return "an operation inputPatch belongs to an approval";
  if (!isRecord(resolution.inputPatch)) return "an operation inputPatch is a JSON object";
  if (!isJsonObject(operation.toolCall.args)) return "an input patched tool call takes JSON object arguments";
  return undefined;
}

export function patchedCall(call: ToolCall, patch: Record<string, Json>): ToolCall | undefined {
  const merged = mergeValues(call.args, patch);
  if (!isJsonObject(merged)) return undefined;
  return { id: call.id, name: call.name, args: merged };
}
