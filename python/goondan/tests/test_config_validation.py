"""§에이전트, §확장과 상속 and the reference and binding phases of §검증 단계."""

from __future__ import annotations

from pathlib import Path

import pytest

from goondan import (
    Extension,
    GoondanConfigError,
    create_goondan,
    define_extension,
    define_tool,
    load_config,
    validate_config,
)


def issues_of(error: pytest.ExceptionInfo[GoondanConfigError]) -> list[tuple[str, str]]:
    return [(item["code"], item["path"]) for item in error.value.issues]


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def noop_model(value):
    return None


# --- inheritance and removal ---------------------------------------------------------------


def test_the_specification_inheritance_example():
    config = validate_config({"agents": {
        "base": {
            "model": "main",
            "tools": ["search", "write"],
            "extensions": {"audit": {}, "memory": {}},
            "hooks": {"modelInput": [{"name": "trim-context", "fn": "trimContext"}], "output": [{"extension": "audit"}]},
        },
        "reader": {"inherit": "base", "remove": {"tools": ["write"], "extensions": ["audit"], "hooks": {"modelInput": ["trim-context"]}}},
    }})
    assert config["agents"]["reader"] == {
        "model": "main",
        "tools": ["search"],
        "extensions": {"memory": {}},
        "hooks": {"modelInput": [], "output": []},
    }
    assert config["agents"]["base"]["tools"] == ["search", "write"]


def test_remove_never_creates_keys_that_were_absent():
    config = validate_config({"agents": {"a": {"model": "m", "remove": {"tools": [], "extensions": [], "hooks": {"output": ["x"]}}}}})
    assert config["agents"]["a"] == {"model": "m"}


def test_remove_applies_to_the_agents_own_declarations():
    config = validate_config({"agents": {"a": {"model": "m", "tools": ["read", {"agent": "b"}], "remove": {"tools": ["read", "b"]}}, "b": {"model": "m"}}})
    assert config["agents"]["a"]["tools"] == []


def test_hook_identifiers_follow_the_declared_field_order():
    config = validate_config({"agents": {
        "base": {
            "model": "main",
            "extensions": {"memory": {}},
            "hooks": {
                "input": [{"agent": ["x", "y"]}],
                "output": [{"agent": "helper"}],
                "modelInput": [{"name": "ctx", "extension": "memory"}],
            },
        },
        "x": {"model": "main"}, "y": {"model": "main"}, "helper": {"model": "main"},
        "child": {"inherit": "base", "remove": {"hooks": {"input": ["x+y"], "output": ["helper"], "modelInput": ["memory"]}}},
    }})
    child = config["agents"]["child"]["hooks"]
    assert child["input"] == [] and child["output"] == []
    assert child["modelInput"] == [{"name": "ctx", "extension": "memory"}]


def test_a_template_hook_identifier_is_relative_to_the_config_directory(tmp_path: Path):
    write(tmp_path, "shared/note.md", "note\n")
    write(tmp_path, "shared/base.yaml", "agents:\n  base:\n    model: m\n    hooks:\n      output: [{template: note.md}]\n")
    write(tmp_path, "goondan.yaml", "resources: [shared/base.yaml]\nagents:\n  child: {inherit: base, remove: {hooks: {output: [shared/note.md]}}}\n")
    config = load_config(tmp_path)
    assert config["agents"]["base"]["hooks"]["output"] == [{"template": str(tmp_path / "shared" / "note.md")}]
    assert config["agents"]["child"]["hooks"]["output"] == []


def test_a_child_that_re_enables_an_extension_keeps_the_parents_hooks():
    config = validate_config({"agents": {
        "base": {"model": "main", "extensions": {"memo": {"enabled": False}}, "hooks": {"modelInput": [{"extension": "memo"}]}},
        "child": {"inherit": "base", "extensions": {"memo": {"enabled": True}}},
    }})
    assert config["agents"]["base"]["hooks"]["modelInput"] == []
    assert config["agents"]["child"]["hooks"]["modelInput"] == [{"extension": "memo"}]


