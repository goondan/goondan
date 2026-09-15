"""§흐름 and §실행 결과: route declaration, route progression, the turn result and its runs."""

from __future__ import annotations

from typing import Any

import pytest

from goondan import (
    Extension,
    GoondanConfigError,
    GoondanExecutionError,
    InMemoryConversationStore,
    create_runtime,
    define_extension,
    define_tool,
)


def answer(text: str = "done", **extra: Any) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop", **extra}


def speaker(text: str, started: list[str] | None = None, name: str = "", **extra: Any):
    async def model(value: dict[str, Any]) -> dict[str, Any]:
        if started is not None:
            started.append(name)
        return answer(text, **extra)

    return model


def config_error(**kwargs: Any) -> list[tuple[str, str]]:
    with pytest.raises(GoondanConfigError) as error:
        create_runtime(**kwargs)
    return [(item["code"], item["path"]) for item in error.value.issues]


# --- route declaration and validation -------------------------------------------------------


def test_an_agent_the_flow_can_run_needs_a_route_of_its_own():
    issues = config_error(
        config={
            "agents": {"main": {"model": "m"}, "other": {"model": "m"}, "last": {"model": "m"}},
            "flow": {"in": "main", "routes": [{"from": "other", "to": "last"}, {"from": "last", "to": "out"}]},
        },
        models={"m": lambda value: None},
    )
    assert issues == [("flow.no_route", "/flow/in")]


def test_every_route_that_reaches_an_agent_without_a_route_is_reported():
    issues = config_error(
        config={
            "agents": {"main": {"model": "m"}, "quiet": {"model": "m"}},
            "flow": {"in": "main", "routes": [
                {"from": "main", "to": "quiet", "when": {"fn": "first"}},
                {"from": "main", "to": "quiet", "when": {"fn": "second"}},
            ]},
        },
        models={"m": lambda value: None},
        functions={"first": lambda value: True, "second": lambda value: True},
    )
    assert issues == [("flow.no_route", "/flow/routes/0/to"), ("flow.no_route", "/flow/routes/1/to")]


def test_a_cycle_of_routes_without_when_is_a_configuration_error():
    issues = config_error(
        config={
            "agents": {"a": {"model": "m"}, "b": {"model": "m"}},
            "flow": {"in": "a", "routes": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}, {"from": "b", "to": "out"}]},
        },
        models={"m": lambda value: None},
    )
    assert issues == [("flow.cycle", "/flow/routes/0"), ("flow.cycle", "/flow/routes/1")]


def test_a_cycle_that_holds_one_conditional_route_is_allowed():
    runtime = create_runtime(
        config={
            "agents": {"a": {"model": "m"}, "b": {"model": "m"}},
            "flow": {"in": "a", "routes": [{"from": "a", "to": "b"}, {"from": "b", "to": "a", "when": {"fn": "again"}}, {"from": "b", "to": "out"}]},
        },
        models={"m": lambda value: None},
        functions={"again": lambda value: False},
    )
    assert runtime.config["flow"]["in"] == "a"


def test_a_route_that_reaches_itself_without_when_is_a_cycle():
    issues = config_error(
        config={"agents": {"a": {"model": "m"}}, "flow": {"in": "a", "routes": [{"from": "a", "to": "a"}, {"from": "a", "to": "out"}]}},
        models={"m": lambda value: None},
    )
    assert issues == [("flow.cycle", "/flow/routes/0")]


def test_a_config_agent_route_may_not_carry_a_conversation(tmp_path):
    (tmp_path / "child.yaml").write_text("agents: {inner: {model: m}}\n", encoding="utf-8")
    issues = config_error(
        config={
            "agents": {"wrap": {"config": "child.yaml"}, "after": {"model": "m"}},
            "flow": {"in": "wrap", "routes": [{"from": "wrap", "to": "after", "carry": {"conversation": "asis"}}, {"from": "after", "to": "out"}]},
        },
        directory=str(tmp_path),
        models={"m": lambda value: None},
    )
    assert issues == [("flow.carry_conversation", "/flow/routes/0/carry/conversation")]


