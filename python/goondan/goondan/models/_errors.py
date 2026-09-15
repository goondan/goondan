"""§오류: `ModelError` and the ordered classification of provider failures."""

from __future__ import annotations

import json as _json
import re
import time
from email.utils import parsedate_to_datetime
from typing import Any, Mapping

from ..types import GoondanError
from ._values import as_text, is_integer, non_empty_text

MODEL_ERROR_CODES = (
    "invalid_request",
    "authentication",
    "permission",
    "not_found",
    "request_too_large",
    "context_length",
    "quota",
    "rate_limited",
    "overloaded",
    "server_error",
    "timeout",
    "network",
    "invalid_response",
    "unsupported_content",
)

RETRYABLE_CODES = frozenset({"rate_limited", "overloaded", "server_error", "timeout", "network"})

PROVIDER_LABEL = {"anthropic": "Anthropic", "openai": "OpenAI"}


class ModelError(GoondanError):
    """§오류: the error the official model adapters raise.

    The runtime reports `code` as the second value of the execution error's `codes`. The
    original exception, when there is one, is the error's `__cause__`.
    """

    def __init__(
        self,
        message: str,
        *,
        provider: str,
        code: str,
        status: int | None = None,
        retry_after_ms: float | None = None,
        request_id: str | None = None,
    ):
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.message = message
        self.status = status
        self.retry_after_ms = retry_after_ms
        self.request_id = request_id

    @property
    def retryable(self) -> bool:
        """True for `rate_limited`, `overloaded`, `server_error`, `timeout` and `network`."""
        return self.code in RETRYABLE_CODES


def invalid_request(provider: str, message: str) -> ModelError:
    return ModelError(f"{PROVIDER_LABEL[provider]} adapter: {message}", provider=provider, code="invalid_request")


def unsupported_content(provider: str, message: str) -> ModelError:
    return ModelError(f"{PROVIDER_LABEL[provider]} adapter cannot send {message}", provider=provider, code="unsupported_content")


def invalid_response(provider: str, message: str) -> ModelError:
    return ModelError(f"{PROVIDER_LABEL[provider]} returned an invalid response: {message}", provider=provider, code="invalid_response")


_CONTEXT_LENGTH_MESSAGE = re.compile(r"prompt is too long|context length|maximum context", re.IGNORECASE)


def classify_error(*, status: int | None, type: str | None, code: str | None, message: str, stream: bool) -> str:
    """§오류: the ordered rules; the first matching row wins."""
    if code == "insufficient_quota" or type == "billing_error" or status == 402:
        return "quota"
    if code == "context_length_exceeded" or _CONTEXT_LENGTH_MESSAGE.search(message) is not None:
        return "context_length"
    if type == "overloaded_error" or status == 529:
        return "overloaded"
    if type == "rate_limit_error" or status == 429:
        return "rate_limited"
    if type == "authentication_error" or status == 401:
        return "authentication"
    if type == "permission_error" or status == 403:
        return "permission"
    if type == "not_found_error" or status == 404:
        return "not_found"
    if type == "request_too_large" or status == 413:
        return "request_too_large"
    if status == 408:
        return "timeout"
    if type == "api_error" or status == 409 or (status is not None and status >= 500):
        return "server_error"
    if not stream:
        return "invalid_request"
    return "invalid_request" if type == "invalid_request_error" else "server_error"


class _ErrorFields:
    __slots__ = ("type", "code", "numeric_code", "message")

    def __init__(self, value: Any):
        self.type: str | None = None
        self.code: str | None = None
        self.numeric_code: int | None = None
        self.message: str | None = None
        if not isinstance(value, dict):
            return
        self.type = as_text(value.get("type"))
        raw_code = value.get("code")
        self.code = as_text(raw_code)
        if is_integer(raw_code):
            self.numeric_code = int(raw_code)
        self.message = as_text(value.get("message"))


def lower_headers(headers: Mapping[str, str] | None) -> dict[str, str]:
    """A lowercase header map; httpx headers and plain dictionaries both work."""
    if headers is None:
        return {}
    return {str(name).lower(): str(value) for name, value in headers.items()}


def find_request_id(headers: Mapping[str, str] | None, body: Any) -> str | None:
    """`request-id`, then `x-request-id`, then the `request_id` field of the body or stream event."""
    found = lower_headers(headers)
    from_headers = non_empty_text(found.get("request-id")) or non_empty_text(found.get("x-request-id"))
    if from_headers is not None:
        return from_headers
    return non_empty_text(body.get("request_id")) if isinstance(body, dict) else None


_DECIMAL = re.compile(r"^\s*-?\d+(?:\.\d+)?\s*$")


def _decimal(value: str) -> float | None:
    return float(value) if _DECIMAL.match(value) is not None else None


def retry_after_ms(headers: Mapping[str, str] | None, now: float | None = None) -> float | None:
    """Reads `retry-after-ms`, then `retry-after` in seconds or as an HTTP date. `now` is epoch milliseconds."""
    found = lower_headers(headers)
    milliseconds = found.get("retry-after-ms")
    if milliseconds is not None:
        parsed = _decimal(milliseconds)
        if parsed is not None:
            return parsed
    retry_after = found.get("retry-after")
    if retry_after is None:
        return None
    seconds = _decimal(retry_after)
    if seconds is not None:
        return seconds * 1000
    try:
        date = parsedate_to_datetime(retry_after)
    except (TypeError, ValueError):
        return None
    if date is None:
        return None
    moment = time.time() * 1000 if now is None else now
    return max(0.0, date.timestamp() * 1000 - moment)


def _parse_body(text: str) -> Any:
    try:
        return _json.loads(text)
    except ValueError:
        return None


def _clip(text: str) -> str:
    return f"{text[:1000]}..." if len(text) > 1000 else text


def http_status_error(provider: str, status: int, headers: Mapping[str, str] | None, text: str) -> ModelError:
    """§오류: the error for a response whose status code is not 2xx."""
    body = _parse_body(text)
    fields = _ErrorFields(body.get("error") if isinstance(body, dict) else None)
    message = fields.message if fields.message is not None else text
    code = classify_error(status=status, type=fields.type, code=fields.code, message=message, stream=False)
    detail = "" if message == "" else f": {_clip(message)}"
    return ModelError(
        f"{PROVIDER_LABEL[provider]} HTTP {status}{detail}",
        provider=provider,
        code=code,
        status=status,
        retry_after_ms=retry_after_ms(headers),
        request_id=find_request_id(headers, body),
    )


def stream_error(provider: str, error_object: Any, request_id: str | None) -> ModelError:
    """§오류: the error for an `error` object received inside the stream."""
    fields = _ErrorFields(error_object)
    message = fields.message if fields.message is not None else ""
    code = classify_error(status=fields.numeric_code, type=fields.type, code=fields.code, message=message, stream=True)
    detail = "" if message == "" else f": {_clip(message)}"
    return ModelError(f"{PROVIDER_LABEL[provider]} stream error{detail}", provider=provider, code=code, request_id=request_id)
