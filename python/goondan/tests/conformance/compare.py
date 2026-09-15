"""Comparison of a normalized document against the expected values.

The comparison is the JSON value comparison of the specification. A difference is
reported with the JSON Pointer of its position so that a failure message can list the
positions with their expected and actual values, as the README asks.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .jsonptr import format_pointer
from .values import KIND_ARRAY, KIND_OBJECT, json_equal, kind_of

ABSENT = "<absent>"


@dataclass(frozen=True)
class Difference:
    pointer: str
    expected: Any
    actual: Any


def _render(value: Any) -> str:
    if value is ABSENT:
        return ABSENT
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        return repr(value)


def diff_values(expected: Any, actual: Any, segments: Sequence[Any] = ()) -> list[Difference]:
    """Compare two values completely and return every position that differs."""
    expected_kind, actual_kind = kind_of(expected), kind_of(actual)
    if expected_kind != actual_kind:
        return [Difference(format_pointer(segments), expected, actual)]
    if expected_kind == KIND_ARRAY:
        differences: list[Difference] = []
        if len(expected) != len(actual):
            differences.append(Difference(format_pointer(segments), expected, actual))
        for index in range(min(len(expected), len(actual))):
            differences.extend(diff_values(expected[index], actual[index], (*segments, index)))
        return differences
    if expected_kind == KIND_OBJECT:
        differences = []
        for key in expected:
            if key in actual:
                differences.extend(diff_values(expected[key], actual[key], (*segments, key)))
            else:
                differences.append(Difference(format_pointer((*segments, key)), expected[key], ABSENT))
        for key in actual:
            if key not in expected:
                differences.append(Difference(format_pointer((*segments, key)), ABSENT, actual[key]))
        return differences
    return [] if json_equal(expected, actual) else [Difference(format_pointer(segments), expected, actual)]


def diff_listed_keys(expected: Mapping[str, Any], actual: Any, segments: Sequence[Any] = ()) -> list[Difference]:
    """Compare only the keys `expected` lists, comparing each listed value completely."""
    if not isinstance(actual, Mapping):
        return [Difference(format_pointer(segments), expected, actual)]
    differences: list[Difference] = []
    for key in expected:
        if key in actual:
            differences.extend(diff_values(expected[key], actual[key], (*segments, key)))
        else:
            differences.append(Difference(format_pointer((*segments, key)), expected[key], ABSENT))
    return differences


def format_differences(differences: Sequence[Difference]) -> str:
    lines = []
    for difference in differences:
        lines.append(f"  {difference.pointer or '(root)'}")
        lines.append(f"    expected: {_render(difference.expected)}")
        lines.append(f"    actual:   {_render(difference.actual)}")
    return "\n".join(lines)