def test_a_route_to_a_missing_agent_reports_only_the_reference():
    issues = config_error(
        config={"agents": {"a": {"model": "m"}}, "flow": {"in": "a", "routes": [{"from": "a", "to": "ghost"}]}},
        models={"m": lambda value: None},
    )
    assert issues == [("reference.agent", "/flow/routes/0/to")]


def test_a_serial_flow_declares_a_route_from_every_item():
    runtime = create_runtime(
        config={"agents": {"a": {"model": "m"}, "b": {"model": "m"}}, "flow": ["a", "b"]},
        models={"m": lambda value: None},
    )
    assert runtime.config["flow"] == {"in": "a", "routes": [{"from": "a", "to": "b"}, {"from": "b", "to": "out"}]}


# --- route progression ----------------------------------------------------------------------


async def test_branches_run_depth_first_and_outputs_follow_the_order_they_are_reached():
    started: list[str] = []
    config = {
        "agents": {name: {"model": name} for name in ("split", "a", "b", "c")},
        "flow": {"in": "split", "routes": [
            {"from": "split", "to": "a"},
            {"from": "split", "to": "b"},
            {"from": "a", "to": "c"},
            {"from": "c", "to": "out"},
            {"from": "b", "to": "out"},
        ]},
    }
    models = {name: speaker(name, started, name) for name in ("split", "a", "b", "c")}
    runtime = create_runtime(config=config, models=models)
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert started == ["split", "a", "c", "b"]
        assert [output_text(message) for message in result["outputs"]] == ["c", "b"]
    finally:
        await runtime.close()


def output_text(message: dict[str, Any]) -> str:
    return "".join(part.get("text", "") for part in message["content"])


async def test_every_candidate_condition_runs_before_the_first_matched_route():
    order: list[str] = []
    config = {
        "agents": {name: {"model": "m"} for name in ("main", "left", "right")},
        "flow": {"in": "main", "routes": [
            {"from": "main", "to": "left", "when": {"fn": "yes"}},
            {"from": "main", "to": "right", "when": {"fn": "also"}},
            {"from": "left", "to": "out"},
            {"from": "right", "to": "out"},
        ]},
    }

    def condition(name: str):
        def decide(value: Any) -> bool:
            order.append(name)
            return True
        return decide

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        order.append("run")
        return answer()

    runtime = create_runtime(config=config, models={"m": model}, functions={"yes": condition("yes"), "also": condition("also")})
    try:
        await runtime.run_turn("start", conversation_id="c1")
        assert order == ["run", "yes", "also", "run", "run"]
    finally:
        await runtime.close()


