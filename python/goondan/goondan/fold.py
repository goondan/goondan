"""세션 저널을 결정적인 읽기 뷰로 만드는 순수 fold입니다."""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import Any


FOLD_VERSION = 1


class FoldError(Exception):
    """저널의 순서, 범위 또는 상태 전이가 올바르지 않습니다."""


class UnsupportedJournalVersionError(FoldError):
    """건너뛸 수 없는 이벤트의 버전이나 종류를 지원하지 않습니다."""


_KNOWN_TYPES = frozenset(
    {
        "conversation.message.appended",
        "conversation.message.replaced",
        "conversation.message.removed",
        "conversation.truncated",
        "operation.created",
        "operation.approved",
        "operation.rejected",
        "operation.cancelled",
        "operation.execution.started",
        "operation.completed",
        "operation.failed",
        "operation.delivery.claimed",
        "operation.delivery.finished",
        "turn.start",
        "input.received",
        "turn.done",
        "turn.error",
        "agent.start",
        "agent.done",
        "agent.error",
        "route.function",
        "snapshot.saved",
    }
)


def _required(event: Mapping[str, Any], *keys: str) -> None:
    missing = [key for key in keys if key not in event]
    if missing:
        raise FoldError(f"{event.get('type', 'event')} is missing {', '.join(missing)}")


def _conversation_key(event: Mapping[str, Any]) -> tuple[str, str]:
    _required(event, "agent", "instance", "executionId", "turnId")
    return str(event["agent"]), str(event["instance"])


def _find_message(messages: Sequence[Mapping[str, Any]], message_id: Any) -> int | None:
    for index, message in enumerate(messages):
        if message.get("id") == message_id:
            return index
    return None


def _base_state(session_id: str) -> dict[str, Any]:
    return {
        "version": 1,
        "sessionId": session_id,
        "head": 0,
        "conversations": [],
        "operations": [],
        "turns": [],
        "executions": [],
    }


