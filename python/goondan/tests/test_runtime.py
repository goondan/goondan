from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from goondan import (
    Extension,
    HookSpec,
    GoondanConfig,
    GoondanError,
    InMemoryOperationStore,
    InMemoryConversationStore,
    create_runtime,
    define_extension,
    define_tool,
    load_config,
)
from goondan.runtime import _json


def test_load_config_merges_resources_in_order_and_preserves_declaring_paths(tmp_path: Path):
    fragments = tmp_path / "fragments"
    nested = fragments / "nested"
    nested.mkdir(parents=True)
    (nested / "goondan.yaml").write_text(
        """version: 1
name: base
agents:
  worker:
    model: first
    systemMessage: {template: templates/system.md}
flow: {in: worker}
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
    ("files", "message"),
    [
        ({"goondan.yaml": "resources: [missing.yaml]\n"}, "does not exist"),
        (
            {
                "goondan.yaml": "resources: [shared.yaml, shared.yaml]\n",
                "shared.yaml": "version: 1\n",
            },
            "duplicate configuration resource",
        ),
        (
            {
                "goondan.yaml": "resources: [child.yaml]\n",
                "child.yaml": "resources: [goondan.yaml]\n",
            },
            "configuration resource cycle",
        ),
    ],
)
def test_load_config_rejects_invalid_resource_graph(tmp_path: Path, files: dict[str, str], message: str):
    for relative_path, content in files.items():
        (tmp_path / relative_path).write_text(content, encoding="utf-8")

    with pytest.raises(GoondanError, match=message):
        load_config(tmp_path)


def test_runtime_rejects_duplicate_agents_in_serial_flow(tmp_path: Path):
    config = {
        "version": 1,
        "name": "duplicate-flow",
        "__root__": str(tmp_path),
        "agents": {"worker": {"model": "scripted"}},
        "flow": ["worker", "worker"],
    }

    with pytest.raises(GoondanError, match="flow must contain unique agent names"):
        create_runtime(config=config, models={"scripted": lambda value: value})


def test_portable_json_filter():
    value = {"한글": [1.0, 0.000001, 1e-7, True, None]}
    assert _json(value, 0) == '{"한글":[1,0.000001,1e-7,true,null]}'
    assert _json({"a": [1, 2]}) == '{\n  "a": [\n    1,\n    2\n  ]\n}'


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
    (tmp_path / "variants").mkdir()
    (tmp_path / "templates" / "system.md").write_text("Agent {{ agent.name }} / {{ params.lang }}\n", encoding="utf-8")
    (tmp_path / "templates" / "note.md").write_text("NOTE={{ text | json(0) }}\n", encoding="utf-8")
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
      input: [{name: normalize, fn: normalize}]
      conversation:
        - {extension: marks}
        - {name: delayed, fn: delayed, mode: async, optional: true}
      modelInput: [{name: note, using: input, template: templates/note.md}]
      toolResult: [{name: decorate, fn: decorate}]
      output: [{name: polish, fn: polish}]
flow: {in: worker}
""",
        encoding="utf-8",
    )
    (tmp_path / "variants" / "plain.yaml").write_text(
        """extends: ../goondan.yaml
agents:
  worker:
    hooks:
      conversation: [{extension: marks}]
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
        return Extension(hooks={"conversation": conversation})

    runtime = create_runtime(
        config=load_config(root, variants=["plain"]),
        models={"scripted": model},
        tools={"echo": define_tool(name="echo", description="echo", input={"type": "object"}, execute=lambda value, ctx: value)},
        functions={
            "normalize": lambda value: {**value, "normalized": True},
            "delayed": lambda value: "later",
            "decorate": lambda value: {**value, "meta": {"decorated": True}},
            "polish": lambda value: "POLISHED=" + "".join(p.get("text", "") for p in value["content"]),
        },
        extensions={"marks": define_extension(name="marks", hooks={"conversation": HookSpec(append_only=True, async_safe=True)}, create=create_marks)},
        store=store,
    )
    outputs = await runtime.run_turn({"text": "hello"}, conversation_id="conv")
    assert outputs[0]["output"]["content"][0]["text"] == "POLISHED=done"
    assert model.inputs[0]["system"][0]["text"] == "Agent worker / ko\n"
    assert model.inputs[0]["messages"][-1]["content"][0]["text"] == 'NOTE={"text":"hello","normalized":true}\n'
    stored = await store.load("conv", "worker")
    assert any(message["role"] == "tool" for message in stored)
    assert sum(message.get("key") == "one" for message in stored) == 1
    assert store.finishes[-1]["status"] == "done"
    await runtime.close()


@pytest.mark.asyncio
async def test_maintain_and_prewarm(tmp_path: Path):
    root = write_config(tmp_path)
    model = ScriptedModel([[{"type": "text", "text": "warm"}]])
    store = InMemoryConversationStore()
    await store.append("conv", "worker", [{"id": "u", "role": "user", "source": "user", "content": [{"type": "text", "text": "saved"}]}])

    def create_marks(**_):
        return Extension(hooks={"conversation": lambda value, ctx: ctx.append(ctx.message.user("maintained", key="m"))})

    runtime = create_runtime(
        config=load_config(root, variants=["plain"]), models={"scripted": model},
        tools={"echo": define_tool(name="echo", description="echo", input={}, execute=lambda value, ctx: value)},
        functions={"normalize": lambda x: x, "delayed": lambda x: x, "decorate": lambda x: x, "polish": lambda x: x},
        extensions={"marks": define_extension(name="marks", hooks={"conversation": HookSpec(append_only=True)}, create=create_marks)}, store=store,
    )
    maintained = await runtime.maintain("conv")
    assert maintained[-1]["content"][0]["text"] == "maintained"
    await runtime.prewarm("conv")
    assert model.inputs[-1]["options"] == {"maxTokens": 1}


@pytest.mark.asyncio
async def test_async_approval_continues_then_delivers_completion_after_restart_once(tmp_path: Path):
    config = {
        "version": 1, "name": "approval", "__root__": str(tmp_path),
        "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}, "lookup"]}},
        "flow": {"in": "worker"},
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

    first_runtime = create_runtime(config=config, models={"scripted": model}, tools={"write": tool, "lookup": lookup}, store=conversations, operation_store=approvals)
    initial = await first_runtime.run_turn("start", conversation_id="restart")
    assert initial[0]["status"] == "done"
    assert initial[0]["output"]["content"][0]["text"] == "continued while pending"
    assert executions == []
    assert lookups == [{"key": "safe"}]
    pending = await first_runtime.list_pending_operations("restart")
    assert len(pending) == 1
    operation_id = pending[0]["operationId"]
    stored = await conversations.load("restart", "worker")
    write_results = [part for message in stored for part in message["content"] if part.get("type") == "tool.result" and part["callId"] == "write-1"]
    assert write_results == [{"type": "tool.result", "callId": "write-1", "content": [{"type": "json", "value": {"status": "pending", "operationId": operation_id}}]}]
    await first_runtime.close()

    restarted_runtime = create_runtime(config=config, models={"scripted": model}, tools={"write": tool, "lookup": lookup}, store=conversations, operation_store=approvals)
    completed = await restarted_runtime.approve_operation("restart", operation_id)
    duplicate = await restarted_runtime.approve_operation("restart", operation_id)
    await restarted_runtime.recover_operations("restart")
    assert completed["status"] == duplicate["status"] == "completed"
    assert executions == [{"text": "once"}]
    assert await restarted_runtime.list_pending_operations("restart") == []
    completion = __import__("json").loads(model.inputs[-1]["messages"][-1]["content"][0]["text"])
    assert completion == {"type": "operation_completion", "deliveryId": f"operation:{operation_id}:completion", "operationId": operation_id, "conversationId": "restart", "agent": "worker", "status": "completed", "toolCall": {"id": "write-1", "name": "write", "args": {"text": "once"}}, "result": {"callId": "write-1", "name": "write", "args": {"text": "once"}, "content": [{"type": "json", "value": {"text": "once"}}]}}
    stored = await conversations.load("restart", "worker")
    assert sum(operation_id in part.get("text", "") for message in stored for part in message["content"] if part.get("type") == "text") == 1
    assert sum(part.get("type") == "tool.result" and part.get("callId") == "write-1" for message in stored for part in message["content"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(("action", "expected"), [("reject_operation", "rejected"), ("cancel_operation", "cancelled")])
async def test_terminal_approval_without_execution_is_delivered(tmp_path: Path, action: str, expected: str):
    config = {"version": 1, "name": "approval", "__root__": str(tmp_path), "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}, "flow": {"in": "worker"}}
    model = ScriptedModel([[{"type": "tool.call", "callId": "write-1", "name": "write", "args": {"text": "blocked"}}], [{"type": "text", "text": "pending acknowledged"}], [{"type": "text", "text": "terminal acknowledged"}]])
    executions = []
    runtime = create_runtime(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, _: executions.append(value))})
    await runtime.run_turn("start", conversation_id=expected)
    operation = (await runtime.list_pending_operations(expected))[0]
    terminal = await getattr(runtime, action)(expected, operation["operationId"])
    await runtime.recover_operations(expected)
    assert terminal["status"] == expected
    assert executions == []
    assert f'"status":"{expected}"' in model.inputs[-1]["messages"][-1]["content"][0]["text"]


@pytest.mark.asyncio
async def test_completion_waits_for_active_turn_safe_boundary(tmp_path: Path):
    config = {"version": 1, "name": "approval", "__root__": str(tmp_path), "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}, "flow": {"in": "worker"}}
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
    runtime = create_runtime(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, _: executions.append(value) or value)})
    active = asyncio.create_task(runtime.run_turn("start", conversation_id="active"))
    await second_started.wait()
    operation = (await runtime.list_pending_operations("active"))[0]
    approved = await runtime.approve_operation("active", operation["operationId"])
    assert approved["status"] == "completed"
    assert executions == [{"text": "once"}]
    assert len(inputs) == 2
    release_second.set()
    await active
    await runtime.recover_operations("active")
    assert len(inputs) == 3
    assert operation["operationId"] in inputs[-1]["messages"][-1]["content"][0]["text"]


@pytest.mark.asyncio
async def test_approved_operation_failure_is_delivered(tmp_path: Path):
    config = {"version": 1, "name": "approval", "__root__": str(tmp_path), "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}, "flow": {"in": "worker"}}
    model = ScriptedModel([[{"type": "tool.call", "callId": "write-1", "name": "write", "args": {}}], [{"type": "text", "text": "pending"}], [{"type": "text", "text": "failed received"}]])

    def fail(value, context):
        raise RuntimeError("write failed")

    runtime = create_runtime(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=fail)})
    await runtime.run_turn("start", conversation_id="failed")
    operation = (await runtime.list_pending_operations("failed"))[0]
    failed = await runtime.approve_operation("failed", operation["operationId"])
    await runtime.recover_operations("failed")
    assert failed["status"] == "failed"
    assert '"error":"write failed","errorCode":"execution_failed"' in model.inputs[-1]["messages"][-1]["content"][0]["text"]


@pytest.mark.asyncio
async def test_recovery_reregisters_approval_and_validated_patch_preserves_original_call(tmp_path: Path):
    config = {"version": 1, "name": "approval", "__root__": str(tmp_path), "agents": {"worker": {"model": "scripted", "input": "asis", "tools": [{"tool": "write", "approval": "required"}]}}, "flow": {"in": "worker"}}
    model = ScriptedModel([[{"type": "tool.call", "callId": "write-1", "name": "write", "args": {"value": 1, "keep": True}}], [{"type": "text", "text": "pending"}]])
    operations = InMemoryOperationStore()
    requests = []
    executed = []

    class RequestHost:
        def request_approval(self, request):
            requests.append(request)

    first = create_runtime(config=config, models={"scripted": model}, tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, context: value)}, operation_store=operations, host=RequestHost())
    await first.run_turn("start", conversation_id="patch")
    pending = (await first.list_operations("patch"))[0]
    restarted = create_runtime(
        config=config,
        models={"scripted": model},
        tools={"write": define_tool(name="write", description="write", input={}, execute=lambda value, context: executed.append((value, context["toolCall"])) or value)},
        operation_store=operations,
        host=type("Host", (), {"request_approval": lambda self, request: requests.append(request), "validate_operation_input_patch": lambda self, operation, patch: patch == {"value": 2}})(),
    )
    await restarted.recover_operations("patch")
    assert [request["operationId"] for request in requests] == [pending["operationId"], pending["operationId"]]
    with pytest.raises(Exception, match="inputPatch validation failed"):
        await restarted.decide_operation("patch", pending["operationId"], {"decision": "approved", "inputPatch": {"value": 3}})
    with pytest.raises(Exception, match="only valid for approval"):
        await restarted.decide_operation("patch", pending["operationId"], {"decision": "rejected", "inputPatch": {"value": 2}})
    approved = await restarted.decide_operation("patch", pending["operationId"], {"decision": "approved", "inputPatch": {"value": 2}})
    await restarted.recover_operations("patch")
    completed = (await restarted.list_operations("patch"))[0]
    assert approved["toolCall"] == {"id": "write-1", "name": "write", "args": {"value": 1, "keep": True}}
    assert approved["inputPatch"] == {"value": 2}
    assert approved["resolvedToolCall"] == {"id": "write-1", "name": "write", "args": {"value": 2, "keep": True}}
    assert executed == [({"value": 2, "keep": True}, approved["resolvedToolCall"])]
    assert completed["status"] == "completed"


@pytest.mark.asyncio
async def test_surface_start_agent_follows_multistep_routes_and_carries_conversation(tmp_path: Path):
    seen = {}

    def model(name, text):
        async def run(value):
            seen[name] = value["messages"]
            return {"message": {"role": "assistant", "source": "model", "content": [{"type": "text", "text": text}]}, "finishReason": "stop"}
        return run

    config = {
        "version": 1, "name": "routes", "__root__": str(tmp_path),
        "agents": {name: {"model": name, "input": "asis"} for name in ("slack", "api", "finish")},
        "flow": {"in": "slack", "routes": [
            {"from": "api", "to": "finish", "carry": {"message": "output", "conversation": "asis"}},
            {"from": "finish", "to": "out"},
        ]},
    }
    runtime = create_runtime(config=config, models={"slack": model("slack", "unused"), "api": model("api", "handoff"), "finish": model("finish", "done")})

    result = await runtime.run_turn("request", conversation_id="route", start_agent="api")

    assert result[0]["output"]["content"][0]["text"] == "done"
    assert [message["content"][0]["text"] for message in seen["finish"]] == ["request", "handoff", "handoff"]
