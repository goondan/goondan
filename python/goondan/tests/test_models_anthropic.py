"""§Anthropic Messages API: settings, request mapping and stream assembly."""

from __future__ import annotations

import pytest

from goondan.models import ModelError, anthropic_model
from test_models_support import (
    MODEL,
    Context,
    ScriptedClient,
    anthropic_text_stream,
    input_of,
    sse,
    sse_response,
    stalled_response,
    text_response,
    user_input,
)


def tool_loop_input() -> dict:
    return input_of(
        [
            {"id": "u1", "role": "user", "source": "input", "content": [{"type": "text", "text": "Read package.json"}]},
            {"id": "a1", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "old-call", "name": "read_file", "args": {"path": "README.md"}}]},
            {"id": "t1", "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "old-call", "content": [{"type": "text", "text": "old result"}]}]},
        ],
        system=[{"text": "You are a coding agent.", "source": "config"}],
        tools=[{"name": "read_file", "description": "Read a file", "input": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}],
    )


async def build(model_input: dict, **settings) -> dict:
    settings.setdefault("env", {})
    return await anthropic_model(model=MODEL, http_client=object(), **settings).build_request(model_input)


def model_error(error: BaseException, code: str) -> ModelError:
    assert isinstance(error, ModelError), f"expected a ModelError, got {error!r}"
    assert error.code == code, f"expected {code}, got {error.code}: {error}"
    return error


async def test_renders_prior_tool_use_and_assembles_split_text_and_tool_deltas():
    stream = sse(
        {"type": "message_start", "message": {"usage": {"input_tokens": 12, "cache_read_input_tokens": 3}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "I will "}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "read it."}},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "call-1", "name": "read_file", "input": {}}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"path":'}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '"package.json"}'}},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 9}},
        {"type": "message_stop"},
    )
    scripted = ScriptedClient([sse_response(stream, chunk_size=37)])
    ctx = Context()
    result = await anthropic_model(model=MODEL, api_key="test-key", env={}, http_client=scripted.client).generate(tool_loop_input(), ctx)

    assert ctx.deltas == ["I will ", "read it."]
    assert result["finishReason"] == "tool"
    assert result["usage"] == {"input": 12, "output": 9, "cacheRead": 3, "cacheWrite": 0}
    assert result["message"]["role"] == "assistant" and result["message"]["source"] == "model"
    assert result["message"]["content"] == [
        {"type": "text", "text": "I will read it."},
        {"type": "tool.call", "callId": "call-1", "name": "read_file", "args": {"path": "package.json"}},
    ]
    body = scripted.requests[0].body
    assert body["model"] == MODEL and body["stream"] is True and body["max_tokens"] == 64000
    assert body["messages"][1]["content"] == [{"type": "tool_use", "id": "old-call", "name": "read_file", "input": {"path": "README.md"}}]
    assert body["messages"][2] == {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "old-call", "content": [{"type": "text", "text": "old result"}]}]}
    await scripted.aclose()


async def test_calls_the_messages_api_with_the_standard_headers():
    scripted = ScriptedClient([sse_response(sse({"type": "message_stop"}), chunk_size=5)])
    model = anthropic_model(model=MODEL, api_key="test-key", env={}, http_client=scripted.client)
    await model.generate(tool_loop_input(), Context())
    assert model.url == "https://api.anthropic.com/v1/messages"
    assert model.headers == {
        "content-type": "application/json",
        "accept": "text/event-stream",
        "anthropic-version": "2023-06-01",
        "x-api-key": "test-key",
    }
    assert scripted.requests[0].url == "https://api.anthropic.com/v1/messages"
    await scripted.aclose()


async def test_uses_anthropic_base_url_and_allows_keyless_compatible_endpoints():
    scripted = ScriptedClient([sse_response(sse({"type": "message_stop"}), chunk_size=5)])
    env = {"ANTHROPIC_BASE_URL": "https://proxy.example.test/", "ANTHROPIC_API_KEY": ""}
    model = anthropic_model(model=MODEL, env=env, http_client=scripted.client, headers={"x-team": "demo"})
    await model.generate(tool_loop_input(), Context())
    assert scripted.requests[0].url == "https://proxy.example.test/v1/messages"
    assert model.headers == {
        "content-type": "application/json",
        "accept": "text/event-stream",
        "anthropic-version": "2023-06-01",
        "x-team": "demo",
    }
    await scripted.aclose()