@pytest.mark.parametrize("returned", ["true", 1, None, [], {}])
async def test_a_route_condition_that_does_not_return_a_boolean_is_a_flow_error(returned: Any):
    config = {
        "agents": {"main": {"model": "m"}, "next": {"model": "m"}},
        "flow": {"in": "main", "routes": [{"from": "main", "to": "next", "when": {"fn": "decide"}}, {"from": "next", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"m": speaker("done")}, functions={"decide": lambda value: returned})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1")
        assert (error.value.where, error.value.codes, error.value.attempt) == ("runtime", ["flow_error"], 1)
    finally:
        await runtime.close()


async def test_a_failing_route_condition_stops_before_the_remaining_candidates():
    seen: list[str] = []
    config = {
        "agents": {"main": {"model": "m"}, "next": {"model": "m"}},
        "flow": {"in": "main", "routes": [
            {"from": "main", "to": "next", "when": {"fn": "broken"}},
            {"from": "main", "to": "out", "when": {"fn": "later"}},
            {"from": "next", "to": "out"},
        ]},
    }

    def broken(value: Any) -> bool:
        raise RuntimeError("no")

    def later(value: Any) -> bool:
        seen.append("later")
        return True

    runtime = create_runtime(config=config, models={"m": speaker("done")}, functions={"broken": broken, "later": later})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1")
        assert error.value.codes == ["flow_error"]
        assert seen == []
    finally:
        await runtime.close()


async def test_a_flow_error_reports_no_event_and_reaches_no_error_stage():
    events: list[str] = []
    stages: list[Any] = []

    class Host:
        def emit(self, event: dict[str, Any]) -> None:
            events.append(event["name"])

    config = {
        "agents": {"main": {"model": "m", "hooks": {"error": [{"fn": "watch"}]}}, "next": {"model": "m"}},
        "flow": {"in": "main", "routes": [{"from": "main", "to": "next", "when": {"fn": "never"}}, {"from": "next", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"m": speaker("done")}, functions={"never": lambda value: False, "watch": lambda value: stages.append(value)}, host=Host())
    try:
        with pytest.raises(GoondanExecutionError):
            await runtime.run_turn("start", conversation_id="c1")
        assert stages == []
        assert events[-1] == "turn.done"
    finally:
        await runtime.close()


async def test_a_route_reached_twice_starts_a_new_run_every_time():
    turns: list[str] = []

    class Host:
        def emit(self, event: dict[str, Any]) -> None:
            if event["name"] == "turn.start" and event["agent"] == "leaf":
                turns.append(event["turnId"])

    config = {
        "agents": {"main": {"model": "m"}, "leaf": {"model": "m"}},
        "flow": {"in": "main", "routes": [
            {"from": "main", "to": "leaf", "when": {"fn": "yes"}},
            {"from": "main", "to": "leaf", "when": {"fn": "yes"}},
            {"from": "leaf", "to": "out"},
        ]},
    }
    runtime = create_runtime(config=config, models={"m": speaker("done")}, functions={"yes": lambda value: True}, host=Host())
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert len(turns) == 2 and turns[0] != turns[1]
        assert len(result["outputs"]) == 2
    finally:
        await runtime.close()


# --- route functions and carry --------------------------------------------------------------


async def test_a_route_function_receives_the_output_text_the_input_and_the_conversation():
    seen: list[dict[str, Any]] = []

    async def first(value: dict[str, Any]) -> dict[str, Any]:
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": "T"}, {"type": "json", "value": {"k": 1}}]}, "finishReason": "stop"}

    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "when": {"fn": "watch"}}, {"from": "second", "to": "out"}]},
    }

    def watch(value: dict[str, Any]) -> bool:
        seen.append(value)
        return True

    runtime = create_runtime(config=config, models={"first": first, "second": speaker("done")}, functions={"watch": watch})
    try:
        await runtime.run_turn({"text": "hello"}, conversation_id="c1")
        assert seen[0]["output"] == 'T{"k":1}'
        assert seen[0]["input"] == {"text": "hello"}
        assert [message["role"] for message in seen[0]["conversation"]] == ["user", "assistant"]
    finally:
        await runtime.close()


async def test_carry_message_uses_the_output_text_a_function_or_a_template(tmp_path):
    template = tmp_path / "request.md"
    template.write_text("carried:{{ output }}", encoding="utf-8")
    received: list[Any] = []

    async def target(value: dict[str, Any]) -> dict[str, Any]:
        received.append(value["messages"][0]["content"][0]["text"])
        return answer()

    async def run(rule: Any) -> None:
        config = {
            "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
            "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"message": rule}}, {"from": "second", "to": "out"}]},
        }
        runtime = create_runtime(
            config=config, directory=str(tmp_path),
            models={"first": speaker("source"), "second": target},
            functions={"shout": lambda value: value["output"].upper()},
        )
        try:
            await runtime.run_turn("start", conversation_id="c1")
        finally:
            await runtime.close()

    await run("output")
    await run({"fn": "shout"})
    await run({"template": str(template)})
    assert received == ["source", "SOURCE", "carried:source"]


async def test_a_carry_message_function_that_returns_nothing_hands_over_null():
    received: list[str] = []

    async def target(value: dict[str, Any]) -> dict[str, Any]:
        received.append(value["messages"][0]["content"][0]["text"])
        return answer()

    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"message": {"fn": "nothing"}}}, {"from": "second", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"first": speaker("source"), "second": target}, functions={"nothing": lambda value: None})
    try:
        await runtime.run_turn("start", conversation_id="c1")
        assert received == ["null"]
    finally:
        await runtime.close()


