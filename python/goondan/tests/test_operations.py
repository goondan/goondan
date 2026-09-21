from __future__ import annotations

import asyncio
from typing import Any

import pytest

from goondan import GoondanError, InMemoryStore, create_goondan, define_tool, fold


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def call(args: Any = None) -> dict[str, Any]:
    return {
        "message": {
            "role": "assistant",
            "content": [{"type": "tool.call", "callId": "write-1", "name": "write", "args": {} if args is None else args}],
        },
        "finishReason": "tool",
    }


class Model:
    def __init__(self, *outputs: dict[str, Any]) -> None:
        self.outputs = list(outputs)
        self.inputs: list[dict[str, Any]] = []

    async def __call__(self, value: dict[str, Any]) -> dict[str, Any]:
        self.inputs.append(value)
        return self.outputs.pop(0) if self.outputs else answer("completion")


def runtime_with_operation(model: Model, *, store: InMemoryStore | None = None, execute: Any = None):
    tool = define_tool(
        name="write",
        description="write",
        input={"type": "object", "properties": {"value": {"type": "integer"}}, "required": ["value"], "additionalProperties": False},
        execute=execute or (lambda value, ctx: value),
    )
    return create_goondan(
        {"agents": {"main": {"model": "m", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}},
        models={"m": model},
        tools={"write": tool},
        store=store,
    )


async def make_pending(runtime: Any, session_id: str = "s") -> dict[str, Any]:
    await (await runtime.run("start", session_id=session_id)).result
    return (await runtime.operations.list(session_id))[0]


@pytest.mark.asyncio
async def test_created_operation_and_pending_result_are_derived_from_the_journal():
    store = InMemoryStore()
    runtime = runtime_with_operation(Model(call({"value": 1}), answer("pending")), store=store)
    operation = await make_pending(runtime)
    assert set(operation) == {
        "operationId", "deliveryId", "agent", "sessionId", "turnId", "instance", "executionId",
        "toolCall", "reasons", "status", "deliveryStatus", "createdAt", "updatedAt",
    }
    assert operation["status"] == "pending" and operation["deliveryStatus"] == "pending"
    stream = [event async for event in store.scan(session_id="s")]
    state = fold("s", stream)
    assert state["operations"] == [operation]
    parts = [part for message in state["conversations"][0]["messages"] for part in message["content"]]
    pending = next(part for part in parts if part.get("type") == "tool.result")
    assert pending["content"] == [{"type": "json", "value": {"status": "pending", "operationId": operation["operationId"]}}]
    await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["rejected", "cancelled"])
async def test_terminal_decisions_are_delivered_through_a_new_turn(decision: str):
    store = InMemoryStore()
    model = Model(call({"value": 1}), answer("pending"), answer("completion received"))
    runtime = runtime_with_operation(model, store=store)
    operation = await make_pending(runtime)
    changed = await runtime.operations.decide("s", operation["operationId"], {"decision": decision})
    assert changed["status"] == decision
    await runtime.idle()
    terminal = (await runtime.operations.list("s"))[0]
    assert terminal["deliveryStatus"] == "delivered"
    stream = [event async for event in store.scan(session_id="s")]
    types = [event["type"] for event in stream]
    assert types.count("turn.start") == 2
    received = next(event for event in stream if event["type"] == "input.received" and event.get("operationId") == operation["operationId"])
    assert received["data"]["input"]["status"] == decision
    assert not {"result", "error", "errorCode"} & set(received["data"]["input"])
    await runtime.close()


@pytest.mark.asyncio
async def test_approved_operation_revalidates_patch_runs_tool_and_delivers_result():
    executed: list[tuple[Any, Any]] = []

    def execute(value: Any, context: Any) -> Any:
        executed.append((value, {key: context[key] for key in ("session_id", "turn_id", "instance", "execution_id", "operation_id")}))
        return {"accepted": value["value"]}

    model = Model(call({"value": 1}), answer("pending"), answer("completion received"))
    runtime = runtime_with_operation(model, execute=execute)
    operation = await make_pending(runtime)
    approved = await runtime.operations.decide(
        "s", operation["operationId"], {"decision": "approved", "inputPatch": {"value": 2}},
    )
    assert approved["resolvedToolCall"]["args"] == {"value": 2}
    await runtime.idle()
    completed = (await runtime.operations.list("s"))[0]
    assert completed["status"] == "completed" and completed["deliveryStatus"] == "delivered"
    assert completed["result"]["callId"] == "write-1"
    assert executed[0][0] == {"value": 2}
    context = executed[0][1]
    assert context["operation_id"] == operation["operationId"]
    assert context["execution_id"] == operation["executionId"]
    await runtime.close()


@pytest.mark.asyncio
async def test_invalid_input_patch_is_rejected_without_changing_the_operation():
    runtime = runtime_with_operation(Model(call({"value": 1}), answer("pending")))
    operation = await make_pending(runtime)
    with pytest.raises(GoondanError) as failure:
        await runtime.operations.decide("s", operation["operationId"], {"decision": "approved", "inputPatch": {"value": "bad"}})
    assert failure.value.codes == ["operation_invalid"]
    assert (await runtime.operations.list("s"))[0]["status"] == "pending"
    await runtime.close()


@pytest.mark.asyncio
async def test_concurrent_decisions_append_only_one_transition():
    store = InMemoryStore()
    runtime = runtime_with_operation(Model(call({"value": 1}), answer("pending")), store=store)
    operation = await make_pending(runtime)
    results = await asyncio.gather(
        runtime.operations.decide("s", operation["operationId"], {"decision": "rejected"}),
        runtime.operations.decide("s", operation["operationId"], {"decision": "cancelled"}),
    )
    await runtime.idle()
    stream = [event async for event in store.scan(session_id="s")]
    decisions = [event["type"] for event in stream if event["type"] in ("operation.rejected", "operation.cancelled")]
    assert len(decisions) == 1
    assert {item["status"] for item in results} <= {"rejected", "cancelled"}
    await runtime.close()


@pytest.mark.asyncio
async def test_replay_marks_interrupted_execution_failed_and_delivers_it():
    store = InMemoryStore()
    started = asyncio.Event()

    async def blocking(value: Any, context: Any) -> Any:
        started.set()
        await asyncio.sleep(60)

    first = runtime_with_operation(Model(call({"value": 1}), answer("pending")), store=store, execute=blocking)
    operation = await make_pending(first)
    await first.operations.decide("s", operation["operationId"], {"decision": "approved"})
    await started.wait()
    await first.close()

    second = runtime_with_operation(Model(answer("opened"), answer("completion")), store=store)
    await (await second.run("open", session_id="s")).result
    await second.idle()
    recovered = (await second.operations.list("s"))[0]
    assert recovered["status"] == "failed"
    assert recovered["errorCode"] == "execution_interrupted"
    assert recovered["deliveryStatus"] == "delivered"
    await second.close()