def test_a_removed_extension_does_not_come_back():
    config = validate_config({"agents": {
        "base": {"model": "main", "extensions": {"memo": {}}, "hooks": {"modelInput": [{"extension": "memo"}]}},
        "child": {"inherit": "base", "remove": {"extensions": ["memo"]}, "extensions": {"memo": {}}},
    }})
    assert config["agents"]["child"]["hooks"]["modelInput"] == []


def test_inheritance_cycles_are_reported_once_at_the_first_declared_member():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"inherit": "b"}, "b": {"inherit": "c"}, "c": {"inherit": "a"}, "d": {"inherit": "c"}}})
    assert issues_of(error) == [("reference.inherit_cycle", "/agents/a/inherit")]


def test_agents_that_cannot_resolve_skip_every_other_reference_check():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"inherit": "missing"}, "b": {"inherit": "a", "tools": [{"agent": "nope"}]}}})
    assert issues_of(error) == [("reference.inherit", "/agents/a/inherit")]


def test_inheritance_can_break_the_schema():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m", "systemMessage": {"text": "a"}}, "b": {"inherit": "a", "systemMessage": {"template": "t.md"}}}})
    assert issues_of(error) == [("schema.oneOf", "/agents/b/systemMessage")]


# --- reference phase -----------------------------------------------------------------------


def test_duplicate_tool_names_are_reported_at_each_later_entry():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m", "tools": ["read", {"tool": "read"}, {"agent": "read"}]}}})
    assert issues_of(error) == [
        ("reference.duplicate_tool", "/agents/a/tools/1"),
        ("reference.duplicate_tool", "/agents/a/tools/2"),
        ("reference.agent", "/agents/a/tools/2/agent"),
    ]


def test_unknown_hook_extensions_and_agents_are_reported():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m", "hooks": {"output": [{"extension": "gone"}, {"agent": ["a", "nope"]}]}}}})
    assert issues_of(error) == [
        ("reference.extension", "/agents/a/hooks/output/0/extension"),
        ("reference.agent", "/agents/a/hooks/output/1/agent/1"),
    ]


def test_hooks_of_disabled_extensions_are_not_reference_errors():
    validate_config({"agents": {"a": {"model": "m", "extensions": {"memo": {"enabled": False}}, "hooks": {"output": [{"extension": "memo"}]}}}})


def test_duplicate_async_conversation_hooks_are_rejected():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m", "hooks": {"conversation": [
            {"fn": "note", "mode": "async"},
            {"fn": "note", "mode": "async"},
            {"fn": "note"},
        ]}}}})
    assert issues_of(error) == [("reference.duplicate_hook", "/agents/a/hooks/conversation/1")]


def test_route_references_use_the_composed_document_position():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m"}}, "routes": [{"from": "$input", "to": "gone"}]})
    assert issues_of(error) == [
        ("routes.no_input", "/routes"),
        ("routes.no_output", "/routes"),
        ("reference.agent", "/routes/0/to"),
    ]


@pytest.mark.parametrize(
    ("routes", "expected"),
    [
        (["gone"], [
            ("routes.no_input", "/routes"),
            ("routes.no_output", "/routes"),
            ("reference.agent", "/routes/0"),
        ]),
        (["a", "gone"], [
            ("routes.no_output", "/routes"),
            ("routes.no_route", "/routes/0/to"),
            ("reference.agent", "/routes/1"),
        ]),
    ],
)
def test_serial_route_references_are_excluded_before_structure_validation(routes: list[str], expected: list[tuple[str, str]]):
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m"}}, "routes": routes})
    assert issues_of(error) == expected


# --- binding phase -------------------------------------------------------------------------


def test_every_missing_binding_is_reported_together():
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(
            config={
                "agents": {"a": {"model": "gone", "input": {"fn": "shape"}, "tools": ["search"], "hooks": {"output": [{"fn": "polish"}, {"name": "gate", "fn": "gate", "when": {"fn": "ready"}}]}}},
                "routes": [{"from": "$input", "to": "a"}, {"from": "a", "to": "$output", "when": {"fn": "done"}}],
            },
            models={},
        )
    assert issues_of(error) == [
        ("binding.function", "/agents/a/hooks/output/0/fn"),
        ("binding.function", "/agents/a/hooks/output/1/fn"),
        ("binding.function", "/agents/a/hooks/output/1/when/fn"),
        ("binding.function", "/agents/a/input/fn"),
        ("binding.model", "/agents/a/model"),
        ("binding.tool", "/agents/a/tools/0"),
        ("binding.function", "/routes/1/when/fn"),
    ]


