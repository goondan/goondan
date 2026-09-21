"""§파일 합성과 경로 기준 and §YAML 해석."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from goondan import GoondanConfigError, load_config, validate_config
from goondan._yaml import YamlDocumentError, parse_document


def issues_of(error: pytest.ExceptionInfo[GoondanConfigError]) -> list[tuple[str, str]]:
    return [(item["code"], item["path"]) for item in error.value.issues]


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


# --- YAML 1.2 core -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("a: yes\nb: no\nc: on\nd: off\n", {"a": "yes", "b": "no", "c": "on", "d": "off"}),
        ("a: true\nb: TRUE\nc: False\n", {"a": True, "b": True, "c": False}),
        ("a: 012\nb: 0o12\nc: 0x1A\n", {"a": 12, "b": 10, "c": 26}),
        ("a: 1e3\nb: 1.5\n", {"a": 1000.0, "b": 1.5}),
        ("a: 1_000\nb: 1:30\nc: 2024-01-02\n", {"a": "1_000", "b": "1:30", "c": "2024-01-02"}),
        ("a: null\nb: ~\nc:\n", {"a": None, "b": None, "c": None}),
        ("a: !!str 10\n", {"a": "10"}),
        ("<<: &base {x: 1}\nb: *base\n", {"<<": {"x": 1}, "b": {"x": 1}}),
    ],
)
def test_core_schema_scalars(text: str, expected: dict[str, object]):
    assert parse_document(text) == expected


def test_an_alias_is_a_copy_of_the_anchored_value():
    document = parse_document("a: &a {x: 1}\nb: *a\n")
    document["a"]["x"] = 2
    assert document["b"] == {"x": 1}


@pytest.mark.parametrize(
    "text",
    [
        "a: 1\na: 2\n",
        "10: value\n",
        "? [1]\n: value\n",
        "a: !!timestamp 2024-01-02\n",
        "a: !!binary aGk=\n",
        "a: !custom 1\n",
        "a: ! 5\n",
        "a: ! [1]\n",
        "a: !\n  b: 1\n",
        "a: !!str x\nb: ! y\n",
        "%YAML 1.1\n---\na: 1\n",
        "a: 1\n---\nb: 2\n",
        "a: &a [*a]\n",
    ],
)
def test_documents_that_break_the_yaml_rules(text: str):
    with pytest.raises(YamlDocumentError):
        parse_document(text)


def test_alias_expansion_is_counted_as_the_specification_defines():
    allowed = "a: &a [1]\nb: &b [*a, *a]\nc: [" + ", ".join(["*b"] * 32) + "]\n"
    assert len(parse_document(allowed)["c"]) == 32
    too_many = "a: &a [1]\nb: &b [*a, *a]\nc: [" + ", ".join(["*b"] * 33) + "]\n"
    with pytest.raises(YamlDocumentError, match="100 aliases"):
        parse_document(too_many)


@pytest.mark.parametrize(
    "text",
    [
        "agents:\n  main:\n    params:\n      a: &a [1]\n      c: [" + ", ".join(["*a"] * 101) + "]\n",
        "agents:\n  main:\n    params:\n      a: *missing\n",
        "agents:\n  main:\n    params: &p [*p]\n",
    ],
)
def test_an_alias_rule_reports_an_empty_path(tmp_path: Path, text: str):
    """§읽기 오류: only a duplicate key and a non-string key carry a position."""
    write(tmp_path, "goondan.yaml", text)
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.yaml", "")]


def test_the_non_specific_tag_is_an_unsupported_tag(tmp_path: Path):
    """§YAML 해석: `!` is not one of the seven core tags, so `v: ! 5` is a `load.yaml` error."""
    write(tmp_path, "goondan.yaml", "agents:\n  main:\n    params:\n      v: ! 5\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.yaml", "")]


def test_duplicate_and_non_string_keys_report_their_position(tmp_path: Path):
    write(tmp_path, "goondan.yaml", "agents:\n  main:\n    model: a\n    model: b\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.yaml", "/agents/main/model")]

    write(tmp_path, "goondan.yaml", "agents:\n  main:\n    10: a\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.yaml", "/agents/main")]


@pytest.mark.parametrize("text", ["", "# comment only\n", "null\n", "[]\n", '""\n'])
def test_a_document_must_be_an_object(tmp_path: Path, text: str):
    write(tmp_path, "goondan.yaml", text)
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.not_object", "")]


def test_invalid_utf8_is_a_load_error(tmp_path: Path):
    (tmp_path / "goondan.yaml").write_bytes(b"agents: {main: {model: \xff}}\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.yaml", "")]


def test_a_byte_order_mark_is_ignored(tmp_path: Path):
    (tmp_path / "goondan.yaml").write_bytes("﻿agents: {main: {model: m}}\n".encode("utf-8"))
    assert load_config(tmp_path)["agents"]["main"]["model"] == "m"


# --- composition ---------------------------------------------------------------------------


def test_resources_then_own_values_and_key_order(tmp_path: Path):
    write(tmp_path, "extra.yaml", "agents:\n  a: {model: second, tools: [read]}\n")
    write(tmp_path, "goondan.yaml", "name: root\nresources: [extra.yaml]\nagents:\n  b: {model: third}\n  a: {tools: [write]}\n")
    config = load_config(tmp_path)
    assert list(config["agents"]) == ["a", "b"]
    assert config["agents"]["a"] == {"model": "second", "tools": ["write"]}
    assert config["name"] == "root"
    assert "routes" not in config


def test_an_empty_resource_list_composes_nothing(tmp_path: Path):
    write(tmp_path, "goondan.yaml", "resources: []\nagents: {main: {model: m}}\n")
    assert load_config(tmp_path)["agents"] == {"main": {"model": "m"}}


def test_null_replaces_instead_of_deleting(tmp_path: Path):
    write(tmp_path, "base.yaml", "agents: {main: {model: m, params: {a: 1, b: 2}}}\n")
    write(tmp_path, "goondan.yaml", "resources: [base.yaml]\nagents: {main: {params: {a: null}}}\n")
    assert load_config(tmp_path)["agents"]["main"]["params"] == {"a": None, "b": 2}


def test_a_null_field_value_is_a_schema_error(tmp_path: Path):
    write(tmp_path, "goondan.yaml", "name: null\nagents: {main: {model: m}}\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("schema.type", "/name")]


def test_declared_paths_are_normalized_lexically_against_the_declaring_file(tmp_path: Path):
    write(tmp_path, "fragment/goondan.yaml", "agents:\n  main:\n    model: m\n    systemMessage: {template: ../shared/../fragment/system.md}\n")
    write(tmp_path, "fragment/system.md", "hello\n")
    write(tmp_path, "goondan.yaml", "resources: [fragment]\n")
    config = load_config(tmp_path)
    assert config["agents"]["main"]["systemMessage"]["template"] == str(tmp_path / "fragment" / "system.md")


def test_template_keys_inside_params_stay_user_data(tmp_path: Path):
    write(tmp_path, "goondan.yaml", "agents:\n  main:\n    model: m\n    params: {template: notes.md, config: ./x}\n")
    assert load_config(tmp_path)["agents"]["main"]["params"] == {"template": "notes.md", "config": "./x"}


def test_a_symlinked_entry_uses_the_target_directory(tmp_path: Path):
    write(tmp_path, "real/goondan.yaml", "agents: {main: {model: m}}\n")
    link = tmp_path / "link.yaml"
    os.symlink(tmp_path / "real" / "goondan.yaml", link)
    config = load_config(link)
    assert config.directory == str((tmp_path / "real").resolve())


def test_the_same_file_reached_twice_is_a_duplicate_resource(tmp_path: Path):
    write(tmp_path, "shared.yaml", "agents: {main: {model: m}}\n")
    os.symlink(tmp_path / "shared.yaml", tmp_path / "alias.yaml")
    write(tmp_path, "goondan.yaml", "resources: [shared.yaml, alias.yaml]\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.duplicate_resource", "/resources/1")]


def test_a_non_yaml_reference_is_reported(tmp_path: Path):
    write(tmp_path, "notes.txt", "agents: {}\n")
    write(tmp_path, "goondan.yaml", "resources: [notes.txt]\n")
    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert issues_of(error) == [("load.not_yaml", "/resources/0")]


def test_the_yaml_suffix_check_ignores_case(tmp_path: Path):
    write(tmp_path, "Shared.YML", "agents: {main: {model: m}}\n")
    write(tmp_path, "goondan.yaml", "resources: [Shared.YML]\n")
    assert load_config(tmp_path)["agents"]["main"]["model"] == "m"


# --- API contracts -------------------------------------------------------------------------


def test_validate_config_rejects_composition_fields():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"extends": "base.yaml", "resources": [], "agents": {"main": {"model": "m"}}})
    assert issues_of(error) == [("schema.additionalProperties", "/extends"), ("schema.additionalProperties", "/resources")]


def test_validating_an_effective_config_again_returns_the_same_document():
    once = validate_config({"agents": {"a": {"model": "m"}, "b": {"inherit": "a"}}, "routes": ["a", "b"]})
    assert dict(validate_config(once)) == dict(once)
    assert once["routes"] == [
        {"from": "$input", "to": "a"},
        {"from": "a", "to": "b"},
        {"from": "b", "to": "$output"},
    ]


def test_the_exception_message_lists_every_issue():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"unknown": 1, "agents": {"main": {"model": "m", "extra": 2}}})
    assert str(error.value) == (
        "Invalid Goondan configuration:\n"
        "- /agents/main/extra: is not a supported field [schema.additionalProperties]\n"
        "- /unknown: is not a supported field [schema.additionalProperties]"
    )


def test_a_schema_error_stops_the_reference_phase():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"main": {"model": "m", "extra": 1, "tools": [{"agent": "missing"}]}}})
    assert issues_of(error) == [("schema.additionalProperties", "/agents/main/extra")]
