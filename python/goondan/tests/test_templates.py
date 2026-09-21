"""§템플릿 지원 범위: the common grammar, the include closure, value rules and the render function."""

from __future__ import annotations

from pathlib import Path

import pytest

from goondan import GoondanConfigError, GoondanError, create_goondan, load_config


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def config_for(template: str = "templates/main.md", params: dict | None = None) -> dict:
    agent: dict = {"model": "m", "systemMessage": {"template": template}}
    if params is not None:
        agent["params"] = params
    return {"agents": {"main": agent}}


def runtime_for(root: Path, template: str = "templates/main.md"):
    return create_goondan(config=config_for(template), models={"m": lambda value: None}, directory=str(root))


def render(root: Path, source: str, variables: dict | None = None, name: str = "templates/main.md") -> str:
    write(root, name, source)
    return runtime_for(root, name).render(name, variables or {})


def issues(root: Path, source: str | None = None, name: str = "templates/main.md") -> list[tuple[str, str, str]]:
    if source is not None:
        write(root, name, source)
    with pytest.raises(GoondanConfigError) as error:
        runtime_for(root, name)
    return [(item["code"], item["path"], item["message"]) for item in error.value.issues]


def fails(root: Path, source: str, variables: dict | None = None) -> str:
    write(root, "templates/main.md", source)
    runtime = runtime_for(root)
    with pytest.raises(GoondanError) as error:
        runtime.render("templates/main.md", variables or {})
    return str(error.value)


# --- tags and whitespace --------------------------------------------------------------------


def test_a_for_body_drops_the_newline_after_each_tag_and_the_indent_before_it(tmp_path: Path):
    source = "{% for name in params.names %}\n- {{ name }}\n{% endfor %}"
    assert render(tmp_path, source, {"params": {"names": ["a", "b"]}}) == "- a\n- b\n"
    indented = "{% for name in params.names %}\n  {% if name %}{{ name }}\n  {% endif %}\n{% endfor %}"
    assert render(tmp_path, indented, {"params": {"names": ["a"]}}) == "a\n"


def test_output_tags_keep_the_surrounding_whitespace_and_the_final_newline(tmp_path: Path):
    assert render(tmp_path, "  {{ params.a }}\nend\n", {"params": {"a": "x"}}) == "  x\nend\n"


def test_comments_are_not_printed_and_are_not_checked(tmp_path: Path):
    assert render(tmp_path, "a{# {% set x %} {{ 1 ~ 2 }} #}b", {}) == "ab"
    assert render(tmp_path, "  {# note #}\nb", {}) == "b"


def test_carriage_returns_and_a_leading_byte_order_mark_are_removed(tmp_path: Path):
    write(tmp_path, "templates/main.md", "")
    (tmp_path / "templates" / "main.md").write_bytes("\ufeffa\r\nb\rc".encode("utf-8"))
    assert runtime_for(tmp_path).render("templates/main.md", {}) == "a\nb\nc"


def test_minus_markers_strip_whitespace_and_plus_markers_are_a_syntax_error(tmp_path: Path):
    assert render(tmp_path, "a\n  {%- if true %}b{% endif %}", {}) == "ab"
    assert render(tmp_path, "{% if true -%}\n  b{% endif %}", {}) == "b"
    assert render(tmp_path, "a  {{- 1 -}}  b", {}) == "a1b"
    assert render(tmp_path, "a  {#- note -#}  b", {}) == "ab"
    assert issues(tmp_path, "{%+ if true %}b{% endif %}") == [
        ("template.syntax", "/agents/main/systemMessage/template", "templates/main.md has invalid syntax"),
    ]
    for source in ["{{+ params.a }}", "{% if true +%}b{% endif %}", "{#+ note #}", "{# note +#}"]:
        assert issues(tmp_path, source)[0][0] == "template.syntax", source


def test_literal_delimiters_are_printed_through_a_string_literal(tmp_path: Path):
    assert render(tmp_path, '{{ "{{" }}{{ "{%" }}', {}) == "{{{%"


@pytest.mark.parametrize("tag", ["set", "with", "raw", "verbatim", "autoescape", "macro", "call", "block", "extends", "import", "from", "filter", "elseif"])
def test_every_tag_outside_the_table_is_unsupported(tmp_path: Path, tag: str):
    found = issues(tmp_path, "{%% %s %%}" % tag)
    assert found == [("template.unsupported", "/agents/main/systemMessage/template", f"templates/main.md uses unsupported syntax: tag {tag}")]


