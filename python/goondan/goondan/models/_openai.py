"""§OpenAI Chat Completions API: the official adapter for Chat Completions and compatible endpoints."""

from __future__ import annotations

import copy
import json as _json
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ._errors import ModelError, invalid_request, invalid_response, stream_error, unsupported_content
from ._ids import new_message_id, random_hex
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
    merge_headers,
    merge_model_options,
    provider_overrides,
    read_http_config,
    read_portable_options,
    resolve_httpx,
)
from ._transport import StreamCall, parse_event_data, stream_model
from ._values import as_text, is_blank, is_number, json_text, merge_objects, non_empty_text

PROVIDER = "openai"
RESERVED_FIELDS = ("messages", "tools", "stream")
IMAGE_PLACEHOLDER = "(image output attached in the next user message)"


@dataclass
class _Settings:
    model: str
    options: dict[str, Any]
    max_tokens_field: str
    stream_usage: bool
    system_role: str
    mid_conversation_system: str
    resolve_media: Any


def _image_url_item(url: str) -> dict[str, Any]:
    return {"type": "image_url", "image_url": {"url": url}}


async def _media_item(part: Mapping[str, Any], settings: _Settings) -> tuple[str, dict[str, Any]]:
    """§부분 매핑: an image item, or a `file` item for base64 PDF data."""
    media = await resolve_media_part(PROVIDER, part, settings.resolve_media)
    if is_image_type(media.media_type):
        url = f"data:{media.media_type};base64,{media.data}" if media.kind == "data" else media.url
        return "image", _image_url_item(url)
    if media.media_type == PDF_TYPE and media.kind == "data":
        return "pdf", {"type": "file", "file": {"file_data": f"data:{PDF_TYPE};base64,{media.data}"}}
    raise unsupported_content(
        PROVIDER,
        f"media of type {media.media_type} given as a URL" if media.kind == "url" else f"media of type {media.media_type}",
    )


async def _user_content(message: Mapping[str, Any], settings: _Settings) -> Any:
    items: list[dict[str, Any]] = []
    for part in content_of(message):
        kind = part.get("type")
        if kind in ("text", "json"):
            text = part_text(part)
            if not is_blank(text):
                items.append({"type": "text", "text": text})
        elif kind == "image":
            url = part.get("url")
            if not isinstance(url, str):
                raise invalid_request(PROVIDER, "an image part needs a string url")
            items.append(_image_url_item(url))
        elif kind == "media":
            items.append((await _media_item(part, settings))[1])
        else:
            raise unsupported_content(PROVIDER, f"{kind} parts in user messages")
    if not items:
        return None
    first = items[0]
    if len(items) == 1 and first.get("type") == "text" and isinstance(first.get("text"), str):
        return first["text"]
    return items


def _assistant_message(message: Mapping[str, Any]) -> dict[str, Any] | None:
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    for part in content_of(message):
        kind = part.get("type")
        if kind in ("text", "json"):
            text = part_text(part)
            if not is_blank(text):
                texts.append(text)
        elif kind == "tool.call":
            args = part.get("args")
            call_id = part.get("callId")
            name = part.get("name")
            calls.append({
                "id": call_id if isinstance(call_id, str) else "",
                "type": "function",
                "function": {
                    "name": name if isinstance(name, str) else "",
                    "arguments": "{}" if args is None else json_text(args),
                },
            })
        else:
            raise unsupported_content(PROVIDER, f"{kind} parts in assistant messages")
    content = "\n".join(texts)
    if content == "" and not calls:
        return None
    result: dict[str, Any] = {"role": "assistant", "content": None if content == "" else content}
    if calls:
        result["tool_calls"] = calls
    return result