async def test_a_config_agent_endpoint_reports_an_empty_conversation_to_the_route_functions(tmp_path):
    (tmp_path / "inner").mkdir()
    (tmp_path / "inner" / "goondan.yaml").write_text("agents: {helper: {model: helper}}\n", encoding="utf-8")
    seen: list[dict[str, Any]] = []

    def decide(value: dict[str, Any]) -> bool:
        seen.append(value)
        return True

    config = {
        "agents": {"wrap": {"config": "inner"}, "after": {"model": "after"}},
        "flow": {"in": "wrap", "routes": [{"from": "wrap", "to": "after", "when": {"fn": "decide"}}, {"from": "after", "to": "out"}]},
    }
    runtime = create_runtime(config=config, directory=str(tmp_path), models={"helper": speaker("helped"), "after": speaker("done")}, functions={"decide": decide})
    try:
        await runtime.run_turn("start", conversation_id="c1")
        assert seen == [{"output": "helped", "input": "start", "conversation": []}]
    finally:
        await runtime.close()


async def test_a_failing_carry_template_is_a_flow_error(tmp_path):
    template = tmp_path / "request.md"
    template.write_text("{{ missing.key }}", encoding="utf-8")
    config = {
        "agents": {"first": {"model": "m"}, "second": {"model": "m"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"message": {"template": str(template)}}}, {"from": "second", "to": "out"}]},
    }
    runtime = create_runtime(config=config, directory=str(tmp_path), models={"m": speaker("done")})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1")
        assert error.value.codes == ["flow_error"]
    finally:
        await runtime.close()


async def test_carry_conversation_asis_replaces_the_stored_conversation_before_the_input_stage():
    store = InMemoryConversationStore()
    seen: list[int] = []

    async def target(value: dict[str, Any]) -> dict[str, Any]:
        seen.append(len(value["messages"]))
        return answer()

    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"conversation": "asis"}}, {"from": "second", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"first": speaker("source"), "second": target}, conversation_store=store)
    try:
        await runtime.run_turn("start", conversation_id="c1")
        # the carried user message and reply, the carried input and the new reply
        assert seen == [3]
        stored = await store.load("c1", "second")
        assert [message["role"] for message in stored] == ["user", "assistant", "user", "assistant"]
    finally:
        await runtime.close()


@pytest.mark.parametrize("returned", [
    "text",
    [{"role": "user"}],
    [{"id": "m1", "role": "user"}],
    [{"id": "m1", "role": 1, "content": []}],
    [{"id": "m1", "role": "user", "content": "text"}],
])
async def test_a_carry_conversation_function_must_return_an_array_of_messages(returned: Any):
    config = {
        "agents": {"first": {"model": "m"}, "second": {"model": "m"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"conversation": {"fn": "shorten"}}}, {"from": "second", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"m": speaker("done")}, functions={"shorten": lambda value: returned})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1")
        assert (error.value.where, error.value.codes) == ("runtime", ["flow_error"])
    finally:
        await runtime.close()


async def test_a_carried_message_must_satisfy_the_whole_message_definition():
    """§route 함수와 `carry`: every carried item is a `message`, so a string `source` is required."""
    store = InMemoryConversationStore()
    seen: list[list[dict[str, Any]]] = []

    async def target(value: dict[str, Any]) -> dict[str, Any]:
        seen.append(value["messages"])
        return answer()

    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"conversation": {"fn": "shorten"}}}, {"from": "second", "to": "out"}]},
    }
    carried = [{"id": "m1", "role": "user", "source": "user", "content": [{"type": "text", "text": "kept"}]}]
    runtime = create_runtime(
        config=config, models={"first": speaker("source"), "second": target},
        functions={"shorten": lambda value: carried}, conversation_store=store,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        assert seen[0][0] == carried[0]
        assert (await store.load("c1", "second"))[0] == carried[0]
    finally:
        await runtime.close()


async def test_a_carried_message_without_a_source_fails_the_flow():
    """§route 함수와 `carry`: the next agent never starts when one carried item is not a message."""
    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"conversation": {"fn": "shorten"}}}, {"from": "second", "to": "out"}]},
    }
    started: list[str] = []

    async def target(value: dict[str, Any]) -> dict[str, Any]:
        started.append("second")
        return answer()

    carried = [{"id": "m1", "role": "user", "content": [{"type": "text", "text": "kept"}]}]
    runtime = create_runtime(
        config=config, models={"first": speaker("source"), "second": target},
        functions={"shorten": lambda value: carried},
    )
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1")
        assert (error.value.where, error.value.codes) == ("runtime", ["flow_error"])
        assert started == []
    finally:
        await runtime.close()


