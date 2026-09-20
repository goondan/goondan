from __future__ import annotations

import asyncio
from typing import Any

import pytest

from goondan import Extension, GoondanAbortError, GoondanExecutionError, InMemoryConversationStore, InMemoryOperationStore, create_goondan, define_extension


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def test_create_goondan_accepts_positional_config_and_run_requires_a_session():
    goondan = create_goondan({"agents": {"main": {"model": "m"}}}, models={"m": lambda value: answer()})
    with pytest.raises(TypeError):
        goondan.run("x")


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
    first = asyncio.create_task(goondan.run("1", session_id="same"))
    await first_started.wait()
    second = asyncio.create_task(goondan.run("2", session_id="same"))
    other = asyncio.create_task(goondan.run("3", session_id="other"))
    await other
    assert started == ["same", "other"]
    release.set()
    await asyncio.gather(first, second)
    assert started == ["same", "other", "same"]


@pytest.mark.asyncio
async def test_stateful_and_stateless_instances_and_conversations():
    store = InMemoryConversationStore()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return answer(str(len(value["messages"])))

    stateful = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": model}, conversation_store=store)
    first = await stateful.run("x", session_id="s")
    second = await stateful.run("y", session_id="s")
    assert first["runs"][0]["instance"] == second["runs"][0]["instance"] == "s/a"
    assert ("s", "a") in store.conversations

    stateless = create_goondan(config={"agents": {"a": {"model": "m", "stateful": False}}}, models={"m": model}, conversation_store=store)
    one = await stateless.run("x", session_id="t")
    two = await stateless.run("y", session_id="t")
    assert one["runs"][0]["instance"] != two["runs"][0]["instance"]
    assert ("t", "a") not in store.conversations


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
    await goondan.run("one", session_id="s")
    await goondan.run("two", session_id="s")
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
                "main": {"model": "main", "extensions": {"e": {}}, "hooks": {"conversation": [{"extension": "e"}]}},
                "helper": {"model": "helper", "stateful": stateful},
            }
        },
        models={"main": lambda value: answer(), "helper": helper},
        extensions={"e": define_extension(name="e", hooks=["conversation"], create=lambda **kwargs: Extension(hooks={"conversation": hook}))},
    )
    await goondan.run("x", session_id="s")
    assert maximum == expected_parallel


@pytest.mark.asyncio
async def test_derived_session_uses_parent_turn_and_target_name():
    contexts: list[Any] = []

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        return answer("helped")

    async def hook(value: Any, ctx: Any) -> Any:
        contexts.append(ctx)
        await ctx.run_agent("helper", "x")
        return None

    from goondan import Extension, create_goondan, define_extension

    config = {"agents": {"main": {"model": "main", "extensions": {"e": {}}, "hooks": {"conversation": [{"extension": "e"}]}}, "helper": {"model": "helper"}}}
    goondan = create_goondan(config=config, models={"main": lambda value: answer(), "helper": helper}, extensions={"e": define_extension(name="e", hooks=["conversation"], create=lambda **kwargs: Extension(hooks={"conversation": hook}))})
    result = await goondan.run("x", session_id="s")
    child = next(run for run in result["runs"] if run["agent"] == "helper")
    assert child["instance"] == f"s#{result['runs'][0]['turnId']}#helper/helper"
    assert contexts[0].session_id == "s"


@pytest.mark.asyncio
async def test_steer_requires_agent_for_parallel_runs_and_tags_queued_values():
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
async def test_steer_queued_before_a_turn_keeps_its_agent_tag():
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
    await goondan.run("x", session_id="s")
    assert seen["a"][-1]["content"] == [{"type": "text", "text": "x"}]
    assert seen["b"][-1]["content"] == [{"type": "text", "text": '{"queued":true}'}]


@pytest.mark.asyncio
async def test_abort_only_stops_active_turn_and_keeps_waiting_turn():
    gate = asyncio.Event()
    calls = 0

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        if calls == 1:
            await gate.wait()
        return answer()

    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = asyncio.create_task(goondan.run("1", session_id="s"))
    await asyncio.sleep(0)
    waiting = asyncio.create_task(goondan.run("2", session_id="s"))
    await asyncio.sleep(0)
    assert goondan.abort("s") is True
    gate.set()
    with pytest.raises(GoondanAbortError):
        await active
    assert (await waiting)["status"] == "done"


@pytest.mark.asyncio
async def test_session_delete_removes_session_and_derived_conversations_but_not_operations():
    store = InMemoryConversationStore()
    operations = InMemoryOperationStore()
    store.conversations[("s", "a")] = []
    store.conversations[("s#t#b", "b")] = []
    store.conversations[("other", "a")] = []
    await operations.save({"operationId": "op", "sessionId": "s", "status": "pending"})
    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": lambda value: answer()}, conversation_store=store, operation_store=operations)
    await goondan.sessions.delete("s")
    assert set(store.conversations) == {("other", "a")}
    assert (await operations.list("s"))[0]["operationId"] == "op"


@pytest.mark.asyncio
async def test_session_delete_rejects_active_and_waiting_turns():
    started = asyncio.Event()
    release = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await release.wait()
        return answer()

    goondan = create_goondan({"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = asyncio.create_task(goondan.run("one", session_id="s"))
    await started.wait()
    waiting = asyncio.create_task(goondan.run("two", session_id="s"))
    await asyncio.sleep(0)
    with pytest.raises(GoondanExecutionError) as error:
        await goondan.sessions.delete("s")
    assert error.value.codes == ["runtime_error"]
    release.set()
    await asyncio.gather(active, waiting)


@pytest.mark.asyncio
async def test_hash_is_rejected_by_host_session_apis():
    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": lambda value: answer()})
    with pytest.raises(GoondanExecutionError):
        await goondan.run("x", session_id="bad#id")
    with pytest.raises(GoondanExecutionError):
        goondan.abort("bad#id")
    with pytest.raises(GoondanExecutionError):
        goondan.steer("bad#id", "x")
    with pytest.raises(GoondanExecutionError):
        await goondan.sessions.delete("bad#id")


@pytest.mark.asyncio
async def test_close_rejects_a_waiting_turn_with_runtime_error():
    gate = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        await gate.wait()
        return answer()

    goondan = create_goondan(config={"agents": {"a": {"model": "m"}}}, models={"m": model})
    active = asyncio.create_task(goondan.run("1", session_id="s"))
    await asyncio.sleep(0)
    waiting = asyncio.create_task(goondan.run("2", session_id="s"))
    await asyncio.sleep(0)
    await goondan.close()
    with pytest.raises(GoondanAbortError):
        await active
    with pytest.raises(GoondanExecutionError) as error:
        await waiting
    assert error.value.codes == ["runtime_error"]
