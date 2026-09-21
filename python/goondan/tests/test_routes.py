from __future__ import annotations

import asyncio
from typing import Any

import pytest

from goondan import GoondanConfigError, GoondanExecutionError, InMemoryStore, create_goondan, validate_config


def issues(error: pytest.ExceptionInfo[GoondanConfigError]) -> list[tuple[str, str]]:
    return [(item["code"], item["path"]) for item in error.value.issues]


class EchoModel:
    def __init__(self, gates: dict[str, asyncio.Event] | None = None) -> None:
        self.gates = gates or {}
        self.started: list[str] = []
        self.inputs: dict[str, list[dict[str, Any]]] = {}

    async def generate(self, value: dict[str, Any], ctx: Any) -> dict[str, Any]:
        self.started.append(ctx.agent)
        self.inputs[ctx.agent] = value["messages"]
        gate = self.gates.get(ctx.agent)
        if gate is not None:
            await gate.wait()
        text = "+".join(
            part["text"]
            for message in value["messages"]
            if message["role"] == "user"
            for part in message["content"]
            if part["type"] == "text"
        )
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": f"{ctx.agent}:{text}"}]}, "finishReason": "stop"}


def routes(*items: tuple[str, str]) -> list[dict[str, str]]:
    return [{"from": source, "to": target} for source, target in items]


def test_serial_routes_are_normalized_and_omission_stays_omitted():
    serial = validate_config({"agents": {"a": {"model": "m"}, "b": {"model": "m"}}, "routes": ["a", "b"]})
    assert serial["routes"] == routes(("$input", "a"), ("a", "b"), ("b", "$output"))
    assert "routes" not in validate_config({"agents": {"a": {"model": "m"}}})


@pytest.mark.parametrize(
    ("declared", "expected"),
    [
        ([{"from": "$input", "to": "$output"}], [("routes.no_input", "/routes"), ("routes.reserved", "/routes/0")]),
        ([{"from": "a", "to": "$output"}], [("routes.no_input", "/routes"), ("routes.unreachable", "/routes/0/from")]),
    ],
)
def test_route_reference_errors(declared: list[dict[str, str]], expected: list[tuple[str, str]]):
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m"}}, "routes": declared})
    assert issues(error) == expected


def test_output_route_is_optional():
    config = validate_config({"agents": {"a": {"model": "m"}}, "routes": [{"from": "$input", "to": "a"}]})
    assert config["routes"] == [{"from": "$input", "to": "a"}]


def test_unconditional_cycle_and_wait_cycle_are_rejected():
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m"}}, "routes": routes(("$input", "a"), ("a", "a"), ("a", "$output"))})
    assert ("routes.cycle", "/routes/1") in issues(error)
    declared = [
        {"from": "$input", "to": "a"}, {"from": "$input", "to": "b"},
        {"from": "a", "to": "b", "when": {"output": "go"}},
        {"from": "b", "to": "a", "when": {"output": "go"}},
        {"from": "a", "to": "$output"}, {"from": "b", "to": "$output"},
    ]
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m"}, "b": {"model": "m"}}, "routes": declared})
    assert ("routes.wait_cycle", "/routes") in issues(error)


@pytest.mark.parametrize(
    ("when", "expected"),
    [
        ({"fn": "f", "output": "x"}, ("schema.oneOf", "/routes/1/when")),
        ({"output": 5}, ("schema.anyOf", "/routes/1/when/output")),
    ],
)
def test_route_when_schema_errors_keep_the_nested_position(when: dict[str, Any], expected: tuple[str, str]):
    declared = [
        {"from": "$input", "to": "a"},
        {"from": "a", "to": "$output", "when": when},
    ]
    with pytest.raises(GoondanConfigError) as error:
        validate_config({"agents": {"a": {"model": "m"}}, "routes": declared})
    assert issues(error) == [expected]


