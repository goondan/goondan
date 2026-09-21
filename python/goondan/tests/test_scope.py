from __future__ import annotations

import asyncio
from typing import Any

import pytest

from goondan import Extension, GoondanAbortError, GoondanExecutionError, InMemoryStore, create_goondan, define_extension, fold


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


async def run_result(awaitable: Any) -> dict[str, Any]:
    return await (await awaitable).result


async def await_result(handle: Any) -> dict[str, Any]:
    return await handle.result


@pytest.mark.asyncio
async def test_create_goondan_accepts_positional_config_and_run_generates_a_session():
    goondan = create_goondan({"agents": {"main": {"model": "m"}}}, models={"m": lambda value: answer()})
    handle = await goondan.run("x")
    assert handle.session_id
    assert not hasattr(handle, "__await__")
    first, second = await asyncio.gather(handle.result, handle.result)
    assert first is second
    assert first["status"] == "done" and first["turnId"] == handle.turn_id


def test_v3_public_runtime_surface_has_one_store_and_no_steer_or_store_projections():
    import goondan as package

    runtime = create_goondan({"agents": {"main": {"model": "m"}}}, models={"m": lambda value: answer()})
    assert runtime.store is not None
    assert all(not hasattr(runtime, name) for name in (
        "steer", "conversation_store", "operation_store", "cancel_operation", "recover_operations",
    ))
    assert all(not hasattr(package, name) for name in (
        "Append", "Completion", "ExecutionHandle", "ConversationStore", "OperationStore",
        "InMemoryConversationStore", "InMemoryOperationStore",
    ))


@pytest.mark.asyncio
async def test_same_session_turns_are_serial_and_other_sessions_run_together():
    first_started = asyncio.Event()
    release = asyncio.Event()
    started: list[str] = []

    class Model:
        async def generate(self, value: dict[str, Any], ctx: Any) -> dict[str, Any]:
            started.append(ctx.session_id)
            if ctx.session_id == "same" and started.count("same") == 1:
                first_started.set()
                await release.wait()
            return answer()

    goondan = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": Model()})
    first = await goondan.run("1", session_id="same")
    await first_started.wait()
    second = await goondan.run("2", session_id="same")
    other = await goondan.run("3", session_id="other")
    await other.result
    assert started == ["same", "other"]
    release.set()
    await asyncio.gather(first.result, second.result)
    assert started == ["same", "other", "same"]


