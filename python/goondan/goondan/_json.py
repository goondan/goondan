"""§JSON 텍스트: the one JSON text serializer the whole package uses.

`JSON 텍스트` is what `JSON.stringify` writes in the TypeScript host, so the number
spelling follows the ECMAScript `Number::toString` algorithm rather than Python's `repr`,
and strings are written without ASCII escaping. The runtime, the template `json` filter
and the model adapters all serialize through this module, so the package cannot
contradict itself about the text a model receives.
"""

from __future__ import annotations

import json
import math
from decimal import Decimal
from typing import Any, Mapping

from .types import GoondanError


def _positional(raw: str) -> str:
    """The exponent spelling `repr` produced, written out in positional notation.

    Only a fractional tail loses its trailing zeros: the zeros of an integer part carry
    the magnitude, so `1e16` is `10000000000000000` and never `1`.
    """
    text = format(Decimal(raw), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def number_text(value: int | float) -> str:
    """§JSON 텍스트: the `Number::toString` spelling of one finite JSON number."""
    if isinstance(value, bool):
        raise GoondanError("a boolean is not a JSON number")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise GoondanError("JSON numbers must be finite")
    # `JSON.stringify(-0)` is `0`, so the sign of a zero is never written.
    if value == 0:
        return "0"
    absolute = abs(value)
    raw = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        # ECMAScript writes this range without an exponent; Python's `repr` may not.
        if "e" in raw:
            return _positional(raw)
        return raw[:-2] if raw.endswith(".0") else raw
    if "e" not in raw:
        return raw
    mantissa, exponent = raw.split("e")
    if "." in mantissa:
        mantissa = mantissa.rstrip("0").rstrip(".")
    power = int(exponent)
    return f"{mantissa}e{'+' if power >= 0 else '-'}{abs(power)}"


def _text(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _write(value: Any, indent: int, level: int) -> str:
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, (int, float)): return number_text(value)
    if isinstance(value, str): return _text(value)
    compact = indent == 0
    if isinstance(value, list):
        if not value: return "[]"
        if compact: return "[" + ",".join(_write(item, 0, 0) for item in value) + "]"
        inner = ",\n".join("  " * (level + 1) + _write(item, indent, level + 1) for item in value)
        return "[\n" + inner + "\n" + "  " * level + "]"
    if isinstance(value, Mapping):
        if not value: return "{}"
        if compact: return "{" + ",".join(f"{_text(str(key))}:{_write(item, 0, 0)}" for key, item in value.items()) + "}"
        inner = ",\n".join("  " * (level + 1) + f"{_text(str(key))}: {_write(item, indent, level + 1)}" for key, item in value.items())
        return "{\n" + inner + "\n" + "  " * level + "}"
    raise GoondanError(f"value is not JSON: {type(value).__name__}")


def json_text(value: Any) -> str:
    """§JSON 텍스트: the compact text, with no spaces between members and no ASCII escaping."""
    return _write(value, 0, 0)


def json_pretty_text(value: Any) -> str:
    """The indented form the `json` filter without an argument produces: two spaces per level."""
    return _write(value, 2, 0)