def test_unsupported_tag_names_are_listed_once_in_code_point_order(tmp_path: Path):
    found = issues(tmp_path, "{% set a = 1 %}{% raw %}x{% endraw %}{% set b = 2 %}")
    assert found[0][2] == "templates/main.md uses unsupported syntax: tag raw, tag set"


def test_a_syntax_error_hides_the_filter_and_test_check(tmp_path: Path):
    found = issues(tmp_path, "{{ params.a | reverse(params.b) }}{{ params.c is odd }}")
    assert found == [("template.syntax", "/agents/main/systemMessage/template", "templates/main.md has invalid syntax")]


def test_a_tag_name_error_hides_the_include_check(tmp_path: Path):
    found = issues(tmp_path, "{% include '../escape.md' %}{% set a = 1 %}")
    assert found[0][2] == "templates/main.md uses unsupported syntax: tag set"


def test_a_tag_name_error_hides_the_filter_and_test_check(tmp_path: Path):
    found = issues(tmp_path, "{% set a = 1 %}{{ params.a | reverse }}")
    assert found[0][2] == "templates/main.md uses unsupported syntax: tag set"


@pytest.mark.parametrize("source", [
    "{% if true %}a",
    "{% for x in params.a %}{% else %}b{% endfor %}",
    "{% for x in params.a if x %}{% endfor %}",
    "{% for x in params.a recursive %}{% endfor %}",
    "{% for a, b in params.a %}{% endfor %}",
    "{{ params.a ",
    "{% if true %}a{% endfor %}",
    "{# open",
])
def test_malformed_supported_tags_are_a_syntax_error(tmp_path: Path, source: str):
    assert issues(tmp_path, source)[0][0] == "template.syntax"


@pytest.mark.parametrize("source", [
    "{{ 012 }}",
    "{{ 00 }}",
    "{{ 01.5 }}",
    "{{ -012 }}",
    "{{ params.list.0 }}",
    "{{ params.list . 0 }}",
    "{{ params.list.0.name }}",
    "{% if params.list.0 %}x{% endif %}",
    "{% for item in params.list.0 %}{% endfor %}",
])
def test_leading_zero_numbers_and_numeric_key_access_are_a_syntax_error(tmp_path: Path, source: str):
    """§식: an integer literal never starts with `0`, and `.` takes a name, never a number."""
    assert issues(tmp_path, source) == [
        ("template.syntax", "/agents/main/systemMessage/template", "templates/main.md has invalid syntax"),
    ]


def test_an_array_item_is_read_with_a_bracket_index(tmp_path: Path):
    """§식: `{{ a[0] }}` is the supported spelling that `{{ a.0 }}` is rejected in favour of."""
    source = "{{ params.list[0] }}{{ 12 }}|{{ 0 }}|{{ 0.5 }}|{{ -0.5 }}"
    assert render(tmp_path, source, {"params": {"list": ["z", "y"]}}) == "z12|0|0.5|-0.5"


def test_if_elif_else_pick_the_first_true_branch(tmp_path: Path):
    source = "{% if params.n == 1 %}A{% elif params.n == 2 %}B{% else %}C{% endif %}"
    assert render(tmp_path, source, {"params": {"n": 2}}) == "B"
    assert render(tmp_path, source, {"params": {"n": 3}}) == "C"


# --- expressions ----------------------------------------------------------------------------


def test_the_specification_example_renders_the_same_text(tmp_path: Path):
    source = "{% if params.mode == 'brief' %}B{% endif %}{{ 'eq' if params.n == '1' else 'ne' }}{% for x in params.list %}{{ loop.index }}{{ x }}{% endfor %}{{ params.tags.items | join(',') }}"
    params = {"mode": "brief", "n": 1, "list": ["a", "b"], "tags": {"items": ["x"]}}
    assert render(tmp_path, source, {"params": params}) == "Bne1a2bx"


