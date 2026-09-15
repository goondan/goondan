"""Interpreter for the closed keyword subset used by `goondan.schema.json`.

The TypeScript host runs the same interpreter over a byte-identical copy of the
schema, so both hosts must produce the same issue code, path, message and order
for the same document. Issues are carried as ``{code, segments, message}`` while
they are collected and are turned into ``{code, path, message}`` objects with an
RFC 6901 JSON Pointer when they are reported.
"""

from __future__ import annotations

import json
import math
import re
from functools import cmp_to_key
from importlib.resources import files
from typing import Any, Iterable, Sequence

Segment = str | int
Issue = dict[str, Any]

SUPPORTED_KEYWORDS = {
    "$schema", "$id", "$comment", "title", "description", "default", "$defs", "$ref",
    "type", "const", "enum", "properties", "required", "additionalProperties", "propertyNames",
    "minProperties", "items", "minItems", "uniqueItems", "minLength", "pattern", "exclusiveMinimum",
    "oneOf", "anyOf", "allOf", "not", "dependentSchemas",
}
_SCHEMA_MAPS = {"$defs", "properties", "dependentSchemas"}
_SCHEMA_ONE = {"additionalProperties", "propertyNames", "items", "not"}
_SCHEMA_LISTS = {"oneOf", "anyOf", "allOf"}
_SHAPE_CODES = {"schema.type", "schema.const", "schema.enum"}

_SCHEMA_CACHE: dict[str, Any] = {}


def schema_text() -> str:
    """The packaged copy of `spec/goondan.schema.json`."""
    if "text" not in _SCHEMA_CACHE:
        _SCHEMA_CACHE["text"] = files("goondan").joinpath("goondan.schema.json").read_text(encoding="utf-8")
    return _SCHEMA_CACHE["text"]


def schema() -> dict[str, Any]:
    if "schema" not in _SCHEMA_CACHE:
        _SCHEMA_CACHE["schema"] = json.loads(schema_text())
    return _SCHEMA_CACHE["schema"]


def unsupported_keywords(node: Any, at: str = "#") -> list[str]:
    """Keyword uses the interpreter does not implement, for the schema sync test."""
    if isinstance(node, bool):
        return []
    if not isinstance(node, dict):
        return [f"{at} is not a schema"]
    problems: list[str] = []
    for key, value in node.items():
        if key not in SUPPORTED_KEYWORDS:
            problems.append(f"{at}/{key}")
        elif key in _SCHEMA_MAPS:
            for name, child in value.items():
                problems.extend(unsupported_keywords(child, f"{at}/{key}/{name}"))
        elif key in _SCHEMA_ONE:
            problems.extend(unsupported_keywords(value, f"{at}/{key}"))
        elif key in _SCHEMA_LISTS:
            for index, child in enumerate(value):
                problems.extend(unsupported_keywords(child, f"{at}/{key}/{index}"))
        elif key == "$ref" and not str(value).startswith("#/"):
            problems.append(f"{at}/$ref is not local")
    return problems


def json_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number" if math.isfinite(value) else "invalid"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "invalid"


def json_equal(left: Any, right: Any) -> bool:
    kind = json_type(left)
    if kind != json_type(right):
        return False
    if kind == "array":
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    if kind == "object":
        return left.keys() == right.keys() and all(json_equal(left[key], right[key]) for key in left)
    return left == right


def pointer(segments: Sequence[Segment]) -> str:
    return "".join("/" + str(segment).replace("~", "~0").replace("/", "~1") for segment in segments)


def issue(code: str, segments: Sequence[Segment], message: str) -> Issue:
    return {"code": code, "segments": list(segments), "message": message}