async def test_a_carried_conversation_stays_stored_when_the_next_run_fails():
    store = InMemoryConversationStore()

    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("no model")

    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "carry": {"conversation": "asis"}}, {"from": "second", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"first": speaker("source"), "second": broken}, conversation_store=store)
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1")
        assert error.value.codes == ["model_error"]
        stored = await store.load("c1", "second")
        assert [message["role"] for message in stored] == ["user", "assistant", "user"]
    finally:
        await runtime.close()


# --- start agent and single agent runs --------------------------------------------------------


async def test_a_start_agent_without_a_route_of_its_own_runs_nothing():
    started: list[str] = []
    config = {
        "agents": {"main": {"model": "m"}, "lonely": {"model": "m"}},
        "flow": {"in": "main", "routes": [{"from": "main", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"m": speaker("done", started, "m")})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1", start_agent="lonely")
        assert error.value.codes == ["flow_error"]
        assert started == []
    finally:
        await runtime.close()


@pytest.mark.parametrize("options", [{"agent": "ghost"}, {"start_agent": "ghost"}, {"agent": "main", "start_agent": "main"}])
async def test_an_agent_the_turn_cannot_resolve_is_a_flow_error(options: dict[str, Any]):
    started: list[str] = []
    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": speaker("done", started, "m")})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("start", conversation_id="c1", **options)
        assert (error.value.where, error.value.codes) == ("runtime", ["flow_error"])
        assert started == []
    finally:
        await runtime.close()


async def test_a_single_agent_run_follows_no_route():
    started: list[str] = []
    config = {
        "agents": {"main": {"model": "main"}, "next": {"model": "next"}},
        "flow": {"in": "main", "routes": [{"from": "main", "to": "next"}, {"from": "next", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"main": speaker("only", started, "main"), "next": speaker("more", started, "next")})
    try:
        result = await runtime.run_turn("start", conversation_id="c1", agent="main")
        assert started == ["main"]
        assert [record["kind"] for record in result["runs"]] == ["flow"]
        assert output_text(result["output"]) == "only"
    finally:
        await runtime.close()


# --- turn result ------------------------------------------------------------------------------


async def test_one_output_is_the_representative_output_and_keeps_its_finish_reason():
    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": speaker("done", finishReason="length")})
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert result["status"] == "done"
        assert result["finishReason"] == "length"
        assert result["outputs"] == [result["output"]]
    finally:
        await runtime.close()


async def test_several_outputs_are_joined_into_one_flow_message_with_a_shared_finish_reason():
    config = {
        "agents": {"split": {"model": "split"}, "a": {"model": "a"}, "b": {"model": "b"}},
        "flow": {"in": "split", "routes": [
            {"from": "split", "to": "a"},
            {"from": "split", "to": "b"},
            {"from": "a", "to": "out"},
            {"from": "b", "to": "out"},
        ]},
    }
    models = {"split": speaker("split"), "a": speaker("first", finishReason="length"), "b": speaker("second", finishReason="length")}
    runtime = create_runtime(config=config, models=models)
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert result["output"]["role"] == "assistant" and result["output"]["source"] == "flow"
        assert result["output"]["content"] == [{"type": "text", "text": "first\n\nsecond"}]
        assert set(result["output"]) == {"id", "role", "content", "source"}
        assert result["finishReason"] == "length"
        assert [output_text(message) for message in result["outputs"]] == ["first", "second"]
    finally:
        await runtime.close()


async def test_outputs_with_different_finish_reasons_report_other():
    config = {
        "agents": {"split": {"model": "split"}, "a": {"model": "a"}, "b": {"model": "b"}},
        "flow": {"in": "split", "routes": [
            {"from": "split", "to": "a"},
            {"from": "split", "to": "b"},
            {"from": "a", "to": "out"},
            {"from": "b", "to": "out"},
        ]},
    }
    models = {"split": speaker("split"), "a": speaker("first"), "b": speaker("second", finishReason="length")}
    runtime = create_runtime(config=config, models=models)
    try:
        assert (await runtime.run_turn("start", conversation_id="c1"))["finishReason"] == "other"
    finally:
        await runtime.close()


# --- agent run records --------------------------------------------------------------------------


def usage(**values: int) -> dict[str, int]:
    return {"input": values.get("input", 0), "output": values.get("output", 0), "cacheRead": values.get("cacheRead", 0), "cacheWrite": values.get("cacheWrite", 0)}


async def test_runs_list_every_awaited_run_in_the_order_the_specification_gives(tmp_path):
    (tmp_path / "inner").mkdir()
    (tmp_path / "inner" / "goondan.yaml").write_text("agents: {helper: {model: helper}}\n", encoding="utf-8")
    calls = {"main": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        calls["main"] += 1
        if calls["main"] == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "w-1", "name": "worker", "args": {}}]}, "finishReason": "tool", "usage": usage(input=1)}
        return answer("ready", usage=usage(input=2))

    config = {
        "agents": {
            "main": {"model": "main", "tools": [{"agent": "worker"}], "hooks": {"output": [{"agent": ["reviewer", "checker"]}]}},
            "worker": {"model": "worker"},
            "reviewer": {"model": "reviewer"},
            "checker": {"model": "checker"},
            "wrap": {"config": "inner"},
        },
        "flow": ["main", "wrap"],
    }
    models = {
        "main": main,
        "worker": speaker("worked", **{"usage": usage(input=3)}),
        "reviewer": speaker("reviewed", **{"usage": usage(input=4)}),
        "checker": speaker("checked", **{"usage": usage(input=5)}),
        "helper": speaker("helped", **{"usage": usage(input=6)}),
    }
    runtime = create_runtime(config=config, directory=str(tmp_path), models=models)
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"]) for record in result["runs"]] == [
            ("main", "flow"), ("worker", "tool"), ("reviewer", "hook"), ("checker", "hook"), ("wrap/helper", "nested"),
        ]
        assert [record["usage"]["input"] for record in result["runs"]] == [3, 3, 4, 5, 6]
        assert all(record["status"] == "done" and record["finishReason"] == "stop" for record in result["runs"][1:])
        assert result["usage"] == usage(input=21)
    finally:
        await runtime.close()


