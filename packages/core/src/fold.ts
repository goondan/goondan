import { compareText, isRecord, jsonEqual, toJson } from "./json.ts";
import { validateDefinition } from "./schema.ts";
import { isMessage, isMessageArray, isToolCall, isToolResult } from "./stage.ts";
import {
  type JournalConversation, type JournalEvent, type JournalExecution, type JournalInput,
  type JournalState, type PendingOperation, type TurnError, type TurnResult,
  type Usage,
} from "./types.ts";

export const JOURNAL_VERSION = 1;

export class JournalFoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalFoldError";
  }
}

function corrupt(event: JournalEvent, message: string): never {
  throw new JournalFoldError(`corrupt journal at seq ${String(event.seq)}: ${message}`);
}

function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function usage(value: unknown): value is Usage {
  if (!isRecord(value)) return false;
  return [value.input, value.output, value.cacheRead, value.cacheWrite].every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
}
function turnError(value: unknown): value is TurnError {
  if (!isRecord(value)) return false;
  return text(value.where) && Array.isArray(value.codes) && value.codes.every(text)
    && text(value.message) && integer(value.attempt) && value.attempt >= 1;
}
function turnResult(value: unknown): value is TurnResult {
  if (!isRecord(value)) return false;
  return text(value.turnId) && Array.isArray(value.outputs) && value.outputs.every(isMessage)
    && usage(value.usage) && value.status === "done" && Array.isArray(value.runs);
}

function journalState(value: unknown): value is JournalState {
  return validateDefinition("journalState", value, []).length === 0;
}

function eventEnvelope(value: JournalEvent): boolean {
  if (!integer(value.seq) || value.seq < 1 || !integer(value.version) || value.version < 1 || !text(value.type)
    || typeof value.sessionId !== "string" || !integer(value.at) || !text(value.writeId)
    || toJson(value.data) === undefined || (value.skippable !== undefined && value.skippable !== true)
    || (value.parentExecutionId !== undefined && value.operationId !== undefined)) return false;
  for (const candidate of [value.agent, value.instance, value.turnId, value.executionId, value.inputId, value.parentExecutionId, value.operationId]) {
    if (candidate !== undefined && !text(candidate)) return false;
  }
  return true;
}

function pendingOperation(value: unknown): value is PendingOperation {
  if (!isRecord(value)) return false;
  return text(value.operationId) && text(value.deliveryId) && text(value.agent)
    && typeof value.sessionId === "string" && text(value.turnId) && text(value.instance)
    && text(value.executionId) && isToolCall(value.toolCall)
    && Array.isArray(value.reasons) && value.reasons.length > 0 && value.reasons.every(text)
    && ["pending", "approved", "running", "completed", "rejected", "cancelled", "failed"].includes(String(value.status))
    && ["pending", "delivering", "delivered"].includes(String(value.deliveryStatus))
    && integer(value.createdAt) && integer(value.updatedAt);
}

function operationOf(state: JournalState, event: JournalEvent): PendingOperation {
  const operation = state.operations.find((item) => item.operationId === event.operationId);
  if (!operation) return corrupt(event, "operation does not exist");
  return operation;
}

function conversationOf(state: JournalState, event: JournalEvent): JournalConversation {
  if (!text(event.agent) || !text(event.instance) || !text(event.executionId) || !text(event.turnId)) {
    return corrupt(event, "conversation scope is incomplete");
  }
  let conversation = state.conversations.find((item) => item.agent === event.agent && item.instance === event.instance);
  if (!conversation) {
    conversation = { sessionId: event.sessionId, agent: event.agent, instance: event.instance, messages: [] };
    state.conversations.push(conversation);
    state.conversations.sort((left, right) => compareText(left.agent, right.agent) || compareText(left.instance, right.instance));
  }
  return conversation;
}

