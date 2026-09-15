"""§승인 작업: creation, records, decisions, execution, completion delivery, recovery and close."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from goondan import (
    Extension,
    GoondanError,
    InMemoryConversationStore,
    InMemoryOperationStore,
    create_runtime,
    define_extension,
    define_tool,
)

RECORD_KEYS = {"operationId", "deliveryId", "agent", "conversationId", "turnId", "toolCall", "reasons", "status", "deliveryStatus", "createdAt", "updatedAt"}


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def tool_call(name: str = "write", call_id: str = "call-1", args: Any = None) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": call_id, "name": name, "args": args or {}}]}, "finishReason": "tool"}


def calls(*parts: dict[str, Any]) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", **part} for part in parts]}, "finishReason": "tool"}


def replies(*outputs: dict[str, Any]):
    remaining = list(outputs)

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return remaining.pop(0) if remaining else answer("exhausted")

    return model


class Host:
    """A host that records every callback and keeps the completion inputs it is handed."""

    def __init__(self, **behaviour: Any):
        self.events: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []
        self.captures: list[dict[str, Any]] = []
        self.completions: list[dict[str, Any]] = []
        self.behaviour = behaviour

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def names(self, name: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event["name"] == name]

    def request_approval(self, request: dict[str, Any]) -> None:
        self.requests.append(request)
        failure = self.behaviour.get("request_approval_error")
        if failure:
            raise RuntimeError(failure)


def approval_config(tool_use: Any = None) -> dict[str, Any]:
    return {"agents": {"main": {"model": "m", "input": "asis", "tools": [tool_use or {"tool": "write", "approval": "required"}]}}}


def echo(values: list[Any] | None = None, name: str = "write"):
    def execute(value: Any, ctx: Any) -> Any:
        if values is not None:
            values.append({"args": value, "input": ctx["input"], "turnId": ctx["turnId"], "toolCall": ctx["toolCall"], "execution": ctx["execution"]})
        return value

    return define_tool(name=name, description=name, input={}, execute=execute)


# --- creation ----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_created_operation_has_only_the_declared_fields_and_a_pending_tool_result():
    host = Host()
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(args={"text": "x"}), answer("pending"))},
        tools={"write": echo()}, conversation_store=store, host=host,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        assert set(operation) == RECORD_KEYS
        assert operation["operationId"].startswith("operation_") and operation["toolCall"]["id"] not in operation["operationId"]
        assert operation["deliveryId"] == f"operation:{operation['operationId']}:completion"
        assert (operation["status"], operation["deliveryStatus"], operation["agent"]) == ("pending", "pending", "main")
        assert operation["reasons"] == ["Tool write requires approval"]
        assert isinstance(operation["createdAt"], int) and isinstance(operation["updatedAt"], int)
        # §작업 기록과 상태: the times are milliseconds since 1970-01-01T00:00:00Z, not seconds.
        assert 0 <= time.time() * 1000 - operation["createdAt"] < 60_000
        pending = {"status": "pending", "operationId": operation["operationId"]}
        stored = await store.load("c1", "main")
        assert [message for message in stored if message["role"] == "tool"] == [{
            "id": stored[2]["id"], "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": "call-1", "content": [{"type": "json", "value": pending}]}], "meta": pending,
        }]
        assert host.names("humanApproval.created")[0]["data"] == {"operationId": operation["operationId"], "tool": "write", "callId": "call-1", "reasons": ["Tool write requires approval"]}
        assert host.requests[0] == {"operationId": operation["operationId"], "conversationId": "c1", "turnId": host.requests[0]["turnId"], "agent": "main", "toolCall": {"id": "call-1", "name": "write", "args": {"text": "x"}}, "reasons": ["Tool write requires approval"]}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_two_calls_with_the_same_call_id_become_two_operations():
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(calls({"callId": "same", "name": "write", "args": {"n": 1}}, {"callId": "same", "name": "write", "args": {"n": 2}}), answer())},
        tools={"write": echo()},
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operations = await runtime.list_operations("c1")
        assert [item["toolCall"]["args"] for item in operations] == [{"n": 1}, {"n": 2}]
        assert len({item["operationId"] for item in operations}) == 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_captured_context_is_stored_and_a_capture_failure_stores_nothing():
    captured: list[dict[str, Any]] = []

    class Capturing(Host):
        def capture_operation_context(self, request: dict[str, Any]) -> Any:
            captured.append(request)
            return {"ticket": len(captured)} if len(captured) == 1 else float("nan")

    host = Capturing()
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), tool_call(call_id="call-2"), answer())},
        tools={"write": echo()}, host=host,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        assert (await runtime.list_operations("c1"))[0]["context"] == {"ticket": 1}
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("again", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("tool", ["runtime_error"])
        assert failure.value.tool_call["id"] == "call-2"
        assert len(await runtime.list_operations("c1")) == 1
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failing_approval_request_fails_the_run_but_keeps_the_pending_operation():
    host = Host(request_approval_error="cannot reach the reviewer")
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer())},
        tools={"write": echo()}, conversation_store=store, host=host,
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("start", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("tool", ["runtime_error"])
        assert [item["status"] for item in await runtime.list_operations("c1")] == ["pending"]
        assert any(message["role"] == "tool" for message in await store.load("c1", "main"))
        assert host.names("tool.error") == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_call_that_is_not_in_the_tools_list_makes_no_operation_and_no_tool_event():
    host = Host()
    config = {"agents": {"main": {"model": "m", "input": "asis", "tools": ["write"], "hooks": {"toolCall": [{"name": "ask", "fn": "ask"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("absent"), answer())},
        tools={"write": echo()}, host=host,
        functions={"ask": lambda value: {"approval": {"reason": "please look"}}},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("start", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("tool", ["tool_unavailable"])
        assert await runtime.list_operations("c1") == []
        assert host.names("tool.start") == [] and host.names("tool.error") == []
    finally:
        await runtime.close()


# --- decisions and cancellation ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_decision_on_a_settled_operation_changes_nothing_and_cancel_stops_an_approved_one():
    executed: list[Any] = []
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": echo(executed)},
        host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        cancelled = await runtime.cancel_operation("c1", operation_id)
        assert cancelled["status"] == "cancelled"
        repeated = await runtime.cancel_operation("c1", operation_id)
        decided = await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
        await runtime.idle()
        assert repeated["status"] == decided["status"] == "cancelled"
        assert executed == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_cancelling_an_unknown_operation_is_an_operation_invalid_error():
    runtime = create_runtime(config=approval_config(), models={"m": replies(answer())}, tools={"write": echo()})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.cancel_operation("c1", "operation_absent")
        assert (failure.value.where, failure.value.codes) == ("runtime", ["operation_invalid"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["approved", {"decision": "cancelled"}, {}, None, {"decision": True}])
async def test_a_decision_that_is_not_approved_or_rejected_is_refused(value: Any):
    """§결정과 취소 2: the decision value decides nothing but `approved` and `rejected`."""
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"))}, tools={"write": echo()}, host=Host())
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        with pytest.raises(GoondanError) as failure:
            await runtime.decide_operation("c1", operation_id, value)
        assert (failure.value.where, failure.value.codes) == ("runtime", ["operation_invalid"])
        assert (await runtime.list_operations("c1"))[0]["status"] == "pending"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_input_patch_is_refused_when_the_host_offers_no_patch_validation():
    """§결정과 취소 4: no validation function means the input patch was not allowed."""
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(args={"a": 1}), answer("pending"))}, tools={"write": echo()}, host=Host())
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        with pytest.raises(GoondanError) as failure:
            await runtime.decide_operation("c1", operation_id, {"decision": "approved", "inputPatch": {"a": 2}})
        assert failure.value.codes == ["operation_invalid"]
        stored = (await runtime.list_operations("c1"))[0]
        assert stored["status"] == "pending" and "inputPatch" not in stored
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_decision_and_a_cancellation_that_arrive_together_change_the_operation_once():
    """§작업 기록과 상태: the store applies one conditional transition, never both."""
    executed: list[Any] = []
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": echo(executed)}, host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        decided, cancelled = await asyncio.gather(
            runtime.decide_operation("c1", operation_id, {"decision": "approved"}),
            runtime.cancel_operation("c1", operation_id),
        )
        await runtime.idle()
        # Either order is allowed, but the operation takes one of the two transitions, so the
        # tool runs exactly once or not at all.
        assert {decided["operationId"], cancelled["operationId"]} == {operation_id}
        final = (await runtime.list_operations("c1"))[0]["status"]
        assert final in {"completed", "cancelled"}
        assert len(executed) == (1 if final == "completed" else 0)
    finally:
        await runtime.close()


# --- execution ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_approved_execution_runs_the_tool_with_the_operation_context_and_applies_tool_result_hooks():
    seen: list[Any] = []
    host = Host()

    def decorate(value: Any, ctx: Any) -> Any:
        return {**value, "content": [*value["content"], {"type": "text", "text": "reviewed"}]}

    config = {"agents": {"main": {
        "model": "m", "input": "asis", "extensions": {"ext": {}},
        "tools": [{"tool": "write", "approval": "required"}],
        "hooks": {"toolCall": [{"name": "info", "fn": "info"}], "toolResult": [{"name": "mark", "extension": "ext"}]},
    }}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call(args={"text": "x"}), answer("pending"), answer("completion"))},
        tools={"write": echo(seen)}, host=host,
        functions={"info": lambda value: {"call": value, "execution": {"ticket": 7}}},
        extensions={"ext": define_extension(name="ext", create=lambda **_: Extension(hooks={"toolResult": decorate}))},
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        assert operation["execution"] == {"ticket": 7}
        await runtime.decide_operation("c1", operation["operationId"], {"decision": "approved"})
        await runtime.idle()
        completed = (await runtime.list_operations("c1"))[0]
        assert completed["status"] == "completed"
        assert completed["result"]["content"] == [{"type": "json", "value": {"text": "x"}}, {"type": "text", "text": "reviewed"}]
        assert seen[0]["input"] == {"type": "operation_execution", "operationId": operation["operationId"]}
        assert seen[0]["turnId"] == operation["turnId"] and seen[0]["execution"] == {"ticket": 7}
        assert "operationId" not in seen[0]["toolCall"]
        started = host.names("tool.start")[0]
        assert started["data"] == {"tool": "write", "callId": "call-1", "args": {"text": "x"}, "operationId": operation["operationId"]}
        assert host.names("tool.done")[0]["data"]["operationId"] == operation["operationId"]
        # §승인된 작업의 실행: the execution is not a turn, so only the first turn and the
        # delivery turn report turn.start.
        assert [event["turnId"] == operation["turnId"] for event in host.names("turn.start")] == [True, False]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_that_left_the_agent_fails_the_operation_before_it_runs():
    host = Host()
    store = InMemoryOperationStore()
    first = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"))}, tools={"write": echo()}, operation_store=store, host=host)
    await first.run_turn("start", conversation_id="c1")
    operation_id = (await first.list_operations("c1"))[0]["operationId"]
    await first.close()

    changed = create_runtime(config={"agents": {"main": {"model": "m", "input": "asis", "tools": []}}}, models={"m": replies(answer("completion"))}, operation_store=store, host=host)
    try:
        await changed.decide_operation("c1", operation_id, {"decision": "approved"})
        await changed.idle()
        failed = (await changed.list_operations("c1"))[0]
        assert (failed["status"], failed["errorCode"], failed["error"]) == ("failed", "validation_failed", "Operation validation failed")
        assert failed["deliveryStatus"] == "delivered"
        assert [event["name"] for event in host.names("tool.start")] == []
    finally:
        await changed.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(("outcome", "message"), [(False, "Operation validation failed"), ("raise", "the reviewer disappeared")])
async def test_a_host_validation_that_refuses_or_throws_fails_the_operation(outcome: Any, message: str):
    class Validating(Host):
        def validate_operation(self, operation: dict[str, Any]) -> Any:
            if outcome == "raise":
                raise RuntimeError(message)
            return outcome

    executed: list[Any] = []
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": echo(executed)}, host=Validating(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
        await runtime.idle()
        failed = (await runtime.list_operations("c1"))[0]
        assert (failed["status"], failed["errorCode"], failed["error"]) == ("failed", "validation_failed", message)
        assert executed == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_an_extension_provides_is_a_valid_operation_target():
    """§승인된 작업의 실행 1: an activated extension's tool is an execution target of its own."""
    tool = define_tool(name="x", description="x", input={}, execute=lambda args, ctx: [{"type": "text", "text": "from the extension"}])
    definition = define_extension(name="ext", create=lambda **_: Extension(tools=[tool]), tools=["x"])
    config = {"agents": {"main": {"model": "m", "input": "asis", "extensions": {"ext": {}}, "tools": [{"tool": "x", "approval": "required"}]}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("x"), answer("pending"), answer("completion"))},
        extensions={"ext": definition}, host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
        await runtime.idle()
        completed = (await runtime.list_operations("c1"))[0]
        assert completed["status"] == "completed"
        assert completed["result"]["content"] == [{"type": "text", "text": "from the extension"}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failing_tool_result_hook_fails_the_operation_with_execution_failed():
    """§승인된 작업의 실행 4: a required `toolResult` hook that fails is an execution failure."""

    def broken(value: Any, ctx: Any) -> Any:
        raise RuntimeError("the hook gave up")

    definition = define_extension(name="ext", create=lambda **_: Extension(hooks={"toolResult": broken}), hooks=["toolResult"])
    config = {"agents": {"main": {
        "model": "m", "input": "asis", "extensions": {"ext": {}},
        "tools": [{"tool": "write", "approval": "required"}],
        "hooks": {"toolResult": [{"extension": "ext", "optional": False}]},
    }}}
    host = Host()
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": echo()}, extensions={"ext": definition}, host=host,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
        await runtime.idle()
        failed = (await runtime.list_operations("c1"))[0]
        assert (failed["status"], failed["errorCode"]) == ("failed", "execution_failed")
        assert "the hook gave up" in failed["error"] and "result" not in failed
        assert [event["data"]["operationId"] for event in host.names("tool.error")] == [operation_id]
        assert host.names("tool.done") == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_execution_that_ends_after_close_is_not_recorded():
    """§런타임 종료와 작업: a stopped runtime leaves the operation `running` for the next one."""
    started = asyncio.Event()

    async def execute(args: Any, ctx: Any) -> Any:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            raise RuntimeError("the tool gave up when it was stopped") from None
        return args

    store = InMemoryOperationStore()
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"))},
        tools={"write": define_tool(name="write", description="write", input={}, execute=execute)},
        operation_store=store, host=Host(),
    )
    await runtime.run_turn("start", conversation_id="c1")
    operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
    await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
    await started.wait()
    await runtime.close()
    await runtime.idle()
    left = (await runtime.list_operations("c1"))[0]
    assert left["status"] == "running" and "errorCode" not in left


