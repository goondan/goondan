"""JSON value rules the runner shares with the specification.

`json_equal` is `spec/goondan.md#json-값-비교` and `merge_values` is
`spec/goondan.md#값-병합`. Booleans are a different kind from numbers, so they are
checked before numbers everywhere in this module.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

KIND_NULL, KIND_BOOLEAN, KIND_NUMBER, KIND_STRING, KIND_ARRAY, KIND_OBJECT, KIND_OTHER = (
    "null", "boolean", "number", "string", "array", "object", "other",
)


def kind_of(value: Any) -> str:
    if value is None:
        return KIND_NULL
    if isinstance(value, bool):
        return KIND_BOOLEAN
    if isinstance(value, (int, float)):
        return KIND_NUMBER
    if isinstance(value, str):
        return KIND_STRING
    if isinstance(value, list):
        return KIND_ARRAY
    if isinstance(value, Mapping):
        return KIND_OBJECT
    return KIND_OTHER


def is_json_value(value: Any) -> bool:
    kind = kind_of(value)
    if kind == KIND_OTHER:
        return False
    if kind == KIND_NUMBER:
        return math.isfinite(value)
    if kind == KIND_ARRAY:
        return all(is_json_value(item) for item in value)
    if kind == KIND_OBJECT:
        return all(isinstance(key, str) and is_json_value(item) for key, item in value.items())
    return True


def json_equal(left: Any, right: Any) -> bool:
    left_kind, right_kind = kind_of(left), kind_of(right)
    if left_kind != right_kind:
        return False
    if left_kind == KIND_NUMBER:
        return float(left) == float(right)
    if left_kind == KIND_ARRAY:
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    if left_kind == KIND_OBJECT:
        return set(left) == set(right) and all(json_equal(left[key], right[key]) for key in left)
    return left == right


def merge_values(base: Any, overlay: Any) -> Any:
    """Merge two values: objects merge key by key, every other value is replaced."""
    if isinstance(base, Mapping) and isinstance(overlay, Mapping):
        merged = {key: value for key, value in base.items()}
        for key, value in overlay.items():
            merged[key] = merge_values(merged[key], value) if key in merged else value
        return merged
    return overlay