@pytest.mark.parametrize("source", [
    "{{ 1 + 1 }}",
    "{{ 'a' ~ 'b' }}",
    "{{ params.a in params.b }}",
    "{{ params.a > params.b }}",
    "{{ params.a[0:1] }}",
    "{{ [1, 2] }}",
    "{{ {'a': 1} }}",
    "{{ params.a() }}",
    "{{ params.a == params.b == params.c }}",
    "{{ 'a' if params.b }}",
    "{{ ('a' if params.b else 'c') if params.d else 'e' }}",
    "{{ 'a' if (params.b if params.c else params.d) else 'e' }}",
    "{{ 1_000 }}",
    "{{ 0x1A }}",
    "{{ 1e3 }}",
    "{{ 'a' 'b' }}",
    "{{ 'a\\q' }}",
    "{{ True }}",
    "{{ none }}",
    "{{ null }}",
    "{{ NULL }}",
    "{{ params[-1] }}",
    "{{ params['a'][params.b] }}",
    "{{ (params.a is defined) == true }}",
    "{{ params.a is defined | upper }}",
    "{{ params.a | upper is defined }}",
    "{{ params.a is equalto(1) }}",
    "{{ params.a | join(params.b) }}",
    "{{ params.a | replace('', 'b') }}",
    "{{ params.a | replace('a') }}",
    "{{ params.a | json(1) }}",
    "{{ params.a | default }}",
    "{{ params.a | default('x', true) }}",
    "{{ params.a | length(1) }}",
    "{% for loop in params.a %}{% endfor %}",
    "{% for x in params.a %}{{ loop }}{% endfor %}",
    "{% for x in params.a %}{{ loop.revindex }}{% endfor %}",
    "{% for x in params.a %}{{ loop['index'] }}{% endfor %}",
    "{% for x in params.a %}{% for y in params.b %}{{ loop.cycle }}{% endfor %}{% endfor %}",
])
def test_forms_outside_the_grammar_are_a_syntax_error(tmp_path: Path, source: str):
    found = issues(tmp_path, source)
    assert found == [("template.syntax", "/agents/main/systemMessage/template", "templates/main.md has invalid syntax")]


@pytest.mark.parametrize("source", [
    "{{ 'a' }}{{ \"b\" }}{{ '\\\\' }}{{ '\\n' }}",
    "{{ 2 }}{{ 0.5 }}{{ -1 }}",
    "{{ true }}{{ false }}",
    "{{ params.mode }}{{ params['my-key'] }}{{ params.list[0] }}",
    "{{ params.a | upper | trim }}",
    "{{ params.a is defined }}{{ params.a is not defined }}",
    "{{ params.a == params.b }}{{ params.a != params.b }}",
    "{{ not params.a }}{{ params.a and params.b }}{{ params.a or params.b }}",
    "{{ 'a' if params.b else 'c' }}",
    "{{ (params.a or params.b) and params.c }}",
    "{{ params.a | replace('a', 'b', 2) }}",
    "{{ params.a | json(0) }}{{ params.a | json }}",
    "{{ params.a | join }}{{ params.a | join('-') }}",
    "{{ loop }}",
    "{% for x in params.a %}{% endfor %}{{ loop }}",
])
def test_forms_inside_the_grammar_load(tmp_path: Path, source: str):
    write(tmp_path, "templates/main.md", source)
    runtime_for(tmp_path)


def test_key_access_reads_json_data_and_never_host_attributes(tmp_path: Path):
    params = {"tags": {"items": ["x"]}, "list": ["a"]}
    assert render(tmp_path, "{{ params.tags.items }}", {"params": params}) == '["x"]'
    assert render(tmp_path, "{{ params.list.length is defined }}", {"params": params}) == "false"
    assert render(tmp_path, "{{ params.list.upper is defined }}", {"params": params}) == "false"
    assert render(tmp_path, "{{ params.list[1] is defined }}", {"params": params}) == "false"
    assert render(tmp_path, "{{ params.list['0'] is defined }}", {"params": params}) == "false"


def test_comparison_uses_json_equality(tmp_path: Path):
    source = "{{ 1 == 1.0 }}{{ 1 == '1' }}{{ true == 1 }}{{ params.n == params.m }}{{ params.a != params.b }}"
    variables = {"params": {"n": None, "m": None, "a": [1], "b": [1]}}
    assert render(tmp_path, source, variables) == "truefalsefalsetruefalse"


