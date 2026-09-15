"""Unit tests for the parts of the runner that do not need a runtime."""

from __future__ import annotations

import math

import pytest

from conformance.bindings import (
    CaseState,
    RecordingConversationStore,
    RecordingOperationStore,
    RuntimeBindings,
    project_event,
    project_operation,
)
from conformance.casefile import check_case
from conformance.compare import ABSENT, diff_listed_keys, diff_values
from conformance.coverage import coverage_problems, duplicate_headings, spec_headings
from conformance.errors import CaseFailure, CaseFormatError, ScriptError, UnsupportedFeature
from conformance.gates import GateOwner, Gates
from conformance.jsonptr import MISSING, PointerError, format_pointer, parse_pointer, pointer_get, pointer_set
from conformance.normalize import (
    document_strings,
    normalize_document,
    replacer,
    strip_message_ids,
    substitute,
    turn_aliases,
    walk_strings,
)
from conformance.ops import OpRunner
from conformance.runner import (
    CaseRunner,
    case_directory_problems,
    check_config_error,
    check_operations,
    check_usage,
    diff_error,
    discover_cases,
    library_problems,
)
from conformance.values import json_equal, merge_values

from goondan import GoondanConfigError
from goondan.store import InMemoryConversationStore, InMemoryOperationStore


def minimal_case(**overrides):
    case = {"description": "a case", "spec": ["에이전트"], "steps": []}
    case.update(overrides)
    return case


# -- JSON Pointer -----------------------------------------------------------------------


def test_parse_pointer_unescapes_the_reserved_characters():
    assert parse_pointer("") == []
    assert parse_pointer("/a/0") == ["a", "0"]
    assert parse_pointer("/a~1b/c~0d") == ["a/b", "c~d"]


def test_parse_pointer_rejects_a_pointer_without_a_leading_slash():
    with pytest.raises(PointerError):
        parse_pointer("a/b")


def test_format_pointer_escapes_the_reserved_characters():
    assert format_pointer(["a/b", "c~d", 2]) == "/a~1b/c~0d/2"


def test_pointer_get_reports_a_location_that_does_not_exist():
    document = {"a": [{"b": 1}]}
    assert pointer_get(document, ["a", "0", "b"]) == 1
    assert pointer_get(document, ["a", "1"]) is MISSING
    assert pointer_get(document, ["a", "01"]) is MISSING
    assert pointer_get(document, ["missing"]) is MISSING


def test_pointer_set_writes_an_object_key_and_appends_to_an_array():
    document = {"a": {"b": 1}, "list": [1, 2]}
    assert pointer_set(document, ["a", "c"], 2) == {"a": {"b": 1, "c": 2}, "list": [1, 2]}
    assert pointer_set(document, ["list", "-"], 3)["list"] == [1, 2, 3]
    assert pointer_set(document, ["list", "0"], 9)["list"] == [9, 2]
    assert document == {"a": {"b": 1}, "list": [1, 2]}


def test_pointer_set_rejects_a_missing_parent_and_an_unknown_index():
    with pytest.raises(PointerError):
        pointer_set({}, ["a", "b"], 1)
    with pytest.raises(PointerError):
        pointer_set({"list": []}, ["list", "0"], 1)
    with pytest.raises(PointerError):
        pointer_set({"a": 1}, [], 2)


# -- JSON values ------------------------------------------------------------------------


def test_json_equal_separates_the_kinds_and_compares_numbers_numerically():
    assert json_equal(1, 1.0)
    assert not json_equal(True, 1)
    assert not json_equal(1, "1")
    assert not json_equal(None, False)
    assert json_equal({"a": [1, {"b": None}]}, {"a": [1.0, {"b": None}]})
    assert not json_equal({"a": 1}, {"a": 1, "b": None})
    assert not json_equal([1, 2], [2, 1])


def test_merge_values_merges_objects_and_replaces_arrays():
    merged = merge_values({"a": {"b": 1, "c": 2}, "list": [1, 2]}, {"a": {"c": 3}, "list": [9]})
    assert merged == {"a": {"b": 1, "c": 3}, "list": [9]}


# -- comparison -------------------------------------------------------------------------


def test_diff_values_points_at_every_position_that_differs():
    differences = diff_values({"a": 1, "b": {"c": 2}}, {"a": 1, "b": {"c": 3}})
    assert [(item.pointer, item.expected, item.actual) for item in differences] == [("/b/c", 2, 3)]


