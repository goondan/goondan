import asyncio

import pytest
from goondan import (
    Extension, GoondanError,
    create_goondan, define_extension, define_tool,
)
from goondan.store import _ConversationProjection as InMemoryConversationStore


def answer(text="done"):
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}


def call(name, args=None):
    return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "call-1", "name": name, "args": args or {}}]}, "finishReason": "tool"}


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["tool", "agent"])
async def test_only_configured_tools_can_execute(target):
    executed = []
    def forbidden(*args):
        executed.append(True)
        raise AssertionError("unselected operation executed")
    async def model(value): return call("hidden")
    agents = {"main": {"model": "main", "tools": []}}
    if target == "agent":
        agents["hidden"] = {"model": "hidden"}
    runtime = create_goondan(
        config={"agents": agents},
        models={"main": model, "hidden": forbidden},
        tools={"hidden": define_tool(name="hidden", description="hidden", input={}, execute=forbidden)} if target == "tool" else {},
    )
    try:
        with pytest.raises(GoondanError, match="not available"):
            await (await runtime.run("input", session_id="configured-tools")).result
        assert executed == []
    finally: await runtime.close()


@pytest.mark.asyncio
async def _v2_approval_saves_and_executes_the_hook_transformed_call():
    calls = []; requests = []; completions = []; count = 0
    class Host:
        def request_approval(self, request): requests.append(request)
        def deliver_operation_completion(self, value): completions.append(value)
    async def model(value):
        nonlocal count
        count += 1
        return call("draft", {"target": "raw"}) if count == 1 else answer()
    def normalize(value, ctx): return {**value, "name": "publish", "args": {"target": "normalized"}}
    def approve(value, ctx): return {"approval": {"reason": "confirm"}}
    def execute(value, ctx): calls.append(value); return [{"type": "text", "text": "published"}]
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "tools": ["draft", "publish"], "extensions": {"policy": {}}, "hooks": {"onToolCall": [{"name": "normalize", "fn": "normalize"}, {"extension": "policy"}]}}}},
        models={"m": model}, functions={"normalize": lambda value: normalize(value, None)},
        tools={name: define_tool(name=name, description=name, input={}, execute=execute) for name in ["draft", "publish"]},
        extensions={"policy": define_extension(name="policy", create=lambda **kwargs: Extension(hooks={"onToolCall": approve}))}, host=Host(),
    )
    try:
        await (await runtime.run("input", session_id="approval")).result
        await asyncio.sleep(0)
        operation = (await runtime.operations.list("approval"))[0]
        assert operation["toolCall"]["name"] == "publish"
        assert operation["toolCall"]["args"] == {"target": "normalized"}
        assert requests[0]["toolCall"] == operation["toolCall"]
        assert calls == []
        await runtime.operations.decide("approval", operation["operationId"], {"decision": "approved"})
        await runtime.idle()
        assert calls == [{"target": "normalized"}]
        assert completions[0]["toolCall"] == operation["toolCall"]
    finally: await runtime.close()


@pytest.mark.asyncio
async def test_async_hooks_bind_their_own_implementation():
    called = []
    def implementation(name):
        async def hook(value, ctx):
            called.append(name)
            return ctx.append(ctx.message.user(name))
        return hook
    async def model(value):
        await asyncio.sleep(0)
        return answer()
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "extensions": {"first": {}, "second": {}}, "hooks": {"onStep": [{"extension": "first", "mode": "async"}, {"extension": "second", "mode": "async"}]}}}},
        models={"m": model},
        extensions={name: define_extension(name=name, create=lambda name=name, **kwargs: Extension(hooks={"onStep": implementation(name)})) for name in ["first", "second"]},
    )
    try:
        await (await runtime.run("input", session_id="async-hooks")).result
        assert called == ["first", "second"]
    finally: await runtime.close()


@pytest.mark.asyncio
async def test_async_context_survives_until_next_turn():
    release = asyncio.Event(); captured = []; started = []
    async def hook(value, ctx):
        started.append(True)
        await release.wait()
        return "late context"
    async def model(value):
        captured.append(value)
        return answer()
    store = InMemoryConversationStore()
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "extensions": {"memory": {}}, "hooks": {"onStep": [{"extension": "memory", "mode": "async"}]}}}},
        models={"m": model}, _conversation_projection=store,
        extensions={"memory": define_extension(name="memory", create=lambda **kwargs: Extension(hooks={"onStep": hook}))},
    )
    try:
        await (await runtime.run("first", session_id="onStep")).result
        await asyncio.sleep(0)
        release.set()
        await asyncio.sleep(0)
        await (await runtime.run("second", session_id="onStep")).result
        texts = [p.get("text") for m in captured[-1]["messages"] for p in m["content"]]
        assert "late context" in texts
        assert any(m.get("source") == "memory" for m in await store.load("onStep", "main"))
    finally: await runtime.close()