@pytest.mark.asyncio
async def test_two_runtimes_serialize_the_same_session_with_the_store_lease():
    store = InMemoryStore()
    started = asyncio.Event()
    release = asyncio.Event()
    inputs: list[list[str]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        inputs.append([
            part.get("text", "")
            for message in value["messages"]
            if message["role"] == "user"
            for part in message["content"]
        ])
        if len(inputs) == 1:
            started.set()
            await release.wait()
        return answer()

    config = {"agents": {"a": {"model": "m"}}}
    first_runtime = create_goondan(config, models={"m": model}, store=store)
    second_runtime = create_goondan(config, models={"m": model}, store=store)
    first = await first_runtime.run("one", session_id="leased")
    await started.wait()
    second_acceptance = asyncio.create_task(second_runtime.run("two", session_id="leased"))
    await asyncio.sleep(0.01)
    assert inputs == [["one"]]
    release.set()
    second = await second_acceptance
    await asyncio.gather(first.result, second.result)

    assert inputs == [["one"], ["one", "two"]]


@pytest.mark.asyncio
async def test_stateful_and_stateless_instances_and_conversations():
    store = InMemoryStore()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return answer(str(len(value["messages"])))

    stateful = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": model}, store=store)
    first = await (await stateful.run("x", session_id="s")).result
    second = await (await stateful.run("y", session_id="s")).result
    assert first["runs"][0]["instance"] == second["runs"][0]["instance"] == "s/a"
    stateful_view = fold("s", [event async for event in store.scan(session_id="s")])
    assert [item["instance"] for item in stateful_view["conversations"]] == ["s/a"]

    stateless = create_goondan(config={"agents": {"a": {"model": "m", "stateful": False}}}, models={"m": model}, store=store)
    one = await (await stateless.run("x", session_id="t")).result
    two = await (await stateless.run("y", session_id="t")).result
    assert one["runs"][0]["instance"] != two["runs"][0]["instance"]
    stateless_view = fold("t", [event async for event in store.scan(session_id="t")])
    assert {item["instance"] for item in stateless_view["conversations"]} == {one["runs"][0]["instance"], two["runs"][0]["instance"]}


@pytest.mark.asyncio
async def test_stateless_extension_is_created_and_disposed_for_every_run():
    created: list[int] = []
    disposed: list[int] = []

    def create(**kwargs: Any) -> Extension:
        number = len(created) + 1
        created.append(number)
        return Extension(dispose=lambda: disposed.append(number))

    goondan = create_goondan(
        {"agents": {"a": {"model": "m", "stateful": False, "extensions": {"e": {}}}}},
        models={"m": lambda value: answer()},
        extensions={"e": define_extension(name="e", create=create)},
    )
    await (await goondan.run("one", session_id="s")).result
    await (await goondan.run("two", session_id="s")).result
    assert created == [1, 2]
    assert disposed == [1, 2]


@pytest.mark.asyncio
@pytest.mark.parametrize(("stateful", "expected_parallel"), [(True, 1), (False, 2)])
async def test_derived_runs_serialize_only_stateful_instances(stateful: bool, expected_parallel: int):
    active = 0
    maximum = 0
    first_started = asyncio.Event()
    release = asyncio.Event()

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        first_started.set()
        if not stateful and active == 2:
            release.set()
        await release.wait()
        active -= 1
        return answer("helper")

    async def hook(value: Any, ctx: Any) -> Any:
        first = asyncio.create_task(ctx.run_agent("helper", 1))
        await first_started.wait()
        second = asyncio.create_task(ctx.run_agent("helper", 2))
        await asyncio.sleep(0)
        if stateful:
            release.set()
        await asyncio.gather(first, second)
        return None

    goondan = create_goondan(
        {
            "agents": {
                "main": {"model": "main", "extensions": {"e": {}}, "hooks": {"onStep": [{"extension": "e"}]}},
                "helper": {"model": "helper", "stateful": stateful},
            }
        },
        models={"main": lambda value: answer(), "helper": helper},
        extensions={"e": define_extension(name="e", hooks=["onStep"], create=lambda **kwargs: Extension(hooks={"onStep": hook}))},
    )
    await (await goondan.run("x", session_id="s")).result
    assert maximum == expected_parallel


@pytest.mark.asyncio
async def test_stateful_child_inputs_join_the_active_execution_and_share_its_output():
    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[list[str]] = []
    outputs: list[dict[str, Any]] = []

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        calls.append([
            part.get("text", "")
            for message in value["messages"]
            if message["role"] == "user"
            for part in message["content"]
        ])
        if len(calls) == 1:
            started.set()
            await release.wait()
            return answer("intermediate")
        return answer("shared")

    async def hook(value: Any, ctx: Any) -> None:
        first = asyncio.create_task(ctx.run_agent("helper", "one"))
        await started.wait()
        second = asyncio.create_task(ctx.run_agent("helper", "two"))
        await asyncio.sleep(0)
        release.set()
        outputs.extend(await asyncio.gather(first, second))

    runtime = create_goondan(
        {
            "agents": {
                "main": {"model": "main", "extensions": {"e": {}}, "hooks": {"onStep": [{"extension": "e"}]}},
                "helper": {"model": "helper"},
            }
        },
        models={"main": lambda value: answer(), "helper": helper},
        extensions={"e": define_extension(name="e", hooks=["onStep"], create=lambda **kwargs: Extension(hooks={"onStep": hook}))},
    )

    result = await (await runtime.run("start", session_id="joined")).result

    assert [item["content"][0]["text"] for item in outputs] == ["shared", "shared"]
    assert calls == [["one"], ["one", "two"]]
    assert [run["agent"] for run in result["runs"]].count("helper") == 1


@pytest.mark.asyncio
async def test_cancelling_one_waiter_does_not_cancel_a_shared_child_execution():
    started = asyncio.Event()
    release = asyncio.Event()
    reached: list[str] = []

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        if not reached:
            reached.append("started")
            started.set()
            await release.wait()
        return answer("shared")

    async def hook(value: Any, ctx: Any) -> None:
        owner = asyncio.create_task(ctx.run_agent("helper", "one"))
        await started.wait()
        joined = asyncio.create_task(ctx.run_agent("helper", "two"))
        await asyncio.sleep(0)
        owner.cancel()
        with pytest.raises(asyncio.CancelledError):
            await owner
        release.set()
        output = await joined
        reached.append(output["content"][0]["text"])

    runtime = create_goondan(
        {
            "agents": {
                "main": {"model": "main", "extensions": {"e": {}}, "hooks": {"onStep": [{"extension": "e"}]}},
                "helper": {"model": "helper"},
            }
        },
        models={"main": lambda value: answer(), "helper": helper},
        extensions={"e": define_extension(name="e", hooks=["onStep"], create=lambda **kwargs: Extension(hooks={"onStep": hook}))},
    )

    await (await runtime.run("start", session_id="shared-cancel")).result
    assert reached == ["started", "shared"]


@pytest.mark.asyncio
async def test_new_host_turn_joins_a_stateful_execution_started_by_a_late_async_hook():
    start_child = asyncio.Event()
    child_started = asyncio.Event()
    release_child = asyncio.Event()
    child_outputs: list[dict[str, Any]] = []
    child_calls: list[list[str]] = []

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        child_calls.append([
            part.get("text", "")
            for message in value["messages"]
            if message["role"] == "user"
            for part in message["content"]
        ])
        if len(child_calls) == 1:
            child_started.set()
            await release_child.wait()
            return answer("intermediate")
        return answer("shared")

    async def late_hook(value: Any, ctx: Any) -> None:
        await start_child.wait()
        child_outputs.append(await ctx.run_agent("helper", "async"))

    runtime = create_goondan(
        {
            "agents": {
                "main": {"model": "main", "extensions": {"late": {}}, "hooks": {"onStep": [{"extension": "late", "mode": "async"}]}},
                "helper": {"model": "helper"},
            }
        },
        models={"main": lambda value: answer("first"), "helper": helper},
        extensions={"late": define_extension(name="late", hooks=["onStep"], create=lambda **kwargs: Extension(hooks={"onStep": late_hook}))},
    )

    first = await (await runtime.run("first", session_id="late-join", agent="main")).result
    start_child.set()
    await child_started.wait()
    joined = await runtime.run("host", session_id="late-join", agent="helper")
    await asyncio.sleep(0)
    release_child.set()
    second = await joined.result
    await runtime.idle()

    assert first["turnId"] != second["turnId"]
    assert second["output"] == "shared"
    assert child_outputs[0]["content"][0]["text"] == "shared"
    assert child_calls == [["async"], ["async", "host"]]


@pytest.mark.asyncio
async def test_new_host_turn_joins_a_stateful_execution_started_by_an_approved_agent_tool():
    child_started = asyncio.Event()
    release_child = asyncio.Event()
    child_calls: list[list[str]] = []
    main_calls = 0

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        nonlocal main_calls
        main_calls += 1
        if main_calls == 1:
            return {
                "message": {
                    "role": "assistant",
                    "content": [{"type": "tool.call", "callId": "worker-1", "name": "worker", "args": {"from": "operation"}}],
                },
                "finishReason": "tool",
            }
        return answer("main done")

    async def worker(value: dict[str, Any]) -> dict[str, Any]:
        child_calls.append([
            part.get("text", "")
            for message in value["messages"]
            if message["role"] == "user"
            for part in message["content"]
        ])
        if len(child_calls) == 1:
            child_started.set()
            await release_child.wait()
            return answer("intermediate")
        return answer("shared")

    runtime = create_goondan(
        {
            "agents": {
                "main": {"model": "main", "tools": [{"agent": "worker", "approval": "required"}]},
                "worker": {"model": "worker"},
            }
        },
        models={"main": main, "worker": worker},
    )
    try:
        await (await runtime.run("first", session_id="operation-join", agent="main")).result
        operation = (await runtime.operations.list("operation-join"))[0]
        await runtime.operations.decide("operation-join", operation["operationId"], {"decision": "approved"})
        await child_started.wait()

        joined = await runtime.run("host", session_id="operation-join", agent="worker")
        await asyncio.sleep(0)
        release_child.set()
        host_result = await joined.result
        await runtime.idle()

        completed = (await runtime.operations.list("operation-join"))[0]
        assert host_result["output"] == "shared"
        assert completed["result"]["content"] == [{"type": "text", "text": "shared"}]
        assert child_calls == [["{\"from\":\"operation\"}"], ["{\"from\":\"operation\"}", "host"]]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_synchronous_agent_wait_cycle_is_rejected_before_input_is_queued():
    async def hook(value: Any, ctx: Any) -> None:
        await ctx.run_agent("b" if ctx.agent == "a" else "a", "child")

    store = InMemoryStore()
    runtime = create_goondan(
        {
            "agents": {
                name: {"model": "m", "extensions": {"e": {}}, "hooks": {"onStep": [{"extension": "e"}]}}
                for name in ("a", "b")
            }
        },
        models={"m": lambda value: answer()},
        extensions={"e": define_extension(name="e", hooks=["onStep"], create=lambda **kwargs: Extension(hooks={"onStep": hook}))},
        store=store,
    )

    with pytest.raises(GoondanExecutionError) as raised:
        handle = await runtime.run("start", session_id="cycle", agent="a")
        await asyncio.wait_for(handle.result, 1)

    assert (raised.value.where, raised.value.codes) == ("onStep", ["hook_error"])
    projected = fold("cycle", [event async for event in store.scan(session_id="cycle")])
    conversation = next(item for item in projected["conversations"] if item["instance"] == "cycle/a")
    assert sum(message["role"] == "user" for message in conversation["messages"]) == 1


@pytest.mark.asyncio
async def test_child_execution_uses_the_same_session_and_parent_execution_id():
    contexts: list[Any] = []

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        return answer("helped")

    async def hook(value: Any, ctx: Any) -> Any:
        contexts.append(ctx)
        await ctx.run_agent("helper", "x")
        return None

    from goondan import Extension, create_goondan, define_extension

    config = {"agents": {"main": {"model": "main", "extensions": {"e": {}}, "hooks": {"onStep": [{"extension": "e"}]}}, "helper": {"model": "helper"}}}
    goondan = create_goondan(config=config, models={"main": lambda value: answer(), "helper": helper}, extensions={"e": define_extension(name="e", hooks=["onStep"], create=lambda **kwargs: Extension(hooks={"onStep": hook}))})
    result = await (await goondan.run("x", session_id="s")).result
    child = next(run for run in result["runs"] if run["agent"] == "helper")
    assert child["instance"] == "s/helper"
    assert child["parentExecutionId"] == result["runs"][0]["executionId"]
    assert contexts[0].session_id == "s"


@pytest.mark.asyncio
async def _v2_steer_requires_agent_for_parallel_runs_and_tags_queued_values():
    gate = asyncio.Event()
    started = asyncio.Event()
    count = 0

    class Model:
        async def generate(self, value: dict[str, Any], ctx: Any) -> dict[str, Any]:
            nonlocal count
            if ctx.agent in {"a", "b"}:
                count += 1
                if count == 2:
                    started.set()
                await gate.wait()
            return answer(ctx.agent)

    config = {
        "agents": {name: {"model": "m"} for name in ("split", "a", "b")},
        "routes": [{"from": "$input", "to": "split"}, {"from": "split", "to": "a"}, {"from": "split", "to": "b"}, {"from": "a", "to": "$output"}, {"from": "b", "to": "$output"}],
    }
    goondan = create_goondan(config=config, models={"m": Model()})
    turn = asyncio.create_task(goondan.run("x", session_id="s"))
    await started.wait()
    with pytest.raises(GoondanExecutionError) as error:
        goondan.steer("s", "ambiguous")
    assert error.value.codes == ["steer_invalid"]
    with pytest.raises(GoondanExecutionError) as error:
        goondan.steer("s", "inactive", agent="split")
    assert error.value.codes == ["steer_invalid"]
    goondan.steer("s", "for-a", agent="a")
    gate.set()
    await turn


@pytest.mark.asyncio
async def _v2_steer_queued_before_a_turn_keeps_its_agent_tag():
    seen: dict[str, list[dict[str, Any]]] = {}

    class Model:
        async def generate(self, value: dict[str, Any], ctx: Any) -> dict[str, Any]:
            seen[ctx.agent] = value["messages"]
            return answer(ctx.agent)

    goondan = create_goondan(
        {"agents": {"a": {"model": "m"}, "b": {"model": "m"}}, "routes": ["a", "b"]},
        models={"m": Model()},
    )
    goondan.steer("s", {"queued": True}, agent="b")
    await (await goondan.run("x", session_id="s")).result
    assert seen["a"][-1]["content"] == [{"type": "text", "text": "x"}]
    assert seen["b"][-1]["content"] == [{"type": "text", "text": '{"queued":true}'}]


@pytest.mark.asyncio
async def test_abort_stops_every_waiter_joined_to_the_active_turn():
    gate = asyncio.Event()
    calls = 0

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        if calls == 1:
            await gate.wait()
        return answer()

    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = await goondan.run("1", session_id="s")
    await asyncio.sleep(0)
    waiting = await goondan.run("2", session_id="s")
    await asyncio.sleep(0)
    assert goondan.abort("s") is True
    gate.set()
    outcomes = await asyncio.gather(active.result, waiting.result, return_exceptions=True)
    assert all(isinstance(outcome, GoondanAbortError) for outcome in outcomes)


@pytest.mark.asyncio
async def test_cancelling_an_accepted_run_waiter_keeps_the_turn_and_input_alive():
    started = asyncio.Event()
    release = asyncio.Event()
    seen: list[list[str]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        seen.append([
            part.get("text", "")
            for message in value["messages"]
            if message["role"] == "user"
            for part in message["content"]
        ])
        if len(seen) == 1:
            started.set()
            await release.wait()
        return answer()

    runtime = create_goondan({"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = await runtime.run("one", session_id="accepted")
    await started.wait()
    accepted = await runtime.run("two", session_id="accepted")
    waiter = asyncio.create_task(await_result(accepted))
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    release.set()
    await active.result
    await accepted.result

    assert seen == [["one"], ["one", "two"]]


@pytest.mark.asyncio
async def test_idle_waits_for_a_host_requested_turn():
    started = asyncio.Event()
    release = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await release.wait()
        return answer()

    runtime = create_goondan({"agents": {"a": {"model": "m"}}}, models={"m": model})
    turn = await runtime.run("one", session_id="host-turn")
    await started.wait()
    waiting = asyncio.create_task(runtime.idle())
    await asyncio.sleep(0)
    assert not waiting.done()
    release.set()
    await waiting
    await turn.result


@pytest.mark.asyncio
async def test_session_delete_removes_only_the_named_journal_stream():
    store = InMemoryStore()
    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": lambda value: answer()}, store=store)
    await (await goondan.run("one", session_id="s")).result
    await (await goondan.run("two", session_id="other")).result
    await goondan.sessions.delete("s")
    assert [event async for event in store.scan(session_id="s")] == []
    assert [event async for event in store.scan(session_id="other")]


@pytest.mark.asyncio
async def test_session_delete_rejects_active_and_waiting_turns():
    started = asyncio.Event()
    release = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await release.wait()
        return answer()

    goondan = create_goondan({"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = await goondan.run("one", session_id="s")
    await started.wait()
    waiting = await goondan.run("two", session_id="s")
    await asyncio.sleep(0)
    with pytest.raises(GoondanExecutionError) as error:
        await goondan.sessions.delete("s")
    assert error.value.codes == ["runtime_error"]
    release.set()
    await asyncio.gather(active.result, waiting.result)


@pytest.mark.asyncio
async def test_session_identifiers_are_opaque_strings():
    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": lambda value: answer()})
    assert (await (await goondan.run("x", session_id="opaque#id")).result)["status"] == "done"
    await goondan.sessions.delete("opaque#id")


@pytest.mark.asyncio
async def test_close_rejects_a_waiting_turn_with_runtime_error():
    gate = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        await gate.wait()
        return answer()

    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = await goondan.run("1", session_id="s")
    await asyncio.sleep(0)
    waiting = await goondan.run("2", session_id="s")
    await asyncio.sleep(0)
    await goondan.close()
    with pytest.raises(GoondanAbortError):
        await active.result
    with pytest.raises(GoondanAbortError):
        await waiting.result
