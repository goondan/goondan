"""§OpenAI Chat Completions API: settings, request mapping and stream assembly."""

from __future__ import annotations

import pytest

from goondan.models import ModelError, openai_chat_model
from test_models_support import (
    OPENAI_MODEL,
    Context,
    ScriptedClient,
    input_of,
    openai_text_stream,
    sse,
    sse_response,
    user_input,
)


async def build(model_input: dict, **settings) -> dict:
    settings.setdefault("env", {})
    return await openai_chat_model(model=OPENAI_MODEL, http_client=object(), **settings).build_request(model_input)


def model_error(error: BaseException, code: str) -> ModelError:
    assert isinstance(error, ModelError), f"expected a ModelError, got {error!r}"
    assert error.code == code, f"expected {code}, got {error.code}: {error}"
    return error


async def generate(stream: str, *, model_input: dict | None = None, **settings):
    scripted = ScriptedClient([sse_response(stream)])
    settings.setdefault("max_retries", 0)
    model = openai_chat_model(model=OPENAI_MODEL, api_key="k", env={}, http_client=scripted.client, **settings)
    try:
        return await model.generate(model_input if model_input is not None else user_input("hi"), Context())
    finally:
        await scripted.aclose()


async def test_posts_to_chat_completions_with_a_bearer_api_key():
    scripted = ScriptedClient([sse_response(openai_text_stream("hi"))])
    model = openai_chat_model(model=OPENAI_MODEL, api_key="sk-test", env={}, http_client=scripted.client)
    await model.generate(user_input("hi"), Context())
    assert scripted.requests[0].url == "https://api.openai.com/v1/chat/completions"
    assert model.headers == {"content-type": "application/json", "accept": "text/event-stream", "authorization": "Bearer sk-test"}
    await scripted.aclose()


def test_allows_a_keyless_local_server_and_reads_the_environment():
    local = openai_chat_model(model="llama3.2", base_url="http://localhost:11434/v1/", env={}, http_client=object())
    assert local.url == "http://localhost:11434/v1/chat/completions"
    assert "authorization" not in local.headers

    from_env = openai_chat_model(model=OPENAI_MODEL, env={"OPENAI_BASE_URL": "https://gateway.example.com/v1", "OPENAI_API_KEY": "sk-env"}, http_client=object())
    assert from_env.url == "https://gateway.example.com/v1/chat/completions"
    assert from_env.headers["authorization"] == "Bearer sk-env"


def test_requires_an_api_key_for_the_official_endpoint():
    with pytest.raises(ModelError) as caught:
        openai_chat_model(model=OPENAI_MODEL, env={"OPENAI_API_KEY": ""}, http_client=object())
    model_error(caught.value, "authentication")


async def test_chooses_the_max_tokens_field_by_base_url_unless_it_is_configured():
    model_input = user_input("hi", {"maxTokens": 50})
    assert (await build(model_input, api_key="k"))["max_completion_tokens"] == 50
    assert (await build(model_input, base_url="http://localhost:11434/v1"))["max_tokens"] == 50
    custom = await build(model_input, api_key="k", max_tokens_field="max_tokens")
    assert custom["max_tokens"] == 50 and "max_completion_tokens" not in custom


async def test_requests_the_usage_chunk_unless_stream_usage_is_false():
    assert (await build(user_input("hi"), api_key="k"))["stream_options"] == {"include_usage": True}
    assert "stream_options" not in await build(user_input("hi"), api_key="k", stream_usage=False)


@pytest.mark.parametrize("options", [{"openai": {"messages": []}}, {"openai": {"stream": False}}, {"openai": {"tools": []}}])
async def test_rejects_reserved_provider_fields(options):
    with pytest.raises(ModelError) as caught:
        await build(user_input("hi", options), api_key="k")
    model_error(caught.value, "invalid_request")


@pytest.mark.parametrize("settings", [
    {"max_tokens_field": ""},
    {"stream_usage": "yes"},
    {"system_role": "tool"},
    {"mid_conversation_system": "developer"},
])
def test_rejects_malformed_settings(settings):
    with pytest.raises(ModelError) as caught:
        openai_chat_model(model=OPENAI_MODEL, api_key="k", env={}, http_client=object(), **settings)
    model_error(caught.value, "invalid_request")


