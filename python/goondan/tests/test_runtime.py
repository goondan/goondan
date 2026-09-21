from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from goondan import (
    Extension,
    GoondanConfig,
    GoondanConfigError,
    GoondanError,
    GoondanExecutionError,
    create_goondan,
    define_extension,
    define_tool,
    load_config,
)
from goondan.store import _ConversationProjection as InMemoryConversationStore
from goondan.store import _OperationProjection as InMemoryOperationStore
from goondan._json import json_pretty_text, json_text
from goondan._values import output_text


def test_load_config_merges_resources_in_order_and_preserves_declaring_paths(tmp_path: Path):
    fragments = tmp_path / "fragments"
    nested = fragments / "nested"
    (nested / "templates").mkdir(parents=True)
    (nested / "templates" / "system.md").write_text("system", encoding="utf-8")
    (nested / "goondan.yaml").write_text(
        """version: 1
name: base
agents:
  worker:
    model: first
    systemMessage: {template: templates/system.md}
""",
        encoding="utf-8",
    )
    (fragments / "override.yaml").write_text(
        """agents:
  worker:
    model: second
    tools: [lookup]
""",
        encoding="utf-8",
    )
    (tmp_path / "goondan.yaml").write_text(
        """resources:
  - fragments/nested
  - fragments/override.yaml
name: final
agents:
  worker:
    tools: [write]
""",
        encoding="utf-8",
    )

    config = load_config(tmp_path)

    assert isinstance(config, GoondanConfig)
    assert config["name"] == "final"
    assert config["agents"]["worker"]["model"] == "second"
    assert config["agents"]["worker"]["tools"] == ["write"]
    assert config["agents"]["worker"]["systemMessage"]["template"] == str(
        (nested / "templates" / "system.md").resolve()
    )


@pytest.mark.parametrize(
    ("files", "code", "path"),
    [
        ({"goondan.yaml": "resources: [missing.yaml]\n"}, "load.not_found", "/resources/0"),
        (
            {
                "goondan.yaml": "resources: [shared.yaml, shared.yaml]\n",
                "shared.yaml": "agents: {main: {model: m}}\n",
            },
            "load.duplicate_resource",
            "/resources/1",
        ),
        (
            {
                "goondan.yaml": "resources: [child.yaml]\n",
                "child.yaml": "resources: [goondan.yaml]\n",
            },
            "load.resource_cycle",
            "/resources/0",
        ),
        ({"goondan.yaml": "resources: 'one.yaml'\n"}, "schema.type", "/resources"),
    ],
)
def test_load_config_rejects_invalid_resource_graph(tmp_path: Path, files: dict[str, str], code: str, path: str):
    for relative_path, content in files.items():
        (tmp_path / relative_path).write_text(content, encoding="utf-8")

    with pytest.raises(GoondanConfigError) as error:
        load_config(tmp_path)
    assert [(item["code"], item["path"]) for item in error.value.issues] == [(code, path)]


def test_runtime_rejects_duplicate_agents_in_serial_routes():
    config = {
        "version": 1,
        "name": "duplicate-route",
        "agents": {"worker": {"model": "scripted"}},
        "routes": ["worker", "worker"],
    }

    with pytest.raises(GoondanConfigError) as error:
        create_goondan(config=config, models={"scripted": lambda value: value})
    assert [(item["code"], item["path"]) for item in error.value.issues] == [("schema.uniqueItems", "/routes/1")]


def test_portable_json_filter():
    value = {"한글": [1.0, 0.000001, 1e-7, True, None]}
    assert json_text(value) == '{"한글":[1,0.000001,1e-7,true,null]}'
    assert json_pretty_text({"a": [1, 2]}) == '{\n  "a": [\n    1,\n    2\n  ]\n}'


@pytest.mark.parametrize(("value", "text"), [
    (1e16, "10000000000000000"),
    (1.5e16, "15000000000000000"),
    (-1.5e16, "-15000000000000000"),
    (1e20, "100000000000000000000"),
    (123456789012345680000.0, "123456789012345680000"),
    (1e21, "1e+21"),
    (1e-6, "0.000001"),
    (1e-7, "1e-7"),
    (1.5e-7, "1.5e-7"),
    (5e-324, "5e-324"),
    (-0.0, "0"),
    (100.0, "100"),
    (0.1, "0.1"),
])
def test_a_number_written_with_an_exponent_keeps_every_digit(value: float, text: str):
    """§JSON 텍스트: trailing zeros go only from a fractional tail, so `1e16` is not `1`."""
    assert json_text(value) == text
    assert json_text([value]) == f"[{text}]"
    assert json_pretty_text({"n": value}) == '{\n  "n": ' + text + "\n}"