@pytest.mark.asyncio
async def test_an_approved_agent_tool_runs_in_the_sub_conversation_of_the_operation_turn():
    store = InMemoryConversationStore()
    config = {"agents": {"main": {"model": "m", "input": "asis", "tools": [{"agent": "worker", "approval": "required"}]}, "worker": {"model": "worker"}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("worker"), answer("pending"), answer("completion")), "worker": replies(answer("worker done"))},
        conversation_store=store, host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        await runtime.decide_operation("c1", operation["operationId"], {"decision": "approved"})
        await runtime.idle()
        completed = (await runtime.list_operations("c1"))[0]
        assert completed["result"]["content"] == [{"type": "text", "text": "worker done"}]
        assert (f"c1:{operation['turnId']}:worker", "worker") in store.conversations
    finally:
        await runtime.close()


# --- completion delivery ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_host_deliverer_receives_the_completion_input_with_its_keys_in_order():
    class Delivering(Host):
        def deliver_operation_completion(self, value: dict[str, Any]) -> None:
            self.completions.append(value)

    host = Delivering()
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(args={"text": "x"}), answer("pending"))}, tools={"write": echo()}, host=host)
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        await runtime.decide_operation("c1", operation["operationId"], {"decision": "approved"})
        await runtime.idle()
        completion = host.completions[0]
        assert list(completion) == ["type", "deliveryId", "operationId", "conversationId", "agent", "status", "toolCall", "result"]
        assert completion["deliveryId"] == operation["deliveryId"] and completion["status"] == "completed"
        delivered = (await runtime.list_operations("c1"))[0]
        assert delivered["deliveryStatus"] == "delivered" and isinstance(delivered["deliveredAt"], int)
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failing_delivery_goes_back_to_pending_and_recovery_tries_again():
    class Flaky(Host):
        def deliver_operation_completion(self, value: dict[str, Any]) -> None:
            self.completions.append(value)
            if len(self.completions) == 1:
                raise RuntimeError("the receiver is down")

    host = Flaky()
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"))}, tools={"write": echo()}, host=host)
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
        await runtime.idle()
        after_failure = (await runtime.list_operations("c1"))[0]
        assert (after_failure["status"], after_failure["deliveryStatus"]) == ("completed", "pending")
        assert "deliveredAt" not in after_failure
        await runtime.recover_operations("c1")
        await runtime.idle()
        assert (await runtime.list_operations("c1"))[0]["deliveryStatus"] == "delivered"
        assert [item["deliveryId"] for item in host.completions] == [after_failure["deliveryId"]] * 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_fallback_delivery_turn_runs_one_agent_without_following_routes():
    store = InMemoryConversationStore()
    config = {
        "agents": {"main": {"model": "m", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}, "next": {"model": "next"}},
        "flow": {"in": "main", "routes": [{"from": "main", "to": "next"}, {"from": "next", "to": "out"}]},
    }
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call(), answer("pending"), answer("completion")), "next": replies(answer("routed"), answer("routed again"))},
        tools={"write": echo()}, conversation_store=store,
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        await runtime.decide_operation("c1", operation["operationId"], {"decision": "approved"})
        await runtime.idle()
        texts = [message["content"][0].get("text", "") for message in await store.load("c1", "main")]
        assert any(text.startswith('{"type":"operation_completion"') for text in texts)
        # §완료 전달 3: the delivery turn runs the operation's agent alone, so `next` keeps
        # the one run of the first turn.
        assert [message["role"] for message in await store.load("c1", "next")] == ["user", "assistant"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_fallback_delivery_message_is_the_json_text_of_the_completion_input():
    """§완료 전달, §JSON 텍스트: an `asis` agent serialises the completion input key by key."""
    store = InMemoryConversationStore()
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": echo()}, conversation_store=store, host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        await runtime.decide_operation("c1", operation["operationId"], {"decision": "rejected"})
        await runtime.idle()
        texts = [message["content"][0]["text"] for message in await store.load("c1", "main") if message["role"] == "user"]
        assert texts[-1] == (
            '{"type":"operation_completion"'
            f',"deliveryId":"{operation["deliveryId"]}"'
            f',"operationId":"{operation["operationId"]}"'
            ',"conversationId":"c1","agent":"main","status":"rejected"'
            ',"toolCall":{"id":"call-1","name":"write","args":{}}}'
        )
    finally:
        await runtime.close()


# --- recovery and close -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recovery_reports_an_interrupted_execution_and_re_requests_pending_approvals():
    store = InMemoryOperationStore()
    host = Host()
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))}, tools={"write": echo()}, operation_store=store, host=host)
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        # An operation the previous runtime left while its tool was running.
        await store.transition("c1", operation_id, ["pending"], {"status": "running", "updatedAt": 1})
        await runtime.recover_operations("c1")
        await runtime.idle()
        recovered = (await runtime.list_operations("c1"))[0]
        assert (recovered["status"], recovered["errorCode"]) == ("failed", "execution_interrupted")
        assert recovered["error"] == "Operation execution outcome is unknown because the runtime stopped"
        assert recovered["deliveryStatus"] == "delivered"
        assert len(host.requests) == 1
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_recovery_leaves_the_execution_this_runtime_is_running_alone():
    entered = asyncio.Event()
    release = asyncio.Event()

    async def slow(value: Any, ctx: Any) -> Any:
        entered.set()
        await release.wait()
        return value

    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": define_tool(name="write", description="write", input={}, execute=slow)}, host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
        await entered.wait()
        await runtime.recover_operations("c1")
        assert (await runtime.list_operations("c1"))[0]["status"] == "running"
        release.set()
        await runtime.idle()
        assert (await runtime.list_operations("c1"))[0]["status"] == "completed"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_recovery_processes_every_operation_and_then_fails_with_the_first_request_error():
    store = InMemoryOperationStore()
    host = Host(request_approval_error="the reviewer is away")
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(calls({"callId": "a", "name": "write", "args": {}}, {"callId": "b", "name": "write", "args": {}}), answer("pending"))},
        tools={"write": echo()}, operation_store=store,
    )
    await runtime.run_turn("start", conversation_id="c1")
    operations = await runtime.list_operations("c1")
    await runtime.close()

    restarted = create_runtime(config=approval_config(), models={"m": replies(answer())}, tools={"write": echo()}, operation_store=store, host=host)
    try:
        with pytest.raises(RuntimeError, match="the reviewer is away"):
            await restarted.recover_operations("c1")
        assert [request["operationId"] for request in host.requests] == [item["operationId"] for item in operations]
    finally:
        await restarted.close()