async def test_a_sub_run_of_a_sub_run_is_listed_before_the_next_sub_run():
    attempts = {"main": 0, "worker": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        attempts["main"] += 1
        if attempts["main"] == 1:
            parts = [
                {"type": "tool.call", "callId": "w-1", "name": "worker", "args": {}},
                {"type": "tool.call", "callId": "s-1", "name": "second", "args": {}},
            ]
            return {"message": {"role": "assistant", "content": parts}, "finishReason": "tool", "usage": usage(input=1)}
        return answer("ready", usage=usage(input=1))

    async def worker(value: dict[str, Any]) -> dict[str, Any]:
        attempts["worker"] += 1
        if attempts["worker"] == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "d-1", "name": "deep", "args": {}}]}, "finishReason": "tool", "usage": usage(input=1)}
        return answer("worked", usage=usage(input=1))

    config = {
        "agents": {
            "main": {"model": "main", "tools": [{"agent": "worker"}, {"agent": "second"}]},
            "worker": {"model": "worker", "tools": [{"agent": "deep"}]},
            "deep": {"model": "deep"},
            "second": {"model": "second"},
        },
    }
    models = {"main": main, "worker": worker, "deep": speaker("dived"), "second": speaker("seconded")}
    runtime = create_runtime(config=config, models=models)
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"]) for record in result["runs"]] == [
            ("main", "flow"), ("worker", "tool"), ("deep", "tool"), ("second", "tool"),
        ]
    finally:
        await runtime.close()


async def test_the_runs_of_a_branching_flow_follow_the_order_the_steps_ran():
    config = {
        "agents": {name: {"model": name} for name in ("split", "a", "b", "c")},
        "flow": {"in": "split", "routes": [
            {"from": "split", "to": "a"},
            {"from": "split", "to": "b"},
            {"from": "a", "to": "c"},
            {"from": "c", "to": "out"},
            {"from": "b", "to": "out"},
        ]},
    }
    runtime = create_runtime(config=config, models={name: speaker(name) for name in ("split", "a", "b", "c")})
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [record["agent"] for record in result["runs"]] == ["split", "a", "c", "b"]
        assert all(record["kind"] == "flow" for record in result["runs"])
    finally:
        await runtime.close()