def test_truthiness_treats_empty_containers_as_false(tmp_path: Path):
    source = "{% for x in params.values %}{% if x %}T{% else %}F{% endif %}{% endfor %}"
    variables = {"params": {"values": [False, None, 0, "", [], {}, "a", 1, [0], {"a": 1}]}}
    assert render(tmp_path, source, variables) == "FFFFFFTTTT"


def test_and_and_or_return_an_operand_and_do_not_evaluate_the_other_side(tmp_path: Path):
    variables = {"params": {"a": "x", "empty": [], "n": 0}}
    assert render(tmp_path, "{{ params.empty or params.a }}", variables) == "x"
    assert render(tmp_path, "{{ params.a and params.n }}", variables) == "0"
    assert render(tmp_path, "{{ not params.a }}{{ not params.empty }}", variables) == "falsetrue"
    assert render(tmp_path, "{{ params.a or params.missing }}", variables) == "x"
    assert render(tmp_path, "{{ params.empty and params.missing }}", variables) == "[]"


# --- iteration ------------------------------------------------------------------------------


def test_loop_exposes_only_the_five_keys_of_the_innermost_loop(tmp_path: Path):
    source = "{% for x in params.a %}{% for y in params.b %}{{ loop.index }}{{ loop.index0 }}{{ loop.first }}{{ loop.last }}{{ loop.length }}{% endfor %}{% endfor %}"
    assert render(tmp_path, source, {"params": {"a": ["p"], "b": ["q", "r"]}}) == "10truefalse221falsetrue2"


def test_a_loop_variable_hides_a_template_variable_and_only_inside_the_body(tmp_path: Path):
    source = "{% for params in params.a %}{{ params }}{% endfor %}"
    assert render(tmp_path, source, {"params": {"a": ["x", "y"]}}) == "xy"


def test_only_arrays_are_iterated(tmp_path: Path):
    assert render(tmp_path, "{% for x in params.a %}{{ x }}{% endfor %}", {"params": {"a": []}}) == ""
    assert "only an array" in fails(tmp_path, "{% for x in params.a %}{% endfor %}", {"params": {"a": {"k": 1}}})
    assert "only an array" in fails(tmp_path, "{% for x in params.a %}{% endfor %}", {"params": {"a": "ab"}})


# --- filters and tests ------------------------------------------------------------------------


def test_filters_follow_the_table(tmp_path: Path):
    variables = {"params": {"list": ["a", 1, True], "text": "  x\u00a0", "n": 2, "obj": {"a": 1, "b": 2}}}
    assert render(tmp_path, "{{ params.list | join('-') }}", variables) == "a-1-true"
    assert render(tmp_path, "{{ params.list | join }}", variables) == "a1true"
    assert render(tmp_path, "{{ params.text | trim }}|", variables) == "x|"
    assert render(tmp_path, "{{ params.n | upper }}", variables) == "2"
    assert render(tmp_path, "{{ 'a\u00df' | upper }}", variables) == "ASS"
    assert render(tmp_path, "{{ 'ABC' | lower }}", variables) == "abc"
    assert render(tmp_path, "{{ 'aaaa' | replace('a', 'b', 2) }}", variables) == "bbaa"
    assert render(tmp_path, "{{ 'aaaa' | replace('aa', 'b') }}", variables) == "bb"
    assert render(tmp_path, "{{ 'a\U0001f600' | length }}", variables) == "2"
    assert render(tmp_path, "{{ params.list | length }}{{ params.obj | length }}", variables) == "32"


def test_the_json_filter_writes_compact_and_indented_forms(tmp_path: Path):
    variables = {"params": {"a": [1, 2], "b": "\ud55c"}}
    assert render(tmp_path, "{{ params | json(0) }}", variables) == '{"a":[1,2],"b":"한"}'
    assert render(tmp_path, "{{ params | json }}", variables) == '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "한"\n}'
    assert render(tmp_path, "{{ params.empty | json }}", {"params": {"empty": []}}) == "[]"


def test_filters_reject_input_they_cannot_process(tmp_path: Path):
    assert "join needs an array" in fails(tmp_path, "{{ params.a | join }}", {"params": {"a": "x"}})
    assert "length needs" in fails(tmp_path, "{{ params.a | length }}", {"params": {"a": 1}})


