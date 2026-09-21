"""세션별 append 전용 저널 저장소 계약과 메모리 구현입니다."""

from __future__ import annotations

import asyncio
import copy
import time
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol


MAX_SAFE_INTEGER = 9_007_199_254_740_991


def _now() -> int:
    return int(time.time() * 1000)


class StoreError(Exception):
    """저널 저장소에서 발생한 오류의 기반 클래스입니다."""


class StoreConflictError(StoreError):
    """기대 head 또는 펜싱 토큰이 현재 상태와 충돌했습니다."""


class StoreInputError(StoreError):
    """저장소 요청이 계약의 입력 형식을 만족하지 않습니다."""


class Lease(Protocol):
    token: int
    expires_at: int | None

    async def renew(self) -> bool: ...

    async def release(self) -> None: ...


class Store(Protocol):
    async def append(
        self,
        events: Sequence[Mapping[str, Any]],
        *,
        write_id: str | None = None,
        expected: int | None = None,
        token: int | None = None,
    ) -> list[dict[str, Any]]: ...

    def scan(
        self,
        *,
        session_id: str | None = None,
        from_seq: int | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]: ...

    async def head(self, session_id: str) -> int: ...

    def watch(self, *, session_id: str | None = None) -> AsyncIterator[None]: ...

    async def acquire_lease(self, session_id: str, owner: str) -> Lease | None: ...

    async def delete_session(self, session_id: str, *, token: int) -> None: ...


