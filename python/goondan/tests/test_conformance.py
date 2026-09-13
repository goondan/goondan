from __future__ import annotations

import json
from pathlib import Path

import pytest

from goondan import InMemoryConversationStore, create_runtime, load_config, define_extension, Extension


ROOT = Path(__file__).resolve().parents[3]


def message_text(message):
    return "".join(part.get("text", "") for part in message.get("content", []) if part.get("type") == "text")


@pytest.mark.asyncio
@pytest.mark.parametrize("fixture", sorted(path for path in (ROOT / "fixtures" / "conformance").glob("*") if (path / "goondan.yaml").is_file()), ids=lambda path: path.name)
async def test_shared_conformance_fixture(fixture: Path):
    case = json.loads((fixture / "case.json").read_text(encoding="utf-8"))
    expected = json.loads((fixture / "expected.json").read_text(encoding="utf-8"))
    results = list(case["modelResults"])
    captured = []

    tool_calls = []

    async def model(model_input):
        captured.append(model_input)
        result = results.pop(0)
        content = ([{"type": "tool.call", **call} for call in result.get("toolCalls", [])]
                   if result.get("toolCalls") else [{"type": "text", "text": result["text"]}])
        return {
            "message": {"role": "assistant", "source": "model", "content": content},
            "finishReason": result["finishReason"],
        }

    def make_tool(name):
        async def execute(value, context):
            tool_calls.append(name)
            return [{"type": "text", "text": case["toolResults"][name]["text"]}]
        from goondan import define_tool
        return define_tool(name=name, description=name, input={"type": "object"}, execute=execute)

    def complete(value, ctx):
        if value.get("name") == "finish": ctx.execution.complete({"id": "complete", "role": "assistant", "source": "tool", "content": value["content"]})
        return value

    store = InMemoryConversationStore()
    runtime = create_runtime(
        config=load_config(fixture, variants=case.get("variants")),
        models={"fixture": model},
        extensions={"completion": define_extension(name="completion", create=lambda options, ports, agent, log: Extension(hooks={"toolResult": complete}))},
        tools={name: make_tool(name) for name in case.get("toolResults", {})},
        functions={
            "normalizeInput": lambda value: value,
            "polishOutput": lambda value: message_text(value) + "!",
            "addExecution": lambda value: {"call": value, "execution": {"fixture": True}},
            "markResult": lambda value: {**value, "meta": {"fixture": True}},
        },
        store=store,
    )
    output = (await runtime.run_turn(case["input"], conversation_id="fixture"))[0]["output"]
    stored = await store.load("fixture", "main")
    if "modelCallCount" in expected:
        actual = {"modelCallCount": len(captured), "toolCalls": tool_calls,
                  "output": {"role": output["role"], "source": output["source"], "text": message_text(output)},
                  "storedRoles": [message["role"] for message in stored]}
    elif "systemText" in expected:
        actual = {"systemText": captured[0]["system"][0]["text"], "outputText": message_text(output)}
    else:
        actual = {
            "system": captured[0]["system"],
            "messages": [{"role": message["role"], "source": message["source"], "text": message_text(message)} for message in captured[0]["messages"]],
            "output": {"role": output["role"], "source": output["source"], "text": message_text(output)},
            "storedMessageSources": [message["source"] for message in stored],
        }
    assert actual == expected


@pytest.mark.asyncio
async def test_shared_async_approval_contract(tmp_path: Path):
    fixture = ROOT / "fixtures" / "conformance" / "async-approval"
    case = json.loads((fixture / "case.json").read_text(encoding="utf-8"))
    expected = json.loads((fixture / "expected.json").read_text(encoding="utf-8"))
    captured = []

    async def model(model_input):
        captured.append(model_input)
        if len(captured) == 1:
            call = case["toolCall"]
            content = [{"type": "tool.call", "callId": call["id"], "name": call["name"], "args": call["args"]}]
            return {"message": {"role": "assistant", "source": "model", "content": content}, "finishReason": "tool"}
        return {"message": {"role": "assistant", "source": "model", "content": [{"type": "text", "text": "done"}]}, "finishReason": "stop"}

    class RecordingStore(__import__("goondan").InMemoryOperationStore):
        def __init__(self):
            super().__init__()
            self.statuses = []

        async def save(self, operation):
            await super().save(operation)
            self.statuses.append(operation.get("status", "pending"))

        async def transition(self, conversation_id, operation_id, statuses, updates):
            result = await super().transition(conversation_id, operation_id, statuses, updates)
            if result is not None and "status" in updates:
                self.statuses.append(result["status"])
            return result

    from goondan import define_tool
    operation_store = RecordingStore()
    conversation_store = InMemoryConversationStore()
    runtime = create_runtime(
        config={"version": 1, "name": "fixture", "__root__": str(tmp_path), "agents": {"main": {"model": "fixture", "input": "asis", "tools": [{"tool": "danger", "approval": "required"}]}}, "flow": {"in": "main"}},
        models={"fixture": model},
        tools={"danger": define_tool(name="danger", description="danger", input={}, execute=lambda value, context: value)},
        store=conversation_store,
        operation_store=operation_store,
    )
    await runtime.run_turn("start", conversation_id=case["conversationId"])
    operation = (await runtime.list_pending_operations(case["conversationId"]))[0]
    operation_id = operation["operationId"]
    await runtime.approve_operation(case["conversationId"], operation_id)
    await runtime.recover_operations(case["conversationId"])
    stored = await conversation_store.load(case["conversationId"], "main")
    pending_value = next(part["content"][0]["value"] for message in stored for part in message["content"] if part.get("type") == "tool.result")
    completion = json.loads(captured[-1]["messages"][-1]["content"][0]["text"])
    normalize = lambda value: json.loads(json.dumps(value).replace(operation_id, expected["initialResult"]["operationId"]))
    assert normalize(pending_value) == expected["initialResult"]
    assert operation_store.statuses[:4] == expected["operationStatusOrder"]
    assert normalize({key: completion[key] for key in expected["completion"]}) == expected["completion"]
    assert sum(part.get("type") == "tool.result" and part.get("callId") == case["toolCall"]["id"] for message in stored for part in message["content"]) == expected["originalToolResultCount"]
    assert sum(expected["initialResult"]["operationId"] in normalize(part).get("text", "") for message in stored for part in message["content"] if part.get("type") == "text") == expected["completionDeliveryCount"]