def test_requires_a_credential_for_the_official_endpoint():
    with pytest.raises(ModelError) as caught:
        anthropic_model(model=MODEL, env={"ANTHROPIC_BASE_URL": "", "ANTHROPIC_API_KEY": ""})
    assert "ANTHROPIC_API_KEY" in model_error(caught.value, "authentication").message


async def test_reports_http_and_malformed_stream_errors_with_their_codes():
    forbidden = ScriptedClient([text_response(403, "forbidden")])
    with pytest.raises(ModelError) as caught:
        await anthropic_model(model=MODEL, api_key="k", env={}, http_client=forbidden.client, max_retries=0).generate(tool_loop_input(), Context())
    error = model_error(caught.value, "permission")
    assert error.status == 403 and error.message == "Anthropic HTTP 403: forbidden"
    await forbidden.aclose()

    malformed = ScriptedClient([sse_response("data: {oops}\n\n")])
    with pytest.raises(ModelError) as broken:
        await anthropic_model(model=MODEL, api_key="k", env={}, http_client=malformed.client, max_retries=0).generate(tool_loop_input(), Context())
    model_error(broken.value, "invalid_response")
    await malformed.aclose()


def test_sends_an_auth_token_only_when_there_is_no_api_key():
    token_only = anthropic_model(model=MODEL, env={"ANTHROPIC_AUTH_TOKEN": "token-1"}, http_client=object())
    assert token_only.headers["authorization"] == "Bearer token-1"
    assert "x-api-key" not in token_only.headers

    both = anthropic_model(model=MODEL, api_key="key-1", auth_token="token-1", env={}, http_client=object())
    assert both.headers["x-api-key"] == "key-1"
    assert "authorization" not in both.headers


def test_replaces_default_headers_by_case_insensitive_name_and_adds_beta_headers():
    model = anthropic_model(
        model=MODEL, api_key="k", env={}, http_client=object(),
        headers={"Anthropic-Version": "2099-01-01", "anthropic-beta": "feature-2026-01-01"},
    )
    assert model.headers == {
        "content-type": "application/json",
        "accept": "text/event-stream",
        "Anthropic-Version": "2099-01-01",
        "x-api-key": "k",
        "anthropic-beta": "feature-2026-01-01",
    }


@pytest.mark.parametrize("settings", [
    {"model": ""},
    {"model": MODEL, "max_retries": -1},
    {"model": MODEL, "max_retries": 1.5},
    {"model": MODEL, "idle_timeout_ms": 0},
    {"model": MODEL, "base_url": ""},
    {"model": MODEL, "cache_ttl": "10m"},
    {"model": MODEL, "mid_conversation_system": "tool"},
    {"model": MODEL, "auto_cache": "yes"},
    {"model": MODEL, "headers": {"x": 1}},
    {"model": MODEL, "options": []},
    {"model": MODEL, "resolve_media": "nope"},
])
def test_rejects_malformed_settings_with_invalid_request(settings):
    with pytest.raises(ModelError) as caught:
        anthropic_model(api_key="k", env={}, http_client=object(), **settings)
    model_error(caught.value, "invalid_request")


async def test_turns_automatic_caching_on_by_default_only_for_the_official_url():
    official = await build(user_input("hi"), base_url="https://api.anthropic.com//", api_key="k")
    assert official["cache_control"] == {"type": "ephemeral"}
    gateway = await build(user_input("hi"), env={"ANTHROPIC_BASE_URL": "http://localhost:8080"})
    assert "cache_control" not in gateway
    forced = await build(user_input("hi"), env={"ANTHROPIC_BASE_URL": "http://localhost:8080"}, auto_cache=True, cache_ttl="1h")
    assert forced["cache_control"] == {"type": "ephemeral", "ttl": "1h"}