def test_diff_values_reports_a_key_only_one_side_has():
    differences = diff_values({"a": 1}, {"a": 1, "b": 2})
    assert [(item.pointer, item.expected, item.actual) for item in differences] == [("/b", ABSENT, 2)]
    differences = diff_values({"a": 1, "b": 2}, {"a": 1})
    assert [(item.pointer, item.expected, item.actual) for item in differences] == [("/b", 2, ABSENT)]


def test_diff_values_reports_the_length_and_the_common_positions_of_an_array():
    differences = diff_values([1, 2], [3], ("runs",))
    assert [item.pointer for item in differences] == ["/runs", "/runs/0"]


def test_diff_listed_keys_ignores_the_keys_the_expectation_does_not_list():
    assert diff_listed_keys({"status": "done"}, {"status": "done", "usage": {}}) == []
    differences = diff_listed_keys({"status": "done"}, {"usage": {}})
    assert [(item.pointer, item.actual) for item in differences] == [("/status", ABSENT)]


def test_diff_error_compares_the_message_only_when_the_expectation_has_one():
    expected = {"where": "model", "codes": ["model_error"], "attempt": 1}
    actual = {"where": "model", "codes": ["model_error"], "attempt": 1, "message": "boom"}
    assert diff_error(expected, actual, ("error",)) == []
    assert diff_error({**expected, "message": "other"}, actual, ("error",))


def test_diff_error_compares_issue_messages_only_when_they_are_written():
    expected = {"phase": "load", "issues": [{"code": "load.not_found", "path": ""}]}
    actual = {"phase": "load", "issues": [{"code": "load.not_found", "path": "", "message": "no file"}]}
    assert diff_error(expected, actual, ("error",)) == []
    differences = diff_error({"phase": "load", "issues": []}, actual, ("error",))
    assert [item.pointer for item in differences] == ["/error/issues"]


# -- normalization ----------------------------------------------------------------------


def test_walk_strings_reads_object_keys_in_code_point_order_and_the_key_before_its_value():
    assert list(walk_strings({"b": "second", "a": "first"})) == ["a", "first", "b", "second"]


def test_document_strings_reads_the_steps_before_the_observation_sections():
    document = {"steps": ["s"], "observations": {"events": ["e"], "effectiveConfig": ["c"]}}
    assert list(document_strings(document)) == ["s", "c", "e"]


def test_strip_message_ids_keeps_an_id_that_does_not_belong_to_a_message():
    document = {"role": "user", "content": [{"type": "tool.call", "id": "c-1"}], "id": "m-1"}
    assert strip_message_ids(document) == {"role": "user", "content": [{"type": "tool.call", "id": "c-1"}]}


def test_turn_aliases_number_the_turns_in_the_traversal_order():
    document = {
        "steps": [{"result": {"runs": [{"turnId": "second"}]}}],
        "observations": {"events": [{"turnId": "first"}]},
    }
    assert turn_aliases(document) == {"second": "<turn:1>", "first": "<turn:2>"}


def test_turn_aliases_number_several_identifiers_inside_one_string_from_the_front():
    document = {"steps": [], "observations": {"events": [{"turnId": "b"}, {"turnId": "a"}],
                                              "conversations": {"c1:a:b:worker": []}}}
    assert turn_aliases(document) == {"b": "<turn:1>", "a": "<turn:2>"}


def test_replacer_substitutes_the_longest_known_text_first():
    replace = replacer({"op-1": "<op:a>", "op-12": "<op:b>"})
    assert replace("op-12 and op-1") == "<op:b> and <op:a>"


def test_substitute_rewrites_object_keys_and_parts_of_a_string():
    value = {"op-1": ["op-1 inside", {"op-1": 1}]}
    assert substitute(value, replacer({"op-1": "X"})) == {"X": ["X inside", {"X": 1}]}


def test_normalize_document_applies_the_four_steps():
    document = {
        "steps": [{"result": {"output": {"id": "m-1", "role": "assistant", "content": [{"type": "text", "text": "/tmp/case/config"}]},
                              "runs": [{"turnId": "turn-x"}]}}],
        "observations": {"operations": [{"operationId": "op-1", "turnId": "turn-x"}],
                         "conversations": {"c1:turn-x:worker/worker": []}},
    }
    normalized = normalize_document(document, case_paths=["/tmp/case"], operation_aliases={"op-1": "<op:danger-1>"})
    assert normalized["steps"][0]["result"]["output"] == {"role": "assistant", "content": [{"type": "text", "text": "<case>/config"}]}
    assert normalized["observations"]["operations"] == [{"operationId": "<op:danger-1>", "turnId": "<turn:1>"}]
    assert list(normalized["observations"]["conversations"]) == ["c1:<turn:1>:worker/worker"]