@pytest.mark.asyncio
async def test_recovery_takes_over_a_delivery_that_an_earlier_runtime_left_claimed():
    store = InMemoryOperationStore()
    class Delivering(Host):
        def deliver_operation_completion(self, value: dict[str, Any]) -> None:
            self.completions.append(value)

    host = Delivering()
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"))}, tools={"write": echo()}, operation_store=store, host=host)
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await store.transition("c1", operation_id, ["pending"], {"status": "rejected", "updatedAt": 1})
        await store.claim_delivery("c1", operation_id, 2)
        await runtime.recover_operations("c1")
        await runtime.idle()
        assert (await runtime.list_operations("c1"))[0]["deliveryStatus"] == "delivered"
        assert [item["status"] for item in host.completions] == ["rejected"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_closed_runtime_refuses_decisions_but_still_lists_operations():
    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"))}, tools={"write": echo()}, host=Host())
    await runtime.run_turn("start", conversation_id="c1")
    operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
    await runtime.close()
    for request in (
        runtime.decide_operation("c1", operation_id, {"decision": "approved"}),
        runtime.cancel_operation("c1", operation_id),
        runtime.recover_operations("c1"),
    ):
        with pytest.raises(GoondanError) as failure:
            await request
        assert (failure.value.where, failure.value.codes) == ("runtime", ["runtime_error"])
    assert [item["status"] for item in await runtime.list_operations("c1")] == ["pending"]


@pytest.mark.asyncio
async def test_closing_leaves_a_claimed_delivery_for_the_next_runtime():
    store = InMemoryOperationStore()
    entered = asyncio.Event()
    release = asyncio.Event()

    class Slow(Host):
        async def deliver_operation_completion(self, value: dict[str, Any]) -> None:
            entered.set()
            await release.wait()
            self.completions.append(value)

    runtime = create_runtime(config=approval_config(), models={"m": replies(tool_call(), answer("pending"))}, tools={"write": echo()}, operation_store=store, host=Slow())
    await runtime.run_turn("start", conversation_id="c1")
    operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
    await runtime.cancel_operation("c1", operation_id)
    await entered.wait()
    await runtime.close()
    await runtime.idle()
    release.set()
    stopped = (await runtime.list_operations("c1"))[0]
    assert (stopped["status"], stopped["deliveryStatus"]) == ("cancelled", "delivering")


@pytest.mark.asyncio
async def test_closing_leaves_a_running_operation_for_the_next_runtime():
    store = InMemoryOperationStore()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def slow(value: Any, ctx: Any) -> Any:
        entered.set()
        await release.wait()
        return value

    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"))},
        tools={"write": define_tool(name="write", description="write", input={}, execute=slow)}, operation_store=store, host=Host(),
    )
    await runtime.run_turn("start", conversation_id="c1")
    operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
    await runtime.decide_operation("c1", operation_id, {"decision": "approved"})
    await entered.wait()
    await runtime.close()
    await runtime.idle()
    release.set()
    stopped = (await runtime.list_operations("c1"))[0]
    assert (stopped["status"], stopped["deliveryStatus"]) == ("running", "pending")