def test_the_package_serializes_json_text_in_one_place():
    """The adapters must not drift from the runtime about the text a model receives."""
    from goondan.models._values import json_text as adapter_json_text

    assert adapter_json_text is json_text


def test_output_text_uses_only_text_parts():
    """§출력 텍스트: `json` 부분은 출력 텍스트에 포함하지 않는다."""
    message = {"content": [{"type": "text", "text": "n="}, {"type": "json", "value": {"n": 1e16}}]}
    assert output_text(message) == "n="


@pytest.mark.asyncio
async def test_a_turn_input_reaches_the_model_with_every_digit():
    """§JSON 텍스트: the user message of a whole float is the number, not a truncated one."""
    store = InMemoryConversationStore()
    runtime = create_goondan(
        config={"agents": {"main": {"model": "scripted"}}},
        models={"scripted": ScriptedModel([[{"type": "text", "text": "ok"}]])}, _conversation_projection=store,
    )
    try:
        await runtime.run({"n": 1e16, "half": 1.5e16}, session_id="c1")
        first = (await store.load("c1", "main"))[0]
        assert first["content"] == [{"type": "text", "text": '{"n":10000000000000000,"half":15000000000000000}'}]
    finally:
        await runtime.close()


class ScriptedModel:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.inputs = []

    async def __call__(self, value):
        self.inputs.append(value)
        output = self.outputs.pop(0)
        return {
            "message": {"role": "assistant", "content": output, "source": "model"},
            "finishReason": "tool" if any(part["type"] == "tool.call" for part in output) else "stop",
            "usage": {"input": 1, "output": 1, "cacheRead": 0, "cacheWrite": 0},
        }


def write_config(tmp_path: Path) -> Path:
    (tmp_path / "templates").mkdir()
    (tmp_path / "templates" / "system.md").write_text("Agent {{ agent.name }} / {{ params.lang }}\n", encoding="utf-8")
    (tmp_path / "templates" / "note.md").write_text("NOTE={{ inputText }}\n", encoding="utf-8")
    (tmp_path / "goondan.yaml").write_text(
        """version: 1
name: test
agents:
  worker:
    model: scripted
    params: {lang: ko}
    input: asis
    systemMessage: {template: templates/system.md, cache: true}
    extensions:
      marks: {}
    tools:
      - {tool: echo, hint: returns input}
    hooks:
      onInput: [{name: normalize, fn: normalize}]
      onStep: [{extension: marks}]
      onModelInput: [{name: note, template: templates/note.md}]
      onToolResult: [{name: decorate, fn: decorate}]
      onOutput: [{name: polish, fn: polish}]
""",
        encoding="utf-8",
    )
    return tmp_path


@pytest.mark.asyncio
async def test_native_turn_hooks_tool_storage_and_templates(tmp_path: Path):
    root = write_config(tmp_path)
    model = ScriptedModel([
        [{"type": "tool.call", "callId": "c1", "name": "echo", "args": {"text": "hi"}}],
        [{"type": "text", "text": "done"}],
    ])
    store = InMemoryConversationStore()

    def create_marks(**_):
        async def conversation(value, ctx):
            return ctx.append(ctx.message.user("mark", key="one", keep=True))
        return Extension(hooks={"onStep": conversation})

    def normalize(messages):
        messages[0]["content"][0]["value"]["normalized"] = True
        return messages

    runtime = create_goondan(
        config=load_config(root),
        models={"scripted": model},
        tools={"echo": define_tool(name="echo", description="echo", input={"type": "object"}, execute=lambda value, ctx: value)},
        functions={
            "normalize": normalize,
            "delayed": lambda value: "later",
            "decorate": lambda value: {**value, "meta": {"decorated": True}},
            "polish": lambda value: {**value, "content": [{"type": "text", "text": "POLISHED=" + "".join(p.get("text", "") for p in value["content"])}]},
        },
        extensions={"marks": define_extension(name="marks", hooks=["onStep"], create=create_marks)},
        _conversation_projection=store,
    )
    result = await runtime.run({"text": "hello"}, session_id="conv")
    assert result["output"] == "POLISHED=done"
    assert model.inputs[0]["system"][0]["text"] == "Agent worker / ko\n"
    assert model.inputs[0]["messages"][-1]["content"][0]["text"] == 'NOTE={"text":"hello","normalized":true}\n'
    stored = await store.load("conv", "worker")
    assert any(message["role"] == "tool" for message in stored)
    assert sum(message.get("key") == "one" for message in stored) == 1
    await runtime.close()