# -- coverage ---------------------------------------------------------------------------


def test_spec_headings_skips_headings_inside_a_fenced_block():
    markdown = "# 제목\n\n## 에이전트\n\n```yaml\n# not a heading\n### also not\n```\n\n### 도구\n\n#### `execution.complete`\n"
    assert spec_headings(markdown) == ["에이전트", "도구", "`execution.complete`"]


def test_duplicate_headings_lists_each_repeated_heading_once():
    assert duplicate_headings(["a", "b", "a", "a"]) == ["a"]


def test_coverage_problems_reports_uncited_unknown_and_duplicated_headings():
    problems = coverage_problems(["a", "b", "b"], {"case-one": ["a", "c"]})
    assert problems == [
        "the specification repeats the heading 'b'",
        "case 'case-one' cites 'c', which is not a heading of the specification",
        "no case cites the heading 'b'",
    ]


# -- case files -------------------------------------------------------------------------


def test_check_case_accepts_a_case_that_follows_the_format():
    case = minimal_case(
        bindings={"models": {"m": {"responses": [{"text": "hi", "usage": {"input": 1}}]}},
                  "tools": {"lookup": {"results": [{"text": "found"}]}},
                  "functions": {"f": {"op": "chain", "ops": [{"op": "text"}, {"op": "constant", "value": 1}]}},
                  "host": {"validateOperation": True}},
        steps=[{"run": {"conversationId": "c1", "input": "hi"}}],
    )
    check_case(case, {"steps": [{"result": {"status": "done"}}], "observations": {"toolCalls": []}})


def test_check_case_rejects_an_unknown_key_and_a_missing_key():
    with pytest.raises(CaseFormatError) as error:
        check_case({"description": "a", "spec": ["에이전트"], "steps": [], "extra": 1}, {"steps": []})
    assert any("extra" in problem for problem in error.value.problems)
    with pytest.raises(CaseFormatError) as error:
        check_case({"spec": ["에이전트"], "steps": []}, {"steps": []})
    assert any("description" in problem for problem in error.value.problems)


def test_check_case_keeps_a_variant_name_the_host_has_to_reject():
    """§읽기 오류: an empty variant name is a `load.not_found` the host reports, not a case problem."""
    check_case(minimal_case(config={"path": "goondan.yaml", "variants": [""]}), {"steps": []})
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(config={"path": "goondan.yaml", "variants": [1]}), {"steps": []})
    assert any("variants/0" in problem for problem in error.value.problems)


def test_check_case_accepts_a_run_model_operation_whose_messages_are_no_array():
    """§훅 컨텍스트와 호스트 함수: `model.run` gets the value unchanged, so any JSON may be passed."""

    def case_with(hook):
        return minimal_case(bindings={"extensions": {"memo": {"instance": {"hooks": {"modelInput": hook}}}}})

    check_case(case_with({"op": "runModel", "messages": "문자열"}), {"steps": []})
    with pytest.raises(CaseFormatError) as error:
        check_case(case_with({"op": "runModel"}), {"steps": []})
    assert any("messages" in problem for problem in error.value.problems)


def test_check_case_rejects_a_hook_operation_outside_a_hook():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(bindings={"functions": {"f": {"op": "append", "messages": []}}}), {"steps": []})
    assert any("append" in problem for problem in error.value.problems)


def test_check_case_rejects_an_error_code_outside_the_closed_set():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(), {"error": {"phase": "load", "issues": [{"code": "config_invalid", "path": ""}]}})
    assert any("config_invalid" in problem for problem in error.value.problems)


def test_check_case_requires_the_step_counts_to_match():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(steps=[{"close": {}}]), {"steps": []})
    assert any("one per step" in problem for problem in error.value.problems)


def test_check_case_rejects_steps_next_to_an_expected_configuration_error():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(steps=[{"close": {}}]), {"error": {"phase": "create", "invalidArgument": True}})
    assert any("must be empty" in problem for problem in error.value.problems)


def test_check_case_rejects_a_released_never_gate_and_a_branch_that_closes():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(steps=[{"release": "never"}]), {"steps": [{}]})
    assert any("reserved" in problem for problem in error.value.problems)
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(steps=[{"parallel": [[{"close": {}}]]}]), {"steps": [{}]})
    assert any("branch" in problem for problem in error.value.problems)


def test_check_case_rejects_a_step_with_two_actions():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(steps=[{"close": {}, "restart": {}}]), {"steps": [{}]})
    assert any("exactly one" in problem for problem in error.value.problems)


