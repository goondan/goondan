"""§Anthropic Messages API: the official Anthropic adapter."""

from __future__ import annotations

import copy
import json as _json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ._errors import ModelError, invalid_request, invalid_response, stream_error, unsupported_content
from ._ids import new_message_id
from ._normalize import (
    PDF_TYPE,
    content_of,
    is_image_type,
    message_text,
    object_schema,
    part_text,
    repair_tool_pairs,
    resolve_media_part,
    split_leading_system,
    system_reminder,
)
from ._options import (
    HttpModelConfig,
    check_optional_choice,
    check_optional_flag,
    env_value,
    merge_headers,
    merge_model_options,
    provider_overrides,
    read_http_config,
    read_portable_options,
    resolve_httpx,
)
from ._transport import StreamCall, parse_event_data, stream_model
from ._values import as_text, is_blank, is_integer, is_number, json_equal, merge_objects, non_empty_text

PROVIDER = "anthropic"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MAX_TOKENS = 64_000
RESERVED_FIELDS = ("messages", "tools", "stream", "system")
LENGTH_STOP_REASONS = frozenset({"max_tokens", "model_context_window_exceeded"})
_INVALID_TOOL_ID_CHARACTERS = re.compile(r"[^A-Za-z0-9_-]")
_BASE64_DATA_URL = re.compile(r"data:([^;,]*)(?:;[^,]*)?;base64,(.*)\Z", re.DOTALL)
_HTTP_URL = re.compile(r"^https?://", re.IGNORECASE)
_USAGE_FIELDS = (
    ("input_tokens", "input"),
    ("output_tokens", "output"),
    ("cache_read_input_tokens", "cacheRead"),
    ("cache_creation_input_tokens", "cacheWrite"),
)


@dataclass
class _Settings:
    model: str
    options: dict[str, Any]
    auto_cache: bool
    cache_ttl: str | None
    mid_conversation_system: str
    resolve_media: Any


def _cache_control(ttl: str | None) -> dict[str, Any]:
    return {"type": "ephemeral"} if ttl is None else {"type": "ephemeral", "ttl": ttl}


def _tool_use_id(call_id: str) -> str:
    """§부분 매핑: every character outside `[A-Za-z0-9_-]` becomes `_`, one per code point."""
    sanitized = _INVALID_TOOL_ID_CHARACTERS.sub("_", call_id)
    return "_" if sanitized == "" else sanitized


def _is_non_blank_block(block: Any) -> bool:
    if not isinstance(block, dict) or block.get("type") != "text":
        return True
    text = block.get("text")
    return not isinstance(text, str) or not is_blank(text)


def _parts_from_blocks(blocks: Sequence[Any]) -> list[dict[str, Any]]:
    """§결과: `text` blocks become text parts and `tool_use` blocks become tool calls."""
    parts: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "text":
            text = block.get("text")
            if isinstance(text, str):
                parts.append({"type": "text", "text": text})
        elif kind == "tool_use":
            identifier = block.get("id")
            name = block.get("name")
            if isinstance(identifier, str) and isinstance(name, str):
                parts.append({"type": "tool.call", "callId": identifier, "name": name, "args": block.get("input")})
    return parts