async def test_sends_mid_conversation_system_messages_with_the_configured_system_role():
    body = await build(input_of([
        {"id": "u", "role": "user", "source": "input", "content": [{"type": "text", "text": "hi"}]},
        {"id": "s", "role": "system", "source": "hook", "content": [{"type": "text", "text": "be brief"}]},
    ]), api_key="k", system_role="developer")
    assert body["messages"] == [{"role": "user", "content": "hi"}, {"role": "developer", "content": "be brief"}]


async def test_joins_system_blocks_and_leading_system_messages_with_a_blank_line():
    body = await build(input_of(
        [
            {"id": "s1", "role": "system", "source": "hook", "content": [{"type": "text", "text": "  "}]},
            {"id": "s2", "role": "system", "source": "hook", "content": [{"type": "text", "text": "then this"}]},
            {"id": "u", "role": "user", "source": "input", "content": [{"type": "text", "text": "hi"}]},
        ],
        system=[{"text": "first", "source": "config"}, {"text": " ", "source": "config"}],
    ), api_key="k")
    assert body["messages"][0] == {"role": "system", "content": "first\n\nthen this"}


async def test_resolves_media_into_image_url_and_file_items():
    body = await build(input_of([{
        "id": "u", "role": "user", "source": "input",
        "content": [
            {"type": "media", "ref": "photo", "mediaType": "image/png"},
            {"type": "media", "ref": "report", "mediaType": "application/pdf"},
        ],
    }]), api_key="k", resolve_media=lambda part: {"data": "AAAA"})
    assert body["messages"] == [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            {"type": "file", "file": {"file_data": "data:application/pdf;base64,AAAA"}},
        ],
    }]


async def test_moves_tool_result_images_into_a_user_message_after_the_tool_messages():
    body = await build(input_of([
        {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "c1", "name": "screenshot", "args": None}]},
        {"id": "t", "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "c1", "content": [{"type": "media", "ref": "shot", "mediaType": "image/png"}]}]},
    ]), api_key="k", resolve_media=lambda part: {"url": "https://files.example.com/shot.png"})
    assert body["messages"] == [
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "screenshot", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "(image output attached in the next user message)"},
        {"role": "user", "content": [
            {"type": "text", "text": "Images returned by tool calls: c1"},
            {"type": "image_url", "image_url": {"url": "https://files.example.com/shot.png"}},
        ]},
    ]


async def test_lists_each_call_id_once_in_the_moved_image_message():
    body = await build(input_of([
        {"id": "a", "role": "assistant", "source": "model", "content": [
            {"type": "tool.call", "callId": "c1", "name": "shot", "args": {}},
            {"type": "tool.call", "callId": "c2", "name": "shot", "args": {}},
        ]},
        {"id": "t", "role": "tool", "source": "tool", "content": [
            {"type": "tool.result", "callId": "c1", "content": [
                {"type": "image", "url": "https://files.example.com/a.png", "mediaType": "image/png"},
                {"type": "image", "url": "https://files.example.com/b.png", "mediaType": "image/png"},
            ]},
            {"type": "tool.result", "callId": "c2", "content": [{"type": "text", "text": "done"}]},
        ]},
    ]), api_key="k")
    assert body["messages"][-1]["content"][0] == {"type": "text", "text": "Images returned by tool calls: c1"}
    assert len(body["messages"][-1]["content"]) == 3


@pytest.mark.parametrize("messages", [
    [{"id": "u", "role": "user", "source": "input", "content": [{"type": "media", "ref": "url-pdf", "mediaType": "application/pdf"}]}],
    [
        {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "c1", "name": "read", "args": {}}]},
        {"id": "t", "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "c1", "content": [{"type": "media", "ref": "pdf", "mediaType": "application/pdf"}]}]},
    ],
    [
        {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "c1", "name": "read", "args": {}}]},
        {"id": "u", "role": "user", "source": "input", "content": [{"type": "tool.result", "callId": "c1", "content": []}]},
    ],
    [{"id": "a", "role": "assistant", "source": "model", "content": [{"type": "image", "url": "https://example.com/a.png", "mediaType": "image/png"}]}],
])
async def test_reports_parts_it_cannot_send_as_unsupported_content(messages):
    def resolve(part):
        return {"url": "https://files.example.com/a.pdf", "mediaType": "application/pdf"} if part["ref"] == "url-pdf" else {"data": "AAAA", "mediaType": "application/pdf"}

    with pytest.raises(ModelError) as caught:
        await build(input_of(messages), api_key="k", resolve_media=resolve)
    model_error(caught.value, "unsupported_content")


