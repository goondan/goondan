"""§공통 설정, §자격 증명과 기본 URL, §옵션 병합: settings, credentials and option handling."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping, Sequence

from ..types import GoondanError
from ._errors import invalid_request
from ._values import is_integer, is_number, merge_objects, strip_nulls

OFFICIAL_BASE_URL = {"anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com/v1"}

_ENV_NAMES = {
    "anthropic": {"api_key": "ANTHROPIC_API_KEY", "base_url": "ANTHROPIC_BASE_URL"},
    "openai": {"api_key": "OPENAI_API_KEY", "base_url": "OPENAI_BASE_URL"},
}

DEFAULT_MAX_RETRIES = 2

HTTPX_HINT = (
    "goondan.models needs httpx. Install the optional dependency with `pip install \"goondan[models]\"` "
    "or pass an httpx.AsyncClient as http_client."
)

# Media a host resolver returns: base64 `data` without a `data:` prefix, or a `url`.
MediaResolver = Callable[[Mapping[str, str]], "Mapping[str, Any] | Awaitable[Mapping[str, Any]]"]


class _NoTimeoutException(Exception):
    """Stands in for `httpx.TimeoutException` when a host passed a client of its own without httpx."""


class _WithoutHttpx:
    TimeoutException = _NoTimeoutException

    @staticmethod
    def AsyncClient(*args: Any, **named: Any) -> Any:  # noqa: N802 - mirrors the httpx name
        raise GoondanError(HTTPX_HINT)


def require_httpx() -> Any:
    """§어댑터 구성: httpx is an optional dependency, so it is imported only when it is needed."""
    try:
        import httpx
    except ImportError as missing:  # pragma: no cover - exercised only without the extra
        raise GoondanError(HTTPX_HINT) from missing
    return httpx


def resolve_httpx(http_client: Any) -> Any:
    """The httpx module, or a stand-in when the host passed its own client and httpx is absent."""
    if http_client is None:
        return require_httpx()
    try:
        import httpx
    except ImportError:  # pragma: no cover - exercised only without the extra
        return _WithoutHttpx
    return httpx


@dataclass
class HttpModelConfig:
    """§공통 설정: the settings both adapters share, after validation."""

    provider: str
    model: str
    base_url: str
    official: bool
    api_key: str | None
    headers: dict[str, str]
    options: dict[str, Any]
    max_retries: int
    idle_timeout_ms: float | None
    resolve_media: MediaResolver | None
    http_client: Any | None
    env: Mapping[str, str] = field(default_factory=dict)


def env_value(env: Mapping[str, str], name: str) -> str | None:
    """Reads an environment variable; an empty string counts as unset."""
    value = env.get(name)
    return value if isinstance(value, str) and value != "" else None


def _check_text(provider: str, name: str, value: Any, *, allow_empty: bool) -> None:
    if value is None:
        return
    if not isinstance(value, str) or (not allow_empty and value == ""):
        raise invalid_request(provider, f"{name} must be a{'' if allow_empty else ' non-empty'} string")


def check_optional_flag(provider: str, name: str, value: Any) -> None:
    if value is not None and not isinstance(value, bool):
        raise invalid_request(provider, f"{name} must be a boolean")


def check_optional_choice(provider: str, name: str, value: Any, choices: Sequence[str]) -> None:
    if value is not None and (not isinstance(value, str) or value not in choices):
        raise invalid_request(provider, f"{name} must be one of {', '.join(choices)}")


def read_http_config(
    provider: str,
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
) -> HttpModelConfig:
    """§공통 설정: validates the shared settings and resolves the base URL and credential once."""
    if not isinstance(model, str) or model == "":
        raise invalid_request(provider, "model must be a non-empty string")
    _check_text(provider, "api_key", api_key, allow_empty=True)
    _check_text(provider, "base_url", base_url, allow_empty=False)
    if headers is not None and not (
        isinstance(headers, Mapping) and all(isinstance(name, str) and isinstance(value, str) for name, value in headers.items())
    ):
        raise invalid_request(provider, "headers must map header names to strings")
    if options is not None and not isinstance(options, Mapping):
        raise invalid_request(provider, "options must be an object")
    if max_retries is not None and not (is_integer(max_retries) and max_retries >= 0):
        raise invalid_request(provider, "max_retries must be a non-negative integer")
    if idle_timeout_ms is not None and not (is_number(idle_timeout_ms) and idle_timeout_ms > 0):
        raise invalid_request(provider, "idle_timeout_ms must be a positive number")
    if resolve_media is not None and not callable(resolve_media):
        raise invalid_request(provider, "resolve_media must be callable")
    if env is not None and not isinstance(env, Mapping):
        raise invalid_request(provider, "env must be a mapping")

    variables: Mapping[str, str] = os.environ if env is None else env
    names = _ENV_NAMES[provider]
    chosen = base_url if base_url is not None else env_value(variables, names["base_url"])
    resolved = (chosen if chosen is not None else OFFICIAL_BASE_URL[provider]).rstrip("/")
    key = api_key if api_key is not None else env_value(variables, names["api_key"])
    return HttpModelConfig(
        provider=provider,
        model=model,
        base_url=resolved,
        official=resolved == OFFICIAL_BASE_URL[provider],
        api_key=key if key != "" else None,
        headers=dict(headers) if headers is not None else {},
        options=dict(options) if options is not None else {},
        max_retries=int(max_retries) if max_retries is not None else DEFAULT_MAX_RETRIES,
        idle_timeout_ms=float(idle_timeout_ms) if idle_timeout_ms is not None else None,
        resolve_media=resolve_media,
        http_client=http_client,
        env=variables,
    )


def merge_headers(defaults: Mapping[str, str], extra: Mapping[str, str]) -> dict[str, str]:
    """§공통 설정: an extra header replaces a default whose name matches case-insensitively."""
    entries: dict[str, tuple[str, str]] = {}
    for name, value in defaults.items():
        entries[name.lower()] = (name, value)
    for name, value in extra.items():
        entries[name.lower()] = (name, value)
    return {name: value for name, value in entries.values()}


def merge_model_options(defaults: Mapping[str, Any], overlay: Mapping[str, Any]) -> dict[str, Any]:
    """§옵션 병합: the input options over the configured defaults, without keys whose value is null."""
    return strip_nulls(merge_objects(dict(defaults), dict(overlay)))


@dataclass
class PortableOptions:
    """§옵션 병합: the option keys every model implementation reads the same way."""

    max_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    stop: list[str] | None = None
    tool_choice: Any = None


def read_portable_options(provider: str, options: Mapping[str, Any]) -> PortableOptions:
    """§옵션 병합: reads and validates the shared option keys."""
    result = PortableOptions()
    if "maxTokens" in options:
        value = options["maxTokens"]
        if not is_integer(value):
            raise invalid_request(provider, "options.maxTokens must be an integer")
        result.max_tokens = int(value)
    if "temperature" in options:
        value = options["temperature"]
        if not is_number(value):
            raise invalid_request(provider, "options.temperature must be a number")
        result.temperature = value
    if "topP" in options:
        value = options["topP"]
        if not is_number(value):
            raise invalid_request(provider, "options.topP must be a number")
        result.top_p = value
    if "stop" in options:
        value = options["stop"]
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise invalid_request(provider, "options.stop must be an array of strings")
        result.stop = list(value)
    if "toolChoice" in options:
        value = options["toolChoice"]
        if value in ("auto", "none", "required"):
            result.tool_choice = value
        elif isinstance(value, dict) and isinstance(value.get("name"), str):
            result.tool_choice = {"name": value["name"]}
        else:
            raise invalid_request(provider, "options.toolChoice must be auto, none, required or {name}")
    return result


def provider_overrides(provider: str, options: Mapping[str, Any], reserved: Sequence[str]) -> dict[str, Any] | None:
    """§옵션 병합: the provider-named option object that is merged into the request body last."""
    if provider not in options:
        return None
    value = options[provider]
    if not isinstance(value, dict):
        raise invalid_request(provider, f"options.{provider} must be an object")
    for key in reserved:
        if key in value:
            raise invalid_request(provider, f"options.{provider}.{key} is managed by the adapter")
    return value
