"""§실행 오류, §재시도 and §실패한 실행과 대화: the execution side of the error rules."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from goondan import (
    Extension,
    GoondanAbortError,
    GoondanConfigError,
    GoondanExecutionError,
    create_goondan,
    define_extension,
    define_tool,
)
from goondan.store import _ConversationProjection as InMemoryConversationStore
from goondan.store import _OperationProjection as InMemoryOperationStore


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def calls(*names: str) -> dict[str, Any]:
    parts = [{"type": "tool.call", "callId": f"{name}-1", "name": name, "args": {}} for name in names]
    return {"message": {"role": "assistant", "content": parts}, "finishReason": "tool"}


def replies(*outputs: Any):
    remaining = list(outputs)

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return remaining.pop(0) if remaining else answer("exhausted")

    return model


def retry(target: str):
    return lambda value: {"retry": True, "target": target}


# --- the retry limit ---------------------------------------------------------------------------


async def test_the_default_limit_calls_the_model_four_times_and_fails_with_the_last_error():
    attempts = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        attempts["count"] += 1
        raise RuntimeError(f"failure {attempts['count']}")

    config = {"agents": {"main": {"model": "m", "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(config=config, models={"m": model}, functions={"again": retry("model")})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run("hello", session_id="c1")
        assert attempts["count"] == 4
        assert (error.value.where, error.value.codes, error.value.attempt) == ("model", ["model_error"], 4)
        assert error.value.message == "failure 4"
    finally:
        await runtime.close()


@pytest.mark.parametrize("limit", [0, 1])
async def test_a_smaller_limit_follows_fewer_retries(limit: int):
    attempts = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        attempts["count"] += 1
        raise RuntimeError("no")

    config = {"agents": {"main": {"model": "m", "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(config=config, models={"m": model}, functions={"again": retry("model")}, max_retries=limit)
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run("hello", session_id="c1")
        assert attempts["count"] == limit + 1
        assert error.value.attempt == limit + 1
    finally:
        await runtime.close()


async def test_a_sub_run_counts_its_own_retries():
    attempts = {"main": 0, "helper": 0}

    async def main(value: dict[str, Any]) -> dict[str, Any]:
        attempts["main"] += 1
        return calls("helper") if attempts["main"] == 1 else answer("ready")

    async def helper(value: dict[str, Any]) -> dict[str, Any]:
        attempts["helper"] += 1
        if attempts["helper"] <= 3:
            raise RuntimeError("no")
        return answer("helped")

    config = {
        "agents": {
            "main": {"model": "main", "tools": [{"agent": "helper"}]},
            "helper": {"model": "helper", "hooks": {"onError": [{"fn": "again"}]}},
        },
    }
    runtime = create_goondan(config=config, models={"main": main, "helper": helper}, functions={"again": retry("model")})
    try:
        result = await runtime.run("hello", session_id="c1")
        assert attempts["helper"] == 4
        assert [record["status"] for record in result["runs"]] == ["done", "done"]
    finally:
        await runtime.close()


# --- the retry target ---------------------------------------------------------------------------


async def test_a_retry_target_that_does_not_match_the_failure_is_not_followed():
    attempts = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        attempts["count"] += 1
        raise RuntimeError("model is down")

    config = {"agents": {"main": {"model": "m", "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(config=config, models={"m": model}, functions={"again": retry("tool")})
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run("hello", session_id="c1")
        assert attempts["count"] == 1
        assert (error.value.where, error.value.codes, error.value.attempt) == ("model", ["model_error"], 1)
    finally:
        await runtime.close()


async def test_a_model_target_is_not_followed_for_a_tool_failure():
    runs = {"count": 0}

    def broken(value: Any, ctx: Any) -> Any:
        runs["count"] += 1
        raise RuntimeError("tool is down")

    config = {"agents": {"main": {"model": "m", "tools": ["work"], "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": replies(calls("work"))},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=broken)},
        functions={"again": retry("model")},
    )
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run("hello", session_id="c1")
        assert runs["count"] == 1
        assert (error.value.where, error.value.codes) == ("tool", ["tool_error"])
        assert error.value.tool_call == {"id": "work-1", "name": "work", "args": {}}
    finally:
        await runtime.close()


async def test_a_pending_operation_needs_no_host_callback_and_reaches_no_error_hook():
    requests = {"count": 0}
    stages: list[Any] = []

    class Host:
        def request_approval(self, request: dict[str, Any]) -> None:
            requests["count"] += 1
            raise RuntimeError("the host is unreachable")

    def watch(value: Any) -> Any:
        stages.append(value)
        return {"retry": True, "target": "tool"}

    config = {"agents": {"main": {"model": "m", "tools": [{"tool": "work", "approval": "required"}], "hooks": {"onError": [{"fn": "again"}]}}}}
    store = InMemoryConversationStore()
    runtime = create_goondan(
        config=config, models={"m": replies(calls("work"))},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: value)},
        functions={"again": watch}, host=Host(), _conversation_projection=store, _operation_projection=InMemoryOperationStore(),
    )
    try:
        result = await runtime.run("hello", session_id="c1")
        assert result["status"] == "done"
        assert requests["count"] == 0
        assert stages == []
        stored = await store.load("c1", "main")
        assert [message["role"] for message in stored] == ["user", "assistant", "tool", "assistant"]
    finally:
        await runtime.close()


# --- attempt numbering ---------------------------------------------------------------------------


async def test_attempt_counts_the_retries_this_run_already_followed():
    seen: list[tuple[str, int]] = []
    failures = {"b": 0, "c": 0}

    def work(name: str):
        def execute(value: Any, ctx: Any) -> Any:
            failures[name] = failures.get(name, 0) + 1
            if name in ("b", "c") and failures[name] == 1:
                raise RuntimeError(f"{name} is down")
            return [{"type": "text", "text": name}]
        return define_tool(name=name, description=name, input={"type": "object"}, execute=execute)

    def again(value: Any) -> Any:
        seen.append((value["toolCall"]["name"], value["attempt"]))
        return {"retry": True, "target": "tool"}

    config = {"agents": {"main": {"model": "m", "tools": ["a", "b", "c"], "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": replies(calls("a", "b", "c"), answer("ready"))},
        tools={name: work(name) for name in ("a", "b", "c")}, functions={"again": again},
    )
    try:
        result = await runtime.run("hello", session_id="c1")
        assert seen == [("b", 1), ("c", 2)]
        assert result["output"] == "ready"
    finally:
        await runtime.close()


async def test_a_retry_repeats_only_the_failed_call_and_reports_tool_start_again():
    started: list[str] = []
    attempts = {"count": 0}

    class Host:
        def emit(self, event: dict[str, Any]) -> None:
            if event["type"] in ("tool.start", "tool.done", "tool.error"):
                    started.append(f"{event['type']}:{event['data']['tool']}")

    def flaky(value: Any, ctx: Any) -> Any:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("no")
        return [{"type": "text", "text": "ok"}]

    config = {"agents": {"main": {"model": "m", "tools": ["steady", "flaky"], "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": replies(calls("steady", "flaky"), answer("ready"))},
        tools={
            "steady": define_tool(name="steady", description="steady", input={"type": "object"}, execute=lambda value, ctx: [{"type": "text", "text": "ok"}]),
            "flaky": define_tool(name="flaky", description="flaky", input={"type": "object"}, execute=flaky),
        },
        functions={"again": retry("tool")}, host=Host(),
    )
    try:
        await runtime.run("hello", session_id="c1")
        assert started == [
            "tool.start:steady", "tool.done:steady",
            "tool.start:flaky", "tool.error:flaky",
            "tool.start:flaky", "tool.done:flaky",
        ]
    finally:
        await runtime.close()


# --- failed runs and the conversation -------------------------------------------------------------


async def test_a_failed_run_keeps_the_messages_it_stored_and_the_next_run_repairs_the_pair():
    store = InMemoryConversationStore()
    attempts = {"count": 0}

    def broken(value: Any, ctx: Any) -> Any:
        raise RuntimeError("no")

    config = {"agents": {"main": {"model": "m", "tools": ["work"]}}}
    runtime = create_goondan(
        config=config, models={"m": replies(calls("work"), answer("second"))},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=broken)},
        _conversation_projection=store,
    )
    try:
        with pytest.raises(GoondanExecutionError):
            await runtime.run("first", session_id="c1")
        stored = await store.load("c1", "main")
        assert [message["role"] for message in stored] == ["user", "assistant"]
        assert stored[1]["content"][0]["type"] == "tool.call"

        await runtime.run("second", session_id="c1")
        repaired = await store.load("c1", "main")
        assert [message["role"] for message in repaired] == ["user", "user", "assistant"]
        assert attempts["count"] == 0
    finally:
        await runtime.close()


async def _v2_projection_repair_keeps_a_message_whose_content_was_already_empty():
    store = InMemoryConversationStore()
    await store.replace("c1", "main", [
        {"id": "empty", "role": "assistant", "content": [], "source": "model"},
        {"id": "lonely", "role": "assistant", "content": [{"type": "tool.call", "callId": "gone", "name": "work", "args": {}}], "source": "model"},
        {"id": "kept", "role": "assistant", "content": [{"type": "text", "text": "hi"}], "source": "model"},
    ])
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": replies(answer("second"))}, _conversation_projection=store)
    try:
        await runtime.run("second", session_id="c1")
        repaired = await store.load("c1", "main")
        # the message that was already empty stays; the one the repair emptied is gone.
        assert [message["id"] for message in repaired][:2] == ["empty", "kept"]
        assert all(part.get("type") != "tool.call" for message in repaired for part in message["content"])
    finally:
        await runtime.close()


# --- how a failure travels -----------------------------------------------------------------------


async def test_a_failed_flow_step_fails_the_turn_with_its_own_error():
    store = InMemoryConversationStore()

    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("no model")

    config = {"agents": {"first": {"model": "first"}, "second": {"model": "second"}}, "routes": ["first", "second"]}
    runtime = create_goondan(config=config, models={"first": replies(answer("one")), "second": broken}, _conversation_projection=store, max_retries=0)
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run("start", session_id="c1")
        assert (error.value.where, error.value.codes) == ("model", ["model_error"])
        # §route 진행: a failed turn does not roll back what an earlier step stored.
        assert [message["role"] for message in await store.load("c1", "first")] == ["user", "assistant"]
    finally:
        await runtime.close()


async def test_a_failure_that_matches_no_other_code_ends_the_run_as_a_runtime_error():
    class BrokenStore(InMemoryConversationStore):
        async def append(self, session_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
            raise RuntimeError("the store is gone")

    events: list[dict[str, Any]] = []
    config = {"agents": {"main": {"model": "m"}}}
    runtime = create_goondan(config=config, models={"m": replies(answer())}, _conversation_projection=BrokenStore(), emit=lambda event: events.append(event))
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run("hello", session_id="c1")
        assert (error.value.where, error.value.codes, error.value.attempt) == ("runtime", ["runtime_error"], 1)
        failed = next(event for event in events if event["type"] == "turn.error")
        assert (failed["data"]["error"]["where"], failed["data"]["error"]["codes"]) == ("runtime", ["runtime_error"])
    finally:
        await runtime.close()


async def test_a_retry_that_asks_for_a_delay_waits_before_it_runs_again():
    moments: list[float] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        moments.append(time.monotonic())
        if len(moments) == 1:
            raise RuntimeError("no")
        return answer("late")

    config = {"agents": {"main": {"model": "m", "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(config=config, models={"m": model}, functions={"again": lambda value: {"retry": True, "target": "model", "afterMs": 50}})
    try:
        await runtime.run("hello", session_id="c1")
        assert len(moments) == 2 and moments[1] - moments[0] >= 0.05
    finally:
        await runtime.close()


async def test_a_run_that_is_aborted_while_it_waits_follows_no_retry():
    started = asyncio.Event()

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        raise RuntimeError("no")

    config = {"agents": {"main": {"model": "m", "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(config=config, models={"m": model}, functions={"again": lambda value: {"retry": True, "target": "model", "afterMs": 5000}})
    try:
        turn = asyncio.create_task(runtime.run("hello", session_id="c1"))
        await started.wait()
        await asyncio.sleep(0)
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError) as error:
            await turn
        assert error.value.codes == ["aborted"]
    finally:
        await runtime.close()


async def test_an_abort_from_the_running_task_stops_the_retry_instead_of_waiting():
    """§재시도: an aborted run follows no retry request, so the wait never starts."""
    attempts = {"count": 0}
    holder: dict[str, Any] = {}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        attempts["count"] += 1
        raise RuntimeError("no")

    async def stop(event: dict[str, Any]) -> None:
        if event["type"] == "hook.applied":
            holder["runtime"].abort("c1")

    config = {"agents": {"main": {"model": "m", "extensions": {"watch": {}}, "hooks": {"onError": [{"fn": "again"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": model},
        functions={"again": lambda value: {"retry": True, "target": "model", "afterMs": 5000}},
        extensions={"watch": define_extension(name="watch", create=lambda **kwargs: Extension(on={"hook.applied": stop}))},
    )
    holder["runtime"] = runtime
    try:
        started = time.monotonic()
        with pytest.raises(GoondanAbortError) as error:
            await runtime.run("hello", session_id="c1")
        assert error.value.codes == ["aborted"]
        assert attempts["count"] == 1 and time.monotonic() - started < 1
    finally:
        await runtime.close()


async def test_a_failed_turn_leaves_no_run_to_abort():
    async def model(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("no")

    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model})
    try:
        with pytest.raises(GoondanExecutionError):
            await runtime.run("hello", session_id="c1")
        assert runtime.abort("c1") is False
    finally:
        await runtime.close()


async def test_a_turn_that_fails_while_preparing_an_extension_raises_the_configuration_error():
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"onOutput": [{"extension": "ext", "optional": True}]}}}}
    runtime = create_goondan(
        config=config, models={"m": replies(answer())},
        extensions={"ext": define_extension(name="ext", create=lambda **kwargs: Extension(hooks={}))},
    )
    try:
        with pytest.raises(GoondanConfigError) as error:
            await runtime.run("hello", session_id="c1")
        assert [item["code"] for item in error.value.issues] == ["binding.extension_hook"]
    finally:
        await runtime.close()
