"""§이벤트 순서: the order one agent run reports its events in."""

from __future__ import annotations

from typing import Any

import pytest

from goondan import GoondanExecutionError, create_runtime, define_tool


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def call(name: str, call_id: str = "call-1") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": call_id, "name": name, "args": {}}]}, "finishReason": "tool"}


def replies(*outputs: Any):
    remaining = list(outputs)

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return remaining.pop(0) if remaining else answer("exhausted")

    return model


class Host:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def order(self) -> list[str]:
        found = []
        for event in self.events:
            name = event["name"]
            found.append(f"{name}:{event['data']['hook']}" if name.startswith("hook.") else name)
        return found

    def agents(self) -> list[tuple[str, str]]:
        return [(event["name"], event["agent"]) for event in self.events]


STAGES = ("input", "conversation", "modelInput", "modelResult", "toolCall", "toolResult", "output")


def hooked(tools: list[Any]) -> dict[str, Any]:
    hooks = {stage: [{"name": stage, "fn": stage}] for stage in STAGES}
    return {"agents": {"main": {"model": "m", "tools": tools, "hooks": hooks}}}


def stage_functions() -> dict[str, Any]:
    functions: dict[str, Any] = {stage: (lambda value: value) for stage in STAGES}
    functions["conversation"] = lambda value: "noted"
    functions["modelInput"] = lambda value: "hint"
    functions["output"] = lambda value: "final"
    return functions


async def test_one_run_reports_its_stages_calls_and_turn_events_in_order():
    host = Host()
    runtime = create_runtime(
        config=hooked(["work"]),
        models={"m": replies(call("work"), answer())},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: [{"type": "text", "text": "ok"}])},
        functions=stage_functions(),
        host=host,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert host.order() == [
            "hook.applied:input", "turn.start",
            "hook.applied:conversation",
            "hook.applied:modelInput", "step.start", "step.done", "hook.applied:modelResult",
            "hook.applied:toolCall", "tool.start", "hook.applied:toolResult", "tool.done",
            "hook.applied:modelInput", "step.start", "step.done", "hook.applied:modelResult",
            "hook.applied:output", "turn.done",
        ]
    finally:
        await runtime.close()


async def test_the_events_of_an_agent_tool_run_happen_between_tool_start_and_the_tool_result_stage():
    host = Host()
    config = {
        "agents": {
            "main": {"model": "main", "tools": [{"agent": "worker"}], "hooks": {"toolResult": [{"name": "after", "fn": "keep"}]}},
            "worker": {"model": "worker"},
        },
    }
    runtime = create_runtime(
        config=config,
        models={"main": replies(call("worker"), answer()), "worker": replies(answer("worked"))},
        functions={"keep": lambda value: value},
        host=host,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert host.agents() == [
            ("turn.start", "main"), ("step.start", "main"), ("step.done", "main"),
            ("tool.start", "main"),
            ("turn.start", "worker"), ("step.start", "worker"), ("step.done", "worker"), ("turn.done", "worker"),
            ("hook.applied", "main"), ("tool.done", "main"),
            ("step.start", "main"), ("step.done", "main"), ("turn.done", "main"),
        ]
    finally:
        await runtime.close()


async def test_a_failure_reports_the_error_stage_after_the_step_or_tool_error():
    host = Host()
    attempts = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("no")
        return answer()

    config = {"agents": {"main": {"model": "m", "hooks": {"error": [{"name": "again", "fn": "again"}]}}}}
    runtime = create_runtime(config=config, models={"m": model}, functions={"again": lambda value: {"retry": True, "target": "model"}}, host=host)
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert host.order() == [
            "turn.start", "step.start", "step.error", "hook.applied:again",
            "step.start", "step.done", "turn.done",
        ]
    finally:
        await runtime.close()


async def test_a_run_that_fails_in_the_input_stage_reports_turn_error_without_turn_start():
    host = Host()
    config = {"agents": {"main": {"model": "m", "hooks": {"input": [{"name": "broken", "fn": "broken", "optional": False}]}}}}

    def broken(value: Any) -> Any:
        raise RuntimeError("no input")

    runtime = create_runtime(config=config, models={"m": replies(answer())}, functions={"broken": broken}, host=host)
    try:
        with pytest.raises(GoondanExecutionError):
            await runtime.run_turn("hello", conversation_id="c1")
        assert host.order() == ["hook.failed:broken", "turn.error"]
        assert host.events[-1]["data"] == {"where": "input", "codes": ["hook_error"], "error": "no input"}
    finally:
        await runtime.close()


async def test_a_call_a_hook_answered_reports_the_tool_result_stage_and_no_tool_event():
    host = Host()
    config = {"agents": {"main": {"model": "m", "tools": ["work"], "hooks": {
        "toolCall": [{"name": "answer", "fn": "answer"}],
        "toolResult": [{"name": "after", "fn": "keep"}],
    }}}}
    result = {"callId": "call-1", "name": "work", "args": {}, "content": [{"type": "text", "text": "cached"}]}
    runtime = create_runtime(
        config=config,
        models={"m": replies(call("work"), answer())},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: value)},
        functions={"answer": lambda value: {"result": result}, "keep": lambda value: value},
        host=host,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert [name for name in host.order() if name.startswith("tool.") or name.startswith("hook.")] == [
            "hook.applied:answer", "hook.applied:after",
        ]
    finally:
        await runtime.close()


async def test_a_call_that_created_an_approval_reports_no_tool_event():
    host = Host()
    config = {"agents": {"main": {"model": "m", "tools": [{"tool": "work", "approval": "required"}], "hooks": {
        "toolCall": [{"name": "before", "fn": "keep"}],
        "toolResult": [{"name": "after", "fn": "keep"}],
    }}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(call("work"), answer())},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: value)},
        functions={"keep": lambda value: value},
        host=host,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        # §이벤트 순서 4: the toolCall stage, then humanApproval.created and no tool event.
        # The pending tool result skips the toolResult stage.
        assert [name for name in host.order() if name.startswith("tool.") or name.startswith("hook.") or name.startswith("humanApproval.")] == [
            "hook.applied:before", "humanApproval.created",
        ]
    finally:
        await runtime.close()


async def test_a_call_that_is_not_available_reports_no_tool_event():
    host = Host()
    config = {"agents": {"main": {"model": "m", "tools": ["work"]}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(call("missing"), answer())},
        tools={"work": define_tool(name="work", description="work", input={"type": "object"}, execute=lambda value, ctx: value)},
        host=host,
    )
    try:
        with pytest.raises(GoondanExecutionError) as error:
            await runtime.run_turn("hello", conversation_id="c1")
        assert error.value.codes == ["tool_unavailable"]
        assert host.order() == ["turn.start", "step.start", "step.done", "turn.error"]
    finally:
        await runtime.close()