def fold(
    session_id: str,
    events: Sequence[Mapping[str, Any]],
    supported_version: int = FOLD_VERSION,
) -> dict[str, Any]:
    """이벤트를 순서대로 적용하여 ``journalState`` JSON 값을 반환합니다."""

    if not isinstance(session_id, str):
        raise FoldError("session_id must be a string")
    if isinstance(supported_version, bool) or not isinstance(supported_version, int) or supported_version < 1:
        raise FoldError("supported_version must be a positive integer")

    state = _base_state(session_id)
    conversations: dict[tuple[str, str], dict[str, Any]] = {}
    operations: dict[str, dict[str, Any]] = {}
    turns: dict[str, dict[str, Any]] = {}
    executions: dict[str, dict[str, Any]] = {}
    input_ids: set[str] = set()
    expected_seq = 1

    def rebuild_indexes() -> None:
        nonlocal conversations, operations, turns, executions, input_ids
        conversations = {(item["agent"], item["instance"]): item for item in state["conversations"]}
        operations = {item["operationId"]: item for item in state["operations"]}
        turns = {item["turnId"]: item for item in state["turns"]}
        executions = {item["executionId"]: item for item in state["executions"]}
        input_ids = {item["inputId"] for turn in state["turns"] for item in turn["inputs"]}

    for raw in events:
        if not isinstance(raw, Mapping):
            raise FoldError("journal events must be objects")
        event = copy.deepcopy(dict(raw))
        _required(event, "seq", "version", "type", "sessionId", "at", "data", "writeId")
        if event["sessionId"] != session_id:
            raise FoldError("journal event belongs to another session")
        seq = event["seq"]
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
            raise FoldError("journal seq must be a positive integer")
        event_type = event["type"]
        version = event["version"]

        if seq != expected_seq:
            if expected_seq == 1 and event_type == "snapshot.saved":
                data = event.get("data")
                through = data.get("throughSeq") if isinstance(data, Mapping) else None
                if not isinstance(through, int) or through < 0 or seq != through + 1:
                    raise FoldError("a leading snapshot must follow its throughSeq")
            else:
                raise FoldError(f"journal seq must be contiguous: expected {expected_seq}, found {seq}")
        expected_seq = seq + 1
        state["head"] = seq
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise FoldError("journal version must be a positive integer")
        state["version"] = max(state["version"], version)

        if version > supported_version or event_type not in _KNOWN_TYPES:
            if event.get("skippable") is True:
                continue
            raise UnsupportedJournalVersionError(f"unsupported journal event: {event_type} version {version}")
        data = event["data"]
        if not isinstance(data, Mapping):
            raise FoldError(f"{event_type} data must be an object")

        if event_type == "snapshot.saved":
            snapshot = data.get("state")
            through = data.get("throughSeq")
            if not isinstance(snapshot, Mapping) or snapshot.get("sessionId") != session_id or snapshot.get("head") != through:
                raise FoldError("snapshot state does not match its scope")
            if not isinstance(through, int) or through >= seq:
                raise FoldError("snapshot throughSeq must precede the snapshot event")
            state = copy.deepcopy(dict(snapshot))
            state["head"] = seq
            state["version"] = max(int(state.get("version", 1)), version)
            rebuild_indexes()
            continue

        if event_type.startswith("conversation."):
            key = _conversation_key(event)
            conversation = conversations.get(key)
            if conversation is None:
                conversation = {"sessionId": session_id, "agent": key[0], "instance": key[1], "messages": []}
                conversations[key] = conversation
                state["conversations"].append(conversation)
            messages = conversation["messages"]
            if event_type == "conversation.message.appended":
                message = copy.deepcopy(data.get("message"))
                if not isinstance(message, Mapping) or not isinstance(message.get("id"), str):
                    raise FoldError("appended conversation message is invalid")
                if _find_message(messages, message["id"]) is not None:
                    raise FoldError("conversation message id already exists")
                index = data.get("index", len(messages))
                if isinstance(index, bool) or not isinstance(index, int) or index < 0 or index > len(messages):
                    raise FoldError("conversation message index is outside the conversation")
                messages.insert(index, message)
            elif event_type == "conversation.message.replaced":
                message_id = data.get("messageId")
                message = copy.deepcopy(data.get("message"))
                if not isinstance(message, Mapping) or message.get("id") != message_id:
                    raise FoldError("replacement message id does not match")
                index = _find_message(messages, message_id)
                if index is not None:
                    messages[index] = message
            elif event_type == "conversation.message.removed":
                index = _find_message(messages, data.get("messageId"))
                if index is not None:
                    messages.pop(index)
            else:
                keep_last = data.get("keepLast")
                if isinstance(keep_last, bool) or not isinstance(keep_last, int) or keep_last < 0:
                    raise FoldError("conversation keepLast must be a non-negative integer")
                if keep_last < len(messages):
                    conversation["messages"] = messages[-keep_last:] if keep_last else []
            continue

        if event_type.startswith("operation."):
            _required(event, "agent", "instance", "turnId", "executionId", "operationId")
            operation_id = str(event["operationId"])
            if event_type == "operation.created":
                if operation_id in operations:
                    raise FoldError("operation already exists")
                operation = copy.deepcopy(data.get("operation"))
                if not isinstance(operation, Mapping):
                    raise FoldError("operation.created needs an operation")
                operation = dict(operation)
                scope = (operation.get("operationId"), operation.get("sessionId"), operation.get("agent"), operation.get("instance"), operation.get("turnId"), operation.get("executionId"))
                expected_scope = (operation_id, session_id, event["agent"], event["instance"], event["turnId"], event["executionId"])
                if scope != expected_scope or operation.get("status") != "pending" or operation.get("deliveryStatus") != "pending":
                    raise FoldError("created operation does not match its event")
                operations[operation_id] = operation
                state["operations"].append(operation)
                continue
            operation = operations.get(operation_id)
            if operation is None:
                raise FoldError("operation does not exist")
            updated_at = data.get("updatedAt")
            if isinstance(updated_at, bool) or not isinstance(updated_at, int) or updated_at < 0:
                raise FoldError("operation updatedAt is invalid")
            current = operation["status"]
            if event_type == "operation.approved":
                if current != "pending": raise FoldError("only pending operations can be approved")
                operation["status"] = "approved"
                if "inputPatch" in data:
                    operation["inputPatch"] = copy.deepcopy(data["inputPatch"])
                    operation["resolvedToolCall"] = copy.deepcopy(data["resolvedToolCall"])
            elif event_type == "operation.rejected":
                if current != "pending": raise FoldError("only pending operations can be rejected")
                operation["status"] = "rejected"
            elif event_type == "operation.cancelled":
                if current != "pending": raise FoldError("only pending operations can be cancelled")
                operation["status"] = "cancelled"
            elif event_type == "operation.execution.started":
                if current != "approved": raise FoldError("only approved operations can start")
                operation["status"] = "running"
            elif event_type == "operation.completed":
                if current != "running": raise FoldError("only running operations can complete")
                operation["status"] = "completed"
                operation["result"] = copy.deepcopy(data.get("result"))
            elif event_type == "operation.failed":
                if current not in ("approved", "running"): raise FoldError("operation cannot fail from its current state")
                operation["status"] = "failed"
                operation["error"] = data.get("error")
                operation["errorCode"] = data.get("errorCode")
            elif event_type == "operation.delivery.claimed":
                if current not in ("completed", "rejected", "cancelled", "failed") or operation.get("deliveryStatus") != "pending":
                    raise FoldError("operation completion cannot be claimed")
                operation["deliveryStatus"] = "delivering"
            elif event_type == "operation.delivery.finished":
                if operation.get("deliveryStatus") != "delivering":
                    raise FoldError("operation delivery is not claimed")
                outcome = data.get("outcome")
                if outcome == "delivered":
                    operation["deliveryStatus"] = "delivered"
                    operation["deliveredAt"] = data.get("deliveredAt")
                elif outcome in ("failed", "interrupted"):
                    operation["deliveryStatus"] = "pending"
                else:
                    raise FoldError("operation delivery outcome is invalid")
            operation["updatedAt"] = updated_at
            continue

        if event_type == "turn.start":
            _required(event, "turnId")
            if any(turn["status"] == "running" for turn in state["turns"]) or event["turnId"] in turns:
                raise FoldError("a session can have only one open turn")
            turn = {"turnId": event["turnId"], "sessionId": session_id, "status": "running", "inputs": []}
            turns[event["turnId"]] = turn
            state["turns"].append(turn)
            continue
        if event_type == "input.received":
            _required(event, "turnId", "inputId")
            turn = turns.get(str(event["turnId"]))
            if turn is None or turn["status"] != "running" or event["inputId"] in input_ids:
                raise FoldError("input does not belong to an open turn or is duplicated")
            journal_input: dict[str, Any] = {"inputId": event["inputId"], "input": copy.deepcopy(data.get("input"))}
            for key in ("agent", "startAgent"):
                if key in data: journal_input[key] = data[key]
            if "meta" in data: journal_input["meta"] = copy.deepcopy(data["meta"])
            if "operationId" in event: journal_input["operationId"] = event["operationId"]
            turn["inputs"].append(journal_input)
            input_ids.add(str(event["inputId"]))
            continue
        if event_type in ("turn.done", "turn.error"):
            _required(event, "turnId")
            turn = turns.get(str(event["turnId"]))
            if turn is None or turn["status"] != "running":
                raise FoldError("turn is not open")
            if event_type == "turn.done":
                turn["status"] = "completed"
                turn["result"] = copy.deepcopy(data.get("result"))
            else:
                status = data.get("status")
                if status not in ("failed", "aborted"):
                    raise FoldError("turn error status is invalid")
                turn["status"] = status
                turn["error"] = copy.deepcopy(data.get("error"))
            continue

        if event_type == "agent.start":
            _required(event, "agent", "instance", "turnId", "executionId")
            execution_id = str(event["executionId"])
            if execution_id in executions or any(item["instance"] == event["instance"] and item["status"] == "running" for item in state["executions"]):
                raise FoldError("agent execution is duplicated or its instance is busy")
            execution: dict[str, Any] = {
                "sessionId": session_id,
                "agent": event["agent"],
                "instance": event["instance"],
                "executionId": execution_id,
                "turnId": event["turnId"],
                "kind": data.get("kind"),
                "status": "running",
                "input": copy.deepcopy(data.get("input")),
            }
            for key in ("parentExecutionId", "operationId"):
                if key in event: execution[key] = event[key]
            executions[execution_id] = execution
            state["executions"].append(execution)
            continue
        if event_type in ("agent.done", "agent.error"):
            _required(event, "executionId")
            execution = executions.get(str(event["executionId"]))
            if execution is None or execution["status"] != "running":
                raise FoldError("agent execution is not open")
            if event_type == "agent.done":
                execution["status"] = "completed"
                execution["output"] = copy.deepcopy(data.get("output"))
                execution["finishReason"] = data.get("finishReason")
                execution["usage"] = copy.deepcopy(data.get("usage"))
            else:
                status = data.get("status")
                if status not in ("failed", "aborted"):
                    raise FoldError("agent error status is invalid")
                execution["status"] = status
                execution["error"] = copy.deepcopy(data.get("error"))
                execution["usage"] = copy.deepcopy(data.get("usage"))
            continue

        if event_type == "route.function":
            _required(event, "turnId")
            if data.get("status") not in ("done", "error"):
                raise FoldError("route function status is invalid")

    state["conversations"].sort(key=lambda item: (item["agent"], item["instance"]))
    return copy.deepcopy(state)


__all__ = ["FOLD_VERSION", "FoldError", "UnsupportedJournalVersionError", "fold"]