def test_declared_extension_stages_ports_and_tools_are_checked():
    memo = define_extension(name="memo", create=lambda **_: Extension(), hooks=["modelInput"], tools=["recall"], requires=["db"])
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(
            config={"agents": {"a": {"model": "m", "extensions": {"memo": {}, "unknown": {}}, "hooks": {"output": [{"extension": "memo"}]}}}},
            models={"m": noop_model}, extensions={"memo": memo},
        )
    assert issues_of(error) == [
        ("binding.port", "/agents/a/extensions/memo"),
        ("binding.extension", "/agents/a/extensions/unknown"),
        ("binding.extension_hook", "/agents/a/hooks/output/0/extension"),
    ]


def test_a_tool_name_two_implementations_provide_is_a_binding_error():
    memo = define_extension(name="memo", create=lambda **_: Extension(), tools=["search"])
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(
            config={"agents": {"a": {"model": "m", "extensions": {"memo": {}}, "tools": ["search"]}}},
            models={"m": noop_model}, extensions={"memo": memo},
            tools={"search": define_tool(name="search", description="s", input={}, execute=lambda value, ctx: None)},
        )
    assert issues_of(error) == [("binding.duplicate_tool", "/agents/a/tools/0")]


def test_an_extension_without_a_declared_tool_list_defers_the_tool_check():
    memo = define_extension(name="memo", create=lambda **_: Extension(tools=[define_tool(name="search", description="s", input={}, execute=lambda value, ctx: None)]))
    create_goondan(config={"agents": {"a": {"model": "m", "extensions": {"memo": {}}, "tools": ["search"]}}}, models={"m": noop_model}, extensions={"memo": memo})


@pytest.mark.asyncio
async def test_an_instance_that_does_not_provide_a_hooked_stage_fails_the_turn():
    memo = define_extension(name="memo", create=lambda **_: Extension(hooks={"output": lambda value, ctx: value}))
    runtime = create_goondan(
        config={"agents": {"a": {"model": "m", "extensions": {"memo": {}}, "hooks": {"modelInput": [{"extension": "memo"}]}}}},
        models={"m": noop_model}, extensions={"memo": memo},
    )
    with pytest.raises(GoondanConfigError) as error:
        await runtime.run("input", session_id="instance")
    assert issues_of(error) == [("binding.extension_hook", "/agents/a/hooks/modelInput/0/extension")]


# --- issue order and duplicates -------------------------------------------------------------


def test_issues_are_ordered_by_path_then_code_and_never_by_message():
    """§구성 오류: array positions compare as numbers, a shorter path comes first, then `code`."""
    from goondan._schema import issue, report

    collected = [
        issue("b.code", ["agents", "main", "tools", 10], "zzz"),
        issue("a.code", ["agents", "main", "tools", 2], "aaa"),
        issue("b.code", ["agents", "main"], "mmm"),
        issue("a.code", ["agents", "main"], "zzz"),
        issue("a.code", ["agents", "main", "hooks"], "aaa"),
    ]
    assert [(item["code"], item["path"]) for item in report(collected)] == [
        ("a.code", "/agents/main"),
        ("b.code", "/agents/main"),
        ("a.code", "/agents/main/hooks"),
        ("a.code", "/agents/main/tools/2"),
        ("b.code", "/agents/main/tools/10"),
    ]


def test_duplicates_use_only_the_path_and_the_code_and_keep_the_first_item():
    """§구성 오류: `message` is used neither for the key nor for the order."""
    from goondan._schema import issue, report

    collected = [
        issue("same", ["agents", "main"], "first wording"),
        issue("same", ["agents", "main"], "another wording"),
        issue("same", ["agents", "other"], "first wording"),
    ]
    assert report(collected) == [
        {"code": "same", "path": "/agents/main", "message": "first wording"},
        {"code": "same", "path": "/agents/other", "message": "first wording"},
    ]
