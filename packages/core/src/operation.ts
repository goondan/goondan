import { isJsonObject, isRecord } from "./json.ts";
import { mergeValues } from "./compose.ts";
import {
  type Json, type OperationCompletion, type OperationDecision, type OperationStatus,
  type OperationUpdate, type PendingOperation, type ToolCall,
} from "./types.ts";

/** The `error` of an operation whose runtime stopped while the tool was running. */
export const interruptedMessage = "Operation execution outcome is unknown because the runtime stopped";
/** The `error` of an operation the host's operation validation refused without an error of its own. */
export const validationFailedMessage = "Operation validation failed";

/** The statuses an operation no longer leaves; only these start a completion delivery. */
export function isTerminalStatus(status: OperationStatus): status is OperationCompletion["status"] {
  return status === "completed" || status === "rejected" || status === "cancelled" || status === "failed";
}

/** The approval reason the `approval: required` setting of one `tools` entry adds. */
export function approvalReason(name: string): string {
  return `Tool ${name} requires approval`;
}

/** The identifier of the single completion delivery of one operation. */
export function deliveryIdOf(operationId: string): string {
  return `operation:${operationId}:completion`;
}

/**
 * Builds the stored record of a new operation. An optional field is left out when it has no value,
 * so a stored operation never carries a `null` in place of an absent one.
 */
export function newOperation(input: {
  operationId: string; agent: string; conversationId: string; turnId: string; toolCall: ToolCall;
  reasons: readonly string[]; execution?: Record<string, Json>; context?: Record<string, Json>; now: number;
}): PendingOperation {
  const operation: PendingOperation = {
    operationId: input.operationId,
    deliveryId: deliveryIdOf(input.operationId),
    agent: input.agent,
    conversationId: input.conversationId,
    turnId: input.turnId,
    toolCall: structuredClone(input.toolCall),
    reasons: [...input.reasons],
    status: "pending",
    deliveryStatus: "pending",
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (input.execution !== undefined) operation.execution = structuredClone(input.execution);
  if (input.context !== undefined) operation.context = structuredClone(input.context);
  return operation;
}

/** The tool result the runtime stores in place of a call that became an operation. */
export function pendingToolContent(operationId: string): Record<string, Json> {
  return { status: "pending", operationId };
}

/**
 * The completion input of a terminal operation, with the keys in the order the specification fixes.
 * `result`, `error` and `errorCode` appear only when the operation has them.
 */
export function completionInput(operation: PendingOperation, status: OperationCompletion["status"]): OperationCompletion {
  const completion: OperationCompletion = {
    type: "operation_completion",
    deliveryId: operation.deliveryId,
    operationId: operation.operationId,
    conversationId: operation.conversationId,
    agent: operation.agent,
    status,
    toolCall: structuredClone(operation.toolCall),
  };
  if (operation.result !== undefined) completion.result = structuredClone(operation.result);
  if (operation.error !== undefined) completion.error = operation.error;
  if (operation.errorCode !== undefined) completion.errorCode = operation.errorCode;
  return completion;
}

/** The call an approved operation executes: the input-patched one when a decision supplied a patch. */
export function effectiveCall(operation: PendingOperation): ToolCall {
  return operation.resolvedToolCall ?? operation.toolCall;
}

/** Why a decision value cannot be recorded, or `undefined` when the value itself is usable. */
export function decisionIssue(resolution: unknown): string | undefined {
  if (!isRecord(resolution)) return "an operation decision is an object";
  if (resolution.decision !== "approved" && resolution.decision !== "rejected") {
    return 'an operation decision is "approved" or "rejected"';
  }
  return undefined;
}

/** Why an input patch cannot be recorded, or `undefined` when the patch is well formed. */
export function patchIssue(resolution: OperationDecision, operation: PendingOperation): string | undefined {
  if (resolution.decision !== "approved") return "an operation inputPatch belongs to an approval";
  if (!isRecord(resolution.inputPatch)) return "an operation inputPatch is a JSON object";
  if (!isJsonObject(operation.toolCall.args)) return "an input patched tool call takes JSON object arguments";
  return undefined;
}

/** The call an approved decision resolved: the same `id` and `name` with the merged arguments. */
export function patchedCall(call: ToolCall, patch: Record<string, Json>): ToolCall | undefined {
  const merged = mergeValues(call.args, patch);
  if (!isJsonObject(merged)) return undefined;
  return { id: call.id, name: call.name, args: merged };
}

/** The update that records a decision, with the patch fields only when the decision carries one. */
export function decisionUpdate(decision: "approved" | "rejected", patch?: Record<string, Json>, call?: ToolCall): OperationUpdate {
  const update: OperationUpdate = { status: decision };
  if (patch !== undefined && call !== undefined) {
    update.inputPatch = structuredClone(patch);
    update.resolvedToolCall = call;
  }
  return update;
}
