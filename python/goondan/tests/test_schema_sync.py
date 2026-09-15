from __future__ import annotations

from pathlib import Path

from goondan import _schema

SPEC_SCHEMA = Path(__file__).resolve().parents[3] / "spec" / "goondan.schema.json"


def test_packaged_schema_is_a_byte_copy_of_the_specification():
    assert _schema.schema_text() == SPEC_SCHEMA.read_text(encoding="utf-8")


def test_schema_uses_only_keywords_the_interpreter_implements():
    assert _schema.unsupported_keywords(_schema.schema()) == []


def test_json_equality_follows_json_types():
    assert _schema.json_equal(1.0, 1)
    assert not _schema.json_equal(True, 1)
    assert not _schema.json_equal("1", 1)
    assert _schema.json_equal({"a": [1, {"b": None}]}, {"a": [1.0, {"b": None}]})


def test_issues_are_sorted_by_position_then_code():
    issues = [
        _schema.issue("schema.type", ["flow", 10], "b"),
        _schema.issue("schema.type", ["flow", 2], "a"),
        _schema.issue("schema.type", ["flow"], "a"),
        _schema.issue("schema.const", ["flow"], "a"),
        _schema.issue("schema.const", ["flow"], "a"),
    ]
    assert [(item["code"], item["path"]) for item in _schema.report(issues)] == [
        ("schema.const", "/flow"),
        ("schema.type", "/flow"),
        ("schema.type", "/flow/2"),
        ("schema.type", "/flow/10"),
    ]