function applyConversation(state: JournalState, event: JournalEvent): void {
  const data = event.data;
  if (!isRecord(data)) return corrupt(event, "conversation data is not an object");
  const conversation = conversationOf(state, event);
  if (event.type === "conversation.message.appended") {
    const appended = data.message;
    if (!isMessage(appended)) return corrupt(event, "message is invalid");
    if (conversation.messages.some((message) => message.id === appended.id)) return corrupt(event, "message id already exists");
    if (data.index === undefined) conversation.messages.push(structuredClone(appended));
    else {
      if (!integer(data.index) || data.index > conversation.messages.length) return corrupt(event, "message index is invalid");
      conversation.messages.splice(data.index, 0, structuredClone(appended));
    }
    return;
  }
  if (event.type === "conversation.message.replaced") {
    if (!text(data.messageId) || !isMessage(data.message) || data.message.id !== data.messageId) return corrupt(event, "replacement is invalid");
    const index = conversation.messages.findIndex((message) => message.id === data.messageId);
    if (index >= 0) conversation.messages[index] = structuredClone(data.message);
    return;
  }
  if (event.type === "conversation.message.removed") {
    if (!text(data.messageId)) return corrupt(event, "messageId is invalid");
    const index = conversation.messages.findIndex((message) => message.id === data.messageId);
    if (index >= 0) conversation.messages.splice(index, 1);
    return;
  }
  if (!integer(data.keepLast)) return corrupt(event, "keepLast is invalid");
  if (data.keepLast < conversation.messages.length) {
    conversation.messages = data.keepLast === 0 ? [] : conversation.messages.slice(-data.keepLast);
  }
}

function applyOperation(state: JournalState, event: JournalEvent): void {
  const data = event.data;
  if (!isRecord(data) || !text(event.operationId)) return corrupt(event, "operation scope or data is invalid");
  if (event.type === "operation.created") {
    const created = data.operation;
    if (!pendingOperation(created)) return corrupt(event, "operation is invalid");
    if (state.operations.some((item) => item.operationId === created.operationId)) return corrupt(event, "operation already exists");
    if (created.operationId !== event.operationId || created.sessionId !== event.sessionId
      || created.agent !== event.agent || created.instance !== event.instance
      || created.turnId !== event.turnId || created.executionId !== event.executionId
      || created.status !== "pending" || created.deliveryStatus !== "pending") {
      return corrupt(event, "operation scope does not match its envelope");
    }
    state.operations.push(structuredClone(created));
    return;
  }
  const operation = operationOf(state, event);
  if (!integer(data.updatedAt)) return corrupt(event, "updatedAt is invalid");
  if (event.type === "operation.approved") {
    if (operation.status !== "pending") return corrupt(event, "only pending operations can be approved");
    operation.status = "approved";
    if (data.inputPatch !== undefined || data.resolvedToolCall !== undefined) {
      if (!isRecord(data.inputPatch) || !isToolCall(data.resolvedToolCall)) return corrupt(event, "approval patch is invalid");
      const patch = toJson(data.inputPatch);
      if (!isRecord(patch)) return corrupt(event, "approval patch is invalid");
      operation.inputPatch = patch;
      operation.resolvedToolCall = structuredClone(data.resolvedToolCall);
    }
  } else if (event.type === "operation.rejected" || event.type === "operation.cancelled") {
    if (operation.status !== "pending") return corrupt(event, "only pending operations can be rejected or cancelled");
    operation.status = event.type === "operation.rejected" ? "rejected" : "cancelled";
  } else if (event.type === "operation.execution.started") {
    if (operation.status !== "approved") return corrupt(event, "only approved operations can start");
    operation.status = "running";
  } else if (event.type === "operation.completed") {
    if (operation.status !== "running" || !isToolResult(data.result)) return corrupt(event, "completed operation is invalid");
    operation.status = "completed";
    operation.result = structuredClone(data.result);
  } else if (event.type === "operation.failed") {
    if ((operation.status !== "approved" && operation.status !== "running") || !text(data.error)
      || !["validation_failed", "execution_failed", "execution_interrupted"].includes(String(data.errorCode))) {
      return corrupt(event, "failed operation is invalid");
    }
    operation.status = "failed";
    operation.error = data.error;
    if (data.errorCode === "validation_failed" || data.errorCode === "execution_failed" || data.errorCode === "execution_interrupted") {
      operation.errorCode = data.errorCode;
    }
  } else if (event.type === "operation.delivery.claimed") {
    if (!["completed", "rejected", "cancelled", "failed"].includes(operation.status) || operation.deliveryStatus !== "pending") {
      return corrupt(event, "operation delivery cannot be claimed");
    }
    operation.deliveryStatus = "delivering";
  } else {
    if (operation.deliveryStatus !== "delivering" || !["delivered", "failed", "interrupted"].includes(String(data.outcome))) {
      return corrupt(event, "operation delivery result is invalid");
    }
    if (data.outcome === "delivered") {
      if (!integer(data.deliveredAt)) return corrupt(event, "deliveredAt is invalid");
      operation.deliveryStatus = "delivered";
      operation.deliveredAt = data.deliveredAt;
    } else operation.deliveryStatus = "pending";
  }
  operation.updatedAt = data.updatedAt;
}