def test_check_case_rejects_a_model_response_with_two_actions():
    with pytest.raises(CaseFormatError) as error:
        check_case(minimal_case(bindings={"models": {"m": {"responses": [{"text": "a", "raw": 1}]}}}), {"steps": []})
    assert any("exactly one" in problem for problem in error.value.problems)


# -- operations -------------------------------------------------------------------------


async def run_op(op, value, *, hook=None):
    gates = Gates()
    return await OpRunner(gates).run(op, value, site="functions/f", owner=GateOwner("runtime-1"), hook=hook)


async def test_value_operations_produce_the_documented_results():
    assert await run_op({"op": "identity"}, {"a": 1}) == {"a": 1}
    assert await run_op({"op": "constant", "value": [1]}, "x") == [1]
    assert await run_op({"op": "get", "path": "/a/0"}, {"a": ["v"]}) == "v"
    assert await run_op({"op": "get", "path": "/missing"}, {}) is None
    assert await run_op({"op": "set", "path": "/a", "value": 2}, {"a": 1}) == {"a": 2}
    assert await run_op({"op": "merge", "value": {"b": 2}}, {"a": 1}) == {"a": 1, "b": 2}
    assert await run_op({"op": "wrap", "key": "value", "with": {"k": 1}}, "x") == {"value": "x", "k": 1}
    assert await run_op({"op": "equals", "path": "/a", "value": 1}, {"a": 1}) is True
    assert await run_op({"op": "equals", "value": None}, {"a": 1}) is False
    assert await run_op({"op": "text"}, {"content": [{"type": "text", "text": "a"}, {"type": "json", "value": 1}]}) == "a"
    assert await run_op({"op": "textSuffix", "suffix": "!"}, "hi") == "hi!"
    assert math.isnan(await run_op({"op": "nonJson"}, None))


async def test_the_result_operation_builds_a_control_result_from_the_tool_call():
    call = {"id": "c-1", "name": "lookup", "args": {"q": 1}}
    built = await run_op({"op": "result", "content": [{"type": "text", "text": "r"}], "isError": True}, call)
    assert built == {"result": {"callId": "c-1", "name": "lookup", "args": {"q": 1},
                                "content": [{"type": "text", "text": "r"}], "isError": True}}


async def test_the_result_operation_fails_without_a_tool_call():
    with pytest.raises(ScriptError):
        await run_op({"op": "result", "content": []}, {"name": "lookup"})


async def test_the_throw_and_text_operations_raise_a_script_error():
    with pytest.raises(ScriptError):
        await run_op({"op": "throw", "message": "boom"}, None)
    with pytest.raises(ScriptError):
        await run_op({"op": "text"}, 1)


async def test_the_sequence_operation_repeats_its_last_item():
    gates = Gates()
    runner = OpRunner(gates)
    owner = GateOwner("runtime-1")
    op = {"op": "sequence", "items": [{"op": "constant", "value": 1}, {"op": "constant", "value": 2}]}
    results = [await runner.run(op, None, site="functions/f", owner=owner) for _ in range(3)]
    assert results == [1, 2, 2]


async def test_the_chain_operation_passes_each_result_to_the_next_operation():
    op = {"op": "chain", "ops": [{"op": "get", "path": "/a"}, {"op": "textSuffix", "suffix": "!"}]}
    assert await run_op(op, {"a": "hi"}) == "hi!"


async def test_the_await_operation_waits_for_the_gate_to_open():
    import asyncio

    gates = Gates()
    runner = OpRunner(gates)
    owner = GateOwner("runtime-1")
    waiting = asyncio.ensure_future(runner.run({"op": "await", "gate": "g", "then": {"op": "constant", "value": 7}},
                                               None, site="functions/f", owner=owner))
    await gates.reach("g")
    assert not waiting.done()
    gates.release("g")
    assert await waiting == 7


async def test_closing_a_runtime_ends_the_waits_of_its_bindings():
    import asyncio

    gates = Gates()
    owner = GateOwner("runtime-1")
    waiting = asyncio.ensure_future(gates.wait("g", owner))
    await gates.reach("g")
    owner.stop()
    with pytest.raises(asyncio.CancelledError):
        await waiting


async def test_reach_returns_once_a_call_has_started_waiting_on_the_gate():
    import asyncio

    gates = Gates()
    owner = GateOwner("runtime-1")
    reaching = asyncio.ensure_future(gates.reach("g"))
    await asyncio.sleep(0)
    assert not reaching.done()
    waiting = asyncio.ensure_future(gates.wait("g", owner))
    await reaching
    gates.release("g")
    await waiting


