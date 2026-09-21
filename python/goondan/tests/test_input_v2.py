from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from goondan import GoondanConfigError, GoondanExecutionError, create_goondan


def answer(text: str = "done", *, content: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "message": {"role": "assistant", "content": content or [{"type": "text", "text": text}]},
        "finishReason": "stop",
    }


@pytest.mark.asyncio
async def test_run_normalizes_messages_parts_strings_json_and_empty_arrays():
    seen: list[list[dict[str, Any]]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        seen.append(value["messages"])
        return answer()

    goondan = create_goondan({"agents": {"main": {"model": "m", "stateful": False}}}, models={"m": model})
    message = {"id": "given", "role": "user", "source": "host", "content": [{"type": "text", "text": "message"}]}
    await (await goondan.run([message], session_id="messages")).result
    await (await goondan.run([{"type": "text", "text": "part"}], session_id="parts")).result
    await (await goondan.run("string", session_id="string")).result
    await (await goondan.run({"json": True}, session_id="json")).result
    await (await goondan.run([], session_id="empty")).result

    assert seen[0] == [message]
    assert seen[1][0]["content"] == [{"type": "text", "text": "part"}]
    assert seen[2][0]["content"] == [{"type": "text", "text": "string"}]
    assert seen[3][0]["content"] == [{"type": "text", "text": '{"json":true}'}]
    assert seen[4] == []


@pytest.mark.asyncio
async def test_input_rule_changes_only_direct_json_parts_and_preserves_message_fields():
    seen: list[dict[str, Any]] = []

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        seen.extend(value["messages"])
        return answer()

    message = {
        "id": "m1",
        "role": "user",
        "source": "host",
        "key": "kept",
        "meta": {"host": True},
        "content": [
            {"type": "text", "text": "before"},
            {"type": "image", "url": "https://example.test/image.png", "mediaType": "image/png"},
            {"type": "media", "ref": "asset-1", "mediaType": "audio/wav"},
            {"type": "json", "value": {"name": "Ada"}},
        ],
    }
    goondan = create_goondan(
        {"agents": {"main": {"model": "m", "input": {"fn": "shape"}}}},
        models={"m": model},
        functions={"shape": lambda value: {"greeting": value["name"]}},
    )
    await (await goondan.run([message], session_id="s")).result
    assert seen[0] == {
        **message,
        "content": [
            *message["content"][:3],
            {"type": "text", "text": '{"greeting":"Ada"}'},
        ],
    }


@pytest.mark.asyncio
async def test_input_hook_can_replace_the_message_array_before_input_conversion():
    seen: list[list[dict[str, Any]]] = []
    replacement = {"id": "replacement", "role": "user", "source": "hook", "content": [{"type": "json", "value": 7}]}

    async def model(value: dict[str, Any]) -> dict[str, Any]:
        seen.append(value["messages"])
        return answer()

    goondan = create_goondan(
        {"agents": {"main": {"model": "m", "hooks": {"onInput": [{"fn": "replace"}]}}}},
        models={"m": model},
        functions={"replace": lambda value: [replacement]},
    )
    await (await goondan.run("discarded", session_id="s")).result
    assert seen == [[{**replacement, "content": [{"type": "text", "text": "7"}]}]]


def test_on_input_rejects_message_augmentation_elements(tmp_path: Path):
    template = tmp_path / "input.md"
    template.write_text("{{ inputText }}", encoding="utf-8")
    with pytest.raises(GoondanConfigError):
        create_goondan(
            {"agents": {"main": {"model": "m", "hooks": {"onInput": [{"agent": "helper"}]}}, "helper": {"model": "m"}}},
            models={"m": lambda value: answer()},
        )
    with pytest.raises(GoondanConfigError):
        create_goondan(
            {"agents": {"main": {"model": "m", "hooks": {"onInput": [{"template": str(template)}]}}}},
            models={"m": lambda value: answer()},
        )


@pytest.mark.asyncio
async def test_route_preserves_output_content_and_adds_origin_metadata():
    received: list[dict[str, Any]] = []
    content = [
        {"type": "image", "url": "https://example.test/image.png"},
        {"type": "text", "text": "caption"},
    ]

    async def first(value: dict[str, Any]) -> dict[str, Any]:
        return answer(content=content)

    async def second(value: dict[str, Any]) -> dict[str, Any]:
        received.extend(value["messages"])
        return answer()

    goondan = create_goondan(
        {"agents": {"first": {"model": "first"}, "second": {"model": "second"}}, "routes": ["first", "second"]},
        models={"first": first, "second": second},
    )
    await (await goondan.run("x", session_id="s")).result
    assert received[0]["content"] == content
    assert received[0]["meta"] == {"from": "first", "instance": "s/first", "kind": "start"}


@pytest.mark.asyncio
async def test_a_branch_failure_aborts_the_other_branch_and_keeps_the_first_error():
    slow_started = asyncio.Event()
    slow_cancelled = asyncio.Event()

    async def split(value: dict[str, Any]) -> dict[str, Any]:
        return answer("split")

    async def broken(value: dict[str, Any]) -> dict[str, Any]:
        await slow_started.wait()
        raise RuntimeError("branch failed")

    async def slow(value: dict[str, Any]) -> dict[str, Any]:
        slow_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            slow_cancelled.set()
            raise

    config = {
        "agents": {name: {"model": name} for name in ("split", "broken", "slow")},
        "routes": [
            {"from": "$input", "to": "split"},
            {"from": "split", "to": "broken"},
            {"from": "split", "to": "slow"},
            {"from": "broken", "to": "$output"},
            {"from": "slow", "to": "$output"},
        ],
    }
    goondan = create_goondan(config, models={"split": split, "broken": broken, "slow": slow}, max_retries=0)
    with pytest.raises(GoondanExecutionError) as error:
        await (await goondan.run("x", session_id="s")).result
    assert error.value.codes == ["model_error"]
    assert slow_cancelled.is_set()