@pytest.mark.asyncio
async def _v2_async_approval_continues_then_delivers_completion_after_restart_once(tmp_path: Path):
    config = {
        "version": 1, "name": "approval",
        "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}, "lookup"]}},
    }
    model = ScriptedModel([
        [
            {"type": "tool.call", "callId": "write-1", "name": "write", "args": {"text": "once"}},
            {"type": "tool.call", "callId": "lookup-1", "name": "lookup", "args": {"key": "safe"}},
        ],
        [{"type": "text", "text": "continued while pending"}],
        [{"type": "text", "text": "completion received"}],
    ])
    conversations = InMemoryConversationStore()
    approvals = InMemoryOperationStore()
    executions = []
    lookups = []
    tool = define_tool(name="write", description="write", input={}, execute=lambda value, _: executions.append(value) or value)
    lookup = define_tool(name="lookup", description="lookup", input={}, execute=lambda value, _: lookups.append(value) or value)

    first_runtime = create_goondan(config=config, models={"scripted": model}, tools={"write": tool, "lookup": lookup}, _conversation_projection=conversations, _operation_projection=approvals)
    initial = await first_runtime.run("start", session_id="restart")
    assert initial["status"] == "done"
    assert initial["output"] == "continued while pending"
    assert executions == []
    assert lookups == [{"key": "safe"}]
    pending = await first_runtime.operations.list("restart")
    assert [item["status"] for item in pending] == ["pending"]
    operation_id = pending[0]["operationId"]
    assert pending[0]["deliveryId"] == f"operation:{operation_id}:completion"
    assert set(pending[0]) == {
        "operationId", "deliveryId", "agent", "sessionId", "turnId", "instance",
        "parentInstance", "parentTurnId", "rootTurnId", "onToolCall", "reasons", "status",
        "deliveryStatus", "createdAt", "updatedAt",
    }
    stored = await conversations.load("restart", "worker")
    write_results = [part for message in stored for part in message["content"] if part.get("type") == "tool.result" and part["callId"] == "write-1"]
    assert write_results == [{"type": "tool.result", "callId": "write-1", "content": [{"type": "json", "value": {"status": "pending", "operationId": operation_id}}]}]
    await first_runtime.close()

    restarted_runtime = create_goondan(config=config, models={"scripted": model}, tools={"write": tool, "lookup": lookup}, _conversation_projection=conversations, _operation_projection=approvals)
    # §결정과 취소: the decision returns right after it is recorded, before the execution.
    approved = await restarted_runtime.operations.decide("restart", operation_id, {"decision": "approved"})
    assert approved["status"] == "approved"
    await restarted_runtime.idle()
    repeated = await restarted_runtime.operations.decide("restart", operation_id, {"decision": "approved"})
    await restarted_runtime.recover_operations("restart")
    await restarted_runtime.idle()
    assert repeated["status"] == "completed"
    assert executions == [{"text": "once"}]
    assert [item["status"] for item in await restarted_runtime.operations.list("restart")] == ["completed"]
    completion = __import__("json").loads(model.inputs[-1]["messages"][-1]["content"][0]["text"])
    assert completion == {
        "type": "operation_completion", "deliveryId": f"operation:{operation_id}:completion",
        "operationId": operation_id, "sessionId": "restart", "agent": "worker",
        "turnId": pending[0]["turnId"], "instance": pending[0]["instance"],
        "parentInstance": pending[0]["parentInstance"], "parentTurnId": pending[0]["parentTurnId"],
        "rootTurnId": pending[0]["rootTurnId"], "status": "completed",
        "onToolCall": {"id": "write-1", "name": "write", "args": {"text": "once"}},
        "result": {"callId": "write-1", "name": "write", "args": {"text": "once"}, "content": [{"type": "json", "value": {"text": "once"}}]},
    }
    stored = await conversations.load("restart", "worker")
    assert sum(operation_id in part.get("text", "") for message in stored for part in message["content"] if part.get("type") == "text") == 1
    assert sum(part.get("type") == "tool.result" and part.get("callId") == "write-1" for message in stored for part in message["content"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(("action", "expected"), [("decide", "rejected"), ("cancel", "cancelled")])
async def test_terminal_approval_without_execution_is_delivered(tmp_path: Path, action: str, expected: str):
    config = {"version": 1, "name": "approval", "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}}
    model = ScriptedModel([[{"type": "tool.call", "callId": "write-1", "name": "write", "args": {"text": "blocked"}}], [{"type": "text", "text": "pending acknowledged"}], [{"type": "text", "text": "terminal acknowledged"}]])
    executions = []
    runtime = create_goondan(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, _: executions.append(value))})
    await runtime.run("start", session_id=expected)
    operation = (await runtime.operations.list(expected))[0]
    if action == "decide":
        terminal = await runtime.operations.decide(expected, operation["operationId"], {"decision": "rejected"})
    else:
        terminal = await runtime.operations.decide(expected, operation["operationId"], {"decision": "cancelled"})
    await runtime.idle()
    assert terminal["status"] == expected
    assert executions == []
    assert f'"status":"{expected}"' in model.inputs[-1]["messages"][-1]["content"][0]["text"]
    delivered = (await runtime.operations.list(expected))[0]
    assert delivered["deliveryStatus"] == "delivered" and isinstance(delivered["deliveredAt"], int)
    # §완료 전달: a rejected or cancelled completion carries no result, error or errorCode.
    assert not {"result", "error", "errorCode"} & set(delivered)


@pytest.mark.asyncio
async def test_completion_waits_for_active_turn_safe_boundary(tmp_path: Path):
    config = {"version": 1, "name": "approval", "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}}
    second_started = asyncio.Event()
    release_second = asyncio.Event()
    inputs = []

    async def model(value):
        inputs.append(value)
        if len(inputs) == 1:
            content = [{"type": "tool.call", "callId": "write-1", "name": "write", "args": {"text": "once"}}]
            return {"message": {"role": "assistant", "source": "model", "content": content}, "finishReason": "tool"}
        if len(inputs) == 2:
            second_started.set()
            await release_second.wait()
            text = "active turn done"
        else:
            text = "completion done"
        return {"message": {"role": "assistant", "source": "model", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}

    executions = []
    runtime = create_goondan(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, _: executions.append(value) or value)})
    active = asyncio.create_task(runtime.run("start", session_id="active"))
    await second_started.wait()
    operation = (await runtime.operations.list("active"))[0]
    approved = await runtime.operations.decide("active", operation["operationId"], {"decision": "approved"})
    assert approved["status"] == "approved"
    # §승인된 작업의 실행: the execution is not a turn, so it does not wait for the active one.
    while not executions:
        await asyncio.sleep(0)
    assert executions == [{"text": "once"}]
    assert len(inputs) == 2
    release_second.set()
    await active
    await runtime.idle()
    assert len(inputs) == 3
    assert operation["operationId"] in inputs[-1]["messages"][-1]["content"][0]["text"]


@pytest.mark.asyncio
async def test_approved_operation_failure_is_delivered(tmp_path: Path):
    config = {"version": 1, "name": "approval", "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}}
    model = ScriptedModel([[{"type": "tool.call", "callId": "write-1", "name": "write", "args": {}}], [{"type": "text", "text": "pending"}], [{"type": "text", "text": "failed received"}]])

    def fail(value, context):
        raise RuntimeError("write failed")

    runtime = create_goondan(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=fail)})
    await runtime.run("start", session_id="failed")
    operation = (await runtime.operations.list("failed"))[0]
    await runtime.operations.decide("failed", operation["operationId"], {"decision": "approved"})
    await runtime.idle()
    failed = (await runtime.operations.list("failed"))[0]
    assert failed["status"] == "failed" and failed["errorCode"] == "execution_failed"
    assert '"error":"write failed","errorCode":"execution_failed"' in model.inputs[-1]["messages"][-1]["content"][0]["text"]