@pytest.mark.parametrize("source, item", [
    ("{{ params.a | reverse }}", "filter reverse"),
    ("{{ params.a is odd }}", "test odd"),
])
def test_filters_and_tests_outside_the_table_are_unsupported(tmp_path: Path, source: str, item: str):
    found = issues(tmp_path, source)
    assert found == [("template.unsupported", "/agents/main/systemMessage/template", f"templates/main.md uses unsupported syntax: {item}")]


def test_unsupported_filters_and_tests_are_listed_together(tmp_path: Path):
    found = issues(tmp_path, "{{ params.a | reverse }}{{ params.b | abs }}{{ params.c is odd }}{{ params.d | abs }}")
    assert found[0][2] == "templates/main.md uses unsupported syntax: filter abs, filter reverse, test odd"


# --- values -----------------------------------------------------------------------------------


def test_non_strings_print_as_json_text(tmp_path: Path):
    source = "[{{ params.t }}|{{ params.whole }}|{{ params.arr }}|{{ params.obj }}|{{ params.n }}|{{ params.arr | join('-') }}]"
    variables = {"params": {"t": True, "whole": 2.0, "arr": ["a", "b"], "obj": {"a": 1}, "n": None}}
    assert render(tmp_path, source, variables) == '[true|2|["a","b"]|{"a":1}|null|a-b]'


def test_a_large_whole_number_keeps_every_digit_when_printed_or_filtered(tmp_path: Path):
    """§JSON 텍스트: `1e16` prints as its digits; only a fractional tail loses trailing zeros."""
    variables = {"params": {"big": 1e16, "half": 1.5e16, "small": 1e-7}}
    source = "{{ params.big }}|{{ params.half }}|{{ params.small }}|{{ params | json(0) }}"
    assert render(tmp_path, source, variables) == (
        '10000000000000000|15000000000000000|1e-7'
        '|{"big":10000000000000000,"half":15000000000000000,"small":1e-7}'
    )
    assert render(tmp_path, "{{ params.big | json }}", variables) == "10000000000000000"


def test_undefined_values_are_allowed_only_in_defined_and_default(tmp_path: Path):
    variables = {"params": {}}
    assert render(tmp_path, "{{ 'd' if params.missing is defined else 'u' }}{{ params.missing | default('z') }}", variables) == "uz"
    assert render(tmp_path, "{{ params.missing is not defined }}", variables) == "true"
    assert render(tmp_path, "{{ params.n | default('z') }}", {"params": {"n": None}}) == "null"
    for source in [
        "{{ params.missing }}",
        "{% if params.missing %}x{% endif %}",
        "{{ params.missing.name is defined }}",
        "{% for x in params.missing %}{% endfor %}",
        "{{ params.missing == 1 }}",
        "{{ not params.missing }}",
        "{{ params.missing and true }}",
        "{{ params.missing | upper }}",
        "{{ 'a' if params.missing else 'b' }}",
    ]:
        assert fails(tmp_path, source, variables), source


# --- include ------------------------------------------------------------------------------------


def test_an_include_resolves_against_the_including_file(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include 'partials/header.md' %}")
    write(tmp_path, "templates/partials/header.md", "H:{% include 'footer.md' %}")
    write(tmp_path, "templates/partials/footer.md", "inner\n")
    write(tmp_path, "templates/footer.md", "outer\n")
    assert runtime_for(tmp_path).render("templates/main.md", {}) == "H:inner\n"


def test_an_include_receives_the_variables_and_loop_variables_but_not_loop(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% for x in params.a %}{% include 'part.md' %}{% endfor %}")
    write(tmp_path, "templates/part.md", "[{{ x }}|{{ loop | default('none') }}]")
    assert runtime_for(tmp_path).render("templates/main.md", {"params": {"a": ["p", "q"]}}) == "[p|none][q|none]"


def test_a_body_that_reads_loop_still_hides_it_from_the_included_template(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% for x in params.a %}{{ loop.index }}{% include 'part.md' %}{% endfor %}")
    write(tmp_path, "templates/part.md", "[{{ x }}|{{ loop is defined }}]")
    assert runtime_for(tmp_path).render("templates/main.md", {"params": {"a": ["p", "q"]}}) == "1[p|false]2[q|false]"