async def test_marks_only_the_last_cache_breakpoints():
    blocks = [{"text": f"block {index}", "source": "config", "cache": True} for index in range(5)]
    with_auto = await build(input_of([], system=blocks), api_key="k")
    assert [index for index, block in enumerate(with_auto["system"]) if "cache_control" in block] == [2, 3, 4]
    without_auto = await build(input_of([], system=blocks), api_key="k", auto_cache=False)
    assert [index for index, block in enumerate(without_auto["system"]) if "cache_control" in block] == [1, 2, 3, 4]


async def test_merges_input_options_over_configured_options_and_drops_null_values():
    body = await build(
        user_input("hi", {"temperature": None, "anthropic": {"metadata": None, "output_config": {"effort": "low"}}}),
        api_key="k",
        options={"maxTokens": 10, "temperature": 0.5, "anthropic": {"thinking": {"type": "adaptive"}, "metadata": {"user_id": "u"}}},
    )
    assert body["max_tokens"] == 10
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "low"}
    assert "temperature" not in body and "metadata" not in body


async def test_merges_options_anthropic_last_and_ignores_the_other_provider():
    body = await build(user_input("hi", {"maxTokens": 10, "anthropic": {"max_tokens": 20}, "openai": {"seed": 1}, "custom": True}), api_key="k")
    assert body["max_tokens"] == 20
    assert "seed" not in body and "custom" not in body


@pytest.mark.parametrize(("choice", "expected"), [
    ("auto", {"type": "auto"}),
    ("none", {"type": "none"}),
    ("required", {"type": "any"}),
    ({"name": "lookup"}, {"type": "tool", "name": "lookup"}),
])
async def test_maps_every_tool_choice_value(choice, expected):
    body = await build(user_input("hi", {"toolChoice": choice}), api_key="k")
    assert body["tool_choice"] == expected


@pytest.mark.parametrize("options", [
    {"maxTokens": 1.5},
    {"temperature": "0"},
    {"stop": ["END", 1]},
    {"toolChoice": "any"},
    {"anthropic": "raw"},
    {"anthropic": {"system": "x"}},
    {"anthropic": {"messages": []}},
])
async def test_rejects_malformed_common_options_and_reserved_fields(options):
    with pytest.raises(ModelError) as caught:
        await build(user_input("hi", options), api_key="k")
    model_error(caught.value, "invalid_request")


async def test_replaces_characters_outside_the_tool_id_alphabet_one_per_code_point():
    body = await build(input_of([
        {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "call.1/😀", "name": "lookup", "args": None}]},
        {"id": "t", "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "call.1/😀", "content": []}]},
    ]), api_key="k")
    assert body["messages"] == [
        {"role": "assistant", "content": [{"type": "tool_use", "id": "call_1__", "name": "lookup", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1__"}]},
    ]


async def test_requires_tool_call_args_to_be_an_object_or_null():
    with pytest.raises(ModelError) as caught:
        await build(input_of([
            {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "c", "name": "lookup", "args": [1]}]},
            {"id": "t", "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "c", "content": []}]},
        ]), api_key="k")
    model_error(caught.value, "invalid_request")


async def test_drops_a_tool_call_whose_result_is_missing():
    body = await build(input_of([
        {"id": "u", "role": "user", "source": "input", "content": [{"type": "text", "text": "hi"}]},
        {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "tool.call", "callId": "c", "name": "lookup", "args": {}}]},
    ]), api_key="k")
    assert body["messages"] == [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]