# --- the store protocol -------------------------------------------------------------------------


def stored(status: str = "pending", delivery: str = "pending") -> dict[str, Any]:
    return {
        "operationId": "op-1", "deliveryId": "operation:op-1:completion", "agent": "main",
        "conversationId": "c1", "turnId": "t1", "toolCall": {"id": "call-1", "name": "write", "args": {}},
        "reasons": ["danger"], "status": status, "deliveryStatus": delivery, "createdAt": 1, "updatedAt": 1,
    }


@pytest.mark.asyncio
async def test_a_transition_writes_only_the_given_fields_while_the_status_is_expected():
    """§작업 저장소 프로토콜: the expected status list decides, and only the named fields change."""
    store = InMemoryOperationStore()
    await store.save(stored())
    changed = await store.transition("c1", "op-1", ["pending", "approved"], {"status": "approved", "updatedAt": 7})
    assert changed is not None and (changed["status"], changed["updatedAt"]) == ("approved", 7)
    assert changed["reasons"] == ["danger"] and changed["deliveryStatus"] == "pending"
    assert await store.transition("c1", "op-1", ["pending"], {"status": "rejected", "updatedAt": 9}) is None
    assert await store.transition("c1", "missing", ["approved"], {"status": "running", "updatedAt": 9}) is None
    kept = await store.get("c1", "op-1")
    assert kept is not None and (kept["status"], kept["updatedAt"]) == ("approved", 7)


