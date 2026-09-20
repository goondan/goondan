"""Helpers the `goondan.models` unit tests share. It holds no test of its own."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Iterable

import httpx

MODEL = "claude-sonnet-5"
OPENAI_MODEL = "gpt-test"


def sse(*events: Any) -> str:
    return "".join(f"data: {json.dumps(event, separators=(',', ':'))}\n\n" for event in events)


def anthropic_text_stream(text: str, usage: Any = None) -> str:
    return sse(
        {"type": "message_start", "message": {"id": "msg_test", "model": "claude-test", "usage": usage if usage is not None else {"input_tokens": 1, "output_tokens": 1}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 2}},
        {"type": "message_stop"},
    )


def openai_text_stream(text: str) -> str:
    return sse(
        {"id": "chatcmpl-test", "model": "gpt-test", "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}]},
        {"id": "chatcmpl-test", "model": "gpt-test", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
    ) + "data: [DONE]\n\n"


def chunked(text: str, chunk_size: int = 7) -> Any:
    payload = text.encode("utf-8")

    async def chunks():
        for offset in range(0, len(payload), chunk_size):
            yield payload[offset:offset + chunk_size]

    return chunks()


def sse_response(text: str, *, chunk_size: int = 7, headers: dict[str, str] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    def reply(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream", **(headers or {})}, content=chunked(text, chunk_size))

    return reply


def json_response(status: int, body: Any, headers: dict[str, str] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    def reply(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body, headers=headers or {})

    return reply


def text_response(status: int, body: str, headers: dict[str, str] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    def reply(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=body, headers=headers or {})

    return reply


def stalled_response(text: str, closed: list[bool] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    """Sends the given text and then keeps the body open until the reader gives up.

    `closed` records that the adapter closed the response, which ends the body generator.
    """

    def reply(_request: httpx.Request) -> httpx.Response:
        async def chunks():
            try:
                if text != "":
                    yield text.encode("utf-8")
                await asyncio.Event().wait()
                yield b""  # pragma: no cover - never reached
            finally:
                if closed is not None:
                    closed.append(True)

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=chunks())

    return reply


def never_answers() -> Callable[[httpx.Request], Any]:
    async def reply(_request: httpx.Request) -> httpx.Response:
        await asyncio.Event().wait()
        return httpx.Response(200)  # pragma: no cover - never reached

    return reply


class RecordedRequest:
    __slots__ = ("url", "headers", "body")

    def __init__(self, request: httpx.Request):
        self.url = str(request.url)
        self.headers = dict(request.headers)
        self.body = json.loads(request.content) if request.content else None


class ScriptedClient:
    """An `httpx.AsyncClient` that answers each call with the next reply and records the request."""

    def __init__(self, replies: Iterable[Callable[[httpx.Request], Any]]):
        self.requests: list[RecordedRequest] = []
        self._queue = list(replies)

        async def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(RecordedRequest(request))
            if not self._queue:
                raise AssertionError(f"unexpected request {len(self.requests)}")
            reply = self._queue.pop(0)
            answer = reply(request)
            if asyncio.iscoroutine(answer):
                answer = await answer
            return answer

        self.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def aclose(self) -> None:
        await self.client.aclose()


def raises(error: BaseException) -> Callable[[httpx.Request], Any]:
    def reply(_request: httpx.Request) -> httpx.Response:
        raise error

    return reply


class Context:
    """The model context members the adapters read."""

    def __init__(self, on_text_delta: Callable[[str], None] | None = None):
        self.agent = "main"
        self.session_id = "c"
        self.turn_id = "t"
        self.step = 1
        self.deltas: list[str] = []
        self._extra = on_text_delta

    def on_text_delta(self, delta: str) -> None:
        self.deltas.append(delta)
        if self._extra is not None:
            self._extra(delta)


def user_input(text: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "system": [],
        "messages": [{"id": "u1", "role": "user", "source": "input", "content": [{"type": "text", "text": text}]}],
        "tools": [],
        "options": options if options is not None else {},
    }


def input_of(messages: list[dict[str, Any]], *, system: list[dict[str, Any]] | None = None, tools: list[dict[str, Any]] | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "system": system if system is not None else [],
        "messages": messages,
        "tools": tools if tools is not None else [],
        "options": options if options is not None else {},
    }