async def test_resends_recorded_blocks_without_whitespace_only_text_blocks():
    recorded = [
        {"type": "thinking", "thinking": "", "signature": "sig"},
        {"type": "text", "text": "\n"},
        {"type": "tool_use", "id": "c1", "name": "lookup", "input": {"q": 1}},
    ]
    body = await build(input_of([
        {
            "id": "a", "role": "assistant", "source": "model",
            "content": [{"type": "text", "text": "\n"}, {"type": "tool.call", "callId": "c1", "name": "lookup", "args": {"q": 1}}],
            "meta": {"anthropic": {"content": recorded}},
        },
        {"id": "t", "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "c1", "content": [{"type": "text", "text": "1"}]}]},
    ]), api_key="k")
    assert body["messages"][0]["content"] == [recorded[0], recorded[2]]


async def test_maps_edited_assistant_messages_without_the_recorded_blocks():
    recorded = [{"type": "thinking", "thinking": "hmm", "signature": "sig"}, {"type": "text", "text": "first"}]
    body = await build(input_of([
        {
            "id": "a", "role": "assistant", "source": "model",
            "content": [{"type": "text", "text": "edited"}],
            "meta": {"anthropic": {"content": recorded}},
        },
    ]), api_key="k")
    assert body["messages"][0]["content"] == [{"type": "text", "text": "edited"}]


async def test_resolves_media_parts_into_image_and_document_blocks():
    seen: list[dict] = []

    def resolve(part):
        seen.append(dict(part))
        return {"data": "iVBORw0KGgo=", "mediaType": "image/png"} if part["ref"] == "photo" else {"url": "https://files.example.com/report.pdf"}

    body = await build(input_of([{
        "id": "u", "role": "user", "source": "input",
        "content": [
            {"type": "media", "ref": "photo", "mediaType": "image/*"},
            {"type": "media", "ref": "report", "mediaType": "application/pdf"},
            {"type": "text", "text": "Compare them"},
        ],
    }]), api_key="k", resolve_media=resolve)
    assert seen == [{"ref": "photo", "mediaType": "image/*"}, {"ref": "report", "mediaType": "application/pdf"}]
    assert body["messages"][0]["content"] == [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}},
        {"type": "document", "source": {"type": "url", "url": "https://files.example.com/report.pdf"}},
        {"type": "text", "text": "Compare them"},
    ]


async def test_accepts_an_asynchronous_media_resolver():
    async def resolve(part):
        return {"data": "AAAA", "mediaType": "image/png"}

    body = await build(input_of([
        {"id": "u", "role": "user", "source": "input", "content": [{"type": "media", "ref": "photo", "mediaType": "image/png"}]},
    ]), api_key="k", resolve_media=resolve)
    assert body["messages"][0]["content"] == [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}}]


async def test_a_resolver_result_without_data_or_url_is_invalid_request():
    with pytest.raises(ModelError) as caught:
        await build(input_of([
            {"id": "u", "role": "user", "source": "input", "content": [{"type": "media", "ref": "photo", "mediaType": "image/png"}]},
        ]), api_key="k", resolve_media=lambda part: {"mediaType": "image/png"})
    model_error(caught.value, "invalid_request")


@pytest.mark.parametrize("message", [
    {"id": "u", "role": "user", "source": "input", "content": [{"type": "media", "ref": "photo", "mediaType": "image/png"}]},
    {"id": "u", "role": "user", "source": "input", "content": [{"type": "image", "url": "ftp://example.com/a.png", "mediaType": "image/png"}]},
    {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "image", "url": "https://example.com/a.png", "mediaType": "image/png"}]},
])
async def test_reports_parts_it_cannot_send_as_unsupported_content(message):
    with pytest.raises(ModelError) as caught:
        await build(input_of([message]), api_key="k")
    model_error(caught.value, "unsupported_content")


async def test_reports_media_the_provider_cannot_receive_as_unsupported_content():
    with pytest.raises(ModelError) as caught:
        await build(input_of([
            {"id": "u", "role": "user", "source": "input", "content": [{"type": "media", "ref": "clip", "mediaType": "audio/wav"}]},
        ]), api_key="k", resolve_media=lambda part: {"data": "AAAA"})
    model_error(caught.value, "unsupported_content")


async def test_sends_a_mid_conversation_system_message_as_a_system_reminder_by_default():
    body = await build(input_of([
        {"id": "u", "role": "user", "source": "input", "content": [{"type": "text", "text": "hi"}]},
        {"id": "s", "role": "system", "source": "hook", "content": [{"type": "text", "text": "be brief"}]},
        {"id": "u2", "role": "user", "source": "input", "content": [{"type": "text", "text": "again"}]},
    ]), api_key="k")
    assert body["messages"] == [{"role": "user", "content": [
        {"type": "text", "text": "hi"},
        {"type": "text", "text": "<system-reminder>\nbe brief\n</system-reminder>"},
        {"type": "text", "text": "again"},
    ]}]