async def test_media_without_a_resolver_is_unsupported_content():
    with pytest.raises(ModelError) as caught:
        await build(input_of([{"id": "u", "role": "user", "source": "input", "content": [{"type": "media", "ref": "photo", "mediaType": "image/png"}]}]), api_key="k")
    model_error(caught.value, "unsupported_content")


async def test_stops_reading_at_done():
    result = await generate(f"{openai_text_stream('hi')}data: {{not json\n\n")
    assert result["finishReason"] == "stop"
    assert result["message"]["content"] == [{"type": "text", "text": "hi"}]
    assert result["message"]["meta"]["openai"] == {"id": "chatcmpl-test", "model": "gpt-test", "finishReason": "stop"}
    assert "usage" not in result


async def test_reports_usage_as_prompt_tokens_minus_cached_tokens():
    stream = sse(
        {"id": "x", "model": OPENAI_MODEL, "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": "stop"}]},
        {"id": "x", "model": OPENAI_MODEL, "choices": [], "usage": {"prompt_tokens": 30, "completion_tokens": 4, "prompt_tokens_details": {"cached_tokens": 10}}},
    ) + "data: [DONE]\n\n"
    result = await generate(stream)
    assert result["usage"] == {"input": 20, "output": 4, "cacheRead": 10, "cacheWrite": 0}


async def test_gives_a_generated_call_id_to_a_tool_call_the_stream_did_not_name():
    stream = sse({"id": "x", "model": OPENAI_MODEL, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"name": "lookup", "arguments": "{}"}}]}, "finish_reason": "tool_calls"}]}) + "data: [DONE]\n\n"
    result = await generate(stream)
    call = result["message"]["content"][0]
    assert call["type"] == "tool.call" and call["name"] == "lookup" and call["args"] == {}
    assert call["callId"].startswith("call_0_") and len(call["callId"]) == len("call_0_") + 8
    assert result["finishReason"] == "tool"


async def test_a_tool_call_with_finish_reason_stop_still_finishes_as_tool():
    stream = sse({"id": "x", "model": OPENAI_MODEL, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "lookup", "arguments": {"q": 1}}}]}, "finish_reason": "stop"}]}) + "data: [DONE]\n\n"
    result = await generate(stream)
    assert result["finishReason"] == "tool"
    assert result["message"]["content"][0] == {"type": "tool.call", "callId": "c1", "name": "lookup", "args": {"q": 1}}


async def test_turns_an_error_chunk_after_a_heartbeat_comment_into_a_model_error():
    stream = ": OPENROUTER PROCESSING\n\n" + sse({
        "id": "gen-1", "object": "chat.completion.chunk",
        "error": {"code": 502, "message": "Provider disconnected"},
        "choices": [{"index": 0, "delta": {"content": ""}, "finish_reason": "error"}],
    })
    with pytest.raises(ModelError) as caught:
        await generate(stream)
    model_error(caught.value, "server_error")


@pytest.mark.parametrize(("finish_reason", "expected"), [("tool_calls", "invalid_response"), ("length", None)])
async def test_reports_malformed_tool_arguments_unless_the_output_was_cut_off(finish_reason, expected):
    stream = sse({"id": "x", "model": OPENAI_MODEL, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "c", "function": {"name": "lookup", "arguments": '{"q":'}}]}, "finish_reason": finish_reason}]}) + "data: [DONE]\n\n"
    if expected is not None:
        with pytest.raises(ModelError) as caught:
            await generate(stream)
        model_error(caught.value, expected)
        return
    result = await generate(stream)
    assert result["finishReason"] == "length" and result["message"]["content"] == []


async def test_ignores_choices_other_than_index_zero():
    stream = sse(
        {"id": "x", "model": OPENAI_MODEL, "choices": [
            {"index": 1, "delta": {"content": "second"}},
            {"index": 0, "delta": {"content": "first"}, "finish_reason": "stop"},
        ]},
    ) + "data: [DONE]\n\n"
    result = await generate(stream)
    assert result["message"]["content"] == [{"type": "text", "text": "first"}]


async def test_a_stream_that_ends_without_done_is_a_network_error():
    stream = sse({"id": "x", "model": OPENAI_MODEL, "choices": [{"index": 0, "delta": {"content": "hi"}}]})
    with pytest.raises(ModelError) as caught:
        await generate(stream)
    model_error(caught.value, "network")