async def _tool_messages(message: Mapping[str, Any], settings: _Settings, images: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """§도구 결과: one `tool` message per result; images move to a following user message."""
    messages: list[dict[str, Any]] = []
    for part in content_of(message):
        if part.get("type") != "tool.result":
            raise unsupported_content(PROVIDER, f"{part.get('type')} parts in tool messages")
        call_id = part.get("callId")
        identifier = call_id if isinstance(call_id, str) else ""
        lines: list[str] = []
        image_count = 0
        inner = part.get("content")
        for item in ([entry for entry in inner if isinstance(entry, dict)] if isinstance(inner, list) else []):
            kind = item.get("type")
            if kind in ("text", "json"):
                lines.append(part_text(item))
            elif kind == "image":
                url = item.get("url")
                if not isinstance(url, str):
                    raise invalid_request(PROVIDER, "an image part needs a string url")
                images.append((identifier, _image_url_item(url)))
                image_count += 1
            elif kind == "media":
                media_kind, media = await _media_item(item, settings)
                if media_kind != "image":
                    raise unsupported_content(PROVIDER, "a PDF inside a tool result")
                images.append((identifier, media))
                image_count += 1
            else:
                raise unsupported_content(PROVIDER, f"{kind} parts inside a tool result")
        text = "\n".join(lines)
        messages.append({
            "role": "tool",
            "tool_call_id": identifier,
            "content": IMAGE_PLACEHOLDER if text == "" and image_count > 0 else text,
        })
    return messages


def _tool_entries(tools: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for tool in tools:
        name = tool.get("name")
        description = tool.get("description")
        entries.append({
            "type": "function",
            "function": {
                "name": name if isinstance(name, str) else "",
                "description": description if isinstance(description, str) else "",
                "parameters": object_schema(tool.get("input")),
            },
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


async def _openai_body(model_input: Mapping[str, Any], settings: _Settings) -> dict[str, Any]:
    system_input, messages_input, tools_input, options_input = _input_lists(model_input)
    options = merge_model_options(settings.options, options_input)
    portable = read_portable_options(PROVIDER, options)
    overrides = provider_overrides(PROVIDER, options, RESERVED_FIELDS)
    instructions, rest = split_leading_system(repair_tool_pairs(messages_input))
    blocks = [block["text"] for block in system_input if isinstance(block.get("text"), str) and not is_blank(block["text"])]
    system_text = "\n\n".join([*blocks, *instructions])
    messages: list[dict[str, Any]] = []
    if system_text != "":
        messages.append({"role": settings.system_role, "content": system_text})
    images: list[tuple[str, dict[str, Any]]] = []

    def flush_images() -> None:
        if not images:
            return
        seen: list[str] = []
        for call_id, _item in images:
            if call_id not in seen:
                seen.append(call_id)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": f"Images returned by tool calls: {', '.join(seen)}"}, *(item for _call, item in images)],
        })
        images.clear()

    for message in rest:
        role = message.get("role")
        if role != "tool":
            flush_images()
        if role == "system":
            text = message_text(message)
            if is_blank(text):
                continue
            messages.append(
                {"role": "user", "content": system_reminder(text)}
                if settings.mid_conversation_system == "user"
                else {"role": settings.system_role, "content": text}
            )
        elif role == "user":
            content = await _user_content(message, settings)
            if content is not None:
                messages.append({"role": "user", "content": content})
        elif role == "assistant":
            assistant = _assistant_message(message)
            if assistant is not None:
                messages.append(assistant)
        elif role == "tool":
            messages.extend(await _tool_messages(message, settings, images))
    flush_images()

    body: dict[str, Any] = {"model": settings.model, "messages": messages, "stream": True}
    if settings.stream_usage:
        body["stream_options"] = {"include_usage": True}
    if tools_input:
        body["tools"] = _tool_entries(tools_input)
    if portable.max_tokens is not None:
        body[settings.max_tokens_field] = portable.max_tokens
    if portable.temperature is not None:
        body["temperature"] = portable.temperature
    if portable.top_p is not None:
        body["top_p"] = portable.top_p
    if portable.stop is not None:
        body["stop"] = portable.stop
    choice = portable.tool_choice
    if choice is not None:
        body["tool_choice"] = choice if isinstance(choice, str) else {"type": "function", "function": {"name": choice["name"]}}
    return copy.deepcopy(body if overrides is None else merge_objects(body, overrides))


@dataclass
class _CallState:
    key: Any
    id: str | None = None
    name: str | None = None
    args: str = ""


def _count(value: Any) -> float:
    return value if is_number(value) else 0


class _OpenAIChatStreamAssembler:
    """§스트림 청크, §결과: assembles the Chat Completions stream into a model result."""

    def __init__(self, emit: Any, request_id: str | None):
        self._emit = emit
        self._request_id = request_id
        self._calls: list[_CallState] = []
        self._text = ""
        self._id: str | None = None
        self._model: str | None = None
        self._finish_reason: str | None = None
        self._usage: dict[str, Any] | None = None
        self._done = False

    def accept(self, data: str) -> bool:
        if data == "[DONE]":
            self._done = True
            return True
        chunk = parse_event_data(PROVIDER, data)
        if not isinstance(chunk, dict):
            raise invalid_response(PROVIDER, "stream chunk is not an object")
        error = chunk.get("error")
        if isinstance(error, dict):
            raise stream_error(PROVIDER, error, self._request_id or non_empty_text(chunk.get("request_id")))
        identifier = as_text(chunk.get("id"))
        if self._id is None and identifier is not None:
            self._id = identifier
            self._model = as_text(chunk.get("model"))
        usage = chunk.get("usage")
        if isinstance(usage, dict):
            self._usage = usage
        choices = chunk.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                index = choice.get("index", 0)
                if index == 0 and not isinstance(index, bool):
                    self._choice(choice)
        return False

    def _choice(self, choice: Mapping[str, Any]) -> None:
        delta = choice.get("delta")
        if isinstance(delta, dict):
            content = delta.get("content")
            if isinstance(content, str) and content != "":
                self._text += content
                self._emit(content)
            tool_calls = delta.get("tool_calls")
            if isinstance(tool_calls, list):
                for item in tool_calls:
                    if isinstance(item, dict):
                        self._tool_call(item)
        finish_reason = as_text(choice.get("finish_reason"))
        if finish_reason is not None:
            self._finish_reason = finish_reason
            self._done = True

    def _key(self, item: Mapping[str, Any]) -> Any:
        """§스트림 청크: `index` first, then a matching `id`, then the last call."""
        index = item.get("index")
        if is_number(index):
            return index
        identifier = non_empty_text(item.get("id"))
        if identifier is not None:
            for call in self._calls:
                if call.id == identifier:
                    return call.key
            return len(self._calls)
        return self._calls[-1].key if self._calls else 0

    def _tool_call(self, item: Mapping[str, Any]) -> None:
        key = self._key(item)
        call = next((candidate for candidate in self._calls if candidate.key == key), None)
        if call is None:
            call = _CallState(key)
            self._calls.append(call)
        if call.id is None:
            call.id = non_empty_text(item.get("id"))
        function = item.get("function")
        if not isinstance(function, dict):
            return
        if call.name is None:
            call.name = non_empty_text(function.get("name"))
        args = function.get("arguments")
        if isinstance(args, str):
            call.args += args
        elif isinstance(args, dict):
            call.args = json_text(args)

    def result(self) -> dict[str, Any]:
        if not self._done:
            raise ModelError("OpenAI stream ended before [DONE] or a finish_reason", provider=PROVIDER, code="network")
        content: list[dict[str, Any]] = [] if self._text == "" else [{"type": "text", "text": self._text}]
        for call in sorted(self._calls, key=lambda state: state.key):
            if call.args == "":
                args: Any = {}
            else:
                try:
                    args = _json.loads(call.args)
                except ValueError as broken:
                    if self._finish_reason == "length":
                        continue
                    raise invalid_response(PROVIDER, f"tool arguments for {call.name or 'a tool call'} are not JSON") from broken
            content.append({
                "type": "tool.call",
                "callId": call.id if call.id is not None else f"call_{call.key}_{random_hex(8)}",
                "name": call.name if call.name is not None else "",
                "args": args,
            })
        has_calls = any(part["type"] == "tool.call" for part in content)
        if self._finish_reason == "length":
            finish_reason = "length"
        elif has_calls:
            finish_reason = "tool"
        elif self._finish_reason == "stop":
            finish_reason = "stop"
        else:
            finish_reason = "other"
        meta = {"id": self._id, "model": self._model, "finishReason": self._finish_reason}
        message = {"id": new_message_id(), "role": "assistant", "source": "model", "content": content, "meta": {PROVIDER: meta}}
        result: dict[str, Any] = {"message": message, "finishReason": finish_reason}
        usage = self._usage
        if usage is not None:
            details = usage.get("prompt_tokens_details")
            cached = _count(details.get("cached_tokens")) if isinstance(details, dict) else 0
            result["usage"] = {
                "input": _count(usage.get("prompt_tokens")) - cached,
                "output": _count(usage.get("completion_tokens")),
                "cacheRead": cached,
                "cacheWrite": 0,
            }
        return result


class OpenAIChatModel:
    """§OpenAI Chat Completions API: a model bound to one endpoint, credential and set of settings.

    `openai_chat_model(**settings)` creates it. `generate(model_input, ctx)` sends the request and
    `build_request(model_input)` returns the same request body without sending anything.
    """

    provider = PROVIDER

    def __init__(self, config: HttpModelConfig, settings: _Settings, headers: dict[str, str], httpx_module: Any):
        self._config = config
        self._settings = settings
        self._headers = headers
        self._httpx = httpx_module
        self._url = f"{config.base_url}/chat/completions"

    @property
    def url(self) -> str:
        return self._url

    @property
    def headers(self) -> dict[str, str]:
        return dict(self._headers)

    async def build_request(self, model_input: Mapping[str, Any]) -> dict[str, Any]:
        """§어댑터 구성: the request body `generate` would send. It sends no HTTP request."""
        return await _openai_body(model_input, self._settings)

    async def generate(self, model_input: Mapping[str, Any], ctx: Any = None) -> dict[str, Any]:
        """§모델 호출: one Chat Completions call, assembled into a model result."""
        body = await _openai_body(model_input, self._settings)
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
            create_assembler=lambda emit, request_id: _OpenAIChatStreamAssembler(emit, request_id),
        ))