async def test_uses_a_native_system_message_only_where_the_condition_holds():
    messages = [
        {"id": "u", "role": "user", "source": "input", "content": [{"type": "text", "text": "hi"}]},
        {"id": "s", "role": "system", "source": "hook", "content": [{"type": "text", "text": "be brief"}]},
        {"id": "a", "role": "assistant", "source": "model", "content": [{"type": "text", "text": "ok"}]},
    ]
    native = await build(input_of(messages), api_key="k", mid_conversation_system="system")
    assert native["messages"][1] == {"role": "system", "content": "be brief"}
    reminder = await build(input_of(messages[:2] + [messages[0]]), api_key="k", mid_conversation_system="system")
    assert reminder["messages"] == [{"role": "user", "content": [
        {"type": "text", "text": "hi"},
        {"type": "text", "text": "<system-reminder>\nbe brief\n</system-reminder>"},
        {"type": "text", "text": "hi"},
    ]}]


async def test_a_stream_that_reports_no_usage_leaves_usage_out():
    scripted = ScriptedClient([sse_response(sse(
        {"type": "message_start", "message": {"id": "m", "model": MODEL}},
        {"type": "message_delta", "delta": {"stop_reason": "refusal"}},
        {"type": "message_stop"},
    ))])
    result = await anthropic_model(model=MODEL, api_key="k", env={}, http_client=scripted.client).generate(user_input("hi"), Context())
    assert "usage" not in result
    assert result["finishReason"] == "other"
    assert result["message"]["meta"]["anthropic"]["stopReason"] == "refusal"
    await scripted.aclose()


@pytest.mark.parametrize("event", [
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": 7}},
    {"type": "content_block_delta", "index": 9, "delta": {"type": "text_delta", "text": "x"}},
    {"type": "content_block_delta", "index": "a", "delta": {"type": "text_delta", "text": "x"}},
    {"type": "message_start", "message": "no"},
])
async def test_malformed_known_events_are_invalid_response(event):
    stream = sse({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}, event)
    scripted = ScriptedClient([sse_response(stream)])
    with pytest.raises(ModelError) as caught:
        await anthropic_model(model=MODEL, api_key="k", env={}, http_client=scripted.client, max_retries=0).generate(user_input("hi"), Context())
    model_error(caught.value, "invalid_response")
    await scripted.aclose()


async def test_an_event_without_a_type_is_invalid_response():
    scripted = ScriptedClient([sse_response(sse({"index": 0}))])
    with pytest.raises(ModelError) as caught:
        await anthropic_model(model=MODEL, api_key="k", env={}, http_client=scripted.client, max_retries=0).generate(user_input("hi"), Context())
    model_error(caught.value, "invalid_response")
    await scripted.aclose()


async def test_a_text_stream_reports_usage_from_message_start_and_message_delta():
    scripted = ScriptedClient([sse_response(anthropic_text_stream("hello"))])
    result = await anthropic_model(model=MODEL, api_key="k", env={}, http_client=scripted.client).generate(user_input("hi"), Context())
    assert result["usage"] == {"input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0}
    assert result["message"]["meta"]["anthropic"] == {"id": "msg_test", "model": "claude-test", "stopReason": "end_turn"}
    await scripted.aclose()

async def test_returns_at_message_stop_while_transport_remains_open():
    scripted = ScriptedClient([stalled_response(anthropic_text_stream("done"))])
    model = anthropic_model(model=MODEL, api_key="test-key", env={}, max_retries=0, idle_timeout_ms=100, http_client=scripted.client)
    try:
        result = await model.generate(user_input("hi"), Context())
        assert result["message"]["content"] == [{"type": "text", "text": "done"}]
    finally:
        await scripted.aclose()