def _positive_integer(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > MAX_SAFE_INTEGER:
        raise StoreInputError(f"{name} must be a positive safe integer")
    return value


def _non_negative_integer(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_SAFE_INTEGER:
        raise StoreInputError(f"{name} must be a non-negative safe integer")
    return value


def _validate_new_event(event: Mapping[str, Any]) -> None:
    if not isinstance(event, Mapping):
        raise StoreInputError("events must contain objects")
    for key in ("version", "type", "sessionId", "data"):
        if key not in event:
            raise StoreInputError(f"event is missing {key}")
    _positive_integer(event["version"], "event.version")
    if not isinstance(event["type"], str) or not event["type"]:
        raise StoreInputError("event.type must be a non-empty string")
    if not isinstance(event["sessionId"], str):
        raise StoreInputError("event.sessionId must be a string")
    forbidden = {"seq", "at", "writeId"}.intersection(event)
    if forbidden:
        raise StoreInputError(f"new event contains storage fields: {', '.join(sorted(forbidden))}")
    if "parentExecutionId" in event and "operationId" in event:
        raise StoreInputError("event cannot have both parentExecutionId and operationId")


@dataclass
class _Lease:
    _store: "InMemoryStore"
    session_id: str
    owner: str
    token: int
    expires_at: int | None = None
    _released: bool = False

    async def renew(self) -> bool:
        async with self._store._lock:
            active = self._store._leases.get(self.session_id)
            return not self._released and active is self

    async def release(self) -> None:
        async with self._store._lock:
            if not self._released and self._store._leases.get(self.session_id) is self:
                self._store._leases.pop(self.session_id, None)
            self._released = True


class InMemoryStore:
    """한 프로세스에서 세션별 저널과 임대를 보관합니다.

    삭제해도 토큰 세대는 남기므로 삭제 전 작성자가 같은 세션을 되살릴 수 없습니다.
    """

    def __init__(self) -> None:
        self._streams: dict[str, list[dict[str, Any]]] = {}
        self._writes: dict[str, dict[str, list[dict[str, Any]]]] = {}
        self._generations: dict[str, int] = {}
        self._leases: dict[str, _Lease] = {}
        self._lock = asyncio.Lock()
        self._watchers: set[tuple[str | None, asyncio.Queue[None]]] = set()

    @property
    def streams(self) -> dict[str, list[dict[str, Any]]]:
        """검사와 단순 호스트 어댑터가 읽을 수 있는 복사본을 반환합니다."""
        return copy.deepcopy(self._streams)

    async def append(
        self,
        events: Sequence[Mapping[str, Any]],
        *,
        write_id: str | None = None,
        expected: int | None = None,
        token: int | None = None,
    ) -> list[dict[str, Any]]:
        if isinstance(events, (str, bytes)) or not isinstance(events, Sequence) or not events:
            raise StoreInputError("append needs a non-empty event array")
        for event in events:
            _validate_new_event(event)
        session_id = events[0]["sessionId"]
        if any(event["sessionId"] != session_id for event in events):
            raise StoreInputError("one append batch must use one sessionId")
        if write_id is not None and (not isinstance(write_id, str) or not write_id):
            raise StoreInputError("write_id must be a non-empty string")
        if expected is not None:
            _non_negative_integer(expected, "expected")
        if token is not None:
            _positive_integer(token, "token")

        async with self._lock:
            generation = self._generations.get(session_id, 0)
            active = self._leases.get(session_id)
            if token is not None and (token < generation or active is None or active.token != token):
                raise StoreConflictError("the fencing token is not current")

            actual_write_id = write_id or uuid.uuid4().hex
            prior = self._writes.get(session_id, {}).get(actual_write_id)
            if prior is not None:
                return copy.deepcopy(prior)

            stream = self._streams.setdefault(session_id, [])
            if expected is not None and expected != len(stream):
                raise StoreConflictError(f"expected head {expected}, found {len(stream)}")
            if len(stream) + len(events) > MAX_SAFE_INTEGER:
                raise StoreInputError("event sequence exceeds the safe integer range")

            at = _now()
            stored: list[dict[str, Any]] = []
            for offset, event in enumerate(events, start=1):
                item = copy.deepcopy(dict(event))
                item["seq"] = len(stream) + offset
                item["at"] = at
                item["writeId"] = actual_write_id
                stored.append(item)
            stream.extend(stored)
            self._writes.setdefault(session_id, {})[actual_write_id] = copy.deepcopy(stored)
            watchers = tuple(self._watchers)

        for wanted, queue in watchers:
            if wanted is None or wanted == session_id:
                if queue.empty():
                    queue.put_nowait(None)
        return copy.deepcopy(stored)

    async def _scan_values(
        self,
        session_id: str | None,
        from_seq: int | None,
        limit: int | None,
    ) -> list[dict[str, Any]]:
        if session_id is None and (from_seq is not None or limit is not None):
            raise StoreInputError("from_seq and limit require session_id")
        if from_seq is not None:
            _positive_integer(from_seq, "from_seq")
        if limit is not None:
            _positive_integer(limit, "limit")
        async with self._lock:
            if session_id is None:
                values = [copy.deepcopy(item) for stream in self._streams.values() for item in stream]
                values.sort(key=lambda item: (item["at"], item["sessionId"], item["seq"]))
                return values
            start = (from_seq or 1) - 1
            values = copy.deepcopy(self._streams.get(session_id, [])[start:])
            return values[:limit] if limit is not None else values

    async def _scan_iterator(
        self,
        session_id: str | None,
        from_seq: int | None,
        limit: int | None,
    ) -> AsyncIterator[dict[str, Any]]:
        for event in await self._scan_values(session_id, from_seq, limit):
            yield event

    def scan(
        self,
        *,
        session_id: str | None = None,
        from_seq: int | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        return self._scan_iterator(session_id, from_seq, limit)

    async def head(self, session_id: str) -> int:
        if not isinstance(session_id, str):
            raise StoreInputError("session_id must be a string")
        async with self._lock:
            return len(self._streams.get(session_id, ()))

    async def _watch_iterator(self, session_id: str | None) -> AsyncIterator[None]:
        queue: asyncio.Queue[None] = asyncio.Queue(maxsize=1)
        entry = (session_id, queue)
        self._watchers.add(entry)
        try:
            while True:
                await queue.get()
                yield None
        finally:
            self._watchers.discard(entry)

    def watch(self, *, session_id: str | None = None) -> AsyncIterator[None]:
        return self._watch_iterator(session_id)

    async def acquire_lease(self, session_id: str, owner: str) -> _Lease | None:
        if not isinstance(session_id, str) or not isinstance(owner, str) or not owner:
            raise StoreInputError("session_id and owner must be strings, and owner must not be empty")
        async with self._lock:
            if session_id in self._leases:
                return None
            token = self._generations.get(session_id, 0) + 1
            self._generations[session_id] = token
            lease = _Lease(self, session_id, owner, token)
            self._leases[session_id] = lease
            return lease

    async def delete_session(self, session_id: str, *, token: int) -> None:
        _positive_integer(token, "token")
        async with self._lock:
            active = self._leases.get(session_id)
            generation = self._generations.get(session_id, 0)
            if active is None or active.token != token or token != generation:
                raise StoreConflictError("the fencing token is not current")
            self._streams.pop(session_id, None)
            self._writes.pop(session_id, None)
            self._leases.pop(session_id, None)
            active._released = True


# 런타임을 저널 기록으로 옮기는 동안 사용하는 비공개 투영 캐시입니다. 공개 저장소
# 계약에는 포함되지 않으며 정본은 언제나 ``Store``의 이벤트 스트림입니다.
class _ConversationProjection:
    def __init__(self) -> None:
        self.conversations: dict[tuple[str, str], list[dict[str, Any]]] = {}

    async def load(self, session_id: str, agent: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self.conversations.get((session_id, agent), []))

    async def append(self, session_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
        self.conversations.setdefault((session_id, agent), []).extend(copy.deepcopy(messages))

    async def replace(self, session_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
        self.conversations[(session_id, agent)] = copy.deepcopy(messages)

    async def delete_session(self, session_id: str) -> None:
        self.conversations = {key: value for key, value in self.conversations.items() if key[0] != session_id}


class _OperationProjection:
    def __init__(self) -> None:
        self.operations: dict[tuple[str, str], dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def list(self, session_id: str | None = None) -> list[dict[str, Any]]:
        return copy.deepcopy([value for (sid, _), value in self.operations.items() if session_id is None or sid == session_id])

    async def get(self, session_id: str, operation_id: str) -> dict[str, Any] | None:
        return copy.deepcopy(self.operations.get((session_id, operation_id)))

    async def save(self, operation: dict[str, Any]) -> None:
        async with self._lock:
            self.operations[(operation["sessionId"], operation["operationId"])] = copy.deepcopy(operation)

    async def transition(self, session_id: str, operation_id: str, expected: Sequence[str], updates: Mapping[str, Any]) -> dict[str, Any] | None:
        async with self._lock:
            current = self.operations.get((session_id, operation_id))
            if current is None or current.get("status") not in expected:
                return None
            changed = {**current, **copy.deepcopy(dict(updates))}
            self.operations[(session_id, operation_id)] = changed
            return copy.deepcopy(changed)

    async def claim_delivery(self, session_id: str, operation_id: str, updated_at: int) -> dict[str, Any] | None:
        async with self._lock:
            current = self.operations.get((session_id, operation_id))
            if current is None or current.get("deliveryStatus") != "pending":
                return None
            changed = {**current, "deliveryStatus": "delivering", "updatedAt": updated_at}
            self.operations[(session_id, operation_id)] = changed
            return copy.deepcopy(changed)

    async def release_delivery(self, session_id: str, operation_id: str, delivery_id: str, updated_at: int) -> dict[str, Any] | None:
        async with self._lock:
            current = self.operations.get((session_id, operation_id))
            if current is None or current.get("deliveryId") != delivery_id or current.get("deliveryStatus") != "delivering":
                return None
            changed = {**current, "deliveryStatus": "pending", "updatedAt": updated_at}
            self.operations[(session_id, operation_id)] = changed
            return copy.deepcopy(changed)


__all__ = [
    "InMemoryStore",
    "Lease",
    "Store",
    "StoreConflictError",
    "StoreError",
    "StoreInputError",
]
