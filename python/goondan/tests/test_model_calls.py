"""§모델 입력과 결과, §입력, §시스템 메시지와 매개변수, §도구: the model call and what it is built from."""

from __future__ import annotations

import asyncio
import copy
from pathlib import Path
from typing import Any

import pytest

from goondan import GoondanError, ModelContext, create_goondan, define_tool


def answer(text: str = "done") -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def tool_call(name: str, call_id: str = "call-1", args: Any = None) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": call_id, "name": name, "args": args or {}}]}, "finishReason": "tool"}


class Model:
    """A model implementation in the shape the specification prefers: `generate(input, ctx)`."""

    def __init__(self, *responses: Any, deltas: list[Any] | None = None):
        self.responses = list(responses)
        self.deltas = deltas or []
        self.inputs: list[dict[str, Any]] = []
        self.contexts: list[ModelContext] = []
        self.late: list[Any] = []

    async def generate(self, model_input: dict[str, Any], ctx: ModelContext) -> Any:
        self.inputs.append(copy.deepcopy(model_input))
        self.contexts.append(ctx)
        for delta in self.deltas:
            ctx.on_text_delta(delta)
        response = self.responses.pop(0) if self.responses else answer("exhausted")
        if isinstance(response, BaseException):
            raise response
        return response


class Host:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    def names(self, name: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event["type"] == name]