function applyTurn(state: JournalState, event: JournalEvent): void {
  const data = event.data;
  if (!isRecord(data) || !text(event.turnId)) return corrupt(event, "turn scope or data is invalid");
  if (event.type === "turn.start") {
    if (state.turns.some((turn) => turn.status === "running") || state.turns.some((turn) => turn.turnId === event.turnId)) {
      return corrupt(event, "turn is already open");
    }
    state.turns.push({ turnId: event.turnId, sessionId: event.sessionId, status: "running", inputs: [] });
    return;
  }
  const turn = state.turns.find((item) => item.turnId === event.turnId);
  if (!turn || turn.status !== "running") return corrupt(event, "turn is not open");
  if (event.type === "input.received") {
    if (!text(event.inputId) || state.turns.some((item) => item.inputs.some((input) => input.inputId === event.inputId))) {
      return corrupt(event, "inputId is missing or duplicated");
    }
    const received = data.input;
    if (received === undefined) return corrupt(event, "input is missing");
    const json = toJson(received);
    if (json === undefined) return corrupt(event, "input is not JSON");
    const input: JournalInput = { inputId: event.inputId, input: json };
    if (typeof data.agent === "string") input.agent = data.agent;
    if (typeof data.startAgent === "string") input.startAgent = data.startAgent;
    if (event.operationId !== undefined) input.operationId = event.operationId;
    turn.inputs.push(input);
  } else if (event.type === "turn.done") {
    if (!turnResult(data.result)) return corrupt(event, "turn result is invalid");
    turn.status = "completed";
    turn.result = structuredClone(data.result);
  } else {
    if ((data.status !== "failed" && data.status !== "aborted") || !turnError(data.error)) return corrupt(event, "turn error is invalid");
    turn.status = data.status;
    turn.error = structuredClone(data.error);
  }
}

function applyExecution(state: JournalState, event: JournalEvent): void {
  const data = event.data;
  if (!isRecord(data) || !text(event.agent) || !text(event.instance) || !text(event.turnId) || !text(event.executionId)) {
    return corrupt(event, "execution scope or data is invalid");
  }
  if (event.type === "agent.start") {
    if ((data.kind !== "turn" && data.kind !== "tool" && data.kind !== "hook") || !isMessageArray(data.input)) return corrupt(event, "execution input is invalid");
    if (state.executions.some((item) => item.executionId === event.executionId)
      || state.executions.some((item) => item.instance === event.instance && item.status === "running")) return corrupt(event, "execution is already open");
    const execution: JournalExecution = {
      sessionId: event.sessionId,
      agent: event.agent,
      instance: event.instance,
      executionId: event.executionId,
      turnId: event.turnId,
      kind: data.kind,
      status: "running",
      input: structuredClone(data.input),
    };
    if (event.parentExecutionId !== undefined) execution.parentExecutionId = event.parentExecutionId;
    if (event.operationId !== undefined) execution.operationId = event.operationId;
    state.executions.push(execution);
    return;
  }
  const execution = state.executions.find((item) => item.executionId === event.executionId);
  if (!execution || execution.status !== "running") return corrupt(event, "execution is not open");
  if (event.type === "agent.done") {
    if (!isMessage(data.output) || !["stop", "tool", "length", "other"].includes(String(data.finishReason)) || !usage(data.usage)) {
      return corrupt(event, "execution result is invalid");
    }
    execution.status = "completed";
    execution.output = structuredClone(data.output);
    if (data.finishReason === "stop" || data.finishReason === "tool" || data.finishReason === "length" || data.finishReason === "other") {
      execution.finishReason = data.finishReason;
    }
    execution.usage = structuredClone(data.usage);
  } else {
    if ((data.status !== "failed" && data.status !== "aborted") || !turnError(data.error) || !usage(data.usage)) {
      return corrupt(event, "execution error is invalid");
    }
    execution.status = data.status;
    execution.error = structuredClone(data.error);
    execution.usage = structuredClone(data.usage);
  }
}

