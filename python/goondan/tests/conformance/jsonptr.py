"""JSON Pointer (RFC 6901) reading and writing used by the `get` and `set` operations."""

from __future__ import annotations

import copy
from typing import Any, Mapping, Sequence

MISSING = object()


class PointerError(ValueError):
    pass


def parse_pointer(pointer: str) -> list[str]:
    if not isinstance(pointer, str):
        raise PointerError(f"a JSON Pointer must be a string, got {pointer!r}")
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise PointerError(f"a JSON Pointer must be empty or start with '/': {pointer!r}")
    return [segment.replace("~1", "/").replace("~0", "~") for segment in pointer[1:].split("/")]


def format_pointer(segments: Sequence[Any]) -> str:
    return "".join("/" + str(segment).replace("~", "~0").replace("/", "~1") for segment in segments)


def _array_index(segment: str, length: int) -> int | None:
    if segment == "0":
        return 0 if length > 0 else None
    if not segment.isdigit() or segment.startswith("0"):
        return None
    index = int(segment)
    return index if index < length else None


def pointer_get(value: Any, segments: Sequence[str]) -> Any:
    """Return the value at `segments`, or `MISSING` when the location does not exist."""
    current = value
    for segment in segments:
        if isinstance(current, Mapping):
            if segment not in current:
                return MISSING
            current = current[segment]
        elif isinstance(current, list):
            index = _array_index(segment, len(current))
            if index is None:
                return MISSING
            current = current[index]
        else:
            return MISSING
    return current


def pointer_set(value: Any, segments: Sequence[str], new_value: Any) -> Any:
    """Return a copy of `value` with `segments` replaced by `new_value`.

    The parent must exist. An object parent takes any key, an array parent takes an
    existing index or `-` to append. Anything else is an error.
    """
    if not segments:
        raise PointerError("set needs a non-empty path")
    result = copy.deepcopy(value)
    parent = pointer_get(result, segments[:-1])
    last = segments[-1]
    if parent is MISSING:
        raise PointerError(f"set found no parent for {format_pointer(segments)}")
    if isinstance(parent, Mapping):
        if not isinstance(parent, dict):
            raise PointerError(f"set cannot write into {type(parent).__name__}")
        parent[last] = copy.deepcopy(new_value)
        return result
    if isinstance(parent, list):
        if last == "-":
            parent.append(copy.deepcopy(new_value))
            return result
        index = _array_index(last, len(parent))
        if index is None:
            raise PointerError(f"set needs an existing array index or '-' at {format_pointer(segments)}")
        parent[index] = copy.deepcopy(new_value)
        return result
    raise PointerError(f"set found no object or array parent for {format_pointer(segments)}")
