"""§오류: error classification, the request id, the retry hint and the backoff."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from goondan import GoondanError
from goondan.models import ModelError
from goondan.models._errors import MODEL_ERROR_CODES, http_status_error, retry_after_ms, stream_error
from goondan.models._transport import backoff_ms


def http(status: int, body: str, headers: dict[str, str] | None = None) -> ModelError:
    return http_status_error("anthropic", status, headers or {}, body)


def error_body(error: dict[str, object]) -> str:
    return json.dumps({"error": error})


def test_classifies_http_error_responses_in_the_specified_order():
    assert http(402, "").code == "quota"
    assert http(429, error_body({"type": "insufficient_quota", "code": "insufficient_quota", "message": "quota"})).code == "quota"
    assert http(400, error_body({"type": "billing_error", "message": "billing"})).code == "quota"
    assert http(400, error_body({"type": "invalid_request_error", "message": "prompt is too long: 250000 tokens > 200000 maximum"})).code == "context_length"
    assert http(400, error_body({"code": "context_length_exceeded", "message": "too long"})).code == "context_length"
    assert http(400, "This model's Maximum Context is exceeded").code == "context_length"
    assert http(529, error_body({"type": "overloaded_error", "message": "Overloaded"})).code == "overloaded"
    assert http(429, "").code == "rate_limited"
    assert http(401, "").code == "authentication"
    assert http(403, "").code == "permission"
    assert http(404, "").code == "not_found"
    assert http(413, "").code == "request_too_large"
    assert http(408, "").code == "timeout"
    assert http(409, "").code == "server_error"
    assert http(503, "").code == "server_error"
    assert http(400, error_body({"type": "invalid_request_error", "message": "bad"})).code == "invalid_request"
    assert http(418, "").code == "invalid_request"


def test_classifies_in_stream_errors_using_an_integer_code_as_the_status():
    assert stream_error("anthropic", {"type": "overloaded_error", "message": "Overloaded"}, None).code == "overloaded"
    assert stream_error("anthropic", {"type": "invalid_request_error", "message": "bad"}, None).code == "invalid_request"
    assert stream_error("openai", {"code": 502, "message": "Provider disconnected"}, None).code == "server_error"
    assert stream_error("openai", {"code": 429, "message": "slow down"}, None).code == "rate_limited"
    assert stream_error("openai", {"message": "unknown"}, None).code == "server_error"
    assert stream_error("openai", {"code": 429, "message": "slow down"}, None).status is None


def test_records_the_status_request_id_retry_hint_and_body_text():
    error = http(400, "plain failure", {"request-id": "req_1", "retry-after": "2"})
    assert (error.provider, error.code, error.status, error.request_id, error.retry_after_ms, error.retryable) == (
        "anthropic", "invalid_request", 400, "req_1", 2000, False,
    )
    assert str(error) == "Anthropic HTTP 400: plain failure"
    assert http(500, "", {"x-request-id": "req_2"}).request_id == "req_2"
    assert http(500, json.dumps({"type": "error", "error": {"type": "api_error", "message": "boom"}, "request_id": "req_3"})).request_id == "req_3"


def test_marks_only_the_five_retryable_codes():
    retryable = {"rate_limited", "overloaded", "server_error", "timeout", "network"}
    for code in MODEL_ERROR_CODES:
        assert ModelError("x", provider="openai", code=code).retryable is (code in retryable)


def test_is_a_goondan_error_and_keeps_the_cause():
    cause = TypeError("connection failed")
    try:
        try:
            raise cause
        except TypeError as broken:
            raise ModelError("network", provider="openai", code="network") from broken
    except ModelError as error:
        assert error.__cause__ is cause
        assert isinstance(error, GoondanError)
        assert error.message == "network"


def test_reads_retry_after_ms_then_retry_after_seconds_or_an_http_date():
    now = datetime(2026, 9, 14, tzinfo=timezone.utc).timestamp() * 1000
    assert retry_after_ms({"retry-after-ms": "1500", "retry-after": "9"}, now) == 1500
    assert retry_after_ms({"retry-after": "2"}, now) == 2000
    assert retry_after_ms({"retry-after": "Mon, 14 Sep 2026 00:00:03 GMT"}, now) == 3000
    assert retry_after_ms({"retry-after": "Sun, 13 Sep 2026 23:59:00 GMT"}, now) == 0
    assert retry_after_ms({"retry-after": "soon"}, now) is None
    assert retry_after_ms({}, now) is None
    # An unusable `retry-after-ms` falls back to `retry-after`.
    assert retry_after_ms({"retry-after-ms": "soon", "retry-after": "3"}, now) == 3000


def test_uses_a_hinted_wait_between_zero_and_sixty_seconds_otherwise_capped_backoff():
    assert backoff_ms(0, 0) == 0
    assert backoff_ms(3, 60_000) == 60_000
    assert backoff_ms(0, 60_001, lambda: 0) == 500
    assert backoff_ms(1, None, lambda: 0) == 1000
    assert backoff_ms(0, -1, lambda: 0.5) == 437.5
    assert backoff_ms(10, None, lambda: 0) == 8000