@pytest.mark.asyncio
async def test_a_claim_needs_a_pending_delivery_and_records_the_update_time():
    store = InMemoryOperationStore()
    await store.save(stored("completed"))
    claimed = await store.claim_delivery("c1", "op-1", 11)
    assert claimed is not None and (claimed["deliveryStatus"], claimed["updatedAt"]) == ("delivering", 11)
    assert claimed["deliveryId"] == "operation:op-1:completion"
    assert await store.claim_delivery("c1", "op-1", 12) is None
    assert await store.claim_delivery("c1", "missing", 12) is None
    again = await store.get("c1", "op-1")
    assert again is not None and again["updatedAt"] == 11


@pytest.mark.asyncio
async def test_a_release_only_returns_the_delivery_it_names():
    """§작업 저장소 프로토콜: a release whose `deliveryId` differs belongs to another delivery."""
    store = InMemoryOperationStore()
    await store.save(stored("failed"))
    await store.claim_delivery("c1", "op-1", 11)
    assert await store.release_delivery("c1", "op-1", "operation:other:completion", 12) is None
    kept = await store.get("c1", "op-1")
    assert kept is not None and (kept["deliveryStatus"], kept["updatedAt"]) == ("delivering", 11)
    released = await store.release_delivery("c1", "op-1", "operation:op-1:completion", 13)
    assert released is not None and (released["deliveryStatus"], released["updatedAt"]) == ("pending", 13)
    assert await store.release_delivery("c1", "op-1", "operation:op-1:completion", 14) is None


