import asyncio
import copy

import pytest

from goondan.fold import FoldError, fold
from goondan import GoondanExecutionError, create_goondan
from goondan.store import InMemoryStore, StoreConflictError


class ExpiringLease:
    def __init__(self, lease, *, lifetime_ms=40, renews=True):
        self._lease = lease
        self._lifetime_ms = lifetime_ms
        self._renews = renews
        self.token = lease.token
        self.expires_at = __import__("time").time_ns() // 1_000_000 + lifetime_ms
        self.renewed = asyncio.Event()

    async def renew(self):
        self.renewed.set()
        if not self._renews:
            return False
        kept = await self._lease.renew()
        if kept:
            self.expires_at = __import__("time").time_ns() // 1_000_000 + self._lifetime_ms
        return kept

    async def release(self):
        await self._lease.release()


class ExpiringStore(InMemoryStore):
    def __init__(self, *, renews=True):
        super().__init__()
        self.renews = renews
        self.last_lease = None

    async def acquire_lease(self, session_id, owner):
        lease = await super().acquire_lease(session_id, owner)
        if lease is None:
            return None
        wrapped = ExpiringLease(lease, renews=self.renews)
        self.last_lease = wrapped
        return wrapped


def new_event(event_type="turn.start", **members):
    return {"version": 1, "type": event_type, "sessionId": "s", "turnId": "t", "data": {}, **members}


@pytest.mark.asyncio
async def test_store_assigns_sequence_and_appends_a_batch_atomically():
    store = InMemoryStore()
    lease = await store.acquire_lease("s", "owner")
    assert lease is not None
    stored = await store.append(
        [new_event(), new_event("input.received", inputId="i", data={"input": "hi"})],
        expected=0,
        token=lease.token,
        write_id="w",
    )
    assert [event["seq"] for event in stored] == [1, 2]
    assert {event["writeId"] for event in stored} == {"w"}
    assert await store.head("s") == 2


@pytest.mark.asyncio
async def test_store_expected_conflict_does_not_append():
    store = InMemoryStore()
    await store.append([new_event()], expected=0)
    with pytest.raises(StoreConflictError):
        await store.append([new_event("turn.done", data={"result": {}})], expected=0)
    assert await store.head("s") == 1


@pytest.mark.asyncio
async def test_store_write_id_is_idempotent_before_expected_check():
    store = InMemoryStore()
    first = await store.append([new_event()], expected=0, write_id="same")
    second = await store.append([new_event()], expected=0, write_id="same")
    assert second == first
    assert await store.head("s") == 1


@pytest.mark.asyncio
async def test_store_rejects_a_stale_fencing_token_after_new_lease():
    store = InMemoryStore()
    first = await store.acquire_lease("s", "one")
    assert first is not None
    await first.release()
    second = await store.acquire_lease("s", "two")
    assert second is not None and second.token > first.token
    with pytest.raises(StoreConflictError):
        await store.append([new_event()], token=first.token)


@pytest.mark.asyncio
async def test_delete_keeps_the_fencing_generation():
    store = InMemoryStore()
    first = await store.acquire_lease("s", "one")
    assert first is not None
    await store.append([new_event()], token=first.token)
    await store.delete_session("s", token=first.token)
    second = await store.acquire_lease("s", "two")
    assert second is not None and second.token > first.token
    with pytest.raises(StoreConflictError):
        await store.append([new_event()], token=first.token)


@pytest.mark.asyncio
async def test_store_watch_wakes_for_the_selected_stream_and_lease_release_is_idempotent():
    store = InMemoryStore()
    lease = await store.acquire_lease("s", "owner")
    assert lease is not None and await lease.renew() is True
    watching = store.watch(session_id="s").__aiter__()
    wake = asyncio.create_task(anext(watching))
    await asyncio.sleep(0)
    await store.append([new_event()], token=lease.token)
    assert await asyncio.wait_for(wake, 1) is None
    await watching.aclose()
    await lease.release()
    await lease.release()
    assert await lease.renew() is False


@pytest.mark.asyncio
async def test_memory_lease_has_no_expiration():
    lease = await InMemoryStore().acquire_lease("s", "owner")
    assert lease is not None and lease.expires_at is None


@pytest.mark.asyncio
async def test_runtime_renews_a_finite_lease_before_it_expires():
    started = asyncio.Event()
    release = asyncio.Event()
    store = ExpiringStore()

    async def model(value):
        started.set()
        await release.wait()
        return {
            "message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]},
            "finishReason": "stop",
        }

    runtime = create_goondan({"agents": {"main": {"model": "m"}}}, models={"m": model}, store=store)
    turn = asyncio.create_task(runtime.run("start", session_id="renewed"))
    await started.wait()
    assert store.last_lease is not None
    await asyncio.wait_for(store.last_lease.renewed.wait(), 1)
    assert not turn.done()
    release.set()
    assert (await turn)["output"] == "done"


@pytest.mark.asyncio
async def test_runtime_fails_a_turn_when_lease_renewal_is_lost():
    started = asyncio.Event()
    store = ExpiringStore(renews=False)

    async def model(value):
        started.set()
        await asyncio.Event().wait()

    runtime = create_goondan({"agents": {"main": {"model": "m"}}}, models={"m": model}, store=store)
    turn = asyncio.create_task(runtime.run("start", session_id="lost"))
    await started.wait()
    with pytest.raises(GoondanExecutionError) as failure:
        await asyncio.wait_for(turn, 1)
    assert failure.value.where == "runtime" and failure.value.codes == ["runtime_error"]


def test_fold_is_deterministic_and_preserves_camel_case_fields():
    events = [
        {
            **new_event(),
            "seq": 1,
            "at": 1,
            "writeId": "w1",
        },
        {
            **new_event("input.received", inputId="i", data={"input": "hi", "startAgent": "a"}),
            "seq": 2,
            "at": 2,
            "writeId": "w2",
        },
        {
            **new_event(
                "agent.start",
                agent="a",
                instance="s/a",
                executionId="e",
                data={"kind": "turn", "onInput": []},
            ),
            "seq": 3,
            "at": 3,
            "writeId": "w3",
        },
        {
            **new_event(
                "conversation.message.appended",
                agent="a",
                instance="s/a",
                executionId="e",
                data={"message": {"id": "m", "role": "user", "source": "input", "content": []}},
            ),
            "seq": 4,
            "at": 4,
            "writeId": "w4",
        },
    ]
    before = copy.deepcopy(events)
    assert fold("s", events) == fold("s", events)
    assert events == before
    state = fold("s", events)
    assert state["turns"][0]["inputs"][0]["startAgent"] == "a"
    assert state["executions"][0]["executionId"] == "e"


def test_fold_rejects_non_contiguous_sequence():
    event = {**new_event(), "seq": 2, "at": 1, "writeId": "w"}
    with pytest.raises(FoldError):
        fold("s", [event])
