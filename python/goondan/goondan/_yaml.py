"""YAML 1.2 core parsing for Goondan configuration files.

The TypeScript host reads the same files with the YAML 1.2 core schema, so the
Python host cannot use PyYAML's YAML 1.1 defaults. This module builds a
SafeLoader subclass with the core resolvers and constructors, rejects the tags
and shapes the specification forbids, counts alias expansions, and reports every
violation as a single `load.yaml` issue with a JSON Pointer into the document.
"""

from __future__ import annotations

import re
from typing import Any, Sequence

import yaml
from yaml.composer import ComposerError
from yaml.constructor import ConstructorError
from yaml.events import AliasEvent, CollectionStartEvent, MappingEndEvent, ScalarEvent, SequenceEndEvent, SequenceStartEvent
from yaml.nodes import MappingNode, ScalarNode, SequenceNode

from ._schema import Segment

ALIAS_LIMIT = 100

_BOOL = re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$")
_NULL = re.compile(r"^(?:~|null|Null|NULL|)$")
_INT = re.compile(r"^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$")
_FLOAT = re.compile(
    r"^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?"
    r"|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"
)

_STR_TAG = "tag:yaml.org,2002:str"


class YamlDocumentError(Exception):
    """A violation of the YAML rules, carrying the position inside the document."""

    def __init__(self, message: str, segments: Sequence[Segment] = ()):
        super().__init__(message)
        self.message = message
        self.segments = list(segments)


class _CoreLoader(yaml.SafeLoader):
    def __init__(self, stream: str):
        super().__init__(stream)
        self._path: list[Segment] = []
        self._alias_total = 0
        self._anchor_weight: dict[str, int] = {}
        self._open_anchors: set[str] = set()
        self._frames: list[list[Any]] = []

    # %YAML must be absent or 1.2.
    def process_directives(self):  # type: ignore[no-untyped-def]
        value = super().process_directives()
        if self.yaml_version is not None and tuple(self.yaml_version) != (1, 2):
            raise YamlDocumentError("only the %YAML 1.2 directive is supported")
        return value

    def compose_node(self, parent, index):  # type: ignore[no-untyped-def]
        if self.check_event(AliasEvent):
            # §읽기 오류: only a duplicate key and a non-string key carry a position; every other
            # YAML rule, an alias included, reports `load.yaml` with an empty path.
            event = self.get_event()
            anchor = event.anchor
            if anchor not in self.anchors:
                raise YamlDocumentError(f"alias '{anchor}' has no anchor")
            if anchor in self._open_anchors:
                raise YamlDocumentError(f"alias '{anchor}' refers to a value that contains it")
            cost = 1 + self._anchor_weight.get(anchor, 0)
            self._alias_total += cost
            for frame in self._frames:
                frame[1] += cost
            if self._alias_total > ALIAS_LIMIT:
                raise YamlDocumentError(f"a document may expand at most {ALIAS_LIMIT} aliases")
            return self.anchors[anchor]
        event = self.peek_event()
        # §YAML 해석: only the seven core tags are supported, so the non-specific tag `!` that
        # `v: ! 5` writes is an unsupported tag rather than a request to resolve the scalar.
        if isinstance(event, (ScalarEvent, CollectionStartEvent)) and event.tag == "!":
            raise YamlDocumentError("the non-specific tag ! is not part of the YAML core schema")
        anchor = event.anchor
        self.descend_resolver(parent, index)
        if self.check_event(ScalarEvent):
            node = self.compose_scalar_node(anchor)
            if anchor is not None:
                self._anchor_weight[anchor] = 0
        elif self.check_event(SequenceStartEvent):
            node = self.compose_sequence_node(anchor)
        else:
            node = self.compose_mapping_node(anchor)
        self.ascend_resolver()
        return node

    def _enter(self, anchor: str | None) -> list[Any]:
        frame: list[Any] = [anchor, 0]
        self._frames.append(frame)
        if anchor is not None:
            self._open_anchors.add(anchor)
        return frame

    def _leave(self, frame: list[Any]) -> None:
        self._frames.pop()
        anchor = frame[0]
        if anchor is not None:
            self._open_anchors.discard(anchor)
            self._anchor_weight[anchor] = frame[1]

    def compose_sequence_node(self, anchor):  # type: ignore[no-untyped-def]
        start = self.get_event()
        tag = start.tag
        if tag is None or tag == "!":
            tag = self.resolve(SequenceNode, None, start.implicit)
        node = SequenceNode(tag, [], start.start_mark, None, flow_style=start.flow_style)
        if anchor is not None:
            self.anchors[anchor] = node
        frame = self._enter(anchor)
        index = 0
        while not self.check_event(SequenceEndEvent):
            self._path.append(index)
            node.value.append(self.compose_node(node, index))
            self._path.pop()
            index += 1
        self._leave(frame)
        node.end_mark = self.get_event().end_mark
        return node

    def compose_mapping_node(self, anchor):  # type: ignore[no-untyped-def]
        start = self.get_event()
        tag = start.tag
        if tag is None or tag == "!":
            tag = self.resolve(MappingNode, None, start.implicit)
        node = MappingNode(tag, [], start.start_mark, None, flow_style=start.flow_style)
        if anchor is not None:
            self.anchors[anchor] = node
        frame = self._enter(anchor)
        seen: set[str] = set()
        while not self.check_event(MappingEndEvent):
            key_node = self.compose_node(node, None)
            key = key_node.value if isinstance(key_node, ScalarNode) and key_node.tag == _STR_TAG else None
            if key is None:
                raise YamlDocumentError("mapping keys must be strings", self._path)
            if key in seen:
                raise YamlDocumentError(f"duplicate mapping key {key!r}", [*self._path, key])
            seen.add(key)
            self._path.append(key)
            node.value.append((key_node, self.compose_node(node, key_node)))
            self._path.pop()
        self._leave(frame)
        node.end_mark = self.get_event().end_mark
        return node