async def test_a_turn_usage_is_the_sum_of_its_run_usages_and_a_tool_context_run_is_a_tool_entry():
    async def tool_body(value: Any, ctx: Any) -> Any:
        return await ctx["run_agent"]("helper", "please")

    config = {
        "agents": {"main": {"model": "main", "tools": ["delegate"]}, "helper": {"model": "helper"}},
    }
    calls = {"main": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        calls["main"] += 1
        if calls["main"] == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "d-1", "name": "delegate", "args": {}}]}, "finishReason": "tool", "usage": usage(output=2)}
        return answer("ready", usage=usage(output=3))

    runtime = create_runtime(
        config=config,
        models={"main": main, "helper": speaker("helped", **{"usage": usage(output=7)})},
        tools={"delegate": define_tool(name="delegate", description="delegate", input={"type": "object"}, execute=tool_body)},
    )
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"], record["usage"]["output"]) for record in result["runs"]] == [("main", "flow", 5), ("helper", "tool", 7)]
        assert result["usage"] == usage(output=12)
    finally:
        await runtime.close()


async def test_a_hook_model_call_becomes_a_model_entry_of_the_requesting_run():
    async def hook(value: Any, ctx: Any) -> Any:
        await ctx.run_model([{"id": "m1", "role": "user", "source": "hook", "content": [{"type": "text", "text": "hi"}]}])
        return None

    calls = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        calls["count"] += 1
        return answer("done", usage=usage(input=calls["count"]))

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": model},
        extensions={"ext": define_extension(name="ext", hooks=["conversation"], create=lambda **kwargs: Extension(hooks={"conversation": hook}))},
    )
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"], record["usage"]["input"]) for record in result["runs"]] == [("main", "flow", 2), ("main", "model", 1)]
        assert result["runs"][1]["turnId"] == result["runs"][0]["turnId"]
        assert result["usage"] == usage(input=3)
    finally:
        await runtime.close()


async def test_a_recovered_agent_tool_keeps_the_entry_of_the_run_that_failed():
    attempts = {"main": 0, "helper": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        attempts["main"] += 1
        if attempts["main"] == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "h-1", "name": "helper", "args": {}}]}, "finishReason": "tool", "usage": usage(input=1)}
        return answer("ready", usage=usage(input=1))

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        attempts["helper"] += 1
        if attempts["helper"] == 1:
            raise RuntimeError("no")
        return answer("helped", usage=usage(input=5))

    config = {
        "agents": {
            "main": {"model": "main", "tools": [{"agent": "helper"}], "hooks": {"error": [{"fn": "again"}]}},
            "helper": {"model": "helper"},
        },
    }
    runtime = create_runtime(config=config, models={"main": main, "helper": helper}, functions={"again": lambda value: {"retry": True, "target": "tool"}})
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"], record["status"]) for record in result["runs"]] == [
            ("main", "flow", "done"), ("helper", "tool", "failed"), ("helper", "tool", "done"),
        ]
        assert result["usage"] == usage(input=7)
    finally:
        await runtime.close()


async def test_a_failed_hook_agent_leaves_a_failed_entry_and_the_turn_continues():
    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("no")

    config = {
        "agents": {
            "main": {"model": "main", "hooks": {"output": [{"agent": "helper", "optional": True}]}},
            "helper": {"model": "helper"},
        },
    }
    runtime = create_runtime(config=config, models={"main": speaker("done", **{"usage": usage(input=4)}), "helper": broken})
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["kind"], record["status"], "finishReason" in record) for record in result["runs"]] == [("flow", "done", True), ("hook", "failed", False)]
        assert result["runs"][1]["usage"] == usage()
        assert result["usage"] == usage(input=4)
    finally:
        await runtime.close()