@pytest.mark.asyncio
async def test_finishing_a_delivery_is_a_transition_out_of_the_terminal_status():
    """§작업 저장소 프로토콜: the store has no request of its own for confirming a delivery."""
    store = InMemoryOperationStore()
    assert not hasattr(store, "finish_delivery")
    await store.save(stored("rejected"))
    await store.claim_delivery("c1", "op-1", 11)
    delivered = await store.transition("c1", "op-1", ["rejected"], {"deliveryStatus": "delivered", "deliveredAt": 12, "updatedAt": 12})
    assert delivered is not None and (delivered["deliveryStatus"], delivered["deliveredAt"]) == ("delivered", 12)
    assert await store.transition("c1", "op-1", ["completed"], {"deliveryStatus": "pending", "updatedAt": 13}) is None


@pytest.mark.asyncio
async def test_the_store_returns_copies_and_leaves_omitted_optional_fields_out():
    store = InMemoryOperationStore()
    record = stored()
    await store.save(record)
    record["reasons"].append("changed after saving")
    first = await store.get("c1", "op-1")
    assert first is not None and first["reasons"] == ["danger"]
    first["reasons"].append("changed after reading")
    second = await store.get("c1", "op-1")
    assert second is not None and second["reasons"] == ["danger"]
    assert "result" not in second and "deliveredAt" not in second and "error" not in second
    assert [item["operationId"] for item in await store.list()] == ["op-1"]
    assert await store.list("other") == []


