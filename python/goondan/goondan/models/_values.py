"""JSON value helpers shared by the adapters.

The texts this module produces must match what the TypeScript adapter produces, so
`json_text` is the package's one `JSON 텍스트` serializer, re-exported here from
`goondan._json`, and `is_blank` follows `String.prototype.trim()`.
"""

from __future__ import annotations

import math
from typing import Any

from .._json import json_text

__all__ = [
    "JS_WHITESPACE", "as_text", "is_blank", "is_integer", "is_number", "json_equal",
    "json_text", "merge_json", "merge_objects", "non_empty_text", "strip_nulls",
]

# §대화 정규화: JavaScript `String.prototype.trim()` removes WhiteSpace and LineTerminator,
# which is not the same set as Python's `str.isspace()`.
JS_WHITESPACE = (
    "\t\n\v\f\r\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004"
    "\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def is_blank(text: str) -> bool:
    """True when JavaScript `text.trim()` would leave an empty string."""
    return text.strip(JS_WHITESPACE) == ""


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value) and value.is_integer()


def as_text(value: Any) -> str | None:
    """The value when it is a string, otherwise `None`."""
    return value if isinstance(value, str) else None


def non_empty_text(value: Any) -> str | None:
    return value if isinstance(value, str) and value != "" else None


def merge_json(base: Any, overlay: Any) -> Any:
    """Merges objects key by key; every other value, arrays included, is replaced by the overlay."""
    if not isinstance(base, dict) or not isinstance(overlay, dict):
        return overlay
    return merge_objects(base, overlay)


def merge_objects(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = dict(base)
    for key, value in overlay.items():
        result[key] = merge_json(result.get(key), value) if key in result else value
    return result


def strip_nulls(value: dict[str, Any]) -> dict[str, Any]:
    """Removes keys whose value is `None` from an object and from the objects nested in it."""
    result: dict[str, Any] = {}
    for key, item in value.items():
        if item is None:
            continue
        result[key] = strip_nulls(item) if isinstance(item, dict) else item
    return result


def json_equal(left: Any, right: Any) -> bool:
    """JSON value equality: object key order is ignored, array order and value types are not."""
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if left is None or right is None:
        return left is None and right is None
    if is_number(left) and is_number(right):
        return left == right
    if isinstance(left, str) and isinstance(right, str):
        return left == right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(json_equal(one, other) for one, other in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(json_equal(left[key], right[key]) for key in left)
    return False