def test_ambiguous_tool_reference_is_rejected():
    with pytest.raises(GoondanError, match="exactly one"):
        create_goondan(config={"agents": {"main": {"model": "m", "tools": [{"tool": "lookup", "agent": "worker"}]}, "worker": {"model": "m"}}}, models={"m": answer})


@pytest.mark.parametrize("tool, message", [
    ({"tool": "lookup", "unknownField": True}, "unknownField"),
    ({"tool": "publish", "approval": "optional"}, "approval"),
])
def test_tool_entries_follow_the_shared_schema(tool, message):
    with pytest.raises(GoondanError, match=message):
        create_goondan(config={"agents": {"main": {"model": "m", "tools": [tool]}}}, models={"m": answer})


@pytest.mark.asyncio
async def test_model_failure_retries_only_for_the_model_target_without_duplicate_input():
    calls = []
    async def model(value):
        calls.append(sum(message["role"] == "user" for message in value["messages"]))
        if len(calls) == 1: raise RuntimeError("retry model")
        return answer()
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "hooks": {"onError": [{"fn": "retry_model"}]}}}},
        models={"m": model}, functions={"retry_model": lambda value: {"retry": True, "target": "model"}},
    )
    try:
        await (await runtime.run("input", session_id="model-retry")).result
        assert calls == [1, 1]
    finally: await runtime.close()


@pytest.mark.asyncio
async def test_routed_turn_aggregates_usage_and_preserves_terminal_finish_reason():
    async def first(value):
        return {**answer("carry"), "usage": {"input": 1, "output": 2, "cacheRead": 3, "cacheWrite": 4}}
    async def final(value):
        return {**answer("truncated"), "usage": {"input": 5, "output": 6, "cacheRead": 7, "cacheWrite": 8}, "finishReason": "length"}
    runtime = create_goondan(
        config={"agents": {"first": {"model": "first"}, "final": {"model": "final"}}, "routes": ["first", "final"]},
        models={"first": first, "final": final},
    )
    try:
        result = await (await runtime.run("input", session_id="route-metadata")).result
        assert result["finishReason"] == "length"
        assert result["usage"] == {"input": 6, "output": 8, "cacheRead": 10, "cacheWrite": 12}
    finally: await runtime.close()


@pytest.mark.asyncio
async def test_model_result_retry_counts_raw_model_usage():
    generations = 0
    async def model(value):
        nonlocal generations
        generations += 1
        return {**answer(), "usage": {"input": generations, "output": 0, "cacheRead": 0, "cacheWrite": 0}}
    runtime = create_goondan(
        config={"agents": {"main": {"model": "m", "hooks": {"onModelResult": [{"fn": "retry_first"}]}}}},
        models={"m": model}, functions={"retry_first": lambda value: {"retry": True, "target": "model"} if generations == 1 else value},
    )
    try:
        result = await (await runtime.run("input", session_id="retry-usage")).result
        assert result["usage"]["input"] == 3
    finally: await runtime.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("approval", [False, True])
async def test_agent_tool_conversations_follow_the_target_stateful_instance(approval):
    main_generations = 0; worker_user_counts = []
    async def main(value):
        nonlocal main_generations
        main_generations += 1
        return call("worker") if main_generations % 2 else answer()
    async def worker(value):
        worker_user_counts.append(sum(message["role"] == "user" for message in value["messages"]))
        return answer("worker done")
    tool_use = {"agent": "worker", **({"approval": "required"} if approval else {})}

    class Host:
        def deliver_operation_completion(self, value): return None

    runtime = create_goondan(config={"agents": {"main": {"model": "main", "tools": [tool_use]}, "worker": {"model": "worker"}}}, models={"main": main, "worker": worker}, host=Host())
    try:
        for index in range(2):
            await (await runtime.run(f"turn {index}", session_id="parent")).result
            if approval:
                operation = (await runtime.operations.list("parent"))[-1]
                await runtime.operations.decide("parent", operation["operationId"], {"decision": "approved"})
                await runtime.idle()
        assert worker_user_counts == [1, 2]
    finally: await runtime.close()


@pytest.mark.asyncio
async def test_parallel_branch_result_preserves_aggregate_metadata():
    def model(text, amount, reason="stop"):
        async def run(value): return {**answer(text), "usage": {"input": amount, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "finishReason": reason}
        return run
    runtime = create_goondan(
        config={
            "agents": {name: {"model": name} for name in ("split", "left", "right")},
            "routes": [
                {"from": "$input", "to": "split"},
                {"from": "split", "to": "left"},
                {"from": "split", "to": "right"},
                {"from": "left", "to": "$output"},
                {"from": "right", "to": "$output"},
            ],
        },
        models={"split": model("split", 1), "left": model("left", 2), "right": model("right", 3, "length")},
    )
    try:
        result = await (await runtime.run("input", session_id="parallel-branch")).result
        assert result["usage"]["input"] == 6
        assert result["finishReason"] == "other"
    finally: await runtime.close()