def openai_chat_model(
    *,
    model: Any,
    api_key: Any = None,
    base_url: Any = None,
    headers: Any = None,
    options: Any = None,
    max_retries: Any = None,
    idle_timeout_ms: Any = None,
    resolve_media: Any = None,
    env: Any = None,
    http_client: Any = None,
    max_tokens_field: Any = None,
    stream_usage: Any = None,
    system_role: Any = None,
    mid_conversation_system: Any = None,
) -> OpenAIChatModel:
    """§자격 증명과 기본 URL: resolves the credential and the base URL once, here.

    The official URL without an API key is an `authentication` error; another base URL, such as a
    local Chat Completions server, may be used without a credential.
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
    if max_tokens_field is not None and (not isinstance(max_tokens_field, str) or max_tokens_field == ""):
        raise invalid_request(PROVIDER, "max_tokens_field must be a non-empty string")
    check_optional_flag(PROVIDER, "stream_usage", stream_usage)
    check_optional_choice(PROVIDER, "system_role", system_role, ("system", "developer"))
    check_optional_choice(PROVIDER, "mid_conversation_system", mid_conversation_system, ("system", "user"))
    httpx_module = resolve_httpx(http_client)

    if config.official and config.api_key is None:
        raise ModelError("OpenAI model needs api_key or OPENAI_API_KEY for the official API", provider=PROVIDER, code="authentication")
    defaults = {"content-type": "application/json", "accept": "text/event-stream"}
    if config.api_key is not None:
        defaults["authorization"] = f"Bearer {config.api_key}"
    settings = _Settings(
        model=config.model,
        options=config.options,
        max_tokens_field=max_tokens_field if max_tokens_field is not None else ("max_completion_tokens" if config.official else "max_tokens"),
        stream_usage=True if stream_usage is None else stream_usage,
        system_role="system" if system_role is None else system_role,
        mid_conversation_system="system" if mid_conversation_system is None else mid_conversation_system,
        resolve_media=config.resolve_media,
    )
    return OpenAIChatModel(config, settings, merge_headers(defaults, config.headers), httpx_module)
