"""§값 처리 단계와 훅 and the runtime side of §확장과 상속."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from goondan import (
    Extension,
    GoondanAbortError,
    GoondanConfigError,
    GoondanError,
    InMemoryConversationStore,
    create_runtime,
    define_extension,
    define_tool,
)


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def tool_call(name: str, call_id: str = "call-1", args: Any = None) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": call_id, "name": name, "args": args if args is not None else {}}]}, "finishReason": "tool"}


def replies(*outputs: Any):
    remaining = list(outputs)
    seen: list[dict[str, Any]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        seen.append(value)
        return remaining.pop(0) if remaining else answer("exhausted")

    model.seen = seen  # type: ignore[attr-defined]
    return model


class Recorder:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def names(self, name: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event["name"] == name]

    def hooks(self) -> list[tuple[str, str, str]]:
        return [(event["name"], event["data"]["value"], event["data"]["hook"]) for event in self.events if event["name"].startswith("hook.")]


def echo_tool(name: str = "echo", execute: Any = None):
    return define_tool(name=name, description=name, input={"type": "object"}, execute=execute or (lambda value, ctx: value))


def extension(stage: str, hook: Any, **kwargs: Any):
    return define_extension(name="ext", create=lambda **_: Extension(hooks={stage: hook}), **kwargs)


# --- 단계 실행 순서 -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_conversation_stage_runs_once_for_every_model_call_of_one_run():
    seen: list[Any] = []

    def note(value: Any) -> Any:
        seen.append(len(value))
        return "context"

    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {"conversation": [{"name": "note", "fn": "note"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies(tool_call("echo"), tool_call("echo", "call-2"), answer())},
        tools={"echo": echo_tool()},
        functions={"note": note},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert len(seen) == 1
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_model_retry_resumes_at_model_input_without_the_conversation_stage():
    order: list[str] = []
    calls = {"count": 0}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        calls["count"] += 1
        if calls["count"] == 1: raise RuntimeError("boom")
        return answer()

    config = {"agents": {"main": {"model": "m", "hooks": {
        "conversation": [{"name": "c", "fn": "mark_conversation"}],
        "modelInput": [{"name": "i", "fn": "mark_input"}],
        "error": [{"name": "e", "fn": "retry"}],
    }}}}
    runtime = create_runtime(
        config=config, models={"m": model},
        functions={
            "mark_conversation": lambda value: order.append("conversation") or "c",
            "mark_input": lambda value: order.append("modelInput") or "i",
            "retry": lambda value: {"retry": True, "target": "model"},
        },
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert order == ["conversation", "modelInput", "modelInput"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_hook_failure_never_reaches_the_error_stage():
    reached: list[Any] = []
    config = {"agents": {"main": {"model": "m", "hooks": {
        "modelInput": [{"name": "broken", "fn": "broken"}],
        "error": [{"name": "watch", "fn": "watch"}],
    }}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        functions={"broken": lambda value: (_ for _ in ()).throw(RuntimeError("no")), "watch": lambda value: reached.append(value)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert reached == []
        assert failure.value.where == "modelInput"
        assert failure.value.codes == ["hook_error"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_safe_point_adds_steered_input_before_the_finished_asynchronous_work():
    release = asyncio.Event()

    async def late(value: Any, ctx: Any) -> Any:
        await release.wait()
        return ctx.append(ctx.message.user("late"))

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"extension": "ext", "mode": "async"}]}}}}
    model = replies(answer(), answer())
    store = InMemoryConversationStore()
    runtime = create_runtime(config=config, models={"m": model}, extensions={"ext": extension("conversation", late)}, conversation_store=store)
    try:
        await runtime.run_turn("first", conversation_id="c1")
        release.set()
        await runtime.idle()
        runtime.steer("c1", "steered")
        await runtime.run_turn("second", conversation_id="c1")
        texts = [part["text"] for message in model.seen[-1]["messages"] for part in message["content"] if part["type"] == "text"]
        assert texts[-3:] == ["second", "steered", "late"]
    finally:
        await runtime.close()


# --- 단계 값과 대화 저장 --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_invalid_model_result_fails_with_value_invalid_before_the_hooks():
    reached: list[Any] = []
    config = {"agents": {"main": {"model": "m", "hooks": {"modelResult": [{"name": "watch", "fn": "watch"}]}}}}
    runtime = create_runtime(
        config=config,
        models={"m": replies({"message": {"role": "user", "content": []}, "finishReason": "stop"})},
        functions={"watch": lambda value: reached.append(value)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert reached == []
        assert (failure.value.where, failure.value.codes) == ("modelResult", ["value_invalid"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_result_message_carries_keep_and_meta_and_a_new_identity():
    store = InMemoryConversationStore()
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {"toolResult": [{"name": "mark", "fn": "mark"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        functions={"mark": lambda value: {**value, "keep": True, "meta": {"m": 1}, "isError": True}},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        message = next(item for item in await store.load("c1", "main") if item["role"] == "tool")
        assert message["source"] == "tool" and message["keep"] is True and message["meta"] == {"m": 1}
        assert message["content"] == [{"type": "tool.result", "callId": "call-1", "content": [{"type": "json", "value": {}}], "isError": True}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_that_returns_a_result_keeps_its_error_keep_and_meta():
    """§단계 값과 대화 저장: `name` and `args` are the call's, the rest is the tool's claim."""
    store = InMemoryConversationStore()
    seen: list[Any] = []

    def watch(value: Any) -> Any:
        seen.append(value)
        return value

    claimed = {"callId": "other", "name": "other", "args": {"other": True},
               "content": [{"type": "text", "text": "결과"}], "isError": True, "keep": True, "meta": {"fixture": True}}
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {"toolResult": [{"name": "watch", "fn": "watch"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo", args={"q": "군단"}), answer())},
        tools={"echo": echo_tool(execute=lambda value, ctx: claimed)},
        functions={"watch": watch}, conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert seen[0]["callId"] == "call-1" and seen[0]["name"] == "echo" and seen[0]["args"] == {"q": "군단"}
        message = next(item for item in await store.load("c1", "main") if item["role"] == "tool")
        assert message["keep"] is True and message["meta"] == {"fixture": True}
        assert message["content"] == [{"type": "tool.result", "callId": "call-1", "content": [{"type": "text", "text": "결과"}], "isError": True}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_result_that_breaks_the_shape_fails_before_the_tool_result_hooks():
    """§단계 값과 대화 저장: the check of a returned result runs before that stage's hooks."""
    store = InMemoryConversationStore()
    reached: list[Any] = []
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {"toolResult": [{"name": "watch", "fn": "watch"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())},
        tools={"echo": echo_tool(execute=lambda value, ctx: {"content": "문자열"})},
        functions={"watch": lambda value: reached.append(value)}, conversation_store=store,
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert reached == []
        assert (failure.value.where, failure.value.codes) == ("toolResult", ["value_invalid"])
        assert [item["role"] for item in await store.load("c1", "main")] == ["user", "assistant"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_that_returns_a_value_without_content_becomes_one_json_part():
    store = InMemoryConversationStore()
    config = {"agents": {"main": {"model": "m", "tools": ["echo"]}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())},
        tools={"echo": echo_tool(execute=lambda value, ctx: {"answer": 42})}, conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        message = next(item for item in await store.load("c1", "main") if item["role"] == "tool")
        assert message["content"] == [{"type": "tool.result", "callId": "call-1", "content": [{"type": "json", "value": {"answer": 42}}]}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("declared", [{}, {"isError": False, "keep": False, "meta": {}}])
async def test_a_tool_result_message_keeps_only_the_optional_fields_the_result_declared(declared: dict[str, Any]):
    store = InMemoryConversationStore()
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {"toolResult": [{"name": "mark", "fn": "mark"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        functions={"mark": lambda value: {**value, **declared}}, conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        message = next(item for item in await store.load("c1", "main") if item["role"] == "tool")
        assert set(message) == {"id", "role", "source", "content"} | set(declared) - {"isError"}
        assert set(message["content"][0]) == {"type", "callId", "content"} | set(declared) & {"isError"}
        assert all(message[key] == declared[key] for key in declared if key != "isError")
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_model_input_changes_are_not_stored_and_the_output_replaces_the_stored_reply():
    store = InMemoryConversationStore()
    config = {"agents": {"main": {"model": "m", "hooks": {
        "modelInput": [{"name": "note", "fn": "note"}],
        "output": [{"name": "polish", "fn": "polish"}],
    }}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        functions={"note": lambda value: "note", "polish": lambda value: "polished"},
        conversation_store=store,
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        stored = await store.load("c1", "main")
        assert [message["source"] for message in stored] == ["main", "polish"]
        assert stored[-1]["content"] == [{"type": "text", "text": "polished"}]
    finally:
        await runtime.close()


# --- 훅 실행과 결과 ------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(("decided", "ran"), [(True, True), (False, False)])
async def test_a_when_function_selects_the_hook(decided: bool, ran: bool):
    host = Recorder()
    applied: list[Any] = []
    config = {"agents": {"main": {"model": "m", "hooks": {"input": [{"name": "h", "fn": "body", "when": {"fn": "decide"}}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())}, host=host,
        functions={"decide": lambda value: decided, "body": lambda value: applied.append(value) or value},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert bool(applied) is ran
        assert host.hooks() == [("hook.applied" if ran else "hook.skipped", "input", "h")]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_when_function_that_does_not_return_a_boolean_fails_the_hook():
    host = Recorder()
    config = {"agents": {"main": {"model": "m", "hooks": {"input": [{"name": "h", "fn": "body", "when": {"fn": "decide"}}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())}, host=host,
        functions={"decide": lambda value: [], "body": lambda value: value},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("input", ["hook_error"])
        assert [name for name, _, _ in host.hooks()] == ["hook.failed"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_using_takes_one_argument_and_conversation_sees_the_earlier_appends():
    seen: list[Any] = []
    config = {"agents": {"main": {"model": "m", "hooks": {"conversation": [
        {"name": "first", "fn": "add"},
        {"name": "second", "fn": "count", "using": "conversation"},
        {"name": "third", "fn": "count", "using": {"fn": "size"}},
    ]}}}}
    runtime = create_runtime(
        config={**config}, models={"m": replies(answer())},
        functions={
            "add": lambda value: "added",
            "count": lambda value: seen.append(value) or "noted",
            "size": lambda value: len(value),
        },
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert isinstance(seen[0], list) and len(seen[0]) == 2
        assert seen[1] == 3
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_using_input_in_the_input_stage_is_the_turn_input():
    """§훅 실행과 결과: `using: input` sees the value from before the input hooks."""
    seen: list[Any] = []
    config = {"agents": {"main": {"model": "m", "hooks": {"input": [
        {"fn": "shout"},
        {"name": "watch", "fn": "watch", "using": "input"},
    ]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        functions={"shout": lambda value: f"{value}!", "watch": lambda value: seen.append(value) or None},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert seen == ["hello"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_result_that_changes_nothing_still_reports_hook_applied():
    """§훅 실행과 결과 5: the event follows step 4 whatever the result was."""
    host = Recorder()
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())}, host=host,
        extensions={"ext": extension("conversation", lambda value, ctx: None)},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert host.hooks() == [("hook.applied", "conversation", "ext")]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_hook_receives_a_copy_and_a_null_result_keeps_the_current_value():
    def mutate(value: Any) -> Any:
        value["text"] = "changed"
        return None

    config = {"agents": {"main": {"model": "m", "input": "asis", "hooks": {"input": [{"name": "h", "fn": "mutate"}]}}}}
    model = replies(answer())
    runtime = create_runtime(config=config, models={"m": model}, functions={"mutate": mutate})
    try:
        await runtime.run_turn({"text": "kept"}, conversation_id="c1")
        assert model.seen[0]["messages"][0]["content"][0]["text"] == '{"text":"kept"}'
    finally:
        await runtime.close()


# --- 인라인 훅 -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_inline_hook_runs_fn_then_agent_then_template(tmp_path):
    template = tmp_path / "note.md"
    template.write_text("[{{ text }}]", encoding="utf-8")
    config = {"agents": {
        "main": {"model": "main", "hooks": {"modelInput": [{"name": "note", "fn": "prefix", "agent": ["left", "right"], "template": str(template), "role": "system"}]}},
        "left": {"model": "left"},
        "right": {"model": "right"},
    }}
    model = replies(answer())
    runtime = create_runtime(
        config=config, models={"main": model, "left": replies(answer("L")), "right": replies(answer("R"))},
        functions={"prefix": lambda value: "sent"},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        added = model.seen[0]["messages"][-1]
        assert added["role"] == "system" and added["source"] == "note"
        assert added["content"] == [{"type": "text", "text": "[L\nR]"}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_inline_agent_array_waits_for_every_run_before_the_hook_fails():
    """§인라인 훅: the hook waits for all of them, so a failure leaves no run behind."""
    finished: list[str] = []
    release = asyncio.Event()

    async def slow(value: dict[str, Any]) -> dict[str, Any]:
        await release.wait()
        finished.append("late")
        return answer("late")

    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("no")

    config = {"agents": {
        "main": {"model": "m", "hooks": {"conversation": [{"agent": ["fast", "late"], "optional": False}]}},
        "fast": {"model": "broken"},
        "late": {"model": "slow"},
    }}
    runtime = create_runtime(config=config, models={"m": replies(answer()), "broken": broken, "slow": slow})
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await asyncio.sleep(0)
        release.set()
        with pytest.raises(GoondanError) as failure:
            await turn
        assert (failure.value.where, failure.value.codes) == ("conversation", ["hook_error"])
        assert finished == ["late"]
    finally:
        await runtime.close()


def _array_hook_config() -> dict[str, Any]:
    return {"agents": {
        "main": {"model": "m", "hooks": {"conversation": [{"agent": ["alpha", "beta"], "optional": False}]}},
        "alpha": {"model": "ma"},
        "beta": {"model": "mb"},
    }}


@pytest.mark.asyncio
async def test_the_hook_failure_is_the_first_declared_target_not_the_first_to_fail():
    """§인라인 훅: the order in which the targets failed is not a criterion for choosing."""
    released = asyncio.Event()

    async def late(value: dict[str, Any]) -> dict[str, Any]:
        await released.wait()
        raise RuntimeError("alpha broke")

    async def early(value: dict[str, Any]) -> dict[str, Any]:
        released.set()
        raise RuntimeError("beta broke")

    runtime = create_runtime(config=_array_hook_config(), models={"m": replies(answer()), "ma": late, "mb": early})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("conversation", ["hook_error"])
        assert "alpha broke" in failure.value.message and "beta broke" not in failure.value.message
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_earlier_ordinary_failure_beats_a_later_aborted_target():
    """§인라인 훅: the kind of failure is not a criterion either, so `alpha` decides here."""
    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("alpha broke")

    async def stopped(value: dict[str, Any]) -> dict[str, Any]:
        raise GoondanAbortError("beta was stopped")

    runtime = create_runtime(config=_array_hook_config(), models={"m": replies(answer()), "ma": broken, "mb": stopped})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("conversation", ["hook_error"])
        assert "alpha broke" in failure.value.message
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_chosen_abort_is_reported_as_aborted_rather_than_a_hook_failure():
    """§훅 실패: when the chosen target ended aborted, the run reports `aborted`, not `hook_error`."""
    async def stopped(value: dict[str, Any]) -> dict[str, Any]:
        raise GoondanAbortError("alpha was stopped")

    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("beta broke")

    runtime = create_runtime(config=_array_hook_config(), models={"m": replies(answer()), "ma": stopped, "mb": broken})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("runtime", ["aborted"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_output_template_hook_reads_the_assistant_message(tmp_path):
    """§인라인 훅 3: without `fn` and `agent`, an output template's `text` is the message object."""
    (tmp_path / "out.md").write_text("{{ text.role }}:{{ text.content[0].text }}", encoding="utf-8")
    config = {"agents": {"main": {"model": "m", "hooks": {"output": [{"template": "out.md"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer("said"))}, directory=str(tmp_path))
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        assert result["output"]["content"] == [{"type": "text", "text": "assistant:said"}]
        assert result["output"]["source"] == "out.md"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_inline_fn_that_returns_nothing_ends_the_hook_without_a_message(tmp_path):
    template = tmp_path / "note.md"
    template.write_text("never", encoding="utf-8")
    config = {"agents": {"main": {"model": "m", "hooks": {"conversation": [{"name": "note", "fn": "quiet", "template": str(template)}]}}}}
    model = replies(answer())
    runtime = create_runtime(config=config, models={"m": model}, functions={"quiet": lambda value: None})
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert len(model.seen[0]["messages"]) == 1
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_non_string_inline_result_becomes_json_text_and_the_output_becomes_an_assistant_message():
    config = {"agents": {"main": {"model": "m", "hooks": {"output": [{"name": "wrap", "fn": "wrap"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, functions={"wrap": lambda value: {"k": [1, True, None]}})
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        assert result["output"]["role"] == "assistant" and result["output"]["source"] == "wrap"
        assert result["output"]["content"] == [{"type": "text", "text": '{"k":[1,true,null]}'}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_named_extension_hook_uses_the_hook_identifier_as_the_message_source():
    def hook(value: Any, ctx: Any) -> Any:
        return ctx.append(ctx.message.user("from the extension"))

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "ctx", "extension": "ext"}]}}}}
    model = replies(answer())
    runtime = create_runtime(config=config, models={"m": model}, extensions={"ext": extension("conversation", hook)})
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert model.seen[0]["messages"][-1]["source"] == "ctx"
    finally:
        await runtime.close()


# --- 제어 결과 -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_control_shaped_value_in_another_stage_stays_a_plain_value():
    config = {"agents": {"main": {"model": "m", "input": "asis", "hooks": {"input": [{"name": "h", "fn": "control"}]}}}}
    model = replies(answer())
    runtime = create_runtime(config=config, models={"m": model}, functions={"control": lambda value: {"retry": True, "target": "model"}})
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert model.seen[0]["messages"][0]["content"][0]["text"] == '{"retry":true,"target":"model"}'
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("result", [
    {"append": [], "extra": 1},
    {"append": [{"role": "user"}]},
    {"append": [], "retry": True},
    {"approval": {"reason": "no"}},
])
async def test_a_malformed_conversation_control_result_fails_the_hook(result: Any):
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "h", "extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        extensions={"ext": extension("conversation", lambda value, ctx: result)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("conversation", ["hook_error"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("result", [{"retry": True}, {"retry": True, "target": "tool"}, {"retry": True, "target": "model", "afterMs": -1}])
async def test_a_malformed_retry_result_fails_the_model_result_hook(result: Any):
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"modelResult": [{"name": "h", "extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        extensions={"ext": extension("modelResult", lambda value, ctx: result)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("modelResult", ["hook_error"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_call_result_skips_the_tool_the_availability_check_and_the_approval():
    executed: list[Any] = []
    config = {"agents": {"main": {"model": "m", "tools": [{"tool": "echo", "approval": "required"}], "hooks": {"toolCall": [
        {"name": "block", "fn": "block"},
    ]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())},
        tools={"echo": echo_tool(execute=lambda value, ctx: executed.append(value))},
        functions={"block": lambda value: {"result": {"callId": value["id"], "name": "other", "args": {}, "content": [{"type": "text", "text": "blocked"}]}}},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert executed == []
        assert await runtime.list_operations("c1") == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_call_result_replaces_the_call_and_the_last_execution_wins():
    seen: list[Any] = []
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "extensions": {"ext": {}}, "hooks": {"toolCall": [
        {"name": "first", "fn": "first"},
        {"extension": "ext"},
    ]}}}}

    def second(value: Any, ctx: Any) -> Any:
        return {"call": {**value, "args": {"n": 2}}, "execution": {"tag": "second"}}

    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())},
        tools={"echo": echo_tool(execute=lambda value, ctx: seen.append((value, ctx["execution"])))},
        functions={"first": lambda value: {"call": {**value, "args": {"n": 1}}, "execution": {"tag": "first"}}},
        extensions={"ext": extension("toolCall", second)},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert seen == [({"n": 2}, {"tag": "second"})]
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("result", [
    {"approval": {"reason": 1}},
    {"approval": {"reason": "ok", "extra": True}},
    {"call": {"id": "other", "name": "echo", "args": {}}},
    {"result": {"callId": "call-1", "content": []}},
])
async def test_a_malformed_tool_call_control_result_fails_the_hook(result: Any):
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "extensions": {"ext": {}}, "hooks": {"toolCall": [{"name": "h", "extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        extensions={"ext": extension("toolCall", lambda value, ctx: result)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("toolCall", ["hook_error"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_unavailable_tool_reaches_the_error_stage_with_the_call_that_left_the_stage():
    seen: list[Any] = []
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {
        "toolCall": [{"name": "rewrite", "fn": "rewrite"}],
        "error": [{"name": "watch", "fn": "watch"}],
    }}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        functions={"rewrite": lambda value: {**value, "name": "absent"}, "watch": lambda value: seen.append(value)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("tool", ["tool_unavailable"])
        assert [(item["where"], item["codes"], item["toolCall"]["name"]) for item in seen] == [("tool", ["tool_unavailable"], "absent")]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_tool_retry_repeats_the_call_that_left_the_tool_call_stage():
    rewrites: list[int] = []
    attempts = {"count": 0}

    def flaky(value: Any, ctx: Any) -> Any:
        attempts["count"] += 1
        if attempts["count"] == 1: raise RuntimeError("boom")
        return value

    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {
        "toolCall": [{"name": "rewrite", "fn": "rewrite"}],
        "error": [{"name": "again", "fn": "again"}],
    }}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool(execute=flaky)},
        functions={"rewrite": lambda value: rewrites.append(1) or {**value, "args": {"n": len(rewrites)}}, "again": lambda value: {"retry": True, "target": "tool"}},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert rewrites == [1] and attempts["count"] == 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_approval_reasons_keep_the_hook_order_before_the_required_reason():
    config = {"agents": {"main": {"model": "m", "tools": [{"tool": "echo", "approval": "required"}], "hooks": {"toolCall": [
        {"name": "a", "fn": "reason_a"},
        {"name": "b", "fn": "reason_b"},
    ]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        functions={"reason_a": lambda value: {"approval": {"reason": "a"}}, "reason_b": lambda value: {"approval": {"reason": "b"}}},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        operation = (await runtime.list_operations("c1"))[0]
        assert operation["reasons"] == ["a", "b", "Tool echo requires approval"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_appending_the_same_message_twice_is_skipped_but_a_different_json_value_is_not():
    def hook(value: Any, ctx: Any) -> Any:
        return ctx.append(
            ctx.message.user("same", key="k"),
            ctx.message.user("same", key="k"),
            {"id": "x", "role": "user", "source": "ctx", "key": "k", "content": [{"type": "json", "value": 1}]},
            {"id": "y", "role": "user", "source": "ctx", "key": "k", "content": [{"type": "json", "value": True}]},
        )

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "ctx", "extension": "ext"}]}}}}
    model = replies(answer())
    runtime = create_runtime(config=config, models={"m": model}, extensions={"ext": extension("conversation", hook)})
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert len(model.seen[0]["messages"]) == 4
    finally:
        await runtime.close()


# --- 훅 실패 -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_optional_hook_keeps_the_value_it_received_and_a_required_hook_fails_the_run():
    config = {"agents": {"main": {"model": "m", "input": "asis", "hooks": {"input": [
        {"name": "broken", "fn": "broken", "optional": True},
        {"name": "keep", "fn": "keep"},
    ]}}}}
    seen: list[Any] = []
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        functions={"broken": lambda value: (_ for _ in ()).throw(RuntimeError("no")), "keep": lambda value: seen.append(value) or value},
    )
    try:
        await runtime.run_turn("kept", conversation_id="c1")
        assert seen == ["kept"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_extension_hook_that_returns_a_value_that_is_not_json_fails_the_hook():
    host = Recorder()
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())}, host=host,
        extensions={"ext": extension("conversation", lambda value, ctx: object())},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("conversation", ["hook_error"])
        assert [event["data"]["hook"] for event in host.names("hook.failed")] == ["ext"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_timeout_cancels_the_sub_run_the_hook_started():
    """§훅 실패: the sub-runs a hook started are cancelled with the hook body."""
    started = asyncio.Event()
    finished: list[str] = []

    async def slow(value: dict[str, Any]) -> dict[str, Any]:
        started.set()
        await asyncio.sleep(10)
        finished.append("late")
        return answer("late")

    config = {"agents": {
        "main": {"model": "m", "hooks": {"conversation": [{"agent": "helper", "timeout": 5}]}},
        "helper": {"model": "slow"},
    }}
    runtime = create_runtime(config=config, models={"m": replies(answer()), "slow": slow})
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert started.is_set()
        await asyncio.sleep(0.02)
        assert finished == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_timeout_cancels_the_hook_body_and_reports_the_limit():
    host = Recorder()
    resumed: list[str] = []

    async def slow(value: Any) -> Any:
        await asyncio.sleep(10)
        resumed.append("late")
        return value

    config = {"agents": {"main": {"model": "m", "hooks": {"input": [{"name": "slow", "fn": "slow", "timeout": 5}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, functions={"slow": slow}, host=host)
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert failure.value.codes == ["hook_error"]
        assert "5ms" in host.names("hook.failed")[0]["data"]["error"]
        assert resumed == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_model_result_retry_past_the_limit_fails_the_hook():
    async def model(value: dict[str, Any]) -> dict[str, Any]:
        return answer()

    config = {"agents": {"main": {"model": "m", "hooks": {"modelResult": [{"name": "again", "fn": "again"}]}}}}
    runtime = create_runtime(config=config, models={"m": model}, functions={"again": lambda value: {"retry": True, "target": "model"}}, max_retries=1)
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("modelResult", ["hook_error"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_hook_result_that_breaks_the_stage_shape_fails_the_hook():
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"output": [{"name": "h", "extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        extensions={"ext": extension("output", lambda value, ctx: {"role": "assistant"})},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert (failure.value.where, failure.value.codes) == ("output", ["hook_error"])
    finally:
        await runtime.close()


def test_the_retry_limit_must_be_a_whole_number():
    with pytest.raises(ValueError):
        create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": replies(answer())}, max_retries=-1)


# --- 비동기 훅 -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_asynchronous_hook_that_returns_something_else_fails_without_failing_the_turn():
    host = Recorder()

    async def wrong(value: Any, ctx: Any) -> Any:
        return "not an append"

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "late", "extension": "ext", "mode": "async"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, extensions={"ext": extension("conversation", wrong)}, host=host)
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        await runtime.idle()
        assert result["status"] == "done"
        assert [(name, hook) for name, _, hook in host.hooks()] == [("hook.failed", "late")]
        assert host.names("hook.failed")[0]["turnId"] == host.names("turn.start")[0]["turnId"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_asynchronous_hook_is_not_scheduled_again_while_it_is_running():
    starts: list[int] = []
    release = asyncio.Event()

    async def late(value: Any, ctx: Any) -> Any:
        starts.append(1)
        await release.wait()
        return None

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(0)
        return answer()

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "late", "extension": "ext", "mode": "async"}]}}}}
    host = Recorder()
    runtime = create_runtime(config=config, models={"m": model}, extensions={"ext": extension("conversation", late)}, host=host)
    try:
        await runtime.run_turn("first", conversation_id="c1")
        await runtime.run_turn("second", conversation_id="c1")
        assert starts == [1]
        assert host.hooks() == []
        release.set()
        await runtime.idle()
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_result_that_arrives_after_the_turn_is_applied_at_the_next_safe_point():
    """§비동기 훅: work and unapplied results survive the turn that scheduled them."""
    release = asyncio.Event()

    async def late(value: Any, ctx: Any) -> Any:
        await release.wait()
        return ctx.append(ctx.message.user("late"))

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "late", "extension": "ext", "mode": "async"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer(), answer())}, extensions={"ext": extension("conversation", late)})
    try:
        await runtime.run_turn("one", conversation_id="c1")
        assert [item["source"] for item in await runtime.conversation_store.load("c1", "main")] == ["main", "model"]
        release.set()
        await runtime.idle()
        await runtime.run_turn("two", conversation_id="c1")
        stored = [item["source"] for item in await runtime.conversation_store.load("c1", "main")]
        assert stored == ["main", "model", "main", "late", "model"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_result_that_finished_after_close_is_not_applied():
    release = asyncio.Event()

    async def late(value: Any, ctx: Any) -> Any:
        await release.wait()
        return ctx.append(ctx.message.user("late"))

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "late", "extension": "ext", "mode": "async"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer(), answer())}, extensions={"ext": extension("conversation", late)})
    await runtime.run_turn("one", conversation_id="c1")
    await runtime.close()
    release.set()
    await asyncio.sleep(0)
    assert [item["source"] for item in await runtime.conversation_store.load("c1", "main")] == ["main", "model"]


@pytest.mark.asyncio
async def test_an_asynchronous_hook_keeps_what_it_started_out_of_the_runs_and_the_usage():
    done = asyncio.Event()

    async def late(value: Any, ctx: Any) -> Any:
        await ctx.run_agent("helper", "ping")
        done.set()
        return None

    config = {"agents": {
        "main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "late", "extension": "ext", "mode": "async"}]}},
        "helper": {"model": "h"},
    }}
    runtime = create_runtime(
        config=config, models={"m": replies(answer()), "h": replies({**answer("aside"), "usage": {"input": 7}})},
        extensions={"ext": extension("conversation", late)},
    )
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        await done.wait()
        assert [item["agent"] for item in result["runs"]] == ["main"]
        assert result["usage"]["input"] == 0
    finally:
        await runtime.close()


# --- 훅 컨텍스트와 호스트 함수 ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_hook_context_carries_the_run_identity_and_builds_messages(tmp_path):
    template = tmp_path / "note.md"
    template.write_text("{{ value }}", encoding="utf-8")
    seen: dict[str, Any] = {}

    async def hook(value: Any, ctx: Any) -> Any:
        seen.update({
            "agent": ctx.agent, "conversation_id": ctx.conversation_id, "turn_id": ctx.turn_id,
            "input": ctx.input, "conversation": list(ctx.conversation), "retry_count": ctx.retry_count,
            "rendered": await ctx.render(str(template), {"value": "ok"}),
            "model": await ctx.run_model([ctx.message.user("ask")]),
        })
        return None

    config = {"agents": {
        "main": {"model": "m", "input": "asis", "systemMessage": {"text": "S"}, "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "probe", "extension": "ext"}]}},
        "spare": {"model": "m", "input": {"template": str(template)}},
    }}
    model = replies(answer("aside"), answer())
    runtime = create_runtime(config=config, models={"m": model}, extensions={"ext": extension("conversation", hook)}, directory=str(tmp_path))
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert seen["agent"] == "main" and seen["conversation_id"] == "c1" and seen["retry_count"] == 0
        assert seen["input"] == "hello" and len(seen["conversation"]) == 1
        assert seen["rendered"] == "ok"
        assert seen["model"]["message"]["content"] == [{"type": "text", "text": "aside"}]
        assert model.seen[0]["system"] == [{"text": "S", "source": "system:0"}] and model.seen[0]["options"] == {}
        assert len(model.seen[0]["messages"]) == 1
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_message_the_context_builds_carries_the_hook_identifier_and_only_the_named_extras():
    """§훅 컨텍스트와 호스트 함수: `extra` is a mapping or the same names as keyword arguments."""
    made: list[dict[str, Any]] = []

    def hook(value: Any, ctx: Any) -> Any:
        made.append(ctx.message.user("plain"))
        made.append(ctx.message.system("mapped", {"key": "k", "meta": {"a": 1}}))
        made.append(ctx.message.user("named", keep=True))
        return None

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "probe", "extension": "ext"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, extensions={"ext": extension("conversation", hook)})
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert [set(item) for item in made] == [
            {"id", "role", "content", "source"},
            {"id", "role", "content", "source", "key", "meta"},
            {"id", "role", "content", "source", "keep"},
        ]
        assert [item["source"] for item in made] == ["probe", "probe", "probe"]
        assert [item["role"] for item in made] == ["user", "system", "user"]
        assert made[1]["key"] == "k" and made[1]["meta"] == {"a": 1} and made[2]["keep"] is True
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_model_run_rejects_a_value_that_is_not_an_array_of_messages():
    async def hook(value: Any, ctx: Any) -> Any:
        return await ctx.run_model("not messages")

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"name": "probe", "extension": "ext"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, extensions={"ext": extension("conversation", hook)})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert failure.value.codes == ["hook_error"]
    finally:
        await runtime.close()


# --- execution.complete --------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["conversation", "toolCall"])
async def test_only_a_synchronous_tool_result_extension_hook_may_schedule_a_message(stage: str):
    def hook(value: Any, ctx: Any) -> Any:
        ctx.execution.complete({"id": "x", "role": "assistant", "source": "policy", "content": []})
        return None

    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "extensions": {"ext": {}}, "hooks": {stage: [{"extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        extensions={"ext": extension(stage, hook)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert failure.value.codes == ["hook_error"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_scheduled_message_ends_the_run_with_finish_reason_tool_and_keeps_the_later_results():
    store = InMemoryConversationStore()
    scheduled = {"id": "complete", "role": "assistant", "source": "policy", "content": [{"type": "text", "text": "stop here"}]}

    def hook(value: Any, ctx: Any) -> Any:
        if value["callId"] == "call-1":
            ctx.execution.complete(scheduled)
        return value

    model = replies({"message": {"role": "assistant", "content": [
        {"type": "tool.call", "callId": "call-1", "name": "echo", "args": {}},
        {"type": "tool.call", "callId": "call-2", "name": "echo", "args": {}},
    ]}, "finishReason": "tool"})
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "extensions": {"ext": {}}, "hooks": {"toolResult": [{"extension": "ext"}]}}}}
    runtime = create_runtime(config=config, models={"m": model}, tools={"echo": echo_tool()}, extensions={"ext": extension("toolResult", hook)}, conversation_store=store)
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        assert result["finishReason"] == "tool"
        assert result["output"]["content"] == [{"type": "text", "text": "stop here"}]
        stored = await store.load("c1", "main")
        assert [message["role"] for message in stored] == ["user", "assistant", "tool", "tool", "assistant"]
        assert len(model.seen) == 1
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_second_schedule_in_the_same_run_throws():
    def hook(value: Any, ctx: Any) -> Any:
        ctx.execution.complete({"id": "x", "role": "assistant", "source": "policy", "content": []})
        ctx.execution.complete({"id": "y", "role": "assistant", "source": "policy", "content": []})
        return value

    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "extensions": {"ext": {}}, "hooks": {"toolResult": [{"extension": "ext"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        extensions={"ext": extension("toolResult", hook)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert failure.value.codes == ["hook_error"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_schedule_stays_when_the_optional_hook_that_made_it_fails_afterwards():
    """§`execution.complete`: scheduling is settled at the moment of the call."""
    def hook(value: Any, ctx: Any) -> Any:
        ctx.execution.complete({"id": "x", "role": "assistant", "source": "policy", "content": [{"type": "text", "text": "stop here"}]})
        raise RuntimeError("after the schedule")

    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "extensions": {"ext": {}}, "hooks": {"toolResult": [{"extension": "ext", "optional": True}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        extensions={"ext": extension("toolResult", hook)},
    )
    try:
        result = await runtime.run_turn("hello", conversation_id="c1")
        assert result["finishReason"] == "tool"
        assert result["output"]["content"] == [{"type": "text", "text": "stop here"}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_schedule_during_an_approved_operation_has_no_effect():
    """§`execution.complete`: an operation execution accepts a valid call and does nothing."""
    calls: list[str] = []

    def hook(value: Any, ctx: Any) -> Any:
        ctx.execution.complete({"id": "x", "role": "assistant", "source": "policy", "content": []})
        calls.append(value["callId"])
        return value

    config = {"agents": {"main": {
        "model": "m", "tools": [{"tool": "echo", "approval": "required"}], "extensions": {"ext": {}},
        "hooks": {"toolResult": [{"extension": "ext"}]},
    }}}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("echo"), answer())}, tools={"echo": echo_tool()},
        extensions={"ext": extension("toolResult", hook)},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        stored = await runtime.list_operations("c1")
        await runtime.decide_operation("c1", stored[0]["operationId"], {"decision": "approved"})
        await runtime.idle()
        assert calls == ["call-1"]
        operation = (await runtime.list_operations("c1"))[0]
        assert operation["status"] == "completed"
    finally:
        await runtime.close()


# --- 확장 인스턴스 --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_one_instance_per_execution_scope_is_reused_and_disposed_at_close():
    log: list[str] = []

    def create(**_):
        log.append("create")
        return Extension(hooks={"conversation": lambda value, ctx: None}, dispose=lambda: log.append("dispose"))

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"extension": "ext"}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer(), answer(), answer())}, extensions={"ext": define_extension(name="ext", create=create)})
    await runtime.run_turn("one", conversation_id="c1")
    await runtime.run_turn("two", conversation_id="c1")
    await runtime.run_turn("three", conversation_id="c2")
    assert log == ["create", "create"]
    await runtime.close()
    assert log == ["create", "create", "dispose", "dispose"]


@pytest.mark.asyncio
async def test_the_options_validator_replaces_the_options_unless_it_returns_nothing():
    seen: list[Any] = []
    config = {"agents": {
        "kept": {"model": "m", "extensions": {"ext": {"options": {"a": 1}}}},
        "replaced": {"model": "m", "extensions": {"ext": {"options": {"a": 1}}}},
    }}
    runtime = create_runtime(
        config=config, models={"m": replies(answer(), answer())},
        extensions={"ext": define_extension(
            name="ext",
            create=lambda *, options, **_: seen.append(options) or Extension(),
            validate_options=lambda options: {"a": 2} if seen else None,
        )},
    )
    try:
        await runtime.run_turn("one", conversation_id="c1", agent="kept")
        await runtime.run_turn("two", conversation_id="c1", agent="replaced")
        assert seen == [{"a": 1}, {"a": 2}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failed_preparation_disposes_what_it_made_and_the_next_run_starts_over():
    log: list[str] = []

    def good(**_):
        log.append("create good")
        return Extension(dispose=lambda: log.append("dispose good"))

    def broken(**_):
        log.append("create broken")
        raise RuntimeError("cannot start")

    config = {"agents": {"main": {"model": "m", "extensions": {"good": {}, "broken": {}}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer(), answer())},
        extensions={"good": define_extension(name="good", create=good), "broken": define_extension(name="broken", create=broken)},
    )
    try:
        for _ in range(2):
            with pytest.raises(GoondanError) as failure:
                await runtime.run_turn("hello", conversation_id="c1")
            assert (failure.value.where, failure.value.codes) == ("runtime", ["runtime_error"])
        assert log == ["create good", "create broken", "dispose good"] * 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failed_instance_check_disposes_what_it_made_and_keeps_nothing():
    """§확장 인스턴스 2: the step-2 check also cleans up, in creation order."""
    log: list[str] = []
    config = {"agents": {"main": {"model": "m", "extensions": {"first": {}, "second": {}}, "hooks": {"output": [{"extension": "second"}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer(), answer())},
        extensions={
            "first": define_extension(name="first", create=lambda **_: log.append("create first") or Extension(dispose=lambda: log.append("dispose first"))),
            "second": define_extension(name="second", create=lambda **_: log.append("create second") or Extension(dispose=lambda: log.append("dispose second"))),
        },
    )
    try:
        for _ in range(2):
            with pytest.raises(GoondanConfigError):
                await runtime.run_turn("hello", conversation_id="c1")
        assert log == ["create first", "create second", "dispose first", "dispose second"] * 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_agent_tool_does_not_turn_a_failed_preparation_into_a_tool_failure():
    """§확장 인스턴스: a configuration error fails the turn whatever started the run."""
    host = Recorder()
    config = {"agents": {
        "main": {"model": "m", "tools": [{"agent": "helper"}]},
        "helper": {"model": "m", "extensions": {"ext": {}}, "hooks": {"output": [{"extension": "ext"}]}},
    }}
    runtime = create_runtime(
        config=config, models={"m": replies(tool_call("helper"), answer())}, host=host,
        extensions={"ext": define_extension(name="ext", create=lambda **_: Extension(hooks={"input": lambda value, ctx: None}))},
    )
    try:
        with pytest.raises(GoondanConfigError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert [item["code"] for item in failure.value.issues] == ["binding.extension_hook"]
        # §이벤트 순서: the tool.start of the attempt is still paired with one tool.error.
        assert [event["data"]["codes"] for event in host.names("tool.error")] == [["binding.extension_hook"]]
        assert [event["data"]["codes"] for event in host.names("turn.error")] == [["binding.extension_hook"], ["binding.extension_hook"]]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_instance_that_misses_a_hooked_stage_fails_the_turn_even_for_an_optional_hook():
    host = Recorder()
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"modelInput": [{"extension": "ext", "optional": True}]}}}}
    runtime = create_runtime(
        config=config, models={"m": replies(answer())},
        extensions={"ext": define_extension(name="ext", create=lambda **_: Extension(hooks={"output": lambda value, ctx: None}))},
    )
    try:
        with pytest.raises(GoondanConfigError) as failure:
            await runtime.run_turn("hello", conversation_id="c1")
        assert [item["code"] for item in failure.value.issues] == ["binding.extension_hook"]
        assert [event["name"] for event in host.events] == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_extension_receives_a_logger_when_the_host_injected_one():
    seen: list[Any] = []
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}}}}

    class Logger:
        def info(self, message, fields=None): seen.append(message)
        def warn(self, message, fields=None): ...
        def error(self, message, fields=None): ...

    runtime = create_runtime(
        config=config, models={"m": replies(answer())}, logger=Logger(),
        extensions={"ext": define_extension(name="ext", create=lambda *, log, **_: log.info("started") or Extension())},
    )
    try:
        await runtime.run_turn("hello", conversation_id="c1")
        assert seen == ["started"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_closed_runtime_reports_a_runtime_error_for_a_new_turn():
    runtime = create_runtime(config={"agents": {"main": {"model": "m"}}}, models={"m": replies(answer())})
    await runtime.close()
    with pytest.raises(GoondanError) as failure:
        await runtime.run_turn("hello", conversation_id="c1")
    assert (failure.value.where, failure.value.codes) == ("runtime", ["runtime_error"])


@pytest.mark.asyncio
async def test_an_abort_inside_a_hook_is_not_a_hook_failure_even_when_optional():
    host = Recorder()
    started = asyncio.Event()

    async def slow(value: Any, ctx: Any) -> Any:
        started.set()
        await asyncio.sleep(10)
        return None

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"conversation": [{"extension": "ext", "optional": True}]}}}}
    runtime = create_runtime(config=config, models={"m": replies(answer())}, extensions={"ext": extension("conversation", slow)}, host=host)
    try:
        turn = asyncio.create_task(runtime.run_turn("hello", conversation_id="c1"))
        await started.wait()
        assert runtime.abort("c1") is True
        with pytest.raises(GoondanAbortError):
            await turn
        assert host.names("hook.failed") == []
        assert host.names("turn.error")[0]["data"]["codes"] == ["aborted"]
    finally:
        await runtime.close()
