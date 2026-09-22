import asyncio

import pytest

from goondan import Extension, GoondanExecutionError, create_goondan, define_extension, define_tool
from goondan.store import InMemoryStore
from test_journal_v3 import ExpiringStore


def answer():
    return {"message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}, "finishReason": "stop"}


async def model(_value):
    return answer()


async def test_route_function_waits_for_asynchronous_event_receiver():
    started, release = asyncio.Event(), asyncio.Event()
    async def emit(event):
        if event["type"] == "route.function.start":
            started.set()
            await release.wait()
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}, "routes": [
        {"from": "$input", "to": "main"}, {"from": "main", "to": {"fn": "pass"}}, {"from": {"fn": "pass"}, "to": "$output"},
    ]}, models={"m": model}, functions={"pass": lambda value: value}, emit=emit)
    try:
        run = await runtime.run("hi")
        result = asyncio.ensure_future(run.result)
        await asyncio.wait_for(started.wait(), 1)
        await asyncio.sleep(0)
        assert not result.done()
        release.set()
        assert (await result)["output"] == "done"
    finally:
        release.set()
        await runtime.close()


@pytest.mark.parametrize("close", [False, True])
async def test_stateless_extensions_outlive_pending_hooks(close):
    started, release = asyncio.Event(), asyncio.Event()
    log = []
    async def hook(value, ctx):
        started.set()
        try:
            await release.wait()
        finally:
            log.append("hook finished")
    ext = define_extension(name="ext", create=lambda **kwargs: Extension(hooks={"onOutput": hook}, dispose=lambda: log.append("disposed")))
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "stateful": False, "extensions": {"ext": {}}, "hooks": {"onOutput": [{"extension": "ext", "mode": "async"}]}}}}, models={"m": model}, extensions={"ext": ext})
    await (await runtime.run("hi")).result
    await started.wait()
    assert log == []
    if close:
        await runtime.close()
    else:
        release.set()
        await runtime.idle()
        await runtime.close()
    assert log == ["hook finished", "disposed"]


async def test_failed_deletion_preserves_extension_state():
    store = InMemoryStore()
    created, disposed = [], []
    def create(**kwargs):
        created.append(True)
        return Extension(dispose=lambda: disposed.append(True))
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "extensions": {"ext": {}}}}}, models={"m": model}, store=store, extensions={"ext": define_extension(name="ext", create=create)})
    try:
        await (await runtime.run("hi", session_id="s")).result
        lease = await store.acquire_lease("s", "other")
        assert lease is not None
        with pytest.raises(GoondanExecutionError):
            await runtime.sessions.delete("s")
        assert disposed == []
        await lease.release()
        await (await runtime.run("again", session_id="s")).result
        assert len(created) == 1
    finally:
        await runtime.close()


@pytest.mark.parametrize("failure", ["scan", "delete"])
async def test_failed_deletion_releases_lease(failure):
    class BrokenStore(InMemoryStore):
        def scan(self, **options):
            if failure == "scan":
                raise OSError("scan failed")
            return super().scan(**options)
        async def delete_session(self, session_id, *, token):
            raise OSError("delete failed")
    store = BrokenStore()
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, store=store)
    with pytest.raises(OSError):
        await runtime.sessions.delete("s")
    lease = await store.acquire_lease("s", "next")
    assert lease is not None
    await lease.release()
    await runtime.close()


async def test_concurrent_journal_open_shares_one_writer():
    class YieldingStore(InMemoryStore):
        async def acquire_lease(self, session_id, owner):
            await asyncio.sleep(0)
            return await super().acquire_lease(session_id, owner)
    runtime = create_goondan(config={"agents": {"main": {"model": "m"}}}, models={"m": model}, store=YieldingStore())
    try:
        first, second = await asyncio.wait_for(asyncio.gather(runtime._open_journal("s"), runtime._open_journal("s")), 1)
        assert first is second
    finally:
        await runtime.close()


async def test_lost_lease_cancels_only_its_sessions_detached_tool():
    store = ExpiringStore()
    entered, cancelled, other_release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls = 0
    async def tool(value, ctx):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    async def scripted(value):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"message": {"role": "assistant", "content": [{"type": "tool.call", "callId": "c", "name": "work", "args": {}}]}, "finishReason": "tool"}
        return answer()
    runtime = create_goondan(config={"agents": {"main": {"model": "m", "tools": [{"tool": "work", "approval": "required"}]}}}, models={"m": scripted}, store=store, tools={"work": define_tool(name="work", description="work", input={}, execute=tool)})
    other = asyncio.create_task(other_release.wait())
    runtime._track_session_task(other, "other")
    try:
        await (await runtime.run("hi", session_id="s")).result
        operation = (await runtime.operations.list("s"))[0]
        await runtime.operations.decide("s", operation["operationId"], {"decision": "approved"})
        await asyncio.wait_for(entered.wait(), 1)
        store.last_lease._renews = False
        await asyncio.wait_for(cancelled.wait(), 1)
        assert not other.done()
        assert (await runtime.operations.list("s"))[0]["status"] == "running"
    finally:
        other_release.set()
        await runtime.close()
