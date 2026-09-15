import pytest
from goondan import create_runtime, define_extension, define_tool, Extension, InMemoryConversationStore


def test_inherit_override_remove_and_defaults():
    runtime = create_runtime(config={"agents": {
        "base": {"model": "m", "params": {"a": 1, "b": 2}, "tools": ["read", "write"], "extensions": {"memory": {}, "audit": {}}, "hooks": {"modelInput": [{"extension": "memory"}, {"name": "note", "fn": "note"}, {"extension": "audit"}]}},
        "child": {"inherit": "base", "params": {"b": 3}, "extensions": {"audit": {"enabled": False}}, "remove": {"tools": ["write"], "extensions": ["memory"], "hooks": {"modelInput": ["note"]}}},
    }}, models={"m": lambda value: None}, functions={"note": lambda value: value}, extensions={name: define_extension(name=name, create=lambda **kwargs: Extension(hooks={"modelInput": lambda value, ctx: value})) for name in ("memory", "audit")}, tools={name: define_tool(name=name, description=name, input={}, execute=lambda value, ctx: None) for name in ("read", "write")})
    assert runtime.config["agents"]["child"]["tools"] == ["read"]
    assert runtime.config["agents"]["child"]["params"] == {"a": 1, "b": 3}
    assert runtime.config["agents"]["child"]["hooks"]["modelInput"] == []
    assert runtime.config["agents"]["base"]["tools"] == ["read", "write"]
    assert runtime.config["flow"] == {"in": "base"}


@pytest.mark.asyncio
async def test_input_object_defaults_to_asis_and_prefers_fn(tmp_path):
    seen = []
    async def model(value):
        seen.append(value["messages"][0]["content"][0]["text"])
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}, "finishReason": "stop"}
    fields_runtime = create_runtime(config={"agents": {"main": {"model": "m", "input": {"fields": {"name": "the name to greet"}}}}}, models={"m": model})
    await fields_runtime.run_turn({"name": "Ada"}, conversation_id="fields")
    unused = tmp_path / "unused.md"
    unused.write_text("template", encoding="utf-8")
    fn_runtime = create_runtime(config={"agents": {"main": {"model": "m", "input": {"fn": "format", "template": str(unused)}}}}, models={"m": model}, functions={"format": lambda value: f"fn:{value['name']}"})
    await fn_runtime.run_turn({"name": "Ada"}, conversation_id="fn")
    assert seen == ['{"name":"Ada"}', "fn:Ada"]


@pytest.mark.asyncio
async def test_serial_flow_defaults():
    async def analyst(value): return {"message": {"role": "assistant", "content": [{"type": "text", "text": "analysis"}]}, "finishReason": "stop"}
    async def editor(value):
        assert value["messages"][0]["content"][0]["text"] == "analysis"
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": "edited"}]}, "finishReason": "stop"}
    runtime = create_runtime(config={"agents": {"a": {"model": "a"}, "e": {"inherit": "a", "model": "e"}}, "flow": ["a", "e"]}, models={"a": analyst, "e": editor})
    assert (await runtime.run_turn("input"))["output"]["content"][0]["text"] == "edited"


@pytest.mark.asyncio
async def test_completion_saves_entire_batch_after_32_steps():
    calls = 0; generations = 0
    async def model(value):
        nonlocal generations
        generations += 1
        assert generations <= 34
        return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": f"{generations}:{i}", "name": "work", "args": None} for i in range(2)]}, "finishReason": "tool"}
    def execute(value, ctx):
        nonlocal calls
        calls += 1
        return [{"type": "text", "text": "done"}]
    def complete(value, ctx):
        if calls == 67: ctx.execution.complete({"id": "complete", "role": "assistant", "source": "policy", "content": [{"type": "text", "text": "complete"}]})
        return value
    store = InMemoryConversationStore()
    runtime = create_runtime(config={"agents": {"main": {"model": "m", "tools": ["work"], "extensions": {"policy": {}}, "hooks": {"toolResult": [{"extension": "policy"}]}}}}, models={"m": model}, tools={"work": define_tool(name="work", description="work", input={}, execute=execute)}, extensions={"policy": define_extension(name="policy", create=lambda **kwargs: Extension(hooks={"toolResult": complete}))}, conversation_store=store)
    result = await runtime.run_turn("input", conversation_id="long")
    assert generations == 34 and calls == 68
    assert result["output"]["content"][0]["text"] == "complete"
    assert len([p for m in await store.load("long", "main") for p in m["content"] if p["type"] == "tool.result"]) == 68


def test_flow_fragment_template_uses_its_own_directory(tmp_path):
    from goondan import load_config
    fragment = tmp_path / "routing"
    fragment.mkdir()
    (fragment / "carry.md").write_text("{{ output }}")
    (fragment / "flow.yaml").write_text("flow:\n  in: a\n  routes:\n    - from: a\n      to: b\n      carry: {message: {template: carry.md}}\n    - {from: b, to: out}\n")
    (tmp_path / "goondan.yaml").write_text("resources: [routing/flow.yaml]\nagents: {a: {model: m}, b: {model: m}}\n")
    config = load_config(tmp_path)
    assert config["flow"]["routes"][0]["carry"]["message"]["template"] == str(fragment / "carry.md")


def test_extension_settings_validate_fields_and_preserve_custom_options():
    from goondan import GoondanError, validate_config
    def config(use):
        return {"version": 1, "agents": {"main": {"model": "m", "extensions": {"memory": use}}}}
    for use in [{"unknownField": True}, {"enabled": "false"}, {"options": []}]:
        with pytest.raises(GoondanError):
            validate_config(config(use))
    use = {"enabled": True, "options": {"custom": {"nested": [1, True, None]}}}
    value = config(use)
    validate_config(value)
    assert value["agents"]["main"]["extensions"]["memory"] == use