def test_an_included_template_sees_a_template_variable_named_loop(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% for x in params.a %}{{ loop.index }}{% include 'part.md' %}{% endfor %}")
    write(tmp_path, "templates/part.md", "{{ loop }}")
    assert runtime_for(tmp_path).render("templates/main.md", {"params": {"a": ["p"]}, "loop": "top"}) == "1top"


def test_an_included_template_without_a_loop_variable_reports_an_undefined_value(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% for x in params.a %}{{ loop.index }}{% include 'part.md' %}{% endfor %}")
    write(tmp_path, "templates/part.md", "{{ loop }}")
    runtime = runtime_for(tmp_path)
    with pytest.raises(GoondanError) as error:
        runtime.render("templates/main.md", {"params": {"a": ["p"]}})
    assert "undefined" in str(error.value)


def test_an_include_in_a_branch_that_never_runs_is_still_checked(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% if false %}{% include 'missing.md' %}{% endif %}")
    assert issues(tmp_path) == [
        ("template.not_found", "/agents/main/systemMessage/template", 'templates/main.md includes "missing.md": cannot read templates/missing.md'),
    ]


@pytest.mark.parametrize("written, path, reason", [
    ("", "", "path is empty"),
    ("a\\\\b.md", "a\\b.md", "backslashes are not allowed"),
    ("/etc/hosts", "/etc/hosts", "absolute paths are not allowed"),
    ("C:/secret.md", "C:/secret.md", "absolute paths are not allowed"),
    ("../secret.md", "../secret.md", '".." segments are not allowed'),
])
def test_include_paths_outside_the_rules_are_unsupported(tmp_path: Path, written: str, path: str, reason: str):
    write(tmp_path, "templates/main.md", "{%% include '%s' %%}" % written)
    assert issues(tmp_path) == [
        ("template.unsupported", "/agents/main/systemMessage/template", f'templates/main.md includes "{path}": {reason}'),
    ]


def test_an_unsupported_escape_in_an_include_path_is_a_syntax_error(tmp_path: Path):
    assert issues(tmp_path, "{% include 'a\\b.md' %}")[0][0] == "template.syntax"


def test_dot_and_empty_include_segments_are_ignored(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include './partials//part.md' %}")
    write(tmp_path, "templates/partials/part.md", "P")
    assert runtime_for(tmp_path).render("templates/main.md", {}) == "P"


def test_an_include_that_leaves_the_directory_through_a_symlink_is_unsupported(tmp_path: Path):
    write(tmp_path, "secret.md", "secret")
    write(tmp_path, "templates/main.md", "{% include 'link.md' %}")
    (tmp_path / "templates" / "link.md").symlink_to(tmp_path / "secret.md")
    assert issues(tmp_path) == [
        ("template.unsupported", "/agents/main/systemMessage/template", 'templates/main.md includes "link.md": resolves outside templates'),
    ]


def test_a_template_outside_the_configuration_directory_keeps_a_relative_identifier(tmp_path: Path):
    root = tmp_path / "config"
    root.mkdir(parents=True, exist_ok=True)
    assert issues(root, "{% set x = 1 %}", "../shared/bad.md") == [
        ("template.unsupported", "/agents/main/systemMessage/template", "../shared/bad.md uses unsupported syntax: tag set"),
    ]


def test_a_template_in_the_configuration_directory_reports_its_directory_as_a_dot(tmp_path: Path):
    root = tmp_path / "config"
    write(tmp_path, "outside/secret.md", "secret")
    write(root, "main.md", "{% include 'link.md' %}")
    (root / "link.md").symlink_to(tmp_path / "outside" / "secret.md")
    found = issues(root, name="main.md")
    assert found == [("template.unsupported", "/agents/main/systemMessage/template", 'main.md includes "link.md": resolves outside .')]


def test_a_symlinked_target_inside_the_directory_is_included(tmp_path: Path):
    write(tmp_path, "templates/partials/real.md", "R")
    write(tmp_path, "templates/main.md", "{% include 'link.md' %}")
    (tmp_path / "templates" / "link.md").symlink_to(tmp_path / "templates" / "partials" / "real.md")
    assert runtime_for(tmp_path).render("templates/main.md", {}) == "R"


