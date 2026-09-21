"""§재시도, 시간 제한과 취소: retries, the idle timeout, cancellation and the httpx extra."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import patch

import httpx
import pytest

from goondan import GoondanError
from goondan.models import ModelError, anthropic_model, openai_chat_model
from goondan.models._options import HTTPX_HINT, require_httpx
from test_models_support import (
    MODEL,
    Context,
    ScriptedClient,
    anthropic_text_stream,
    json_response,
    never_answers,
    openai_text_stream,
    raises,
    sse,
    sse_response,
    stalled_response,
    user_input,
)


def model_error(error: BaseException, code: str) -> ModelError:
    assert isinstance(error, ModelError), f"expected a ModelError, got {error!r}"
    assert error.code == code, f"expected {code}, got {error.code}: {error}"
    return error


async def generate(scripted: ScriptedClient, ctx: Context | None = None, **settings):
    model = anthropic_model(model=MODEL, api_key="k", env={}, http_client=scripted.client, **settings)
    return await model.generate(user_input("hi"), ctx if ctx is not None else Context())


def test_official_models_expose_provider_identifiers():
    assert anthropic_model(model=MODEL, api_key="k", env={}, http_client=object()).provider == "anthropic"
    assert openai_chat_model(model=MODEL, api_key="k", env={}, http_client=object()).provider == "openai"


async def test_retries_an_overloaded_response_and_honours_retry_after():
    scripted = ScriptedClient([
        json_response(529, {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}, {"retry-after": "0"}),
        sse_response(anthropic_text_stream("hello")),
    ])
    result = await generate(scripted)
    assert len(scripted.requests) == 2
    assert result["message"]["content"] == [{"type": "text", "text": "hello"}]
    assert scripted.requests[1].body == scripted.requests[0].body
    await scripted.aclose()


async def test_does_not_retry_a_rejected_request_and_records_its_request_id():
    scripted = ScriptedClient([
        json_response(400, {"type": "error", "error": {"type": "invalid_request_error", "message": "prompt is too long: 1 > 0"}}, {"request-id": "req_123"}),
    ])
    with pytest.raises(ModelError) as caught:
        await generate(scripted)
    error = model_error(caught.value, "context_length")
    assert len(scripted.requests) == 1
    assert (error.status, error.request_id, error.retryable) == (400, "req_123", False)
    await scripted.aclose()


async def test_retries_an_in_stream_error_that_arrives_before_any_text():
    failing = sse(
        {"type": "message_start", "message": {"id": "m", "model": MODEL, "usage": {}}},
        {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}},
    )
    scripted = ScriptedClient([sse_response(failing), sse_response(anthropic_text_stream("ok"))])
    ctx = Context()
    result = await generate(scripted, ctx)
    assert len(scripted.requests) == 2
    assert ctx.deltas == ["ok"]
    assert result["usage"] == {"input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0}
    await scripted.aclose()


async def test_does_not_retry_after_a_text_chunk_reached_the_caller():
    failing = sse(
        {"type": "message_start", "message": {"id": "m", "model": MODEL, "usage": {}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}},
        {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}},
    )
    scripted = ScriptedClient([sse_response(failing), sse_response(anthropic_text_stream("unused"))])
    ctx = Context()
    with pytest.raises(ModelError) as caught:
        await generate(scripted, ctx)
    model_error(caught.value, "overloaded")
    assert len(scripted.requests) == 1
    assert ctx.deltas == ["Hi"]
    await scripted.aclose()


async def test_reports_a_stream_without_message_stop_as_network_after_max_retries_attempts():
    truncated = sse({"type": "message_start", "message": {"id": "m", "model": MODEL, "usage": {}}})
    scripted = ScriptedClient([sse_response(truncated), sse_response(truncated)])
    with pytest.raises(ModelError) as caught:
        await generate(scripted, max_retries=1)
    model_error(caught.value, "network")
    assert len(scripted.requests) == 2
    await scripted.aclose()


async def test_wraps_connection_failures_as_network_errors_with_the_original_cause():
    cause = httpx.ConnectError("connection refused")
    scripted = ScriptedClient([raises(cause)])
    with pytest.raises(ModelError) as caught:
        await generate(scripted, max_retries=0)
    error = model_error(caught.value, "network")
    assert error.__cause__ is cause
    assert len(scripted.requests) == 1
    await scripted.aclose()


async def test_maps_an_httpx_timeout_to_the_timeout_code():
    scripted = ScriptedClient([raises(httpx.ReadTimeout("too slow"))])
    with pytest.raises(ModelError) as caught:
        await generate(scripted, max_retries=0)
    assert model_error(caught.value, "timeout").retryable is True
    await scripted.aclose()


async def test_times_out_while_waiting_for_the_response_headers():
    scripted = ScriptedClient([never_answers()])
    with pytest.raises(ModelError) as caught:
        await generate(scripted, idle_timeout_ms=30, max_retries=0)
    assert model_error(caught.value, "timeout").retryable is True
    await scripted.aclose()


async def test_times_out_while_waiting_for_the_next_body_chunk():
    partial = sse({"type": "message_start", "message": {"id": "m", "model": MODEL, "usage": {}}})
    scripted = ScriptedClient([stalled_response(partial)])
    with pytest.raises(ModelError) as caught:
        await generate(scripted, idle_timeout_ms=30, max_retries=0)
    model_error(caught.value, "timeout")
    await scripted.aclose()


async def test_cancellation_propagates_unwrapped_while_the_stream_is_open():
    partial = sse(
        {"type": "message_start", "message": {"id": "m", "model": MODEL, "usage": {}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hel"}},
    )
    closed: list[bool] = []
    scripted = ScriptedClient([stalled_response(partial, closed)])
    ctx = Context()
    task = asyncio.ensure_future(generate(scripted, ctx))
    for _ in range(100):
        await asyncio.sleep(0)
        if ctx.deltas:
            break
    assert ctx.deltas == ["Hel"]
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(scripted.requests) == 1
    # §취소: the adapter closes the open response before it lets the cancellation through.
    assert closed == [True]
    await scripted.aclose()


async def test_cancellation_stops_the_wait_before_a_retry():
    scripted = ScriptedClient([
        json_response(529, {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}, {"retry-after": "30"}),
    ])
    task = asyncio.ensure_future(generate(scripted))
    while not scripted.requests:
        await asyncio.sleep(0)
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(scripted.requests) == 1
    await scripted.aclose()


async def test_the_adapter_never_closes_a_client_the_caller_passed():
    scripted = ScriptedClient([sse_response(anthropic_text_stream("hi")), sse_response(anthropic_text_stream("again"))])
    model = anthropic_model(model=MODEL, api_key="k", env={}, http_client=scripted.client)
    await model.generate(user_input("hi"), Context())
    assert not scripted.client.is_closed
    second = await model.generate(user_input("hi"), Context())
    assert second["message"]["content"] == [{"type": "text", "text": "again"}]
    await scripted.aclose()
    assert scripted.client.is_closed


async def test_openai_retries_a_rate_limit_and_stops_at_done():
    scripted = ScriptedClient([
        json_response(429, {"error": {"message": "Rate limit reached", "type": "requests", "code": "rate_limit_exceeded"}}, {"retry-after-ms": "5", "x-request-id": "req_9"}),
        sse_response(openai_text_stream("ok")),
    ])
    model = openai_chat_model(model="gpt-test", api_key="k", env={}, http_client=scripted.client)
    result = await model.generate(user_input("hi"), Context())
    assert len(scripted.requests) == 2
    assert result["message"]["content"] == [{"type": "text", "text": "ok"}]
    await scripted.aclose()


async def test_openai_does_not_retry_an_exhausted_quota():
    scripted = ScriptedClient([
        json_response(429, {"error": {"message": "You exceeded your current quota", "type": "insufficient_quota", "code": "insufficient_quota"}}),
        sse_response(openai_text_stream("unused")),
    ])
    model = openai_chat_model(model="gpt-test", api_key="k", env={}, http_client=scripted.client)
    with pytest.raises(ModelError) as caught:
        await model.generate(user_input("hi"), Context())
    assert model_error(caught.value, "quota").status == 429
    assert len(scripted.requests) == 1
    await scripted.aclose()


async def test_a_model_without_a_client_creates_and_closes_one_itself():
    seen: list[httpx.AsyncClient] = []
    real_client = httpx.AsyncClient

    def spy(*args, **named):
        client = real_client(*args, **named, transport=httpx.MockTransport(lambda request: httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=anthropic_text_stream("hi").encode("utf-8"),
        )))
        seen.append(client)
        return client

    model = anthropic_model(model=MODEL, api_key="k", env={})
    with patch.object(httpx, "AsyncClient", spy):
        result = await model.generate(user_input("hi"), Context())
    assert result["message"]["content"] == [{"type": "text", "text": "hi"}]
    assert len(seen) == 1 and seen[0].is_closed


def test_creating_a_model_without_httpx_names_the_optional_extra():
    with patch.dict(sys.modules, {"httpx": None}):
        with pytest.raises(GoondanError) as caught:
            require_httpx()
        with pytest.raises(GoondanError) as creating:
            anthropic_model(model=MODEL, api_key="k", env={})
    assert HTTPX_HINT in str(caught.value)
    assert "goondan[models]" in str(creating.value)


def test_a_host_client_of_another_kind_is_accepted_without_httpx():
    class Client:
        pass

    with patch.dict(sys.modules, {"httpx": None}):
        model = anthropic_model(model=MODEL, api_key="k", env={}, http_client=Client())
    assert model.url == "https://api.anthropic.com/v1/messages"