async def test_an_open_gate_does_not_make_a_call_wait():
    gates = Gates()
    gates.release("g")
    await gates.wait("g", GateOwner("runtime-1"))
    assert gates.is_open("g")


def test_releasing_the_reserved_gate_is_an_error():
    with pytest.raises(ValueError):
        Gates().release("never")


# -- observations -----------------------------------------------------------------------


def test_project_event_keeps_the_required_data_keys_without_the_error_text():
    event = {"name": "turn.error", "agent": "main", "conversationId": "c1", "turnId": "t1", "at": 1,
             "data": {"where": "model", "codes": ["model_error"], "error": "boom", "extra": 1}}
    assert project_event(event) == {"name": "turn.error", "agent": "main", "conversationId": "c1", "turnId": "t1",
                                    "data": {"where": "model", "codes": ["model_error"]}}


def test_project_event_keeps_the_operation_identifier_of_an_approved_execution():
    event = {"name": "tool.done", "agent": "main", "conversationId": "c1", "turnId": "t1", "at": 1,
             "data": {"tool": "danger", "callId": "c-1", "args": {}, "result": {}, "operationId": "op-1"}}
    assert project_event(event)["data"]["operationId"] == "op-1"


def test_project_operation_drops_the_times():
    operation = {"operationId": "op-1", "status": "pending", "createdAt": 1, "updatedAt": 2, "deliveredAt": 3}
    assert project_operation(operation) == {"operationId": "op-1", "status": "pending"}


async def test_the_operation_store_numbers_repeated_call_identifiers():
    store = RecordingOperationStore()
    for index in range(2):
        await store.save({"conversationId": "c1", "operationId": f"op-{index}", "toolCall": {"id": "danger-1"},
                          "status": "pending", "deliveryStatus": "pending"})
    assert store.aliases() == {"op-0": "<op:danger-1>", "op-1": "<op:danger-1#2>"}


async def test_the_operation_store_records_every_accepted_state_change_once():
    store = RecordingOperationStore()
    await store.save({"conversationId": "c1", "operationId": "op-1", "toolCall": {"id": "danger-1"},
                      "deliveryId": "operation:op-1:completion", "status": "pending", "deliveryStatus": "pending"})
    await store.transition("c1", "op-1", ["pending"], {"status": "approved"})
    await store.transition("c1", "op-1", ["pending"], {"status": "running"})
    await store.transition("c1", "op-1", ["approved"], {"status": "completed"})
    await store.claim_delivery("c1", "op-1", 10)
    await store.release_delivery("c1", "op-1", "operation:op-1:completion", 11)
    await store.claim_delivery("c1", "op-1", 12)
    await store.transition("c1", "op-1", ["completed"], {"deliveryStatus": "delivered", "deliveredAt": 13})
    await store.transition("c1", "op-1", ["completed"], {"deliveryStatus": "delivered", "deliveredAt": 14})
    assert store.observation_history(store.aliases()) == {
        "<op:danger-1>": ["pending/pending", "approved/pending", "completed/pending", "completed/delivering",
                          "completed/pending", "completed/delivering", "completed/delivered"],
    }


def test_the_runner_stores_are_the_stores_the_host_ships():
    """The runner store only records, so the runtime sees the host's own store protocol."""
    assert isinstance(RecordingOperationStore(), InMemoryOperationStore)
    assert isinstance(RecordingConversationStore(), InMemoryConversationStore)
    for name in vars(InMemoryOperationStore):
        if not name.startswith("_"):
            assert hasattr(RecordingOperationStore(), name)


# -- invariants -------------------------------------------------------------------------


def test_check_config_error_accepts_the_error_the_specification_describes():
    error = GoondanConfigError([{"code": "binding.model", "segments": ["agents", "main", "model"], "message": "no model"}])
    assert check_config_error(error) == []


def test_check_config_error_reports_an_empty_issue_list():
    class Empty(Exception):
        issues: list = []

    assert check_config_error(Empty()) == ["a configuration error must carry at least one issue"]


def test_check_operations_requires_the_times_the_specification_defines():
    problems = check_operations([{"operationId": "op-1", "createdAt": "x", "updatedAt": 1,
                                  "deliveredAt": 2, "deliveryStatus": "pending"}])
    assert len(problems) == 2


def test_check_usage_adds_the_usage_of_every_agent_run():
    zero = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
    good = {"result": {"usage": {**zero, "input": 5}, "runs": [{"usage": {**zero, "input": 5}}]}}
    bad = {"result": {"usage": {**zero, "input": 4}, "runs": [{"usage": {**zero, "input": 5}}]}}
    assert check_usage([good]) == []
    assert len(check_usage([bad])) == 1
    assert len(check_usage([{"parallel": [[bad]]}])) == 1


