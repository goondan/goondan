"""§대화 정규화: the provider-independent normalization both adapters run before mapping."""

from __future__ import annotations

import inspect
from typing import Any, Mapping, Sequence

from ._errors import invalid_request, unsupported_content
from ._options import MediaResolver
from ._values import is_blank, json_text, non_empty_text

PDF_TYPE = "application/pdf"


def part_text(part: Mapping[str, Any]) -> str:
    """The text of a `text` part, or the compact JSON text of a `json` part."""
    if part.get("type") == "text":
        text = part.get("text")
        return text if isinstance(text, str) else ""
    return json_text(part.get("value"))


def message_text(message: Mapping[str, Any]) -> str:
    """The `text` and `json` part texts of a message, joined without a separator."""
    text = ""
    for part in content_of(message):
        if part.get("type") in ("text", "json"):
            text += part_text(part)
    return text


def content_of(message: Mapping[str, Any]) -> list[dict[str, Any]]:
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [part for part in content if isinstance(part, dict)]


def system_reminder(text: str) -> str:
    return f"<system-reminder>\n{text}\n</system-reminder>"


def repair_tool_pairs(messages: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """§대화 정규화 1: keeps a tool part only when both the call and the result exist, then drops empty messages."""
    calls: set[str] = set()
    results: set[str] = set()
    for message in messages:
        for part in content_of(message):
            call_id = part.get("callId")
            if not isinstance(call_id, str):
                continue
            if part.get("type") == "tool.call":
                calls.add(call_id)
            elif part.get("type") == "tool.result":
                results.add(call_id)
    paired = calls & results
    repaired: list[dict[str, Any]] = []
    for message in messages:
        content = content_of(message)
        kept = [
            part for part in content
            if part.get("type") not in ("tool.call", "tool.result") or part.get("callId") in paired
        ]
        if not kept:
            continue
        repaired.append({**message, "content": kept})
    return repaired


def split_leading_system(messages: Sequence[Mapping[str, Any]]) -> tuple[list[str], list[dict[str, Any]]]:
    """§대화 정규화 2: splits off the consecutive `system` messages at the start."""
    instructions: list[str] = []
    start = 0
    while start < len(messages):
        message = messages[start]
        if message.get("role") != "system":
            break
        text = message_text(message)
        if not is_blank(text):
            instructions.append(text)
        start += 1
    return instructions, [dict(message) for message in messages[start:]]


def object_schema(schema: Any) -> dict[str, Any]:
    """§대화 정규화: a tool input schema without a `type` key is sent as an object schema."""
    if not isinstance(schema, dict):
        return {"type": "object"}
    return dict(schema) if "type" in schema else {"type": "object", **schema}


class MediaSource:
    """§미디어 해석: base64 data or a URL, with the media type the adapter must use."""

    __slots__ = ("kind", "data", "url", "media_type")

    def __init__(self, kind: str, media_type: str, *, data: str = "", url: str = ""):
        self.kind = kind
        self.media_type = media_type
        self.data = data
        self.url = url


async def resolve_media_part(provider: str, part: Mapping[str, Any], resolver: MediaResolver | None) -> MediaSource:
    """§미디어 해석: turns a `media` part into data or a URL with the host resolver."""
    ref = part.get("ref")
    reference = ref if isinstance(ref, str) else ""
    declared = part.get("mediaType")
    declared_type = declared if isinstance(declared, str) else ""
    if resolver is None:
        raise unsupported_content(provider, f"media part {reference} without a resolve_media function")
    resolved: Any = resolver({"ref": reference, "mediaType": declared_type})
    if inspect.isawaitable(resolved):
        resolved = await resolved
    if not isinstance(resolved, Mapping):
        raise invalid_request(provider, f"resolve_media returned no data or url for {reference}")
    media_type = non_empty_text(resolved.get("mediaType")) or declared_type
    data = resolved.get("data")
    if isinstance(data, str):
        return MediaSource("data", media_type, data=data)
    url = resolved.get("url")
    if isinstance(url, str):
        return MediaSource("url", media_type, url=url)
    raise invalid_request(provider, f"resolve_media returned no data or url for {reference}")


def is_image_type(media_type: str) -> bool:
    return media_type.startswith("image/")