def _text_block(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def _image_block(part: Mapping[str, Any]) -> dict[str, Any]:
    url = part.get("url")
    if not isinstance(url, str):
        raise invalid_request(PROVIDER, "an image part needs a string url")
    declared = part.get("mediaType")
    declared_type = declared if isinstance(declared, str) else ""
    match = _BASE64_DATA_URL.match(url)
    if match is not None:
        media_type = (match.group(1) or "") if declared_type == "" else declared_type
        return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": match.group(2) or ""}}
    if _HTTP_URL.match(url) is not None:
        return {"type": "image", "source": {"type": "url", "url": url}}
    raise unsupported_content(PROVIDER, f"an image URL that is neither a base64 data URL nor http(s): {url[:32]}")


async def _media_block(part: Mapping[str, Any], settings: _Settings) -> dict[str, Any]:
    media = await resolve_media_part(PROVIDER, part, settings.resolve_media)
    source = (
        {"type": "base64", "media_type": media.media_type, "data": media.data}
        if media.kind == "data"
        else {"type": "url", "url": media.url}
    )
    if is_image_type(media.media_type):
        return {"type": "image", "source": source}
    if media.media_type == PDF_TYPE:
        return {"type": "document", "source": source}
    raise unsupported_content(PROVIDER, f"media of type {media.media_type}")


async def _tool_result_content(parts: Sequence[Mapping[str, Any]], settings: _Settings) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for part in parts:
        kind = part.get("type")
        if kind in ("text", "json"):
            text = part_text(part)
            if not is_blank(text):
                blocks.append(_text_block(text))
        elif kind == "image":
            blocks.append(_image_block(part))
        elif kind == "media":
            blocks.append(await _media_block(part, settings))
        else:
            raise unsupported_content(PROVIDER, f"{kind} parts inside a tool result")
    return blocks


async def _user_blocks(message: Mapping[str, Any], settings: _Settings) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for part in content_of(message):
        kind = part.get("type")
        if kind in ("text", "json"):
            text = part_text(part)
            if not is_blank(text):
                blocks.append(_text_block(text))
        elif kind == "image":
            blocks.append(_image_block(part))
        elif kind == "media":
            blocks.append(await _media_block(part, settings))
        elif kind == "tool.result":
            call_id = part.get("callId")
            inner = part.get("content")
            content = await _tool_result_content(
                [item for item in inner if isinstance(item, dict)] if isinstance(inner, list) else [], settings,
            )
            block: dict[str, Any] = {"type": "tool_result", "tool_use_id": _tool_use_id(call_id if isinstance(call_id, str) else "")}
            if content:
                block["content"] = content
            if part.get("isError") is True:
                block["is_error"] = True
            blocks.append(block)
        else:
            raise unsupported_content(PROVIDER, f"{kind} parts in {message.get('role')} messages")
    return blocks


def _recorded_blocks(message: Mapping[str, Any]) -> list[Any] | None:
    """§원래 블록 재전송: the response blocks the adapter recorded in `meta.anthropic.content`."""
    meta = message.get("meta")
    if not isinstance(meta, dict):
        return None
    anthropic = meta.get(PROVIDER)
    if not isinstance(anthropic, dict):
        return None
    content = anthropic.get("content")
    return content if isinstance(content, list) else None


def _assistant_blocks(message: Mapping[str, Any]) -> list[Any]:
    content = content_of(message)
    recorded = _recorded_blocks(message)
    if recorded is not None and json_equal(_parts_from_blocks(recorded), content):
        return [block for block in recorded if _is_non_blank_block(block)]
    blocks: list[Any] = []
    for part in content:
        kind = part.get("type")
        if kind in ("text", "json"):
            text = part_text(part)
            if not is_blank(text):
                blocks.append(_text_block(text))
        elif kind == "tool.call":
            args = part.get("args")
            if args is not None and not isinstance(args, dict):
                raise invalid_request(PROVIDER, f"tool call {part.get('callId')} args must be an object or null")
            call_id = part.get("callId")
            name = part.get("name")
            blocks.append({
                "type": "tool_use",
                "id": _tool_use_id(call_id if isinstance(call_id, str) else ""),
                "name": name if isinstance(name, str) else "",
                "input": args if args is not None else {},
            })
        else:
            raise unsupported_content(PROVIDER, f"{kind} parts in assistant messages")
    return blocks


async def _message_units(messages: Sequence[Mapping[str, Any]], settings: _Settings) -> list[tuple[str, Any]]:
    units: list[tuple[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role == "system":
            text = message_text(message)
            if not is_blank(text):
                units.append(("system", text))
            continue
        blocks = _assistant_blocks(message) if role == "assistant" else await _user_blocks(message, settings)
        if not blocks:
            continue
        units.append(("assistant" if role == "assistant" else "user", blocks))
    return units


def _is_tool_result_block(block: Any) -> bool:
    return isinstance(block, dict) and block.get("type") == "tool_result"


def _place_messages(units: Sequence[tuple[str, Any]], settings: _Settings) -> list[dict[str, Any]]:
    """§메시지 배치: merges adjacent same-role messages and puts `tool_result` blocks first."""
    placed: list[dict[str, Any]] = []

    def append(role: str, blocks: Sequence[Any]) -> None:
        if placed and placed[-1]["role"] == role and isinstance(placed[-1]["content"], list):
            placed[-1]["content"].extend(blocks)
        else:
            placed.append({"role": role, "content": list(blocks)})

    for index, (kind, payload) in enumerate(units):
        if kind != "system":
            append(kind, payload)
            continue
        following = units[index + 1] if index + 1 < len(units) else None
        native = (
            settings.mid_conversation_system == "system"
            and bool(placed)
            and placed[-1]["role"] == "user"
            and (following is None or following[0] == "assistant")
        )
        if native:
            placed.append({"role": "system", "content": payload})
        else:
            append("user", [_text_block(system_reminder(payload))])
    for message in placed:
        if message["role"] != "user":
            continue
        blocks = message["content"]
        message["content"] = [block for block in blocks if _is_tool_result_block(block)] + [
            block for block in blocks if not _is_tool_result_block(block)
        ]
    return placed


def _system_blocks(system: Sequence[Mapping[str, Any]], instructions: Sequence[str], settings: _Settings) -> list[dict[str, Any]]:
    """§시스템 블록과 캐시: the non-blank system blocks, then the leading system message texts."""
    blocks = [block for block in system if isinstance(block, dict) and isinstance(block.get("text"), str) and not is_blank(block["text"])]
    flagged = [index for index, block in enumerate(blocks) if block.get("cache") is True]
    marked = set(flagged[-(3 if settings.auto_cache else 4):])
    mapped: list[dict[str, Any]] = []
    for index, block in enumerate(blocks):
        if index in marked:
            mapped.append({"type": "text", "text": block["text"], "cache_control": _cache_control(settings.cache_ttl)})
        else:
            mapped.append(_text_block(block["text"]))
    return mapped + [_text_block(text) for text in instructions]


def _tool_entries(tools: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for tool in tools:
        name = tool.get("name")
        description = tool.get("description")
        entries.append({
            "name": name if isinstance(name, str) else "",
            "description": description if isinstance(description, str) else "",
            "input_schema": object_schema(tool.get("input")),
        })
    return entries


def _input_lists(model_input: Mapping[str, Any]) -> tuple[list[Any], list[Any], list[Any], dict[str, Any]]:
    if not isinstance(model_input, Mapping):
        raise invalid_request(PROVIDER, "the model input must be an object")
    system = model_input.get("system")
    messages = model_input.get("messages")
    tools = model_input.get("tools")
    options = model_input.get("options")
    return (
        [item for item in system if isinstance(item, Mapping)] if isinstance(system, list) else [],
        [item for item in messages if isinstance(item, Mapping)] if isinstance(messages, list) else [],
        [item for item in tools if isinstance(item, Mapping)] if isinstance(tools, list) else [],
        dict(options) if isinstance(options, Mapping) else {},
    )


async def _anthropic_body(model_input: Mapping[str, Any], settings: _Settings) -> dict[str, Any]:
    system_blocks_input, messages_input, tools_input, options_input = _input_lists(model_input)
    options = merge_model_options(settings.options, options_input)
    portable = read_portable_options(PROVIDER, options)
    overrides = provider_overrides(PROVIDER, options, RESERVED_FIELDS)
    instructions, rest = split_leading_system(repair_tool_pairs(messages_input))
    system = _system_blocks(system_blocks_input, instructions, settings)
    messages = _place_messages(await _message_units(rest, settings), settings)
    body: dict[str, Any] = {
        "model": settings.model,
        "max_tokens": portable.max_tokens if portable.max_tokens is not None else DEFAULT_MAX_TOKENS,
        "stream": True,
    }
    if system:
        body["system"] = system
    body["messages"] = messages
    if tools_input:
        body["tools"] = _tool_entries(tools_input)
    if settings.auto_cache:
        body["cache_control"] = _cache_control(settings.cache_ttl)
    if portable.temperature is not None:
        body["temperature"] = portable.temperature
    if portable.top_p is not None:
        body["top_p"] = portable.top_p
    if portable.stop is not None:
        body["stop_sequences"] = portable.stop
    choice = portable.tool_choice
    if choice is not None:
        if choice in ("auto", "none"):
            body["tool_choice"] = {"type": choice}
        elif choice == "required":
            body["tool_choice"] = {"type": "any"}
        else:
            body["tool_choice"] = {"type": "tool", "name": choice["name"]}
    return copy.deepcopy(body if overrides is None else merge_objects(body, overrides))


def _finish_reason(stop_reason: str | None) -> str:
    if stop_reason in ("end_turn", "stop_sequence"):
        return "stop"
    if stop_reason == "tool_use":
        return "tool"
    if stop_reason is not None and stop_reason in LENGTH_STOP_REASONS:
        return "length"
    return "other"


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise invalid_response(PROVIDER, f"{field} is not a string")
    return value


def _append_text(block: dict[str, Any], key: str, piece: str) -> None:
    current = block.get(key)
    block[key] = (current if isinstance(current, str) else "") + piece


class _AnthropicStreamAssembler:
    """§스트림 이벤트, §결과: assembles the Messages API stream into a model result."""

    def __init__(self, emit: Any, request_id: str | None):
        self._emit = emit
        self._request_id = request_id
        self._blocks: dict[int, dict[str, Any]] = {}
        self._args: dict[int, str] = {}
        self._usage: dict[str, float] = {}
        self._id: str | None = None
        self._model: str | None = None
        self._stop_reason: str | None = None
        self._stop_details: Any = None
        self._has_stop_details = False
        self._stopped = False

    def accept(self, data: str) -> bool:
        event = parse_event_data(PROVIDER, data)
        if not isinstance(event, dict):
            raise invalid_response(PROVIDER, "stream event is not an object")
        kind = event.get("type")
        if not isinstance(kind, str):
            raise invalid_response(PROVIDER, "stream event has no type")
        if kind == "message_start":
            self._message_start(event.get("message"))
        elif kind == "content_block_start":
            self._block_start(event)
        elif kind == "content_block_delta":
            self._block_delta(event)
        elif kind == "message_delta":
            self._message_delta(event)
        elif kind == "message_stop":
            self._stopped = True
        elif kind == "error":
            raise stream_error(PROVIDER, event.get("error"), self._request_id or non_empty_text(event.get("request_id")))
        return False

    def _read_usage(self, value: Any) -> None:
        if not isinstance(value, dict):
            return
        for source, target in _USAGE_FIELDS:
            count = value.get(source)
            if is_number(count):
                self._usage[target] = count

    def _message_start(self, message: Any) -> None:
        if not isinstance(message, dict):
            raise invalid_response(PROVIDER, "message_start has no message")
        identifier = as_text(message.get("id"))
        model = as_text(message.get("model"))
        if identifier is not None:
            self._id = identifier
        if model is not None:
            self._model = model
        self._read_usage(message.get("usage"))

    def _index(self, event: Mapping[str, Any]) -> int:
        index = event.get("index")
        if not is_integer(index) or index < 0:
            raise invalid_response(PROVIDER, f"{event.get('type')} has an invalid index")
        return int(index)

    def _block_start(self, event: Mapping[str, Any]) -> None:
        index = self._index(event)
        block = event.get("content_block")
        if not isinstance(block, dict):
            raise invalid_response(PROVIDER, "content_block_start has no content_block")
        self._blocks[index] = copy.deepcopy(block)
        self._args[index] = ""

    def _block_delta(self, event: Mapping[str, Any]) -> None:
        index = self._index(event)
        block = self._blocks.get(index)
        if block is None:
            raise invalid_response(PROVIDER, "content_block_delta for a block that was not started")
        delta = event.get("delta")
        if not isinstance(delta, dict):
            raise invalid_response(PROVIDER, "content_block_delta has no delta")
        kind = delta.get("type")
        if kind == "text_delta":
            text = _require_text(delta.get("text"), "text_delta.text")
            _append_text(block, "text", text)
            if text != "":
                self._emit(text)
        elif kind == "input_json_delta":
            self._args[index] = self._args.get(index, "") + _require_text(delta.get("partial_json"), "input_json_delta.partial_json")
        elif kind == "thinking_delta":
            _append_text(block, "thinking", _require_text(delta.get("thinking"), "thinking_delta.thinking"))
        elif kind == "signature_delta":
            _append_text(block, "signature", _require_text(delta.get("signature"), "signature_delta.signature"))
        elif kind == "citations_delta":
            citations = block.get("citations")
            citation = delta.get("citation")
            block["citations"] = [*citations, citation] if isinstance(citations, list) else [citation]

    def _message_delta(self, event: Mapping[str, Any]) -> None:
        delta = event.get("delta")
        if isinstance(delta, dict):
            stop_reason = as_text(delta.get("stop_reason"))
            if stop_reason is not None:
                self._stop_reason = stop_reason
            if "stop_details" in delta and delta["stop_details"] is not None:
                self._stop_details = delta["stop_details"]
                self._has_stop_details = True
        self._read_usage(event.get("usage"))

    def result(self) -> dict[str, Any]:
        if not self._stopped:
            raise ModelError("Anthropic stream ended before message_stop", provider=PROVIDER, code="network")
        blocks: list[dict[str, Any]] = []
        for index in sorted(self._blocks):
            block = self._blocks[index]
            if block.get("type") in ("tool_use", "server_tool_use"):
                args = self._args.get(index, "")
                if args != "":
                    try:
                        block["input"] = _json.loads(args)
                    except ValueError as broken:
                        if self._stop_reason is not None and self._stop_reason in LENGTH_STOP_REASONS:
                            continue
                        raise invalid_response(PROVIDER, f"tool input for {block.get('name')} is not JSON") from broken
                elif "input" not in block:
                    block["input"] = {}
            blocks.append(block)
        needs_blocks = any(
            block.get("type") not in ("text", "tool_use")
            or (block.get("type") == "text" and isinstance(block.get("citations"), list) and len(block["citations"]) > 0)
            for block in blocks
        )
        meta: dict[str, Any] = {"id": self._id, "model": self._model, "stopReason": self._stop_reason}
        if self._has_stop_details:
            meta["stopDetails"] = self._stop_details
        if needs_blocks:
            meta["content"] = blocks
        message = {
            "id": new_message_id(),
            "role": "assistant",
            "source": "model",
            "content": _parts_from_blocks(blocks),
            "meta": {PROVIDER: meta},
        }
        result: dict[str, Any] = {"message": message, "finishReason": _finish_reason(self._stop_reason)}
        if self._usage:
            result["usage"] = {
                "input": self._usage.get("input", 0),
                "output": self._usage.get("output", 0),
                "cacheRead": self._usage.get("cacheRead", 0),
                "cacheWrite": self._usage.get("cacheWrite", 0),
            }
        return result


class AnthropicModel:
    """§Anthropic Messages API: a model bound to one endpoint, credential and set of settings.

    `anthropic_model(**settings)` creates it. `generate(model_input, ctx)` sends the request and
    `build_request(model_input)` returns the same request body without sending anything.
    """

    def __init__(self, config: HttpModelConfig, settings: _Settings, headers: dict[str, str], httpx_module: Any):
        self._config = config
        self._settings = settings
        self._headers = headers
        self._httpx = httpx_module
        self._url = f"{config.base_url}/v1/messages"

    @property
    def url(self) -> str:
        return self._url

    @property
    def headers(self) -> dict[str, str]:
        return dict(self._headers)

    async def build_request(self, model_input: Mapping[str, Any]) -> dict[str, Any]:
        """§어댑터 구성: the request body `generate` would send. It sends no HTTP request."""
        return await _anthropic_body(model_input, self._settings)

    async def generate(self, model_input: Mapping[str, Any], ctx: Any = None) -> dict[str, Any]:
        """§모델 호출: one Messages API call, assembled into a model result."""
        body = await _anthropic_body(model_input, self._settings)
        on_text_delta = getattr(ctx, "on_text_delta", None) if ctx is not None else None
        return await stream_model(StreamCall(
            provider=PROVIDER,
            url=self._url,
            headers=self._headers,
            body=body,
            httpx=self._httpx,
            client=self._config.http_client,
            max_retries=self._config.max_retries,
            idle_timeout_ms=self._config.idle_timeout_ms,
            on_text_delta=on_text_delta if callable(on_text_delta) else None,
            create_assembler=lambda emit, request_id: _AnthropicStreamAssembler(emit, request_id),
        ))


def anthropic_model(
    *,
    model: Any,
    api_key: Any = None,
    auth_token: Any = None,
    base_url: Any = None,
    headers: Any = None,
    options: Any = None,
    max_retries: Any = None,
    idle_timeout_ms: Any = None,
    resolve_media: Any = None,
    env: Any = None,
    http_client: Any = None,
    auto_cache: Any = None,
    cache_ttl: Any = None,
    mid_conversation_system: Any = None,
) -> AnthropicModel:
    """§자격 증명과 기본 URL: resolves the credential and the base URL once, here.

    The official URL without an API key or auth token is an `authentication` error; another base
    URL may be used without a credential.
    """
    config = read_http_config(
        PROVIDER,
        model=model,
        api_key=api_key,
        base_url=base_url,
        headers=headers,
        options=options,
        max_retries=max_retries,
        idle_timeout_ms=idle_timeout_ms,
        resolve_media=resolve_media,
        env=env,
        http_client=http_client,
    )
    if auth_token is not None and not isinstance(auth_token, str):
        raise invalid_request(PROVIDER, "auth_token must be a string")
    check_optional_flag(PROVIDER, "auto_cache", auto_cache)
    check_optional_choice(PROVIDER, "cache_ttl", cache_ttl, ("5m", "1h"))
    check_optional_choice(PROVIDER, "mid_conversation_system", mid_conversation_system, ("user", "system"))
    httpx_module = resolve_httpx(http_client)

    token_setting = auth_token if auth_token is not None else env_value(config.env, "ANTHROPIC_AUTH_TOKEN")
    token = token_setting if config.api_key is None and token_setting not in (None, "") else None
    if config.official and config.api_key is None and token is None:
        raise ModelError(
            "Anthropic model needs api_key, auth_token, ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for the official API",
            provider=PROVIDER,
            code="authentication",
        )
    defaults = {"content-type": "application/json", "accept": "text/event-stream", "anthropic-version": ANTHROPIC_VERSION}
    if config.api_key is not None:
        defaults["x-api-key"] = config.api_key
    elif token is not None:
        defaults["authorization"] = f"Bearer {token}"
    settings = _Settings(
        model=config.model,
        options=config.options,
        auto_cache=config.official if auto_cache is None else auto_cache,
        cache_ttl=cache_ttl,
        mid_conversation_system="user" if mid_conversation_system is None else mid_conversation_system,
        resolve_media=config.resolve_media,
    )
    return AnthropicModel(config, settings, merge_headers(defaults, config.headers), httpx_module)
