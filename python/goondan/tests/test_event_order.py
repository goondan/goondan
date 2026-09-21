from __future__ import annotations

from typing import Any

import pytest

from goondan import GoondanExecutionError, create_goondan, define_tool


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def call(name: str) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "c1", "name": name, "args": {}}]}, "finishReason": "tool"}


class Host:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def types(self) -> list[str]:
        return [event["type"] for event in self.events]


@pytest.mark.asyncio
async def test_journal_and_observational_events_share_one_ordered_channel():
    host = Host()
    outputs = [call("work"), answer()]

    async def model(value: Any) -> dict[str, Any]:
        return outputs.pop(0)

    runtime = create_goondan(
        {"agents": {"main": {"model": "m", "tools": ["work"]}}},
        models={"m": model},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: "ok")},
        host=host,
    )
    await runtime.run("hello", session_id="s")
    assert host.types() == [
        "turn.start", "input.received", "agent.start", "conversation.message.appended",
        "step.start", "step.done", "conversation.message.appended", "tool.start",
        "conversation.message.appended", "tool.done", "step.start", "step.done",
        "conversation.message.appended", "agent.done", "turn.done",
    ]
    journal = [event for event in host.events if "seq" in event]
    observational = [event for event in host.events if event.get("observational") is True]
    assert [event["seq"] for event in journal] == list(range(1, len(journal) + 1))
    assert {event["type"] for event in observational} == {"step.start", "step.done", "tool.start", "tool.done"}
    await runtime.close()


@pytest.mark.asyncio
async def test_failed_execution_closes_agent_before_turn():
    host = Host()

    async def broken(value: Any) -> dict[str, Any]:
        raise RuntimeError("model failed")

    runtime = create_goondan({"agents": {"main": {"model": "m"}}}, models={"m": broken}, host=host)
    with pytest.raises(GoondanExecutionError):
        await runtime.run("hello", session_id="s")
    assert host.types()[-3:] == ["step.error", "agent.error", "turn.error"]
    agent_error, turn_error = host.events[-2:]
    assert agent_error["data"]["status"] == "failed"
    assert turn_error["data"]["status"] == "failed"
    await runtime.close()


@pytest.mark.asyncio
async def test_approval_creation_is_journaled_without_tool_execution_events():
    host = Host()
    outputs = [call("work"), answer("pending")]

    async def model(value: Any) -> dict[str, Any]:
        return outputs.pop(0)

    runtime = create_goondan(
        {"agents": {"main": {"model": "m", "tools": [{"tool": "work", "approval": "required"}]}}},
        models={"m": model},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: value)},
        host=host,
    )
    await runtime.run("hello", session_id="s")
    assert "operation.created" in host.types()
    assert not {"tool.start", "tool.done", "tool.error"} & set(host.types())
    await runtime.close()