@pytest.mark.asyncio
async def test_parallel_branches_start_together_and_outputs_follow_route_order():
    left, right = asyncio.Event(), asyncio.Event()
    model = EchoModel({"left": left, "right": right})
    config = {
        "agents": {name: {"model": "m"} for name in ("split", "left", "right")},
        "routes": routes(("$input", "split"), ("split", "left"), ("split", "right"), ("left", "$output"), ("right", "$output")),
    }
    turn = asyncio.create_task(create_goondan(config=config, models={"m": model}).run("x", session_id="s"))
    while not {"left", "right"} <= set(model.started):
        await asyncio.sleep(0)
    right.set()
    await asyncio.sleep(0)
    left.set()
    result = await turn
    assert [item["content"][0]["text"].split(":", 1)[0] for item in result["outputs"]] == ["left", "right"]
    assert result["output"] == "\n\n".join(item["content"][0]["text"] for item in result["outputs"])


@pytest.mark.asyncio
async def test_stateful_fan_in_runs_once_in_route_order_with_route_metadata():
    model = EchoModel()
    config = {
        "agents": {name: {"model": "m"} for name in ("split", "a", "b", "join")},
        "routes": routes(("$input", "split"), ("split", "a"), ("split", "b"), ("a", "join"), ("b", "join"), ("join", "$output")),
    }
    result = await create_goondan(config=config, models={"m": model}).run("x", session_id="s")
    assert [run["agent"] for run in result["runs"]].count("join") == 1
    joined = [message for message in model.inputs["join"] if message["role"] == "user"]
    assert [message["meta"]["from"] for message in joined[-2:]] == ["a", "b"]
    assert [message["meta"]["instance"] for message in joined[-2:]] == ["s/a", "s/b"]


@pytest.mark.asyncio
async def test_initial_inputs_are_all_registered_before_stateful_start_checks():
    model = EchoModel()
    config = {
        "agents": {name: {"model": "m"} for name in ("x", "y")},
        "routes": routes(("$input", "x"), ("$input", "y"), ("y", "x"), ("x", "$output")),
    }
    await create_goondan(config, models={"m": model}).run("host", session_id="s")
    assert model.started == ["y", "x"]
    inputs = [message["content"][0]["text"] for message in model.inputs["x"] if message["role"] == "user"]
    assert inputs == ["host", "y:host"]