# -- bindings ---------------------------------------------------------------------------


class FakeToolContext:
    def __init__(self):
        self.agent = "wrap/main"
        self.conversation_id = "c1"
        self.turn_id = "t1"
        self.tool_call = {"id": "c-1", "name": "lookup", "args": {"q": 1}}
        self.input = "hi"
        self.conversation = []
        self.execution = {"ticket": 1}


class FakeExecution:
    def __init__(self):
        self.output = None

    def complete(self, output):
        self.output = output


class FakeMessages:
    def __init__(self):
        self.made = 0

    def user(self, text, **extra):
        self.made += 1
        return {"id": f"m-{self.made}", "role": "user", "source": "extension", "content": [{"type": "text", "text": text}], **extra}


class FakeHookContext:
    def __init__(self):
        self.agent = "main"
        self.conversation_id = "c1"
        self.turn_id = "t1"
        self.input = "hi"
        self.conversation = []
        self.retry_count = 0
        self.message = FakeMessages()
        self.execution = FakeExecution()
        self.appended = None

    def append(self, *items):
        self.appended = list(items)
        return {"append": list(items)}


def make_bindings(bindings):
    return CaseState({"description": "d", "spec": ["에이전트"], "steps": [], "bindings": bindings}, "/tmp/case")


async def test_a_scripted_tool_records_its_call_and_returns_the_content():
    state = make_bindings({"tools": {"lookup": {"description": "d", "results": [{"text": "found"},
                                                                               {"json": {"a": 1}, "isError": True}]}}})
    binding = RuntimeBindings(state, "runtime-1")
    tool = binding.tools["lookup"]
    assert tool.description == "d"
    context = FakeToolContext()
    assert await tool.execute({"q": 1}, context) == [{"type": "text", "text": "found"}]
    assert await tool.execute({"q": 2}, context) == {"content": [{"type": "json", "value": {"a": 1}}], "isError": True}
    assert state.observations.tool_calls == [{"tool": "lookup", "args": {"q": 1}}, {"tool": "lookup", "args": {"q": 2}}]
    assert state.observations.tool_contexts[0] == {
        "tool": "lookup", "agent": "wrap/main", "conversationId": "c1", "turnId": "t1",
        "toolCall": {"id": "c-1", "name": "lookup", "args": {"q": 1}},
        "input": "hi", "conversation": [], "execution": {"ticket": 1},
    }
    assert state.unused_scripts() == []


async def test_a_scripted_tool_that_runs_out_of_results_fails_the_case():
    state = make_bindings({"tools": {"lookup": {"results": []}}})
    tool = RuntimeBindings(state, "runtime-1").tools["lookup"]
    with pytest.raises(ScriptError):
        await tool.execute({}, FakeToolContext())
    assert state.problems and "scripts 0 results" in state.problems[0]


async def test_an_unused_script_is_reported():
    state = make_bindings({"models": {"m": {"responses": [{"text": "a"}]}}, "tools": {"t": {"results": [{"text": "b"}]}}})
    assert state.unused_scripts() == ["the model 'm' has 1 unused responses", "the tool 't' has 1 unused results"]


async def test_a_scripted_model_builds_the_message_and_the_finish_reason():
    state = make_bindings({"models": {"m": {"responses": [
        {"toolCalls": [{"callId": "c-1", "name": "lookup", "args": {}}]},
        {"text": "done", "source": "model", "id": "m-1"},
    ]}}})
    model = RuntimeBindings(state, "runtime-1").models["m"]
    first = await model.generate({"messages": []}, None)
    assert first["finishReason"] == "tool"
    assert first["message"]["content"] == [{"type": "tool.call", "callId": "c-1", "name": "lookup", "args": {}}]
    second = await model.generate({"messages": []}, None)
    assert second == {"message": {"role": "assistant", "content": [{"type": "text", "text": "done"}], "id": "m-1", "source": "model"},
                      "finishReason": "stop"}
    assert state.observations.model_inputs == {"m": [{"messages": []}, {"messages": []}]}


async def test_a_scripted_function_records_its_argument():
    state = make_bindings({"functions": {"f": {"op": "textSuffix", "suffix": "!"}}})
    function = RuntimeBindings(state, "runtime-1").functions["f"]
    assert await function("hi") == "hi!"
    assert state.observations.function_calls == [{"fn": "f", "value": "hi"}]