def _format(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def _resolve_ref(root: Any, ref: str) -> Any:
    node = root
    for raw in ref[2:].split("/"):
        node = node.get(raw.replace("~1", "/").replace("~0", "~")) if isinstance(node, dict) else None
        if node is None:
            raise ValueError(f"unresolvable $ref {ref}")
    return node


def _required_only(branches: Sequence[Any]) -> list[str] | None:
    keys: list[str] = []
    for branch in branches:
        if not isinstance(branch, dict) or len(branch) != 1 or not isinstance(branch.get("required"), list) or len(branch["required"]) != 1:
            return None
        keys.append(branch["required"][0])
    return keys


def _describe(root: Any, branch: Any) -> str:
    node = branch
    while isinstance(node, dict) and "$ref" in node and len(node) == 1:
        node = _resolve_ref(root, node["$ref"])
    if not isinstance(node, dict):
        return "an allowed form"
    if "const" in node:
        return _format(node["const"])
    if "enum" in node:
        return " or ".join(_format(item) for item in node["enum"])
    if node.get("type") == "object" and isinstance(node.get("required"), list) and node["required"]:
        return "{" + ", ".join(node["required"]) + "}"
    if "type" in node:
        return " or ".join(node["type"]) if isinstance(node["type"], list) else node["type"]
    return "an allowed form"


def _unique(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _combine(root: Any, kind: str, branches: Sequence[Any], results: Sequence[list[Issue]], at: list[Segment]) -> list[Issue]:
    keys = _required_only(branches)
    if keys:
        return [issue(f"schema.{kind}", at, f"must declare {'at least' if kind == 'anyOf' else 'exactly'} one of {', '.join(keys)}")]
    here = pointer(at)
    compatible = [
        index for index, errors in enumerate(results)
        if not any(error["code"] in _SHAPE_CODES and pointer(error["segments"]) == here for error in errors)
    ]
    if len(compatible) == 1:
        return list(results[compatible[0]])
    return [issue(f"schema.{kind}", at, "must be " + " or ".join(_unique(_describe(root, branch) for branch in branches)))]


def _check(root: Any, node: Any, value: Any, at: list[Segment]) -> list[Issue]:
    if node is True:
        return []
    if node is False:
        return [issue("schema.false", at, "is not allowed")]
    out: list[Issue] = []
    if "$ref" in node:
        out.extend(_check(root, _resolve_ref(root, node["$ref"]), value, at))
    kind = json_type(value)
    if "type" in node:
        types = node["type"] if isinstance(node["type"], list) else [node["type"]]
        if not any(expected == kind or (expected == "integer" and kind == "number" and float(value).is_integer()) for expected in types):
            out.append(issue("schema.type", at, "must be " + " or ".join(types)))
            return out
    if "const" in node and not json_equal(value, node["const"]):
        out.append(issue("schema.const", at, f"must be {_format(node['const'])}"))
    if "enum" in node and not any(json_equal(value, candidate) for candidate in node["enum"]):
        out.append(issue("schema.enum", at, "must be one of " + ", ".join(_format(item) for item in node["enum"])))
    if kind == "string" and "minLength" in node and len(value) < node["minLength"]:
        out.append(issue("schema.minLength", at, "must not be empty" if node["minLength"] == 1 else f"must contain at least {node['minLength']} characters"))
    if kind == "string" and "pattern" in node and re.search(node["pattern"], value) is None:
        out.append(issue("schema.pattern", at, f"must match {node['pattern']}"))
    if kind == "number" and "exclusiveMinimum" in node and not value > node["exclusiveMinimum"]:
        out.append(issue("schema.exclusiveMinimum", at, f"must be greater than {_format(node['exclusiveMinimum'])}"))
    if kind == "array":
        if "minItems" in node and len(value) < node["minItems"]:
            out.append(issue("schema.minItems", at, "must not be empty" if node["minItems"] == 1 else f"must contain at least {node['minItems']} items"))
        if node.get("uniqueItems") is True:
            for index, item in enumerate(value):
                if any(json_equal(earlier, item) for earlier in value[:index]):
                    out.append(issue("schema.uniqueItems", [*at, index], "duplicates an earlier item"))
        if "items" in node:
            for index, item in enumerate(value):
                out.extend(_check(root, node["items"], item, [*at, index]))
    if kind == "object":
        keys = list(value.keys())
        if "minProperties" in node and len(keys) < node["minProperties"]:
            out.append(issue("schema.minProperties", at, "must not be empty" if node["minProperties"] == 1 else f"must contain at least {node['minProperties']} entries"))
        for name in node.get("required", []):
            if name not in value:
                out.append(issue("schema.required", [*at, name], "is required"))
        for key in keys:
            if "propertyNames" in node:
                bad = _check(root, node["propertyNames"], key, [*at, key])
                if bad:
                    out.extend(issue("schema.propertyNames", [*at, key], error["message"]) for error in bad)
                    continue
            if key in node.get("properties", {}):
                out.extend(_check(root, node["properties"][key], value[key], [*at, key]))
            elif node.get("additionalProperties") is False:
                out.append(issue("schema.additionalProperties", [*at, key], "is not a supported field"))
            elif "additionalProperties" in node:
                out.extend(_check(root, node["additionalProperties"], value[key], [*at, key]))
        for name, dependent in node.get("dependentSchemas", {}).items():
            if name in value:
                out.extend(_check(root, dependent, value, at))
    for branch in node.get("allOf", []):
        out.extend(_check(root, branch, value, at))
    if "anyOf" in node:
        results = [_check(root, branch, value, at) for branch in node["anyOf"]]
        if not any(not errors for errors in results):
            out.extend(_combine(root, "anyOf", node["anyOf"], results, at))
    if "oneOf" in node:
        results = [_check(root, branch, value, at) for branch in node["oneOf"]]
        passing = sum(1 for errors in results if not errors)
        if passing == 0:
            out.extend(_combine(root, "oneOf", node["oneOf"], results, at))
        elif passing > 1:
            keys = _required_only(node["oneOf"])
            out.append(issue("schema.oneOf", at, f"must declare exactly one of {', '.join(keys)}" if keys else "matches more than one allowed form"))
    if "not" in node and not _check(root, node["not"], value, at):
        negated = node["not"]
        out.append(issue("schema.not", at, f"must not be {_format(negated['const'])}" if isinstance(negated, dict) and "const" in negated else "uses a form that is not allowed"))
    return out


def validate(value: Any, at: Sequence[Segment] = ()) -> list[Issue]:
    """Check a composed configuration document against the whole schema."""
    root = schema()
    return _check(root, root, value, list(at))


def validate_definition(name: str, value: Any, at: Sequence[Segment] = ()) -> list[Issue]:
    """Check one value against a `$defs` entry, as the read phase does for extends and resources."""
    root = schema()
    return _check(root, root["$defs"][name], value, list(at))


def json_issues(value: Any, at: Sequence[Segment] = ()) -> list[Issue]:
    """Values that a composed configuration document may not contain."""
    out: list[Issue] = []
    segments = list(at)
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return out
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            out.append(issue("config.not_json", segments, "must be a finite number"))
        return out
    if isinstance(value, list):
        for index, item in enumerate(value):
            out.extend(json_issues(item, [*segments, index]))
        return out
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                out.append(issue("config.not_json", segments, "must use string keys"))
                continue
            out.extend(json_issues(item, [*segments, key]))
        return out
    out.append(issue("config.not_json", segments, f"must be a JSON value, not {type(value).__name__}"))
    return out


def _compare_segments(left: Sequence[Segment], right: Sequence[Segment]) -> int:
    for a, b in zip(left, right):
        if isinstance(a, int) and isinstance(b, int):
            if a != b:
                return -1 if a < b else 1
            continue
        first, second = str(a), str(b)
        if first != second:
            return -1 if first < second else 1
    return len(left) - len(right)


def _compare_issues(left: Issue, right: Issue) -> int:
    """§구성 오류: `path` segment by segment, then `code`. `message` orders nothing."""
    delta = _compare_segments(left["segments"], right["segments"])
    if delta:
        return delta
    if left["code"] != right["code"]:
        return -1 if left["code"] < right["code"] else 1
    return 0


def report(issues: Iterable[Issue]) -> list[dict[str, str]]:
    """§구성 오류: de-duplicate by `path` and `code`, then sort, and render `{code, path, message}`.

    The item a stage produced first survives a duplicate, and `message` is used neither for
    the key nor for the order, so both hosts report the same items in the same order even
    when they word a message differently.
    """
    seen: set[tuple[str, str]] = set()
    kept: list[Issue] = []
    for item in issues:
        key = (pointer(item["segments"]), item["code"])
        if key in seen:
            continue
        seen.add(key)
        kept.append(item)
    return [
        {"code": item["code"], "path": pointer(item["segments"]), "message": item["message"]}
        for item in sorted(kept, key=cmp_to_key(_compare_issues))
    ]


def prefix(issues: Iterable[Issue], at: Sequence[Segment]) -> list[Issue]:
    """Move issues under another document position, as nested configurations need."""
    head = list(at)
    return [issue(item["code"], [*head, *item["segments"]], item["message"]) for item in issues]