def _scalar(loader: _CoreLoader, node: ScalarNode, pattern: re.Pattern[str], kind: str) -> str:
    text = loader.construct_scalar(node)
    if not isinstance(text, str) or pattern.match(text) is None:
        raise YamlDocumentError(f"{text!r} is not a {kind}", loader._path)
    return text


def _construct_null(loader: _CoreLoader, node: ScalarNode) -> None:
    _scalar(loader, node, _NULL, "null value")
    return None


def _construct_bool(loader: _CoreLoader, node: ScalarNode) -> bool:
    return _scalar(loader, node, _BOOL, "boolean").lower() == "true"


def _construct_int(loader: _CoreLoader, node: ScalarNode) -> int:
    text = _scalar(loader, node, _INT, "integer")
    sign = -1 if text.startswith("-") else 1
    body = text[1:] if text[:1] in "+-" else text
    if body.startswith("0o"):
        return sign * int(body[2:], 8)
    if body.startswith("0x"):
        return sign * int(body[2:], 16)
    return sign * int(body, 10)


def _construct_float(loader: _CoreLoader, node: ScalarNode) -> float:
    text = _scalar(loader, node, _FLOAT, "number")
    lowered = text.lower()
    if lowered.endswith(".inf"):
        return float("-inf") if lowered.startswith("-") else float("inf")
    if lowered.endswith(".nan"):
        return float("nan")
    return float(text)


def _construct_str(loader: _CoreLoader, node: ScalarNode) -> str:
    return loader.construct_scalar(node)


def _construct_seq(loader: _CoreLoader, node: SequenceNode) -> list[Any]:
    if not isinstance(node, SequenceNode):
        raise YamlDocumentError("!!seq requires a sequence", loader._path)
    return loader.construct_sequence(node)


def _construct_map(loader: _CoreLoader, node: MappingNode) -> dict[str, Any]:
    if not isinstance(node, MappingNode):
        raise YamlDocumentError("!!map requires a mapping", loader._path)
    return loader.construct_mapping(node)


def _construct_unknown(loader: _CoreLoader, node: Any) -> Any:
    raise YamlDocumentError(f"tag {node.tag} is not part of the YAML core schema", loader._path)


_CoreLoader.yaml_implicit_resolvers = {}
_CoreLoader.add_implicit_resolver("tag:yaml.org,2002:bool", _BOOL, list("tTfF"))
_CoreLoader.add_implicit_resolver("tag:yaml.org,2002:int", _INT, list("-+0123456789"))
_CoreLoader.add_implicit_resolver("tag:yaml.org,2002:float", _FLOAT, list("-+.0123456789"))
_CoreLoader.add_implicit_resolver("tag:yaml.org,2002:null", _NULL, ["~", "n", "N", ""])

_CoreLoader.yaml_constructors = {
    "tag:yaml.org,2002:null": _construct_null,
    "tag:yaml.org,2002:bool": _construct_bool,
    "tag:yaml.org,2002:int": _construct_int,
    "tag:yaml.org,2002:float": _construct_float,
    _STR_TAG: _construct_str,
    "tag:yaml.org,2002:seq": _construct_seq,
    "tag:yaml.org,2002:map": _construct_map,
    None: _construct_unknown,
}
_CoreLoader.yaml_multi_constructors = {}


def _unshare(value: Any) -> Any:
    """Turn every alias into its own copy, as the specification requires."""
    if isinstance(value, dict):
        return {key: _unshare(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_unshare(item) for item in value]
    return value


def parse_document(text: str) -> Any:
    """Parse one YAML 1.2 core document, raising `YamlDocumentError` on any violation."""
    loader = _CoreLoader(text)
    try:
        if not loader.check_node():
            return None
        node = loader.get_node()
        if loader.check_node():
            raise YamlDocumentError("a configuration file must contain exactly one YAML document")
        return _unshare(loader.construct_document(node))
    except YamlDocumentError:
        raise
    except (ComposerError, ConstructorError) as error:
        raise YamlDocumentError(str(error.problem or error)) from error
    except yaml.YAMLError as error:
        raise YamlDocumentError(_syntax_message(error)) from error
    finally:
        loader.dispose()


def _syntax_message(error: yaml.YAMLError) -> str:
    problem = getattr(error, "problem", None)
    mark = getattr(error, "problem_mark", None)
    if problem and mark is not None:
        return f"{problem} at line {mark.line + 1}, column {mark.column + 1}"
    return str(error) or "the file is not valid YAML"