async def test_an_extension_script_logs_its_options_creation_events_and_disposal():
    state = make_bindings({"extensions": {"memory": {
        "definition": {"requires": ["note"], "hooks": ["modelInput"], "tools": [], "validateOptions": {"op": "identity"}},
        "instance": {"hooks": {"modelInput": {"op": "append", "messages": [{"role": "user", "text": "remember"}]}},
                     "events": ["turn.done"]},
    }}})
    definition = RuntimeBindings(state, "runtime-1").extensions["memory"]
    assert definition.requires == ("note",) and definition.hooks == ("modelInput",) and definition.tools == ()
    assert await definition.validate_options({"prefix": "a"}) == {"prefix": "a"}
    instance = definition.create(options={"prefix": "a"}, ports={"note": "n"},
                                 agent={"name": "main", "path": "main", "spec": {}}, log=object())
    context = FakeHookContext()
    assert await instance.hooks["modelInput"]({"messages": []}, context) == {"append": context.appended}
    await instance.on["turn.done"]({"name": "turn.done"})
    await instance.dispose()
    assert state.observations.extension_log == [
        {"action": "validateOptions", "extension": "memory", "options": {"prefix": "a"}},
        {"action": "create", "instance": 1, "extension": "memory", "options": {"prefix": "a"},
         "ports": {"note": "n"}, "agent": {"name": "main", "path": "main", "spec": {}}},
        {"action": "event", "instance": 1, "name": "turn.done"},
        {"action": "dispose", "instance": 1},
    ]
    assert state.observations.hook_calls == [{"extension": "memory", "stage": "modelInput", "value": {"messages": []}}]
    assert state.observations.hook_contexts == [{"extension": "memory", "stage": "modelInput", "agent": "main",
                                                 "conversationId": "c1", "turnId": "t1", "input": "hi",
                                                 "conversation": [], "retryCount": 0}]


async def test_an_extension_that_declares_a_creation_error_fails_to_create():
    state = make_bindings({"extensions": {"broken": {"definition": {"createError": "no"}}}})
    definition = RuntimeBindings(state, "runtime-1").extensions["broken"]
    with pytest.raises(ScriptError):
        definition.create(options={}, ports={}, agent={"name": "main", "path": "main", "spec": {}}, log=None)
    assert state.observations.extension_log[0]["action"] == "create"


async def test_the_complete_operation_uses_the_tool_result_content_when_asked():
    state = make_bindings({"extensions": {"finish": {"instance": {"hooks": {"toolResult": {
        "op": "complete", "tool": "done", "useResultContent": True,
        "message": {"role": "assistant", "source": "tool", "content": []},
    }}}}}})
    definition = RuntimeBindings(state, "runtime-1").extensions["finish"]
    instance = definition.create(options={}, ports={}, agent={"name": "main", "path": "main", "spec": {}}, log=None)
    context = FakeHookContext()
    result = {"callId": "c-1", "name": "done", "args": {}, "content": [{"type": "text", "text": "bye"}]}
    assert await instance.hooks["toolResult"](result, context) is None
    assert context.execution.output["content"] == [{"type": "text", "text": "bye"}]
    assert await instance.hooks["toolResult"]({"name": "other", "content": []}, context) is None


async def test_only_the_host_callbacks_a_case_lists_are_provided():
    state = make_bindings({"host": {"validateOperation": True, "requestApproval": {"op": "constant", "value": None}}})
    host = RuntimeBindings(state, "runtime-1").host
    assert hasattr(host, "validate_operation") and hasattr(host, "request_approval")
    assert not hasattr(host, "deliver_operation_completion")
    assert await host.validate_operation({"operationId": "op-1", "createdAt": 1}) is True
    assert await host.request_approval({"tool": "danger"}) is None
    assert state.observations.host_calls == [{"callback": "validateOperation", "value": {"operationId": "op-1"}},
                                             {"callback": "requestApproval", "value": {"tool": "danger"}}]


async def test_the_input_patch_callback_receives_both_arguments_as_one_value():
    state = make_bindings({"host": {"validateOperationInputPatch": True}})
    host = RuntimeBindings(state, "runtime-1").host
    assert await host.validate_operation_input_patch({"operationId": "op-1", "updatedAt": 2}, {"env": "staging"}) is True
    assert state.observations.host_calls == [{"callback": "validateOperationInputPatch",
                                              "value": {"operation": {"operationId": "op-1"}, "inputPatch": {"env": "staging"}}}]


async def test_the_event_sink_projects_the_event_and_checks_its_time():
    state = make_bindings({})
    receive = RuntimeBindings(state, "runtime-1").emit()
    await receive({"name": "turn.start", "agent": "main", "conversationId": "c1", "turnId": "t1", "at": "now",
                   "data": {"input": "hi"}})
    assert state.observations.events == [{"name": "turn.start", "agent": "main", "conversationId": "c1",
                                          "turnId": "t1", "data": {"input": "hi"}}]
    assert state.problems == ["the event 'turn.start' must have a number 'at'"]


