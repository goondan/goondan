"""§에이전트 경로와 실행 범위 and §실행 이벤트: agent paths, sub-conversations, abort, steering and events."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from goondan import (
    Extension,
    GoondanAbortError,
    InMemoryConversationStore,
    create_runtime,
    define_extension,
    define_tool,
    load_config,
)


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def tool_call(name: str, call_id: str = "call-1", args: Any = None) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": call_id, "name": name, "args": args or {}}]}, "finishReason": "tool"}


def replies(*outputs: dict[str, Any]):
    remaining = list(outputs)

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return remaining.pop(0) if remaining else answer("exhausted")

    return model


class Recorder:
    """A host that records every event it receives on the single `emit` channel."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def names(self, name: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event["name"] == name]


def write_nested(tmp_path: Path) -> Path:
    inner = tmp_path / "inner"
    inner.mkdir()
    (inner / "goondan.yaml").write_text("version: 1\nagents:\n  main: {model: inner}\nflow: {in: main}\n", encoding="utf-8")
    (tmp_path / "goondan.yaml").write_text("version: 1\nagents:\n  wrap: {config: ./inner}\nflow: {in: wrap}\n", encoding="utf-8")
    return tmp_path


# --- agent paths ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_nested_agents_are_stored_and_reported_by_path(tmp_path: Path):
    root = write_nested(tmp_path)
    store = InMemoryConversationStore()
    host = Recorder()
    runtime = create_runtime(config=load_config(root), models={"inner": replies(answer("inner done"))}, conversation_store=store, host=host)
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert sorted(store.conversations) == [("c1", "wrap/main")]
        assert {event["agent"] for event in host.events} == {"wrap/main"}
        assert [event["name"] for event in host.events] == ["turn.start", "step.start", "step.done", "turn.done"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_same_agent_name_in_two_scopes_keeps_separate_conversations(tmp_path: Path):
    inner = tmp_path / "inner"
    inner.mkdir()
    (inner / "goondan.yaml").write_text("version: 1\nagents:\n  main: {model: inner}\nflow: {in: main}\n", encoding="utf-8")
    (tmp_path / "goondan.yaml").write_text(
        "version: 1\nagents:\n  main: {model: outer, tools: [{agent: wrap}]}\n  wrap: {config: ./inner}\nflow: {in: main}\n",
        encoding="utf-8",
    )
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config=load_config(tmp_path),
        models={"outer": replies(tool_call("wrap"), answer("outer done")), "inner": replies(answer("inner done"))},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        agents = {agent for _, agent in store.conversations}
        assert "main" in agents and "wrap/main" in agents
        assert await store.load("c1", "main") != await store.load("c1", "wrap/main")
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_extension_create_input_carries_the_agent_path_and_spec(tmp_path: Path):
    root = write_nested(tmp_path)
    (root / "inner" / "goondan.yaml").write_text(
        "version: 1\nagents:\n  main: {model: inner, params: {lang: ko}, extensions: {marks: {}}}\nflow: {in: main}\n",
        encoding="utf-8",
    )
    seen: list[dict[str, Any]] = []

    def create(*, agent, **_):
        seen.append(agent)
        return Extension()

    runtime = create_runtime(
        config=load_config(root),
        models={"inner": replies(answer())},
        extensions={"marks": define_extension(name="marks", create=create)},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert seen[0]["name"] == "main"
        assert seen[0]["path"] == "wrap/main"
        assert seen[0]["spec"]["params"] == {"lang": "ko"}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_run_turn_resolves_an_agent_path_and_follows_no_route(tmp_path: Path):
    root = write_nested(tmp_path)
    (root / "inner" / "goondan.yaml").write_text(
        "version: 1\nagents:\n  main: {model: inner}\n  next: {model: other}\nflow:\n  in: main\n  routes: [{from: main, to: next}, {from: next, to: out}]\n",
        encoding="utf-8",
    )
    store = InMemoryConversationStore()
    runtime = create_runtime(config=load_config(root), models={"inner": replies(answer("only")), "other": replies(answer("unused"))}, conversation_store=store)
    try:
        result = await runtime.run_turn("hello", conversation_id="c1", agent="wrap/main")
        assert [item["content"][0]["text"] for item in result["outputs"]] == ["only"]
        assert sorted(store.conversations) == [("c1", "wrap/main")]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_nested_runtime_is_created_once_and_reused(tmp_path: Path):
    root = write_nested(tmp_path)
    runtime = create_runtime(config=load_config(root), models={"inner": replies(answer("a"), answer("b"))})
    try:
        await runtime.run_turn("one", conversation_id="c1")
        first = runtime.child_runtimes["wrap"]
        await runtime.run_turn("two", conversation_id="c1")
        assert runtime.child_runtimes["wrap"] is first
        assert first.conversation_store is runtime.conversation_store and first.operation_store is runtime.operation_store
        assert runtime._resolve("wrap/main") == (first, "main")
    finally:
        await runtime.close()


# --- sub-conversations ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_tool_uses_the_parent_turn_sub_conversation():
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config={"agents": {"main": {"model": "main", "tools": [{"agent": "worker"}]}, "worker": {"model": "worker"}}},
        models={"main": replies(tool_call("worker"), answer()), "worker": replies(answer("worked"))},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        worker_keys = [key for key in store.conversations if key[1] == "worker"]
        assert len(worker_keys) == 1
        conversation_id, _ = worker_keys[0]
        assert conversation_id.startswith("c1:") and conversation_id.endswith(":worker")
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_hook_agents_share_a_sub_conversation_and_differ_by_path():
    store = InMemoryConversationStore()
    config = {
        "agents": {
            "main": {"model": "main", "hooks": {"modelInput": [{"name": "advisors", "agent": ["left", "right"]}]}},
            "left": {"model": "left"},
            "right": {"model": "right"},
        }
    }
    runtime = create_runtime(
        config=config,
        models={"main": replies(answer()), "left": replies(answer("L")), "right": replies(answer("R"))},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert ("c1:main:modelInput:advisors", "left") in store.conversations
        assert ("c1:main:modelInput:advisors", "right") in store.conversations
    finally:
        await runtime.close()


def test_the_memory_store_keeps_ambiguous_pairs_apart():
    store = InMemoryConversationStore()

    async def check() -> None:
        await store.append("a:b", "c", [{"id": "1", "role": "user", "content": [{"type": "text", "text": "first"}]}])
        await store.append("a", "b:c", [{"id": "2", "role": "user", "content": [{"type": "text", "text": "second"}]}])
        assert [message["id"] for message in await store.load("a:b", "c")] == ["1"]
        assert [message["id"] for message in await store.load("a", "b:c")] == ["2"]

    asyncio.run(check())


# --- abort ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_abort_stops_a_nested_config_agent_and_reports_the_aborted_error(tmp_path: Path):
    root = write_nested(tmp_path)
    started = asyncio.Event()
    host = Recorder()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(10)
        return answer()

    runtime = create_runtime(config=load_config(root), models={"inner": model}, host=host)
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        errors = host.names("turn.error")
        assert [event["agent"] for event in errors] == ["wrap/main"]
        assert errors[0]["data"]["where"] == "runtime" and errors[0]["data"]["codes"] == ["aborted"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_abort_between_flow_steps_stops_the_turn():
    release = asyncio.Event()
    second_started = asyncio.Event()

    async def first(value: dict[str, Any]) -> dict[str, Any]:
        return answer("carry")

    async def second(value: dict[str, Any]) -> dict[str, Any]:
        second_started.set()
        return answer("second")

    async def gate(value: Any) -> bool:
        await release.wait()
        return True

    config = {
        "agents": {"first": {"model": "first"}, "second": {"model": "second"}},
        "flow": {"in": "first", "routes": [{"from": "first", "to": "second", "when": {"fn": "gate"}}, {"from": "second", "to": "out"}]},
    }
    runtime = create_runtime(config=config, models={"first": first, "second": second}, functions={"gate": gate})
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await asyncio.sleep(0.01)
        assert runtime.abort("c1") is True
        release.set()
        with pytest.raises(GoondanAbortError):
            await turn
        assert not second_started.is_set()
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_optional_hook_does_not_swallow_an_abort():
    started = asyncio.Event()
    swallowed: list[str] = []

    async def slow(value: Any) -> Any:
        started.set()
        await asyncio.sleep(10)
        swallowed.append("resumed")
        return value

    config = {"agents": {"main": {"model": "m", "hooks": {"conversation": [{"name": "slow", "fn": "slow", "optional": True}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, functions={"slow": slow})
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        assert swallowed == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_model_result_that_arrives_after_an_abort_is_discarded():
    release = asyncio.Event()
    store = InMemoryConversationStore()
    host = Recorder()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        await release.wait()
        return answer("too late")

    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, conversation_store=store, host=host)
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await asyncio.sleep(0.01)
        assert runtime.abort("c1") is True
        release.set()
        with pytest.raises(GoondanAbortError):
            await turn
        texts = [part["text"] for message in await store.load("c1", "main") for part in message["content"] if part.get("type") == "text"]
        assert "too late" not in texts
        assert host.names("step.done") == []
        assert [event["data"]["codes"] for event in host.names("step.error")] == [["aborted"]]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_abort_targets_only_the_requested_conversation_and_a_closed_runtime_returns_false():
    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": replies(answer())})
    assert runtime.abort("c1") is False
    await runtime.run_turn("hello", conversation_id="c1")
    assert runtime.abort("c1") is False
    await runtime.close()
    assert runtime.abort("c1") is False


@pytest.mark.asyncio
async def test_a_sub_conversation_identifier_does_not_abort_the_run():
    started = asyncio.Event()

    async def worker(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(0.05)
        return answer("worked")

    runtime = create_runtime(
        config={"agents": {"main": {"model": "main", "tools": [{"agent": "worker"}]}, "worker": {"model": "worker"}}},
        models={"main": replies(tool_call("worker"), answer()), "worker": worker},
    )
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1:unknown:worker") is False
        result = await turn
        assert result["status"] == "done"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_aborted_hook_agent_is_not_reported_as_a_hook_failure():
    host = Recorder()
    started = asyncio.Event()

    async def advisor(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(10)
        return answer("advice")

    config = {
        "agents": {
            "main": {"model": "main", "hooks": {"modelInput": [{"name": "advisors", "agent": ["left", "right"]}]}},
            "left": {"model": "left"},
            "right": {"model": "right"},
        }
    }
    runtime = create_runtime(config=config, models={"main": replies(answer()), "left": advisor, "right": advisor}, host=host)
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        assert host.names("hook.failed") == []
        assert {tuple(event["data"]["codes"]) for event in host.names("turn.error")} == {("aborted",)}
        assert {event["agent"] for event in host.names("turn.error")} == {"main", "left", "right"}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_error_hook_cannot_retry_an_aborted_run():
    retries: list[Any] = []
    started = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(10)
        return answer()

    def recover(value: Any) -> Any:
        retries.append(value)
        return {"retry": True, "target": "model"}

    config = {"agents": {"main": {"model": "m", "hooks": {"error": [{"fn": "recover"}]}}}}
    runtime = create_runtime(config=config, models={"m": model}, functions={"recover": recover})
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        assert retries == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_model_call_that_fails_after_the_abort_reports_step_error_with_aborted():
    """§이벤트 순서: the call that step.start announced reports step.error, not a model failure."""
    host = Recorder()
    started = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            raise RuntimeError("the model gave up") from None
        return answer()

    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, host=host)
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        assert [event["name"] for event in host.events] == ["turn.start", "step.start", "step.error", "turn.error"]
        assert host.names("step.error")[0]["data"] == {"step": 1, "codes": ["aborted"], "error": "the run was aborted"}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_that_fails_after_the_abort_reports_tool_error_with_aborted():
    """§이벤트 순서: the execution that tool.start announced reports tool.error, not a tool failure."""
    host = Recorder()
    started = asyncio.Event()

    async def probe(value: Any, ctx: dict[str, Any]) -> Any:
        started.set()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            raise RuntimeError("the tool gave up") from None
        return {"ok": True}

    runtime = create_runtime(
        config={"agents": {"main": {"model": "m", "tools": ["probe"]}}},
        models={"m": replies(tool_call("probe"), answer())},
        tools={"probe": define_tool(name="probe", description="probe", input={}, execute=probe)},
        host=host,
    )
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        assert [event["name"] for event in host.events] == ["turn.start", "step.start", "step.done", "tool.start", "tool.error", "turn.error"]
        error = host.names("tool.error")[0]["data"]
        assert error["codes"] == ["aborted"] and error["tool"] == "probe" and error["callId"] == "call-1"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_result_that_arrives_after_the_abort_is_not_stored():
    """§실행 중단: a run that was told to stop uses no tool result and stores no message for it."""
    host = Recorder()
    store = InMemoryConversationStore()
    holder: dict[str, Any] = {}

    async def stopper(value: Any, ctx: dict[str, Any]) -> Any:
        holder["runtime"].abort(ctx["conversationId"])
        return {"late": True}

    runtime = create_runtime(
        config={"agents": {"main": {"model": "m", "tools": ["stopper"]}}},
        models={"m": replies(tool_call("stopper"), answer())},
        tools={"stopper": define_tool(name="stopper", description="stop", input={}, execute=stopper)},
        conversation_store=store,
        host=host,
    )
    holder["runtime"] = runtime
    try:
        with pytest.raises(GoondanAbortError):
            await runtime.run_turn("hello", conversation_id="c1")
        stored = await store.load("c1", "main")
        assert [part["type"] for message in stored for part in message["content"]] == ["text", "tool.call"]
        assert [event["name"] for event in host.events] == ["turn.start", "step.start", "step.done", "tool.start", "tool.error", "turn.error"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_abort_error_carries_the_members_of_an_execution_error():
    """§실행 중단, §실행 오류: `where` runtime, `codes` ["aborted"] and no tool call."""
    started = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(10)
        return answer()

    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": model})
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError) as found:
            await turn
        error = found.value
        assert error.where == "runtime" and error.codes == ["aborted"] and error.attempt == 1
        assert error.tool_call is None and error.message == str(error)
        assert error.value() == {"where": "runtime", "codes": ["aborted"], "message": str(error), "attempt": 1}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_abort_leaves_async_hook_work_and_approved_operations_alone():
    finished: list[str] = []
    release = asyncio.Event()

    async def late(value: Any, ctx: Any) -> Any:
        await release.wait()
        finished.append("late")
        return None

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(10)
        return answer()

    config = {"agents": {"main": {"model": "m", "extensions": {"memory": {}}, "hooks": {"conversation": [{"extension": "memory", "mode": "async"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": model},
        extensions={"memory": define_extension(name="memory", create=lambda **_: Extension(hooks={"conversation": late}))},
    )
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await asyncio.sleep(0.01)
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        release.set()
        await runtime.idle()
        assert finished == ["late"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_operation_of_a_nested_agent_is_routed_by_its_path(tmp_path: Path):
    root = write_nested(tmp_path)
    (root / "inner" / "goondan.yaml").write_text(
        "version: 1\nagents:\n  main: {model: inner, input: asis, tools: [{tool: write, approval: required}]}\nflow: {in: main}\n",
        encoding="utf-8",
    )
    executed: list[Any] = []
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config=load_config(root),
        models={"inner": replies(tool_call("write", args={"text": "x"}), answer("pending"), answer("completion received"))},
        tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, ctx: executed.append(value) or value)},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        assert operation["agent"] == "wrap/main"
        approved = await runtime.decide_operation("c1", operation["operationId"], {"decision": "approved"})
        assert approved["status"] == "approved"
        await runtime.idle()
        assert executed == [{"text": "x"}]
        completed = (await runtime.list_operations("c1"))[0]
        assert completed["status"] == "completed" and completed["deliveryStatus"] == "delivered"
        assert sorted(store.conversations) == [("c1", "wrap/main")]
    finally:
        await runtime.close()


# --- tool context -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_tool_context_carries_the_path_identity_and_runs_agents_in_the_sub_conversation():
    contexts: list[dict[str, Any]] = []
    store = InMemoryConversationStore()

    async def probe(value: Any, ctx: dict[str, Any]) -> Any:
        contexts.append(ctx)
        run = await ctx["run_agent"]("worker", {"ask": 1})
        return {"worker": run["output"]["content"][0]["text"]}

    config = {
        "agents": {
            "main": {"model": "main", "tools": ["probe", {"agent": "worker"}]},
            "worker": {"model": "worker"},
        }
    }
    runtime = create_runtime(
        config=config,
        models={"main": replies(tool_call("probe", args={"a": 1}), answer()), "worker": replies(answer("worked"))},
        tools={"probe": define_tool(name="probe", description="probe", input={}, execute=probe)},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        ctx = contexts[0]
        assert set(ctx) == {"input", "conversation", "agent", "conversationId", "turnId", "toolCall", "execution", "run_agent"}
        assert ctx["agent"] == "main" and ctx["conversationId"] == "c1" and ctx["execution"] == {}
        assert ctx["toolCall"] == {"id": "call-1", "name": "probe", "args": {"a": 1}}
        worker_key = next(key for key in store.conversations if key[1] == "worker")
        assert worker_key[0] == f"c1:{ctx['turnId']}:worker"
    finally:
        await runtime.close()


# --- steering ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_steering_reaches_the_next_foreground_run_before_the_conversation_stage(tmp_path: Path):
    root = write_nested(tmp_path)
    store = InMemoryConversationStore()
    seen: list[list[dict[str, Any]]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        seen.append(value["messages"])
        return answer()

    runtime = create_runtime(config=load_config(root), models={"inner": model}, conversation_store=store)
    try:
        runtime.steer("c1", {"note": "queued"})
        await runtime.run_turn("hello", conversation_id="c1")
        texts = [part["text"] for message in seen[0] for part in message["content"]]
        assert texts == ["hello", '{"note":"queued"}']
        steered = (await store.load("c1", "wrap/main"))[1]
        assert steered["role"] == "user" and steered["source"] == "user"
        assert steered["content"] == [{"type": "text", "text": '{"note":"queued"}'}]
        assert "key" not in steered and "keep" not in steered and "meta" not in steered
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_steering_skips_the_input_stage_hooks():
    applied: list[Any] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return answer()

    def shout(value: Any) -> Any:
        applied.append(value)
        return f"{value}!"

    config = {"agents": {"main": {"model": "m", "hooks": {"input": [{"name": "shout", "fn": "shout"}]}}}}
    store = InMemoryConversationStore()
    runtime = create_runtime(config=config, models={"m": model}, functions={"shout": shout}, conversation_store=store)
    try:
        runtime.steer("c1", "steered")
        await runtime.run_turn("hello", conversation_id="c1")
        assert applied == ["hello"]
        assert [message["content"][0]["text"] for message in await store.load("c1", "main")][:2] == ["hello!", "steered"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_sub_conversation_run_does_not_take_steered_input():
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config={"agents": {"main": {"model": "main", "tools": [{"agent": "worker"}]}, "worker": {"model": "worker"}}},
        models={"main": replies(tool_call("worker"), answer()), "worker": replies(answer("worked"))},
        conversation_store=store,
    )
    try:
        runtime.steer("c1", "for the flow step")
        await runtime.run_turn("hello", conversation_id="c1")
        worker_key = next(key for key in store.conversations if key[1] == "worker")
        worker_texts = [part.get("text") for message in store.conversations[worker_key] for part in message["content"]]
        assert "for the flow step" not in worker_texts
        main_texts = [part.get("text") for message in await store.load("c1", "main") for part in message["content"]]
        assert "for the flow step" in main_texts
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_abort_keeps_the_queue_and_close_drops_it():
    release = asyncio.Event()
    store = InMemoryConversationStore()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        await release.wait()
        return answer()

    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, conversation_store=store)
    turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
    await asyncio.sleep(0.01)
    runtime.steer("c1", "kept")
    assert runtime.abort("c1") is True
    release.set()
    with pytest.raises(GoondanAbortError):
        await turn
    assert runtime._steering["c1"] == ["kept"]
    await runtime.close()
    assert runtime._steering == {}
    runtime.steer("c1", "dropped")
    assert runtime._steering == {}


# --- events -----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_events_use_the_envelope_and_reach_the_host_before_the_instances():
    order: list[str] = []

    class Host:
        def __init__(self) -> None:
            self.events: list[dict[str, Any]] = []

        def emit(self, event: dict[str, Any]) -> None:
            order.append("host")
            self.events.append(event)

    def create(name: str):
        def build(**_):
            def handler(event: dict[str, Any]) -> None:
                order.append(name)

            return Extension(on={"turn.done": handler})

        return build

    host = Host()
    config = {"agents": {"main": {"model": "m", "extensions": {"first": {}, "second": {}}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(answer("ok"))},
        extensions={name: define_extension(name=name, create=create(name)) for name in ("first", "second")},
        host=host,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        done = next(event for event in host.events if event["name"] == "turn.done")
        assert set(done) == {"name", "agent", "conversationId", "turnId", "at", "data"}
        assert done["agent"] == "main" and done["conversationId"] == "c1"
        assert isinstance(done["at"], int) and done["turnId"]
        assert set(done["data"]) == {"output", "steps", "usage"}
        assert order[-3:] == ["host", "first", "second"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_emit_binding_receives_every_event_of_a_nested_agent(tmp_path: Path):
    root = write_nested(tmp_path)
    received: list[dict[str, Any]] = []

    async def emit(event: dict[str, Any]) -> None:
        received.append(event)

    runtime = create_runtime(config=load_config(root), models={"inner": replies(answer())}, emit=emit)
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert [event["name"] for event in received] == ["turn.start", "step.start", "step.done", "turn.done"]
        assert {event["agent"] for event in received} == {"wrap/main"}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failing_receiver_does_not_stop_the_run_or_the_other_receivers():
    delivered: list[str] = []

    class Host:
        def emit(self, event: dict[str, Any]) -> None:
            raise RuntimeError("receiver is broken")

    def create(**_):
        def handler(event: dict[str, Any]) -> None:
            delivered.append(event["name"])

        return Extension(on={"turn.done": handler})

    runtime = create_runtime(
        config={"agents": {"main": {"model": "m", "extensions": {"watch": {}}}}},
        models={"m": replies(answer("ok"))},
        extensions={"watch": define_extension(name="watch", create=create)},
        host=Host(),
    )
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        assert result["status"] == "done"
        assert delivered == ["turn.done"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_tool_events_carry_the_call_and_a_retry_starts_the_pair_again():
    host = Recorder()
    attempts = {"count": 0}

    def flaky(value: Any, ctx: Any) -> Any:
        attempts["count"] += 1
        if attempts["count"] == 1: raise RuntimeError("boom")
        return {"ok": True}

    config = {"agents": {"main": {"model": "m", "tools": ["flaky"], "hooks": {"error": [{"fn": "retry_tool"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(tool_call("flaky", args={"a": 1}), answer())},
        tools={"flaky": define_tool(name="flaky", description="flaky", input={}, execute=flaky)},
        functions={"retry_tool": lambda value: {"retry": True, "target": "tool"}},
        host=host,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        names = [event["name"] for event in host.events if event["name"].startswith("tool.")]
        assert names == ["tool.start", "tool.error", "tool.start", "tool.done"]
        assert host.names("tool.error")[0]["data"]["codes"] == ["tool_error"]
        assert set(host.names("tool.done")[0]["data"]) == {"tool", "callId", "args", "result"}
        assert host.names("tool.start")[0]["data"] == {"tool": "flaky", "callId": "call-1", "args": {"a": 1}}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_step_done_precedes_the_model_result_stage():
    host = Recorder()
    order: list[str] = []

    def note(value: Any) -> Any:
        order.append("modelResult")
        return value

    class Host(Recorder):
        def emit(self, event: dict[str, Any]) -> None:
            super().emit(event)
            if event["name"] == "step.done": order.append("step.done")

    host = Host()
    config = {"agents": {"main": {"model": "m", "hooks": {"modelResult": [{"name": "note", "fn": "note"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, functions={"note": note}, host=host)
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert order == ["step.done", "modelResult"]
        assert host.names("step.done")[0]["data"] == {"step": 1, "finishReason": "stop"}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failed_extension_preparation_reports_turn_error_without_turn_start():
    host = Recorder()

    def create(**_):
        return Extension(tools=[define_tool(name="missing", description="", input={}, execute=lambda value, ctx: None)])

    config = {"agents": {"main": {"model": "m", "extensions": {"broken": {}}, "hooks": {"toolResult": [{"extension": "broken"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(answer())},
        extensions={"broken": define_extension(name="broken", create=create)},
        host=host,
    )
    try:
        with pytest.raises(Exception):
            await runtime.run_turn("hello", conversation_id="c1")
        assert [event["name"] for event in host.events] == ["turn.error"]
        assert host.events[0]["data"]["where"] == "runtime"
        assert host.events[0]["data"]["codes"] == ["binding.extension_hook"]
    finally:
        await runtime.close()


# --- idle -------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idle_waits_for_async_hook_work():
    finished: list[str] = []

    async def late(value: Any, ctx: Any) -> Any:
        await asyncio.sleep(0.02)
        finished.append("late")
        return None

    config = {"agents": {"main": {"model": "m", "extensions": {"memory": {}}, "hooks": {"conversation": [{"extension": "memory", "mode": "async"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(answer())},
        extensions={"memory": define_extension(name="memory", create=lambda **_: Extension(hooks={"conversation": late}))},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert finished == []
        await runtime.idle()
        assert finished == ["late"]
        await runtime.idle()
    finally:
        await runtime.close()
    await runtime.idle()


@pytest.mark.asyncio
async def test_idle_returns_after_close_stopped_the_work():
    release = asyncio.Event()

    async def never(value: Any, ctx: Any) -> Any:
        await release.wait()
        return None

    config = {"agents": {"main": {"model": "m", "extensions": {"memory": {}}, "hooks": {"conversation": [{"extension": "memory", "mode": "async"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(answer())},
        extensions={"memory": define_extension(name="memory", create=lambda **_: Extension(hooks={"conversation": never}))},
    )
    await runtime.run_turn("hello", conversation_id="c1")
    await runtime.close()
    await runtime.idle()


@pytest.mark.asyncio
async def test_idle_waits_for_completion_delivery():
    host = Recorder()
    config = {"agents": {"main": {"model": "m", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(tool_call("write"), answer("pending"), answer("completion received"))},
        tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, ctx: value)},
        host=host,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        await runtime.decide_operation("c1", operation["operationId"], {"decision": "approved"})
        await runtime.idle()
        operations = await runtime.list_operations("c1")
        assert operations[0]["deliveryStatus"] == "delivered"
        started = host.names("tool.start")
        assert started[-1]["data"]["operationId"] == operation["operationId"]
    finally:
        await runtime.close()