@pytest.mark.asyncio
async def _v2_recovery_reregisters_approval_and_validated_patch_preserves_original_call(tmp_path: Path):
    config = {"version": 1, "name": "approval", "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}}
    model = ScriptedModel([[{"type": "tool.call", "callId": "write-1", "name": "write", "args": {"value": 1, "keep": True}}], [{"type": "text", "text": "pending"}]])
    operations = InMemoryOperationStore()
    requests = []
    executed = []

    class RequestHost:
        def request_approval(self, request):
            requests.append(request)

    first = create_goondan(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, context: value)}, _operation_projection=operations, host=RequestHost())
    await first.run("start", session_id="patch")
    pending = (await first.operations.list("patch"))[0]
    restarted = create_goondan(
        config=config,
        models={"scripted": model},
        tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, context: executed.append((value, context["tool_call"])) or value)},
        _operation_projection=operations,
        host=type("Host", (), {"request_approval": lambda self, request: requests.append(request), "validate_operation_input_patch": lambda self, operation, patch: patch == {"value": 2}})(),
    )
    await restarted.recover_operations("patch")
    assert [request["operationId"] for request in requests] == [pending["operationId"], pending["operationId"]]
    for value in ({"decision": "approved", "inputPatch": {"value": 3}}, {"decision": "rejected", "inputPatch": {"value": 2}}, {"decision": "maybe"}):
        with pytest.raises(GoondanError) as rejected:
            await restarted.operations.decide("patch", pending["operationId"], value)
        assert (rejected.value.where, rejected.value.codes) == ("runtime", ["operation_invalid"])
    with pytest.raises(GoondanError) as missing:
        await restarted.operations.decide("patch", "operation_absent", {"decision": "approved"})
    assert missing.value.codes == ["operation_invalid"]
    assert (await restarted.operations.list("patch"))[0]["status"] == "pending"
    approved = await restarted.operations.decide("patch", pending["operationId"], {"decision": "approved", "inputPatch": {"value": 2}})
    await restarted.idle()
    completed = (await restarted.operations.list("patch"))[0]
    assert approved["toolCall"] == {"id": "write-1", "name": "write", "args": {"value": 1, "keep": True}}
    assert approved["inputPatch"] == {"value": 2}
    assert approved["resolvedToolCall"] == {"id": "write-1", "name": "write", "args": {"value": 2, "keep": True}}
    assert executed == [({"value": 2, "keep": True}, approved["resolvedToolCall"])]
    assert completed["status"] == "completed"