async def test_the_conversation_store_keeps_every_scope_apart():
    state = make_bindings({})
    store = state.conversation_store
    await store.append("a:b", "c", [{"id": "m-1", "role": "user", "content": []}])
    await store.append("a", "b:c", [{"id": "m-2", "role": "user", "content": []}])
    await store.replace("a", "b:c", [{"id": "m-3", "role": "user", "content": []}])
    assert list(store.observation()) == ["a:b/c", "a/b:c"]
    assert store.observation()["a/b:c"] == [{"id": "m-3", "role": "user", "content": []}]


def test_library_problems_reports_an_entry_that_is_not_a_case(tmp_path):
    (tmp_path / "README.md").write_text("x", encoding="utf-8")
    (tmp_path / "Good-Case").mkdir()
    (tmp_path / "notes.txt").write_text("x", encoding="utf-8")
    (tmp_path / ".hidden").mkdir()
    problems = library_problems(tmp_path)
    assert len(problems) == 2


def test_case_directory_problems_reports_a_missing_file_and_an_entry_a_case_may_not_have(tmp_path):
    (tmp_path / "case.json").write_text("{}", encoding="utf-8")
    (tmp_path / "config").mkdir()
    (tmp_path / "templates").mkdir()
    (tmp_path / ".DS_Store").write_text("x", encoding="utf-8")
    problems = case_directory_problems(tmp_path)
    assert problems == ["'templates' is not a directory a case may have", "the case has no expected.json"]


def test_discover_cases_reads_the_directories_in_code_point_order(tmp_path):
    for name in ("beta", "alpha", ".hidden"):
        (tmp_path / name).mkdir()
    (tmp_path / "README.md").write_text("x", encoding="utf-8")
    assert [entry.name for entry in discover_cases(tmp_path)] == ["alpha", "beta"]


# -- the runner's use of the host API -----------------------------------------------------


class FakeRuntime:
    """A runtime with only the members a test needs, so a missing one can be checked."""

    def __init__(self, operations=()):
        self.operations = list(operations)
        self.closed = False

    async def list_operations(self, conversation_id=None):
        return list(self.operations)

    async def close(self):
        self.closed = True


def make_runner(tmp_path, runtime, **case):
    case = {"description": "a case", "spec": ["에이전트"], "steps": [], **case}
    runner = CaseRunner(tmp_path, case, {"steps": []})
    runner.runtimes.append((runtime, RuntimeBindings(runner.state, "runtime-1")))
    return runner


def test_a_host_api_the_runtime_does_not_have_fails_as_unsupported(tmp_path):
    runner = make_runner(tmp_path, FakeRuntime())
    with pytest.raises(UnsupportedFeature) as found:
        runner.method("steer")
    assert str(found.value) == "unsupported by Python runner: runtime steer()"
    assert runner.state.unsupported == ["runtime steer()"]
    assert runner.method("close") is not None


async def test_the_observations_are_built_before_the_runtimes_are_closed(tmp_path):
    runtime = FakeRuntime([{"conversationId": "c1", "operationId": "op-1", "createdAt": 1, "updatedAt": 2}])
    runner = make_runner(tmp_path, runtime)
    runner.state.observations.extension_log.append({"action": "create", "instance": 1})
    await runner.collect()
    await runner.teardown()
    runner.state.observations.extension_log.append({"action": "dispose", "instance": 1})
    document = runner.build_document()
    assert runtime.closed is True
    assert document["observations"]["extensionLog"] == [{"action": "create", "instance": 1}]
    assert document["observations"]["operations"] == [{"conversationId": "c1", "operationId": "op-1"}]


async def test_the_operation_alias_of_a_step_is_read_from_the_operation_store(tmp_path):
    runner = make_runner(tmp_path, FakeRuntime())
    await runner.state.operation_store.save({"conversationId": "c9", "operationId": "op-1", "status": "pending",
                                             "deliveryStatus": "pending", "toolCall": {"id": "danger-1"}})
    assert runner.operation_arguments({"operation": "<op:danger-1>"}, "steps/0") == ("c9", "op-1")
    assert runner.operation_arguments({"operation": "other", "conversationId": "c1"}, "steps/0") == ("c1", "other")
    with pytest.raises(CaseFailure):
        runner.operation_arguments({"operation": "<op:missing>"}, "steps/0")