# --- the model call ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_model_context_carries_the_run_identity_and_a_call_number_that_grows():
    model = Model(tool_call("echo"), answer())
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "tools": ["echo"]}}},
        models={"m": model},
        tools={"echo": define_tool(name="echo", description="echo", input={}, execute=lambda value, ctx: value)},
    )
    try:
        result = await runtime.run("hello", session_id="c1")
        assert [ctx.step for ctx in model.contexts] == [1, 2]
        assert {ctx.agent for ctx in model.contexts} == {"main"}
        assert {ctx.session_id for ctx in model.contexts} == {"c1"}
        assert len({ctx.turn_id for ctx in model.contexts}) == 1
        assert result["status"] == "done"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_model_receives_a_copy_of_the_model_input():
    class Mutating(Model):
        async def generate(self, model_input: dict[str, Any], ctx: ModelContext) -> Any:
            result = await super().generate(model_input, ctx)
            model_input["messages"].append({"id": "x", "role": "user", "source": "model", "content": [{"type": "text", "text": "injected"}]})
            model_input["options"]["maxTokens"] = 1
            return result

    model = Mutating(tool_call("echo"), answer())
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "tools": ["echo"]}}},
        models={"m": model},
        tools={"echo": define_tool(name="echo", description="echo", input={}, execute=lambda value, ctx: value)},
    )
    try:
        await runtime.run("hello", session_id="c1")
        assert all(message["content"][0].get("text") != "injected" for message in model.inputs[1]["messages"])
        assert model.inputs[1]["options"] == {}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_plain_callable_model_still_runs_and_a_model_without_either_form_fails():
    calls: list[dict[str, Any]] = []

    async def callable_model(model_input: dict[str, Any]) -> Any:
        calls.append(model_input)
        return answer("plain")

    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": callable_model})
    try:
        result = await runtime.run("hello", session_id="c1")
        assert result["output"] == "plain" and len(calls) == 1
    finally:
        await runtime.close()

    broken = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": object()})
    try:
        with pytest.raises(GoondanError) as failure:
            await broken.run("hello", session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("model", ["model_error"])
    finally:
        await broken.close()


@pytest.mark.asyncio
async def test_a_model_failure_adds_the_implementation_code_after_model_error():
    class Limited(Exception):
        code = "rate_limited"

    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": Model(Limited("slow down"))})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run("hello", session_id="c1")
        assert (failure.value.where, failure.value.codes, failure.value.message) == ("model", ["model_error", "rate_limited"], "slow down")
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failed_tool_implementation_reports_only_the_tool_error_code():
    """§도구, §이벤트 종류: the second code belongs to a model failure, never to a tool failure."""

    class Limited(Exception):
        code = "rate_limited"

    async def execute(args: Any, ctx: Any) -> Any:
        raise Limited("slow down")

    host = Host()
    config = {"agents": {"main": {"model": "m", "tools": ["t"]}}}
    runtime = create_goondan(
        config=config, models={"m": Model(tool_call("t"))}, host=host, max_retries=0,
        tools={"t": define_tool(name="t", description="t", input={"type": "object"}, execute=execute)},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run("hello", session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("tool", ["tool_error"])
        assert host.names("tool.error")[0]["data"]["codes"] == ["tool_error"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_runtime_fills_a_missing_message_id_and_source_before_it_checks_the_result():
    model = Model({"message": {"role": "assistant", "content": [{"type": "text", "text": "hi"}]}, "finishReason": "stop"})
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model})
    try:
        output = (await runtime.run("hello", session_id="c1"))["outputs"][0]
        assert output["source"] == "model" and isinstance(output["id"], str) and output["id"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_model_run_result_is_filled_and_checked_the_same_way():
    """§모델 결과: `model.run` fills `id` and `source` and then checks the same shape."""
    from goondan import Extension, define_extension

    seen: list[Any] = []
    broken = {"message": {"role": "assistant", "content": [], "id": "x", "source": "model"}, "finishReason": "stop", "usage": {"input": -1}}
    model = Model({"message": {"role": "assistant", "content": [{"type": "text", "text": "aside"}]}, "finishReason": "stop"}, broken, answer())

    async def hook(value: Any, ctx: Any) -> Any:
        try:
            seen.append(await ctx.run_model([{"id": "m1", "role": "user", "source": "hook", "content": []}]))
            await ctx.run_model([{"id": "m2", "role": "user", "source": "hook", "content": []}])
        except GoondanError as failure:
            seen.append(str(failure))
        return None

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"onInput": [{"extension": "ext"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": model},
        extensions={"ext": define_extension(name="ext", create=lambda **_: Extension(hooks={"onInput": hook}), hooks=["onInput"])},
    )
    try:
        await runtime.run("hello", session_id="c1")
        assert seen[0]["message"]["source"] == "model" and isinstance(seen[0]["message"]["id"], str)
        assert "the model result" in seen[1]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_usage_value_that_is_not_a_token_count_makes_the_result_invalid():
    """§모델 결과, §사용량 집계: a reported usage field must be a finite number that is 0 or more."""
    model = Model({"message": {"role": "assistant", "content": [], "id": "x", "source": "model"}, "finishReason": "stop", "usage": {"output": -3}})
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run("hello", session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("onModelResult", ["value_invalid"])
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_tool_call_parts_and_not_the_finish_reason_decide_whether_tools_run():
    """§모델 결과: `tool` without a call ends the run, `stop` with a call still runs it."""
    without = Model({"message": {"role": "assistant", "content": [{"type": "text", "text": "hi"}]}, "finishReason": "tool"})
    tool = define_tool(name="t", description="t", input={"type": "object"}, execute=lambda args, ctx: [{"type": "text", "text": "ran"}])
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "tools": ["t"]}}}, models={"m": without}, tools={"t": tool})
    try:
        result = await runtime.run("hello", session_id="c1")
        assert result["finishReason"] == "tool" and len(without.inputs) == 1
    finally:
        await runtime.close()

    reply = tool_call("t")
    reply["finishReason"] = "stop"
    host = Host()
    with_call = Model(reply, answer("after"))
    again = create_goondan(config={"agents": {"main": {"model": "m", "tools": ["t"]}}}, models={"m": with_call}, tools={"t": tool}, host=host)
    try:
        result = await again.run("hello", session_id="c1")
        assert len(host.names("tool.done")) == 1 and result["finishReason"] == "stop"
    finally:
        await again.close()


@pytest.mark.asyncio
async def test_the_message_meta_is_stored_and_sent_to_the_model_again():
    """§모델 결과: a provider keeps what it needs to resend its own response in `meta`."""
    reply = tool_call("t")
    reply["message"]["meta"] = {"anthropic": {"blocks": [{"type": "thinking"}]}}
    model = Model(reply, answer())
    tool = define_tool(name="t", description="t", input={"type": "object"}, execute=lambda args, ctx: [{"type": "text", "text": "ran"}])
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "tools": ["t"]}}}, models={"m": model}, tools={"t": tool})
    try:
        await runtime.run("hello", session_id="c1")
        resent = [message for message in model.inputs[1]["messages"] if message["role"] == "assistant"]
        assert [message.get("meta") for message in resent] == [{"anthropic": {"blocks": [{"type": "thinking"}]}}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_runtime_hands_the_options_a_hook_set_to_the_model_unchanged():
    """§모델 입력: the runtime starts `options` empty and never reads what a hook put there."""
    from goondan import Extension, define_extension

    seen: list[Any] = []
    filled = {"maxTokens": 10, "toolChoice": {"name": "t"}, "anthropic": {"thinking": {"type": "enabled"}}}

    async def hook(value: Any, ctx: Any) -> Any:
        seen.append(copy.deepcopy(value["options"]))
        return {**value, "options": copy.deepcopy(filled)}

    model = Model(answer())
    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"onModelInput": [{"extension": "ext"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": model},
        extensions={"ext": define_extension(name="ext", create=lambda **_: Extension(hooks={"onModelInput": hook}), hooks=["onModelInput"])},
    )
    try:
        await runtime.run("hello", session_id="c1")
        assert seen == [{}] and model.inputs[0]["options"] == filled
    finally:
        await runtime.close()


# --- text chunks -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_text_chunks_are_reported_in_order_between_step_start_and_step_done():
    host = Host()
    model = Model(answer("ab"), deltas=["a", 7, "b", None])
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, host=host)
    try:
        await runtime.run("hello", session_id="c1")
        names = [event["type"] for event in host.events if event["type"].startswith("step.")]
        assert names == ["step.start", "step.textDelta", "step.textDelta", "step.done"]
        assert [event["data"] for event in host.names("step.textDelta")] == [{"step": 1, "delta": "a"}, {"step": 1, "delta": "b"}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_chunks_delivered_after_the_call_returned_are_not_reported():
    host = Host()
    saved: list[ModelContext] = []

    class Late(Model):
        async def generate(self, model_input: dict[str, Any], ctx: ModelContext) -> Any:
            saved.append(ctx)
            return await super().generate(model_input, ctx)

    model = Late(answer("first"), answer("second"))
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, host=host)
    try:
        await runtime.run("hello", session_id="c1")
        saved[0].on_text_delta("late")
        await asyncio.sleep(0)
        assert host.names("step.textDelta") == []
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_model_run_keeps_the_run_identity_reports_no_step_event_and_counts_usage_on_the_current_run():
    host = Host()
    first = answer("first")
    first["usage"] = {"input": 2}
    second = answer("second")
    second["usage"] = {"output": 3}
    own = answer("own")
    own["usage"] = {"cacheRead": 5}
    model = Model(first, second, own, deltas=["chunk"])
    seen: list[ModelContext] = []

    def hook_model(stage: str):
        async def hook(value: Any, ctx: Any) -> Any:
            await ctx.run_model([{"id": "m1", "role": "user", "source": "hook", "content": [{"type": "text", "text": "ask"}]}])
            seen.append(model.contexts[-1])
            return None
        return hook

    from goondan import Extension, define_extension

    config = {"agents": {"main": {"model": "m", "extensions": {"ext": {}}, "hooks": {"onModelInput": [{"name": "early", "extension": "ext"}], "onOutput": [{"name": "late", "extension": "ext"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": model}, host=host,
        extensions={"ext": define_extension(name="ext", create=lambda **_: Extension(hooks={"onModelInput": hook_model("onModelInput"), "onOutput": hook_model("onOutput")}))},
    )
    try:
        result = await runtime.run("hello", session_id="c1")
        # §모델 호출: model.run uses the last started call number and never increases it.
        assert [ctx.step for ctx in seen] == [0, 1]
        assert {ctx.agent for ctx in seen} == {"main"} and {ctx.session_id for ctx in seen} == {"c1"}
        assert len({ctx.execution_id for ctx in model.contexts}) == 1
        assert len({ctx.instance for ctx in model.contexts}) == 1
        assert [event["data"]["step"] for event in host.names("step.start")] == [1]
        # §텍스트 조각: only the run's own call reports its chunks.
        assert [event["data"]["delta"] for event in host.names("step.textDelta")] == ["chunk"]
        assert result["output"] == "second"
        assert len(result["runs"]) == 1
        assert result["runs"][0]["usage"] == {"input": 2, "output": 3, "cacheRead": 5, "cacheWrite": 0}
        assert result["usage"] == result["runs"][0]["usage"]
    finally:
        await runtime.close()


# --- the model call limit ----------------------------------------------------------------------


@pytest.mark.parametrize("value", [0, -1, "2", True, 1.5])
def test_an_invalid_max_steps_fails_the_runtime_creation(value: Any):
    with pytest.raises(ValueError):
        create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": Model()}, max_steps=value)


@pytest.mark.asyncio
async def test_a_run_that_reached_the_model_call_limit_fails_without_another_call_or_error_stage():
    host = Host()
    errors: list[Any] = []
    model = Model(tool_call("echo", "c-1"), tool_call("echo", "c-2"), answer())
    config = {"agents": {"main": {"model": "m", "tools": ["echo"], "hooks": {"onError": [{"name": "seen", "fn": "seen"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": model}, host=host, max_steps=2,
        tools={"echo": define_tool(name="echo", description="echo", input={}, execute=lambda value, ctx: value)},
        functions={"seen": lambda value: errors.append(value) or value},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run("hello", session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("runtime", ["runtime_error"])
        assert len(model.inputs) == 2 and errors == []
        assert [event["type"] for event in host.events if event["type"] == "step.start"] == ["step.start"] * 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_model_call_limit_counts_retried_calls():
    model = Model(answer("first"), answer("second"), answer("third"))
    config = {"agents": {"main": {"model": "m", "hooks": {"onModelResult": [{"name": "again", "fn": "again"}]}}}}
    runtime = create_goondan(
        config=config, models={"m": model}, max_steps=2, max_retries=5,
        functions={"again": lambda value: {"retry": True, "target": "model"}},
    )
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run("hello", session_id="c1")
        assert failure.value.codes == ["runtime_error"]
        assert len(model.inputs) == 2
    finally:
        await runtime.close()


# --- input -------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_input_fn_result_becomes_json_text_and_the_message_carries_the_declared_name():
    model = Model(answer())
    config = {"agents": {"main": {"model": "m", "input": {"fn": "shape", "fields": {"text": "the text"}}}}}
    runtime = create_goondan(config=config, models={"m": model}, functions={"shape": lambda value: {"seen": value, "ok": True}})
    try:
        await runtime.run({"text": "hi"}, session_id="c1")
        first = model.inputs[0]["messages"][0]
        assert first["role"] == "user" and first["source"] == "main"
        assert first["content"] == [{"type": "text", "text": '{"seen":{"text":"hi"},"ok":true}'}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(("result", "codes"), [(float("nan"), ["value_invalid"]), (None, ["runtime_error"])])
async def test_an_input_fn_that_fails_or_returns_a_non_json_value_fails_the_run_at_input(result: Any, codes: list[str]):
    def shape(value: Any) -> Any:
        if result is None:
            raise RuntimeError("input broke")
        return result

    runtime = create_goondan(config={"agents": {"main": {"model": "m", "input": {"fn": "shape"}}}}, models={"m": Model(answer())}, functions={"shape": shape})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run({"text": "hi"}, session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("onInput", codes)
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_input_template_gets_the_object_keys_or_the_value_as_text(tmp_path: Path):
    keys = tmp_path / "keys.md"
    keys.write_text("{{ name }} says {{ text }}", encoding="utf-8")
    plain = tmp_path / "plain.md"
    plain.write_text("<{{ text }}>", encoding="utf-8")
    model = Model(answer(), answer())
    config = {"agents": {
        "keys": {"model": "m", "input": {"template": str(keys)}},
        "plain": {"model": "m", "input": {"template": str(plain)}},
    }}
    runtime = create_goondan(config=config, models={"m": model})
    try:
        await runtime.run({"name": "kim", "text": "hello"}, session_id="c1", agent="keys")
        await runtime.run(7, session_id="c2", agent="plain")
        assert model.inputs[0]["messages"][0]["content"][0]["text"] == "kim says hello"
        assert model.inputs[1]["messages"][0]["content"][0]["text"] == "<7>"
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failing_input_template_fails_the_run_at_input(tmp_path: Path):
    template = tmp_path / "input.md"
    template.write_text("{{ value.missing }}", encoding="utf-8")
    config = {"agents": {"main": {"model": "m", "input": {"template": str(template)}}}}
    runtime = create_goondan(config=config, models={"m": Model(answer())})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run({"present": "hi"}, session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("onInput", ["runtime_error"])
    finally:
        await runtime.close()


# --- system blocks and tool definitions ----------------------------------------------------------


@pytest.mark.asyncio
async def test_system_blocks_are_numbered_and_only_a_declared_cache_hint_is_kept(tmp_path: Path):
    template = tmp_path / "system.md"
    template.write_text("{{ agent.name }}/{{ model }}/{{ params.lang }}/{{ tools[0].name }}", encoding="utf-8")
    model = Model(answer())
    config = {"agents": {"main": {
        "model": "m", "params": {"lang": "ko"}, "tools": [{"tool": "echo", "hint": "careful"}, {"agent": "worker"}],
        "systemMessage": [{"text": "first", "cache": True}, {"text": "second", "cache": False}, {"template": str(template)}],
    }, "worker": {"model": "m", "description": "helps"}}}
    runtime = create_goondan(
        config=config, models={"m": model},
        tools={"echo": define_tool(name="echo", description="echo", input={"type": "object"}, execute=lambda value, ctx: value)},
    )
    try:
        await runtime.run("hello", session_id="c1")
        assert model.inputs[0]["system"] == [
            {"text": "first", "source": "system:0", "cache": True},
            {"text": "second", "source": "system:1"},
            {"text": "main/m/ko/echo", "source": "system:2"},
        ]
        assert model.inputs[0]["tools"] == [
            {"name": "echo", "description": "echo\ncareful", "input": {"type": "object"}},
            {"name": "worker", "description": "helps", "input": {"type": "object"}},
        ]
        assert model.inputs[0]["options"] == {}
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_an_agent_tool_without_a_description_is_described_by_its_name():
    model = Model(answer())
    config = {"agents": {"main": {"model": "m", "tools": [{"agent": "worker"}]}, "worker": {"model": "m"}}}
    runtime = create_goondan(config=config, models={"m": model})
    try:
        await runtime.run("hello", session_id="c1")
        assert model.inputs[0]["tools"] == [{"name": "worker", "description": "Run worker", "input": {"type": "object"}}]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_the_registered_key_is_the_exposed_name_and_the_execution_target():
    """§도구: a tool implementation that calls itself something else keeps the binding key."""
    seen: list[str] = []

    async def execute(args: Any, ctx: Any) -> Any:
        seen.append(ctx["tool_call"]["name"])
        return [{"type": "text", "text": "ran"}]

    model = Model(tool_call("listed"), answer())
    tool = define_tool(name="its-own-name", description="Describes itself", input={"type": "object"}, execute=execute)
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "tools": ["listed"]}}}, models={"m": model}, tools={"listed": tool})
    try:
        await runtime.run("hello", session_id="c1")
        assert model.inputs[0]["tools"] == [{"name": "listed", "description": "Describes itself", "input": {"type": "object"}}]
        assert seen == ["listed"]
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_call_id_that_an_earlier_turn_answered_is_called_again():
    """§도구: a new response never skips a call whose identifier was already used."""
    seen: list[Any] = []

    async def execute(args: Any, ctx: Any) -> Any:
        seen.append(args)
        return [{"type": "text", "text": "ran"}]

    model = Model(tool_call("t", "same"), answer(), tool_call("t", "same"), answer())
    tool = define_tool(name="t", description="t", input={"type": "object"}, execute=execute)
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "tools": ["t"]}}}, models={"m": model}, tools={"t": tool})
    try:
        await runtime.run("one", session_id="c1")
        await runtime.run("two", session_id="c1")
        assert len(seen) == 2
    finally:
        await runtime.close()


@pytest.mark.asyncio
async def test_a_failing_system_block_template_fails_the_run_at_model_input(tmp_path: Path):
    template = tmp_path / "system.md"
    template.write_text("{{ params.missing.deep }}", encoding="utf-8")
    config = {"agents": {"main": {"model": "m", "systemMessage": {"template": str(template)}}}}
    runtime = create_goondan(config=config, models={"m": Model(answer())})
    try:
        with pytest.raises(GoondanError) as failure:
            await runtime.run("hi", session_id="c1")
        assert (failure.value.where, failure.value.codes) == ("onModelInput", ["runtime_error"])
    finally:
        await runtime.close()