const known = new Set([
  "conversation.message.appended", "conversation.message.replaced", "conversation.message.removed", "conversation.truncated",
  "operation.created", "operation.approved", "operation.rejected", "operation.cancelled", "operation.execution.started",
  "operation.completed", "operation.failed", "operation.delivery.claimed", "operation.delivery.finished",
  "turn.start", "input.received", "turn.done", "turn.error", "agent.start", "agent.done", "agent.error",
  "route.function", "snapshot.saved",
]);

/** 저장된 이벤트를 결정적인 세션 상태로 재생합니다. */
export function fold(sessionId: string, events: readonly JournalEvent[], supportedVersion: number = JOURNAL_VERSION): JournalState {
  let state: JournalState = { version: 1, sessionId, head: 0, conversations: [], operations: [], turns: [], executions: [] };
  let expected = 1;
  for (const [index, event] of events.entries()) {
    if (!eventEnvelope(event)) corrupt(event, "event envelope is invalid");
    if (event.sessionId !== sessionId) corrupt(event, "sessionId does not match");
    if (event.seq !== expected) {
      if (index === 0 && event.type === "snapshot.saved" && isRecord(event.data) && integer(event.data.throughSeq)) expected = event.data.throughSeq + 1;
      if (event.seq !== expected) corrupt(event, "event sequence has a gap");
    }
    expected = event.seq + 1;
    if (event.version > supportedVersion || !known.has(event.type)) {
      if (event.skippable === true) { state.head = event.seq; continue; }
      corrupt(event, "event version or type is unsupported");
    }
    if (validateDefinition("journalEvent", event, []).length > 0) corrupt(event, "event does not satisfy the journal schema");
    if (event.type === "snapshot.saved") {
      if (!isRecord(event.data) || !integer(event.data.throughSeq) || !journalState(event.data.state)
        || event.data.throughSeq >= event.seq || event.data.state.sessionId !== sessionId
        || event.data.state.head !== event.data.throughSeq || event.skippable !== true) {
        corrupt(event, "snapshot is invalid");
      }
      if (index > 0 && !jsonEqual(event.data.state, state)) corrupt(event, "snapshot does not match folded state");
      state = structuredClone(event.data.state);
      state.head = event.seq;
      state.version = Math.max(state.version, event.version);
      continue;
    }
    state.head = event.seq;
    state.version = Math.max(state.version, event.version);
    if (event.type.startsWith("conversation.")) applyConversation(state, event);
    else if (event.type.startsWith("operation.")) applyOperation(state, event);
    else if (event.type === "turn.start" || event.type === "input.received" || event.type === "turn.done" || event.type === "turn.error") applyTurn(state, event);
    else if (event.type.startsWith("agent.")) applyExecution(state, event);
    else if (event.type === "route.function") {
      if (!isRecord(event.data) || !integer(event.data.route) || !text(event.data.fn)
        || (event.data.status !== "done" && event.data.status !== "error") || !isMessageArray(event.data.input)) {
        corrupt(event, "route function event is invalid");
      }
    }
  }
  return structuredClone(state);
}