def test_an_include_cycle_lists_the_files_from_the_repeated_one(tmp_path: Path):
    write(tmp_path, "templates/loop-a.md", "{% include 'loop-b.md' %}")
    write(tmp_path, "templates/loop-b.md", "{% include 'loop-a.md' %}")
    found = issues(tmp_path, name="templates/loop-a.md")
    assert found == [
        ("template.unsupported", "/agents/main/systemMessage/template", "include cycle: templates/loop-a.md -> templates/loop-b.md -> templates/loop-a.md"),
    ]


def test_a_template_that_includes_itself_is_a_cycle(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include 'main.md' %}")
    assert issues(tmp_path)[0][2] == "include cycle: templates/main.md -> templates/main.md"


def test_the_same_file_included_twice_is_not_a_cycle(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include 'a.md' %}{% include 'b.md' %}")
    write(tmp_path, "templates/a.md", "{% include 'shared.md' %}")
    write(tmp_path, "templates/b.md", "{% include 'shared.md' %}")
    write(tmp_path, "templates/shared.md", "S")
    assert runtime_for(tmp_path).render("templates/main.md", {}) == "SS"


@pytest.mark.parametrize("source", [
    "{% include 'a.md' ignore missing %}",
    "{% include 'a.md' with context %}",
    "{% include 'a.md' without context %}",
    "{% include ['a.md', 'b.md'] %}",
    "{% include 'a' ~ '.md' %}",
    "{% include params.name %}",
])
def test_include_forms_outside_the_grammar_are_a_syntax_error(tmp_path: Path, source: str):
    write(tmp_path, "templates/a.md", "A")
    assert issues(tmp_path, source)[0][0] == "template.syntax"


def test_includes_are_checked_in_the_order_they_appear(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include 'first.md' %}{% include '../second.md' %}")
    write(tmp_path, "templates/first.md", "{% include 'missing.md' %}")
    assert issues(tmp_path)[0] == (
        "template.not_found",
        "/agents/main/systemMessage/template",
        'templates/first.md includes "missing.md": cannot read templates/missing.md',
    )


def test_an_include_target_that_is_a_directory_cannot_be_read(tmp_path: Path):
    write(tmp_path, "templates/parts/a.md", "A")
    assert issues(tmp_path, "{% include 'parts' %}") == [
        ("template.not_found", "/agents/main/systemMessage/template", 'templates/main.md includes "parts": cannot read templates/parts'),
    ]


def test_an_error_in_an_included_file_is_reported_at_the_declaring_position(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include 'bad.md' %}")
    write(tmp_path, "templates/bad.md", "{% set x = 1 %}")
    assert issues(tmp_path) == [
        ("template.unsupported", "/agents/main/systemMessage/template", "templates/bad.md uses unsupported syntax: tag set"),
    ]


def test_every_declaring_position_reports_the_same_file(tmp_path: Path):
    write(tmp_path, "templates/bad.md", "{% set x = 1 %}")
    config = {
        "agents": {
            "main": {"model": "m", "systemMessage": [{"template": "templates/bad.md"}, {"template": "templates/bad.md"}]},
        },
    }
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(config=config, models={"m": lambda value: None}, directory=str(tmp_path))
    assert [item["path"] for item in error.value.issues] == [
        "/agents/main/systemMessage/0/template",
        "/agents/main/systemMessage/1/template",
    ]


# --- when templates are read ---------------------------------------------------------------------


def test_a_missing_declared_template_is_reported_once(tmp_path: Path):
    (tmp_path / "templates").mkdir()
    assert issues(tmp_path) == [
        ("template.not_found", "/agents/main/systemMessage/template", "cannot read templates/main.md"),
    ]


def test_a_directory_and_invalid_utf8_cannot_be_read(tmp_path: Path):
    (tmp_path / "templates" / "main.md").mkdir(parents=True)
    assert issues(tmp_path)[0][0] == "template.not_found"
    import shutil

    shutil.rmtree(tmp_path / "templates" / "main.md")
    (tmp_path / "templates" / "main.md").write_bytes(b"\xff\xfe")
    assert issues(tmp_path)[0][0] == "template.not_found"