async def test_a_failed_model_run_leaves_an_entry_with_no_usage_and_no_finish_reason():
    attempts = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("no")
        return answer("done", usage=usage(input=2))

    async def hook(value: Any, ctx: Any) -> Any:
        with pytest.raises(Exception):
            await ctx.run_model([{"id": "m1", "role": "user", "source": "u", "content": [{"type": "text", "text": "x"}]}])
        return None

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"input": [{"extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": model},
        extensions={"ext": define_extension(name="ext", hooks=["input"], create=lambda **kwargs: Extension(hooks={"input": hook}))},
    )
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"], record["status"], "finishReason" in record) for record in result["runs"]] == [
            ("main", "flow", "done", True), ("main", "model", "failed", False),
        ]
        assert result["runs"][1]["usage"] == usage()
        assert result["usage"] == usage(input=2)
    finally:
        await runtime.close()


async def test_the_turn_done_usage_leaves_out_the_runs_this_run_started():
    events: list[dict[str, Any]] = []
    attempts = {"main": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        attempts["main"] += 1
        if attempts["main"] == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "h-1", "name": "helper", "args": {}}]}, "finishReason": "tool", "usage": usage(input=5)}
        return answer("ready", usage=usage(input=1))

    config = {"agents": {"main": {"model": "main", "tools": [{"agent": "helper"}]}, "helper": {"model": "helper"}}}
    runtime = create_runtime(
        config=config, models={"main": main, "helper": speaker("helped", **{"usage": usage(input=100)})},
        emit=lambda event: events.append(event),
    )
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        done = next(event for event in events if event["name"] == "turn.done" and event["agent"] == "main")
        assert done["data"]["usage"] == usage(input=6)
        assert done["data"]["steps"] == 2
        assert result["usage"] == usage(input=106)
    finally:
        await runtime.close()


async def test_an_asynchronous_hook_run_is_left_out_of_the_turn_runs():
    config = {
        "agents": {
            "main": {"model": "main", "hooks": {"conversation": [{"agent": "helper", "mode": "async"}]}},
            "helper": {"model": "helper"},
        },
    }
    runtime = create_runtime(config=config, models={"main": speaker("done", **{"usage": usage(input=2)}), "helper": speaker("helped", **{"usage": usage(input=9)})})
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        await runtime.idle()
        assert [(record["agent"], record["kind"]) for record in result["runs"]] == [("main", "flow")]
        assert result["usage"] == usage(input=2)
    finally:
        await runtime.close()


async def test_a_nested_configuration_adds_nested_entries_and_its_usage(tmp_path):
    (tmp_path / "inner").mkdir()
    (tmp_path / "inner" / "goondan.yaml").write_text("agents: {helper: {model: helper}}\nflow: [helper]\n", encoding="utf-8")
    config = {"agents": {"main": {"model": "main"}, "wrap": {"config": "inner"}}, "flow": ["main", "wrap"]}
    runtime = create_runtime(
        config=config, directory=str(tmp_path),
        models={"main": speaker("first", **{"usage": usage(input=3)}), "helper": speaker("second", **{"usage": usage(input=4), "finishReason": "length"})},
    )
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"]) for record in result["runs"]] == [("main", "flow"), ("wrap/helper", "nested")]
        assert result["usage"] == usage(input=7)
        # §종료 사유: a config agent's output uses the finish reason of its nested turn.
        assert result["finishReason"] == "length"
        assert output_text(result["output"]) == "second"
    finally:
        await runtime.close()


async def test_an_agent_tool_that_runs_a_nested_configuration_lists_the_agents_it_ran(tmp_path):
    (tmp_path / "inner").mkdir()
    (tmp_path / "inner" / "goondan.yaml").write_text("agents: {helper: {model: helper}}\n", encoding="utf-8")
    attempts = {"main": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        attempts["main"] += 1
        if attempts["main"] == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "w-1", "name": "wrap", "args": {}}]}, "finishReason": "tool", "usage": usage(input=1)}
        return answer("ready", usage=usage(input=2))

    config = {"agents": {"main": {"model": "main", "tools": [{"agent": "wrap"}]}, "wrap": {"config": "inner"}}, "flow": ["main"]}
    runtime = create_runtime(config=config, directory=str(tmp_path), models={"main": main, "helper": speaker("helped", **{"usage": usage(input=8)})})
    try:
        result = await runtime.run_turn("start", conversation_id="c1")
        assert [(record["agent"], record["kind"]) for record in result["runs"]] == [("main", "flow"), ("wrap/helper", "nested")]
        assert result["usage"] == usage(input=11)
    finally:
        await runtime.close()
