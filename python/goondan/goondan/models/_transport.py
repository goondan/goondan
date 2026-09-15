"""§스트리밍, §재시도, 시간 제한과 취소: one streaming call, its retries and its idle timeout."""

from __future__ import annotations

import asyncio
import json as _json
import random as _random
from dataclasses import dataclass
from typing import Any, Callable, Protocol, Sequence

from ._errors import ModelError, PROVIDER_LABEL, find_request_id, http_status_error, invalid_response
from ._sse import SseParser
from ._values import json_text


class StreamAssembler(Protocol):
    """Turns the `data` of each server-sent event into a model result."""

    def accept(self, data: str) -> bool:
        """Handles one event; returns true when the provider signalled the end."""

    def result(self) -> dict[str, Any]:
        ...


@dataclass
class StreamCall:
    provider: str
    url: str
    headers: dict[str, str]
    body: dict[str, Any]
    httpx: Any
    client: Any | None
    max_retries: int
    idle_timeout_ms: float | None
    on_text_delta: Callable[[str], None] | None
    create_assembler: Callable[[Callable[[str], None], str | None], StreamAssembler]


def backoff_ms(attempt: int, hinted: float | None, random: Callable[[], float] = _random.random) -> float:
    """§재시도, 시간 제한과 취소: the wait before the nth retry, where the first retry is n = 0."""
    if hinted is not None and 0 <= hinted <= 60_000:
        return hinted
    return min(8000.0, 500.0 * 2 ** attempt) * (1 - 0.25 * random())


def _describe(error: BaseException) -> str:
    text = str(error)
    return text if text != "" else type(error).__name__


async def _close_quietly(closeable: Any) -> None:
    """Closes a response or a client even while an error or a cancellation is propagating."""
    try:
        await closeable.aclose()
    except BaseException:  # noqa: BLE001 - the original failure must reach the caller unchanged
        pass


def _timeout_error(call: StreamCall) -> ModelError:
    return ModelError(
        f"{PROVIDER_LABEL[call.provider]} sent nothing for {call.idle_timeout_ms} ms",
        provider=call.provider,
        code="timeout",
    )


async def _wait(awaitable: Any, call: StreamCall) -> Any:
    """Applies `idle_timeout_ms` to one wait; an `asyncio.CancelledError` is never turned into an error."""
    if call.idle_timeout_ms is None:
        return await awaitable
    try:
        return await asyncio.wait_for(awaitable, call.idle_timeout_ms / 1000)
    except TimeoutError as broken:
        raise _timeout_error(call) from broken


async def _next_chunk(iterator: Any) -> bytes | None:
    try:
        return await iterator.__anext__()
    except StopAsyncIteration:
        return None


def _deliver(provider: str, assembler: StreamAssembler, events: Sequence[str]) -> bool:
    for data in events:
        try:
            done = assembler.accept(data)
        except ModelError:
            raise
        except Exception as broken:
            raise invalid_response(provider, f"unexpected stream event: {_describe(broken)}") from broken
        if done:
            return True
    return False


def _finish(provider: str, assembler: StreamAssembler) -> dict[str, Any]:
    try:
        return assembler.result()
    except ModelError:
        raise
    except Exception as broken:
        raise invalid_response(provider, _describe(broken)) from broken


async def _read_error_body(response: Any, call: StreamCall) -> str:
    try:
        body = await _wait(response.aread(), call)
    except ModelError:
        raise
    except Exception:  # noqa: BLE001 - the status code alone still classifies the failure
        return ""
    return body.decode("utf-8", "replace") if isinstance(body, (bytes, bytearray)) else str(body)


async def _run_attempt(call: StreamCall, client: Any, payload: bytes, emit: Callable[[str], None]) -> dict[str, Any]:
    response: Any = None
    try:
        # §재시도, 시간 제한과 취소: the adapter applies neither its own default timeout nor httpx's.
        request = client.build_request("POST", call.url, headers=call.headers, content=payload, timeout=None)
        response = await _wait(client.send(request, stream=True), call)
        if not 200 <= response.status_code < 300:
            raise http_status_error(call.provider, response.status_code, response.headers, await _read_error_body(response, call))
        assembler = call.create_assembler(emit, find_request_id(response.headers, None))
        parser = SseParser()
        iterator = response.aiter_bytes().__aiter__()
        while True:
            chunk = await _wait(_next_chunk(iterator), call)
            if chunk is None:
                _deliver(call.provider, assembler, parser.end())
                break
            if _deliver(call.provider, assembler, parser.push(chunk)):
                break
        return _finish(call.provider, assembler)
    except ModelError:
        raise
    except call.httpx.TimeoutException as broken:
        raise ModelError(f"{PROVIDER_LABEL[call.provider]} timed out: {_describe(broken)}", provider=call.provider, code="timeout") from broken
    except Exception as broken:
        raise ModelError(f"{PROVIDER_LABEL[call.provider]} request failed: {_describe(broken)}", provider=call.provider, code="network") from broken
    finally:
        if response is not None:
            await _close_quietly(response)


async def stream_model(call: StreamCall) -> dict[str, Any]:
    """§재시도: resends a retryable failure up to `max_retries` times, but only before the first text chunk."""
    payload = json_text(call.body).encode("utf-8")
    emitted = False

    def emit(delta: str) -> None:
        nonlocal emitted
        emitted = True
        if call.on_text_delta is not None:
            call.on_text_delta(delta)

    client = call.client
    own_client = None
    try:
        if client is None:
            own_client = call.httpx.AsyncClient()
            client = own_client
        attempt = 0
        while True:
            try:
                return await _run_attempt(call, client, payload, emit)
            except ModelError as failure:
                if not failure.retryable or emitted or attempt >= call.max_retries:
                    raise
                wait = backoff_ms(attempt, failure.retry_after_ms)
            attempt += 1
            await asyncio.sleep(wait / 1000)
    finally:
        # §공통 설정: the adapter closes only the client it created itself.
        if own_client is not None:
            await _close_quietly(own_client)


def parse_event_data(provider: str, data: str) -> Any:
    """§스트리밍: the `data` of one event as JSON; malformed data is an `invalid_response` error."""
    try:
        return _json.loads(data)
    except ValueError as broken:
        raise invalid_response(provider, f"stream event data is not JSON: {_describe(broken)}") from broken
