"""Normalization of the actual document before it is compared.

The four steps are the ones the README lists: the case directory becomes `<case>`,
message `id` keys are dropped, operation identifiers become operation aliases and turn
identifiers become `<turn:N>`. String substitution applies to object keys and to string
values, and replaces a part of a string as well.
"""

from __future__ import annotations

from typing import Any, Callable, Iterator, Mapping, Sequence

SECTION_ORDER = (
    "effectiveConfig", "events", "modelInputs", "modelContexts", "toolCalls", "toolContexts",
    "functionCalls", "hookCalls", "hookContexts", "hostCalls", "extensionLog", "conversations",
    "operations", "operationHistory",
)


def is_message(value: Any) -> bool:
    return isinstance(value, Mapping) and "role" in value and "content" in value


def walk_strings(value: Any) -> Iterator[str]:
    """Yield every string of `value`: array items in order, object keys in code point order."""
    if isinstance(value, Mapping):
        for key in sorted(value):
            yield key
            yield from walk_strings(value[key])
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, str):
        yield value


def document_strings(document: Mapping[str, Any]) -> Iterator[str]:
    """Yield the document's strings in the traversal order that numbers the turns."""
    yield from walk_strings(document.get("steps", []))
    observations = document.get("observations", {})
    for section in SECTION_ORDER:
        if section in observations:
            yield from walk_strings(observations[section])


def substitute(value: Any, replace: Callable[[str], str]) -> Any:
    if isinstance(value, Mapping):
        return {replace(key): substitute(item, replace) for key, item in value.items()}
    if isinstance(value, list):
        return [substitute(item, replace) for item in value]
    if isinstance(value, str):
        return replace(value)
    return value


def replacer(mapping: Mapping[str, str]) -> Callable[[str], str]:
    """Build a substitution that replaces the longest known text first."""
    pairs = sorted(mapping.items(), key=lambda pair: (-len(pair[0]), pair[0]))

    def replace(text: str) -> str:
        for original, replacement in pairs:
            if original:
                text = text.replace(original, replacement)
        return text

    return replace


def message_ids(value: Any) -> Iterator[Any]:
    """Yield the `id` of every message, or `None` when the message has none."""
    if isinstance(value, Mapping):
        if is_message(value):
            yield value.get("id")
        for item in value.values():
            yield from message_ids(item)
    elif isinstance(value, list):
        for item in value:
            yield from message_ids(item)


def strip_message_ids(value: Any) -> Any:
    if isinstance(value, Mapping):
        stripped = {key: strip_message_ids(item) for key, item in value.items() if not (key == "id" and is_message(value))}
        return stripped
    if isinstance(value, list):
        return [strip_message_ids(item) for item in value]
    return value


def collect_turn_ids(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, Mapping):
        candidate = value.get("turnId")
        if isinstance(candidate, str) and candidate:
            found.add(candidate)
        for item in value.values():
            found |= collect_turn_ids(item)
    elif isinstance(value, list):
        for item in value:
            found |= collect_turn_ids(item)
    return found


def turn_aliases(document: Mapping[str, Any]) -> dict[str, str]:
    """Number turn identifiers from 1 in the order they first appear in the document."""
    identifiers = collect_turn_ids(document)
    order: list[str] = []
    for text in document_strings(document):
        hits = sorted((text.find(identifier), identifier) for identifier in identifiers if identifier in text)
        for _, identifier in hits:
            if identifier not in order:
                order.append(identifier)
    return {identifier: f"<turn:{index + 1}>" for index, identifier in enumerate(order)}


def normalize_document(document: Mapping[str, Any], *, case_paths: Sequence[str], operation_aliases: Mapping[str, str]) -> dict[str, Any]:
    result: Any = substitute(document, replacer({path: "<case>" for path in case_paths if path}))
    result = strip_message_ids(result)
    result = substitute(result, replacer(dict(operation_aliases)))
    result = substitute(result, replacer(turn_aliases(result)))
    return result