def test_a_draft_file_that_nothing_declares_or_includes_is_not_read(tmp_path: Path):
    write(tmp_path, "templates/main.md", "ok")
    write(tmp_path, "templates/draft.md", "{% set x = 1 %}")
    assert runtime_for(tmp_path).render("templates/main.md", {}) == "ok"


def test_a_template_declared_next_to_an_input_function_is_checked(tmp_path: Path):
    write(tmp_path, "templates/input.md", "{% set x = 1 %}")
    config = {"agents": {"main": {"model": "m", "input": {"fn": "shape", "template": "templates/input.md"}}}}
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(config=config, models={"m": lambda value: None}, functions={"shape": lambda value: value}, directory=str(tmp_path))
    assert [(item["code"], item["path"]) for item in error.value.issues] == [("template.unsupported", "/agents/main/input/template")]


def test_load_config_carries_the_template_sources_and_the_runtime_does_not_read_again(tmp_path: Path):
    write(tmp_path, "goondan.yaml", "agents:\n  main:\n    model: m\n    systemMessage: {template: templates/main.md}\n")
    template = write(tmp_path, "templates/main.md", "first")
    config = load_config(tmp_path)
    assert config.templates == {str(template.resolve()): "first"}
    runtime = create_goondan(config=config, models={"m": lambda value: None})
    template.write_text("second", encoding="utf-8")
    assert runtime.render("templates/main.md", {}) == "first"


def test_a_hook_template_is_read_at_its_own_position(tmp_path: Path):
    write(tmp_path, "templates/note.md", "{{ text | reverse }}")
    config = {"agents": {"main": {"model": "m", "hooks": {"onOutput": [{"template": "templates/note.md"}]}}}}
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(config=config, models={"m": lambda value: None}, directory=str(tmp_path))
    assert [(item["code"], item["path"]) for item in error.value.issues] == [("template.unsupported", "/agents/main/hooks/onOutput/0/template")]


def test_validate_config_does_not_read_template_files(tmp_path: Path):
    from goondan import validate_config

    config = validate_config({"agents": {"main": {"model": "m", "systemMessage": {"template": "nowhere.md"}}}})
    assert config.templates is None


# --- the render function ------------------------------------------------------------------------


def test_render_accepts_an_absolute_path_or_one_relative_to_the_configuration_directory(tmp_path: Path):
    template = write(tmp_path, "templates/main.md", "{{ params.a }}")
    runtime = runtime_for(tmp_path)
    assert runtime.render(str(template), {"params": {"a": "x"}}) == "x"
    assert runtime.render("templates/main.md", {"params": {"a": "x"}}) == "x"
    assert runtime.render("./templates/main.md", {"params": {"a": "x"}}) == "x"


def test_render_refuses_a_template_that_was_not_read(tmp_path: Path):
    write(tmp_path, "templates/main.md", "ok")
    write(tmp_path, "templates/other.md", "other")
    runtime = runtime_for(tmp_path)
    with pytest.raises(GoondanError) as error:
        runtime.render("templates/other.md", {})
    assert "is not loaded" in str(error.value)
    with pytest.raises(GoondanError):
        runtime.render("/etc/hosts", {})


def test_render_can_address_an_included_template(tmp_path: Path):
    write(tmp_path, "templates/main.md", "{% include 'part.md' %}")
    write(tmp_path, "templates/part.md", "P{{ params.a }}")
    runtime = runtime_for(tmp_path)
    assert runtime.render("templates/part.md", {"params": {"a": "1"}}) == "P1"


def test_a_template_variable_name_may_be_any_string(tmp_path: Path):
    assert render(tmp_path, "{{ text }}", {"text": "x", "my-key": "y"}) == "x"


def test_a_variable_that_was_not_provided_is_undefined(tmp_path: Path):
    assert render(tmp_path, "{{ missing is defined }}{{ missing | default('z') }}", {}) == "falsez"
    assert fails(tmp_path, "{{ missing }}", {})


def test_negative_number_literals_print_and_compare(tmp_path: Path):
    assert render(tmp_path, "{{ -1 }}{{ params.n == -1 }}", {"params": {"n": -1}}) == "-1true"


def test_the_runtime_keeps_the_template_sources_it_was_given(tmp_path: Path):
    template = write(tmp_path, "templates/main.md", "ok")
    assert runtime_for(tmp_path).templates == {str(template.resolve()): "ok"}