@pytest.mark.asyncio
async def test_surface_start_agent_follows_multistep_routes_and_carries_conversation(tmp_path: Path):
    seen = {}
    routed = []

    def model(name, text):
        async def run(value):
            seen[name] = value["messages"]
            return {"message": {"role": "assistant", "source": "model", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}
        return run

    config = {
        "version": 1, "name": "routes",
        "agents": {name: {"model": name, "input": "asis"} for name in ("slack", "api", "finish")},
        "routes": [
            {"from": "$input", "to": "slack"},
            {"from": "slack", "to": "api"},
            {"from": "api", "to": "finish", "when": {"fn": "has_output"}},
            {"from": "finish", "to": "$output"},
        ],
    }
    def has_output(value):
        routed.append(value)
        return True
    runtime = create_goondan(config=config, models={"slack": model("slack", "unused"), "api": model("api", "handoff"), "finish": model("finish", "done")}, functions={"has_output": has_output})

    result = await runtime.run("request", session_id="route", start_agent="api")

    assert result["output"] == "done"
    assert [message["content"][0]["text"] for message in seen["finish"]] == ["handoff"]
    assert routed[0]["text"] == "handoff"


@pytest.mark.asyncio
async def test_a_route_branch_with_no_outgoing_candidates_may_finish_without_output():
    async def model(value):
        return {"message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}, "finishReason": "stop"}
    config = {
        "version": 1,
        "agents": {"main": {"model": "m"}},
        "routes": [{"from": "$input", "to": "main"}],
    }
    runtime = create_goondan(config=config, models={"m": model})
    result = await runtime.run("request", session_id="route-1")
    assert result["outputs"] == [] and "output" not in result
    await runtime.close()


def test_empty_route_list_is_a_schema_error():
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(config={"agents": {"main": {"model": "m"}}, "routes": []}, models={"m": lambda value: None})
    assert [(item["code"], item["path"]) for item in error.value.issues] == [("schema.oneOf", "/routes")]


def test_shared_template_syntax(tmp_path: Path):
    (tmp_path / "templates").mkdir()
    (tmp_path / "goondan.yaml").write_text("agents: {main: {model: m}}\n", encoding="utf-8")
    tail = tmp_path / "templates" / "tail.md"
    tail.write_text("{{ params.items | join(',') | trim }}", encoding="utf-8")
    main = tmp_path / "templates" / "main.md"
    main.write_text("{% if params.value is defined %}{{ params.value | default('x') | upper }}{% endif %}{% include 'tail.md' %}", encoding="utf-8")
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "systemMessage": {"template": str(main)}, "params": {"value": "ok", "items": ["a", "b"]}}}}, models={"m": lambda value: None})
    assert runtime.render(str(main), {"params": {"value": "ok", "items": ["a", "b"]}}) == "OKa,b"

    unsupported = tmp_path / "templates" / "unsupported.md"
    unsupported.write_text("{% set value = 1 %}", encoding="utf-8")
    with pytest.raises(GoondanConfigError) as error:
        create_goondan(config={"agents": {"main": {"model": "m", "systemMessage": {"template": str(unsupported)}}}}, models={"m": lambda value: None})
    assert [(item["code"], item["path"]) for item in error.value.issues] == [("template.unsupported", "/agents/main/systemMessage/template")]
