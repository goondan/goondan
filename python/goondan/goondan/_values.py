"""§단계 값과 대화 저장, §제어 결과, §JSON 값 비교: the shapes a value stage accepts.

Every function here works on plain JSON values, so the runtime can check a hook result, a
model result or a tool result with the same rules the specification writes for both hosts.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any

from ._json import json_text
from ._schema import json_equal, json_type

ROLES = ("system", "user", "assistant", "tool")
FINISH_REASONS = ("stop", "tool", "length", "other")
USAGE_KEYS = ("input", "output", "cacheRead", "cacheWrite")
MESSAGE_KEYS = ("id", "role", "content", "source", "key", "keep", "meta")

# §제어 결과: the keys that make a hook result a control result, and the stages that read them.
CONTROL_KEYS = ("append", "call", "approval", "result", "retry")
STAGE_CONTROLS: dict[str, tuple[str, ...]] = {
    "conversation": ("append",),
    "modelInput": ("append",),
    "toolCall": ("call", "approval", "result"),
    "modelResult": ("retry",),
    "error": ("retry",),
}


def is_json(value: Any) -> bool:
    """A JSON value: finite numbers, string object keys and nothing the host invented."""
    kind = json_type(value)
    if kind == "invalid":
        return False
    if kind == "array":
        return all(is_json(item) for item in value)
    if kind == "object":
        return all(isinstance(key, str) and is_json(item) for key, item in value.items())
    return True


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _object(value: Any) -> bool:
    return isinstance(value, dict) and is_json(value)


def is_part(value: Any) -> bool:
    """`goondan.schema.json` `part`."""
    if not isinstance(value, dict):
        return False
    keys = set(value)
    kind = value.get("type")
    if kind == "text":
        return keys == {"type", "text"} and isinstance(value["text"], str)
    if kind == "json":
        return keys == {"type", "value"} and is_json(value["value"])
    if kind == "image":
        return {"type", "url"} <= keys <= {"type", "url", "mediaType"} and isinstance(value["url"], str) and isinstance(value.get("mediaType", ""), str)
    if kind == "media":
        return keys == {"type", "ref", "mediaType"} and isinstance(value["ref"], str) and isinstance(value["mediaType"], str)
    if kind == "tool.call":
        return keys == {"type", "callId", "name", "args"} and isinstance(value["callId"], str) and isinstance(value["name"], str) and is_json(value["args"])
    if kind == "tool.result":
        return (
            {"type", "callId", "content"} <= keys <= {"type", "callId", "content", "isError"}
            and isinstance(value["callId"], str)
            and isinstance(value["content"], list)
            and all(is_part(item) for item in value["content"])
            and isinstance(value.get("isError", False), bool)
        )
    return False


def is_message(value: Any, role: str | None = None) -> bool:
    """`goondan.schema.json` `message`. Optional fields are absent, never `null`."""
    if not isinstance(value, dict):
        return False
    keys = set(value)
    if not {"id", "role", "content", "source"} <= keys <= set(MESSAGE_KEYS):
        return False
    if not isinstance(value["id"], str) or not isinstance(value["source"], str):
        return False
    if value["role"] not in ROLES or (role is not None and value["role"] != role):
        return False
    if not isinstance(value["content"], list) or not all(is_part(item) for item in value["content"]):
        return False
    if "key" in value and not isinstance(value["key"], str):
        return False
    if "keep" in value and not isinstance(value["keep"], bool):
        return False
    return "meta" not in value or _object(value["meta"])


def is_message_array(value: Any) -> bool:
    return isinstance(value, list) and all(is_message(item) for item in value)


def is_carried_conversation(value: Any) -> bool:
    """§route 함수와 `carry`: what the return value of a `carry.conversation` function must be.

    Every item must satisfy the `message` definition of `goondan.schema.json`, which is the
    same condition a conversation stage value has, so both hosts apply the same check and a
    message without a string `source` fails the flow.
    """
    return is_message_array(value)


def is_system_block(value: Any) -> bool:
    if not isinstance(value, dict) or not {"text", "source"} <= set(value) <= {"text", "source", "cache"}:
        return False
    return isinstance(value["text"], str) and isinstance(value["source"], str) and isinstance(value.get("cache", False), bool)


def is_tool_definition(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"name", "description", "input"}:
        return False
    return isinstance(value["name"], str) and isinstance(value["description"], str) and _object(value["input"])


def is_model_input(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"system", "messages", "tools", "options"}:
        return False
    return (
        isinstance(value["system"], list) and all(is_system_block(item) for item in value["system"])
        and is_message_array(value["messages"])
        and isinstance(value["tools"], list) and all(is_tool_definition(item) for item in value["tools"])
        and _object(value["options"])
    )


def is_usage(value: Any) -> bool:
    """§사용량 집계: an absent key counts as 0, a present one must be a finite number ≥ 0."""
    if not _object(value):
        return False
    return all(_number(value[key]) and value[key] >= 0 for key in USAGE_KEYS if key in value)


def is_model_result(value: Any) -> bool:
    if not isinstance(value, dict) or not {"message", "finishReason"} <= set(value) <= {"message", "finishReason", "usage"}:
        return False
    if not is_message(value["message"], "assistant") or value["finishReason"] not in FINISH_REASONS:
        return False
    return "usage" not in value or is_usage(value["usage"])


def is_tool_call(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"id", "name", "args"}:
        return False
    return isinstance(value["id"], str) and isinstance(value["name"], str) and is_json(value["args"])


def is_tool_result(value: Any) -> bool:
    if not isinstance(value, dict) or not {"callId", "name", "args", "content"} <= set(value) <= {"callId", "name", "args", "content", "isError", "keep", "meta"}:
        return False
    if not isinstance(value["callId"], str) or not isinstance(value["name"], str) or not is_json(value["args"]):
        return False
    if not isinstance(value["content"], list) or not all(is_part(item) for item in value["content"]):
        return False
    if "isError" in value and not isinstance(value["isError"], bool):
        return False
    if "keep" in value and not isinstance(value["keep"], bool):
        return False
    return "meta" not in value or _object(value["meta"])


def stage_error(stage: str, value: Any, call_id: str | None = None) -> str | None:
    """§단계 값과 대화 저장: what is wrong with a value of `stage`, or `None` when it fits."""
    if stage in ("input", "error"):
        return None if is_json(value) else "must be a JSON value"
    if stage == "conversation":
        return None if is_message_array(value) else "must be an array of messages"
    if stage == "modelInput":
        return None if is_model_input(value) else "must be a model input with system, messages, tools and options"
    if stage == "modelResult":
        return None if is_model_result(value) else "must be a model result with an assistant message and a finishReason"
    if stage == "toolCall":
        if not is_tool_call(value):
            return "must be a tool call with id, name and args"
        return None if call_id is None or value["id"] == call_id else f"must keep the call id {call_id!r}"
    if stage == "toolResult":
        if not is_tool_result(value):
            return "must be a tool result with callId, name, args and content"
        return None if call_id is None or value["callId"] == call_id else f"must keep the call id {call_id!r}"
    if stage == "output":
        return None if is_message(value, "assistant") else "must be an assistant message"
    return f"is not a value stage: {stage!r}"


@dataclass(frozen=True)
class Control:
    """§제어 결과: one row of the control-result table, already checked and copied."""

    kind: str
    value: Any
    execution: dict[str, Any] | None = None


def control_result(stage: str, value: Any, call_id: str | None = None) -> Control | None:
    """The control result a hook returned, or `None` when the value is a plain stage value.

    Raises `ValueError` when the value carries a control key of this stage but breaks that
    row's format; the caller turns that into a hook failure.
    """
    if not isinstance(value, dict):
        return None
    allowed = STAGE_CONTROLS.get(stage, ())
    chosen = next((key for key in CONTROL_KEYS if key in value and key in allowed), None)
    if chosen is None:
        return None
    keys = set(value)
    if chosen == "append":
        if keys != {"append"}:
            raise ValueError("an append result carries only the append key")
        if not is_message_array(value["append"]):
            raise ValueError("append must be an array of messages")
        return Control("append", copy.deepcopy(value["append"]))
    if chosen == "call":
        if not keys <= {"call", "execution"}:
            raise ValueError("a call result carries only the call and execution keys")
        found = stage_error("toolCall", value["call"], call_id)
        if found:
            raise ValueError(f"call {found}")
        if "execution" in value and not _object(value["execution"]):
            raise ValueError("execution must be a JSON object")
        return Control("call", copy.deepcopy(value["call"]), copy.deepcopy(value["execution"]) if "execution" in value else None)
    if chosen == "approval":
        if keys != {"approval"}:
            raise ValueError("an approval result carries only the approval key")
        reason = value["approval"]
        if not isinstance(reason, dict) or set(reason) != {"reason"} or not isinstance(reason["reason"], str):
            raise ValueError("approval must be an object with a string reason")
        return Control("approval", {"reason": reason["reason"]})
    if chosen == "result":
        if keys != {"result"}:
            raise ValueError("a result control carries only the result key")
        found = stage_error("toolResult", value["result"], call_id)
        if found:
            raise ValueError(f"result {found}")
        return Control("result", copy.deepcopy(value["result"]))
    if not keys <= {"retry", "target", "afterMs"}:
        raise ValueError("a retry result carries only the retry, target and afterMs keys")
    if value["retry"] is not True:
        raise ValueError("retry must be true")
    targets = ("model",) if stage == "modelResult" else ("model", "tool")
    if value.get("target") not in targets:
        raise ValueError(f"target must be one of {', '.join(targets)}")
    after = value.get("afterMs")
    if "afterMs" in value and not (_number(after) and after >= 0):
        raise ValueError("afterMs must be a finite number of milliseconds that is 0 or more")
    return Control("retry", {"target": value["target"], "afterMs": after if "afterMs" in value else None})


def append_messages(target: list[dict[str, Any]], messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """§제어 결과: add each message unless the last one with the same `source` and `key` matches.

    Returns the new list and the messages that were actually added. Messages already in the
    list are never removed or changed.
    """
    updated = list(target)
    added: list[dict[str, Any]] = []
    for message in messages:
        last = next((item for item in reversed(updated) if item.get("source") == message.get("source") and item.get("key") == message.get("key")), None)
        if last is not None and last.get("role") == message.get("role") and json_equal(last.get("content"), message.get("content")):
            continue
        copied = copy.deepcopy(message)
        updated.append(copied)
        added.append(copied)
    return updated, added


def output_text(message: Any) -> str:
    """§출력 텍스트: the `text` parts and the JSON text of the `json` parts, in order."""
    parts = message.get("content") if isinstance(message, dict) else message
    if not isinstance(parts, list):
        return json_text(parts)
    pieces: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            pieces.append(part["text"])
        elif part.get("type") == "json":
            pieces.append(json_text(part.get("value")))
    return "".join(pieces)


def result_text(value: Any) -> str:
    """§인라인 훅: the text an inline result becomes."""
    return value if isinstance(value, str) else json_text(value)