@pytest.mark.asyncio
async def test_fan_in_runs_on_input_for_each_arrival_and_on_prompt_once_for_the_bundle():
    model = EchoModel()
    seen_inputs: list[list[str]] = []
    seen_prompts: list[list[str]] = []

    def texts(messages: list[dict[str, Any]]) -> list[str]:
        return [
            part["text"]
            for message in messages
            for part in message["content"]
            if part["type"] == "text"
        ]

    def on_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen_inputs.append(texts(messages))
        return messages

    def on_prompt(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen_prompts.append(texts(messages))
        return messages

    config = {
        "agents": {
            "split": {"model": "m"},
            "a": {"model": "m"},
            "b": {"model": "m"},
            "join": {"model": "m", "hooks": {"onInput": [{"fn": "on_input"}], "onPrompt": [{"fn": "on_prompt"}]}},
        },
        "routes": routes(("$input", "split"), ("split", "a"), ("split", "b"), ("a", "join"), ("b", "join"), ("join", "$output")),
    }

    await create_goondan(config, models={"m": model}, functions={"on_input": on_input, "on_prompt": on_prompt}).run("host", session_id="fan-in-hooks")

    assert seen_inputs == [["a:split:host"], ["b:split:host"]]
    assert seen_prompts == [["a:split:host", "b:split:host"]]


@pytest.mark.asyncio
async def test_stateless_fan_in_runs_for_each_arrival_without_storing_conversation():
    model = EchoModel()
    config = {
        "agents": {"split": {"model": "m"}, "a": {"model": "m"}, "b": {"model": "m"}, "join": {"model": "m", "stateful": False}},
        "routes": routes(("$input", "split"), ("split", "a"), ("split", "b"), ("a", "join"), ("b", "join"), ("join", "$output")),
    }
    goondan = create_goondan(config=config, models={"m": model})
    result = await goondan.run("x", session_id="s")
    joins = [run for run in result["runs"] if run["agent"] == "join"]
    assert len(joins) == 2 and joins[0]["instance"] != joins[1]["instance"]
    assert ("s", "join") not in goondan._conversation_projection.conversations


@pytest.mark.asyncio
async def test_when_function_and_output_conditions_use_message_values():
    seen: list[dict[str, Any]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": '{"route":"yes","extra":1}'}, {"type": "json", "value": "ignored"}]}, "finishReason": "stop"}

    config = {
        "agents": {"a": {"model": "m"}},
        "routes": [
            {"from": "$input", "to": "a", "when": {"fn": "input_ok"}},
            {"from": "a", "to": "$output", "when": {"output": {"route": "yes"}}},
        ],
    }
    goondan = create_goondan(config=config, models={"m": model}, functions={"input_ok": lambda value: seen.append(value) or True})
    await goondan.run({"kind": "x"}, session_id="s")
    assert seen[0]["output"] is None and seen[0]["text"] == '{"kind":"x"}'
    assert seen[0]["input"][0]["content"][0]["type"] == "json"


@pytest.mark.asyncio
async def test_later_route_conditions_keep_the_initial_turn_input():
    seen: list[dict[str, Any]] = []

    class Model:
        async def generate(self, value: dict[str, Any], ctx: Any) -> dict[str, Any]:
            return {"message": {"role": "assistant", "content": [{"type": "text", "text": ctx.agent}]}, "finishReason": "stop"}

    config = {
        "agents": {"a": {"model": "m"}, "b": {"model": "m"}},
        "routes": [
            {"from": "$input", "to": "a"},
            {"from": "a", "to": "b", "when": {"fn": "inspect"}},
            {"from": "b", "to": "$output"},
        ],
    }
    await create_goondan(config, models={"m": Model()}, functions={"inspect": lambda value: seen.append(value) or True}).run("host", session_id="s")
    assert seen[0]["input"][0]["source"] == "a"
    assert seen[0]["input"][0]["content"] == [{"type": "text", "text": "host"}]


@pytest.mark.asyncio
async def test_no_matching_route_and_non_boolean_condition_fail():
    config = {"agents": {"a": {"model": "m"}}, "routes": [{"from": "$input", "to": "a", "when": {"fn": "bad"}}, {"from": "a", "to": "$output"}]}
    no_match = create_goondan(config=config, models={"m": EchoModel()}, functions={"bad": lambda value: False})
    with pytest.raises(GoondanExecutionError) as no_match_error:
        await no_match.run("x", session_id="s")
    assert no_match_error.value.codes == ["route_error"]
    invalid = create_goondan(config=config, models={"m": EchoModel()}, functions={"bad": lambda value: "true"})
    with pytest.raises(GoondanExecutionError) as error:
        await invalid.run("x", session_id="s")
    assert error.value.codes == ["route_error"]


@pytest.mark.asyncio
async def test_function_route_passes_one_message_array_and_records_the_call():
    store = InMemoryStore()
    model = EchoModel()
    calls: list[list[dict[str, Any]]] = []

    def shape(messages: list[dict[str, Any]], context: Any) -> list[dict[str, Any]]:
        calls.append(messages)
        return [
            {"id": "f1", "role": "user", "source": "shape", "content": [{"type": "text", "text": "one"}]},
            {"id": "f2", "role": "user", "source": "shape", "content": [{"type": "text", "text": "two"}]},
        ]

    config = {
        "agents": {"a": {"model": "m"}},
        "routes": [
            {"from": "$input", "to": {"fn": "shape"}},
            {"from": {"fn": "shape"}, "to": "a"},
            {"from": "a", "to": "$output"},
        ],
    }
    result = await create_goondan(config, models={"m": model}, functions={"shape": shape}, store=store).run("host", session_id="function")

    assert len(calls) == 1 and calls[0][0]["content"][0]["text"] == "host"
    assert calls[0][0]["source"] == "input" and "meta" not in calls[0][0]
    assert [message["content"][0]["text"] for message in model.inputs["a"]] == ["one", "two"]
    assert result["output"] == "a:one+two"
    events = [event async for event in store.scan(session_id="function")]
    function_event = next(event for event in events if event["type"] == "route.function")
    assert function_event["data"]["status"] == "done" and function_event["data"]["fn"] == "shape"


@pytest.mark.asyncio
async def test_function_route_emits_each_returned_message_or_can_end_without_output():
    messages = [
        {"id": "f1", "role": "assistant", "source": "shape", "content": [{"type": "text", "text": "one"}]},
        {"id": "f2", "role": "assistant", "source": "shape", "content": [{"type": "text", "text": "two"}]},
    ]
    routes_with_output = [
        {"from": "$input", "to": {"fn": "shape"}},
        {"from": {"fn": "shape"}, "to": "$output"},
    ]
    emitted = await create_goondan(
        {"agents": {"a": {"model": "m"}}, "routes": routes_with_output},
        models={"m": EchoModel()}, functions={"shape": lambda value: messages},
    ).run("host", session_id="emitted")
    assert [item["content"][0]["text"] for item in emitted["outputs"]] == ["one", "two"]
    assert emitted["output"] == "one\n\ntwo"

    ended = await create_goondan(
        {"agents": {"a": {"model": "m"}}, "routes": routes_with_output},
        models={"m": EchoModel()}, functions={"shape": lambda value: None},
    ).run("host", session_id="ended")
    assert ended["outputs"] == [] and "output" not in ended


@pytest.mark.asyncio
async def test_parallel_function_routes_run_together_and_stateful_fan_in_waits_for_both():
    slow_started = asyncio.Event()
    fast_started = asyncio.Event()

    async def slow(value: Any) -> list[dict[str, Any]]:
        slow_started.set()
        await fast_started.wait()
        return [{"id": "slow", "role": "user", "source": "slow", "content": [{"type": "text", "text": "slow"}]}]

    async def fast(value: Any) -> list[dict[str, Any]]:
        fast_started.set()
        return [{"id": "fast", "role": "user", "source": "fast", "content": [{"type": "text", "text": "fast"}]}]

    model = EchoModel()
    config = {
        "agents": {"join": {"model": "m"}},
        "routes": [
            {"from": "$input", "to": {"fn": "slow"}},
            {"from": "$input", "to": {"fn": "fast"}},
            {"from": {"fn": "slow"}, "to": "join"},
            {"from": {"fn": "fast"}, "to": "join"},
            {"from": "join", "to": "$output"},
        ],
    }

    result = await asyncio.wait_for(
        create_goondan(config, models={"m": model}, functions={"slow": slow, "fast": fast}).run("host", session_id="parallel-functions"),
        1,
    )

    assert slow_started.is_set() and fast_started.is_set()
    assert [message["content"][0]["text"] for message in model.inputs["join"]] == ["slow", "fast"]
    assert result["output"] == "join:slow+fast"


@pytest.mark.asyncio
async def test_output_object_condition_rejects_non_rfc_json():
    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": '{"score":NaN}'}]}, "finishReason": "stop"}

    config = {
        "agents": {"a": {"model": "m"}},
        "routes": [
            {"from": "$input", "to": "a"},
            {"from": "a", "to": "$output", "when": {"output": {"score": 1}}},
        ],
    }
    with pytest.raises(GoondanExecutionError) as failure:
        await create_goondan(config, models={"m": model}).run("x", session_id="s")
    assert (failure.value.where, failure.value.codes) == ("runtime", ["route_error"])


@pytest.mark.asyncio
async def test_agent_runs_one_name_and_start_agent_continues_routes():
    model = EchoModel()
    config = {"agents": {"a": {"model": "m"}, "b": {"model": "m"}}, "routes": routes(("$input", "a"), ("a", "b"), ("b", "$output"))}
    goondan = create_goondan(config=config, models={"m": model})
    single = await goondan.run("x", session_id="single", agent="a")
    continued = await goondan.run("x", session_id="continued", start_agent="a")
    assert [run["agent"] for run in single["runs"]] == ["a"]
    assert [run["agent"] for run in continued["runs"]] == ["a", "b"]
