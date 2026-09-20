"""Runs every shared case in `fixtures/models` with the steps of spec/model-adapters.md (§공통 사례).

The TypeScript runner is `packages/models/test/fixtures.test.ts`; both must agree on every case.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from goondan.models import ModelError, anthropic_model, openai_chat_model

ROOT = Path(__file__).resolve().parents[3] / "fixtures" / "models"
PROVIDERS = ("anthropic", "openai")
EMPTY_INPUT = {"system": [], "messages": [], "tools": [], "options": {}}
CASE_FIELDS = {"config", "input", "stream", "chunkSize"}
EXPECTED_FIELDS = {"request", "result", "deltas", "error"}

# §공통 사례: cases name the TypeScript settings, so the Python runner renames them.
SETTING_NAMES = {
    "model": "model",
    "apiKey": "api_key",
    "authToken": "auth_token",
    "baseUrl": "base_url",
    "headers": "headers",
    "options": "options",
    "maxRetries": "max_retries",
    "idleTimeoutMs": "idle_timeout_ms",
    "env": "env",
    "autoCache": "auto_cache",
    "cacheTtl": "cache_ttl",
    "midConversationSystem": "mid_conversation_system",
    "maxTokensField": "max_tokens_field",
    "streamUsage": "stream_usage",
    "systemRole": "system_role",
}


def case_directories(provider: str) -> list[Path]:
    root = ROOT / provider
    return sorted(path for path in root.iterdir() if path.is_dir())


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict), f"{path} must hold an object"
    return value


def same(left: Any, right: Any) -> bool:
    """JSON value equality: object key order is ignored, array order and value types are not."""
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if isinstance(left, str) and isinstance(right, str):
        return left == right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(same(one, other) for one, other in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(same(left[key], right[key]) for key in left)
    return False


def check(label: str, actual: Any, expected: Any) -> None:
    assert same(actual, expected), (
        f"{label} differs\nactual:   {json.dumps(actual, ensure_ascii=False, sort_keys=True)}\n"
        f"expected: {json.dumps(expected, ensure_ascii=False, sort_keys=True)}"
    )


def read_settings(raw: Any) -> dict[str, Any]:
    assert isinstance(raw, dict), "config must be an object"
    assert isinstance(raw.get("model"), str), "config.model must be a string"
    settings: dict[str, Any] = {"env": {}, "max_retries": 0}
    for key, value in raw.items():
        assert key in SETTING_NAMES, f"unknown config field {key}"
        settings[SETTING_NAMES[key]] = value
    return settings


def stream_client(stream: str, chunk_size: int) -> httpx.AsyncClient:
    """A client whose transport answers every request with the case's response body."""
    payload = stream.encode("utf-8")

    def handler(_request: httpx.Request) -> httpx.Response:
        async def chunks():
            for offset in range(0, len(payload), chunk_size):
                yield payload[offset:offset + chunk_size]

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=chunks())

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class _Context:
    """The model context members the adapters read."""

    def __init__(self) -> None:
        self.agent = "main"
        self.session_id = "fixture"
        self.turn_id = "turn"
        self.step = 1
        self.deltas: list[str] = []

    def on_text_delta(self, delta: str) -> None:
        self.deltas.append(delta)


def create(provider: str, settings: dict[str, Any]):
    return anthropic_model(**settings) if provider == "anthropic" else openai_chat_model(**settings)


def result_without_message_id(result: dict[str, Any]) -> dict[str, Any]:
    message = {key: value for key, value in result["message"].items() if key != "id"}
    return {**result, "message": message}


async def run_case(provider: str, directory: Path) -> None:
    fixture = read_json(directory / "case.json")
    expected = read_json(directory / "expected.json")
    assert set(fixture) <= CASE_FIELDS, f"unknown case.json field in {directory.name}"
    assert set(expected) <= EXPECTED_FIELDS, f"unknown expected.json field in {directory.name}"
    settings = read_settings(fixture.get("config"))
    model_input = fixture.get("input")
    stream = fixture.get("stream")
    chunk_size = fixture.get("chunkSize", 7)
    expected_error = expected.get("error", {}).get("code") if "error" in expected else None
    failed = False

    def compare_failure(error: ModelError) -> None:
        nonlocal failed
        assert expected_error is not None, f"unexpected {error.code} error: {error}"
        assert error.code == expected_error, f"expected {expected_error}, got {error.code}: {error}"
        failed = True

    client = stream_client(stream if isinstance(stream, str) else "", chunk_size)
    try:
        try:
            model = create(provider, {**settings, "http_client": client})
        except ModelError as error:
            compare_failure(error)
            return

        if model_input is not None:
            try:
                request = await model.build_request(model_input)
                if "request" in expected:
                    check("request", request, expected["request"])
            except ModelError as error:
                if stream is not None:
                    raise
                compare_failure(error)

        if stream is not None:
            ctx = _Context()
            try:
                result = await model.generate(model_input if model_input is not None else EMPTY_INPUT, ctx)
                if "result" in expected:
                    check("result", result_without_message_id(result), expected["result"])
                if "deltas" in expected:
                    check("deltas", ctx.deltas, expected["deltas"])
            except ModelError as error:
                compare_failure(error)
    finally:
        await client.aclose()

    if expected_error is not None:
        assert failed, f"expected a {expected_error} error"


@pytest.mark.parametrize("provider", PROVIDERS)
def test_provider_has_cases(provider: str) -> None:
    assert case_directories(provider), f"fixtures/models/{provider} has no case"


@pytest.mark.parametrize(
    ("provider", "directory"),
    [(provider, directory) for provider in PROVIDERS for directory in case_directories(provider)],
    ids=[f"{provider}/{directory.name}" for provider in PROVIDERS for directory in case_directories(provider)],
)
async def test_model_fixture(provider: str, directory: Path) -> None:
    await run_case(provider, directory)