@pytest.mark.asyncio
async def test_the_runtime_asks_the_store_with_the_arguments_the_protocol_names():
    """§작업 저장소 프로토콜: every transition carries `updatedAt`, and a release names the claim."""
    class Recording(InMemoryOperationStore):
        def __init__(self) -> None:
            super().__init__()
            self.requests: list[tuple[str, Any]] = []

        async def transition(self, conversation_id: str, operation_id: str, expected: Any, updates: Any) -> Any:
            self.requests.append(("transition", (list(expected), dict(updates))))
            return await super().transition(conversation_id, operation_id, expected, updates)

        async def claim_delivery(self, conversation_id: str, operation_id: str, updated_at: int) -> Any:
            self.requests.append(("claim", updated_at))
            return await super().claim_delivery(conversation_id, operation_id, updated_at)

    store = Recording()
    runtime = create_runtime(
        config=approval_config(), models={"m": replies(tool_call(), answer("pending"), answer("completion"))},
        tools={"write": echo()}, operation_store=store, host=Host(),
    )
    try:
        await runtime.run_turn("start", conversation_id="c1")
        operation_id = (await runtime.list_operations("c1"))[0]["operationId"]
        await runtime.decide_operation("c1", operation_id, {"decision": "rejected"})
        await runtime.idle()
    finally:
        await runtime.close()
    transitions = [payload for name, payload in store.requests if name == "transition"]
    assert all("updatedAt" in updates for _, updates in transitions)
    assert [expected for expected, _ in transitions] == [["pending"], ["rejected"]]
    assert transitions[-1][1]["deliveryStatus"] == "delivered" and "deliveredAt" in transitions[-1][1]
    assert [payload for name, payload in store.requests if name == "claim"]
    final = (await runtime.list_operations("c1"))[0]
    assert (final["status"], final["deliveryStatus"]) == ("rejected", "delivered")
