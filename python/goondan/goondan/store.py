"""In-memory implementations of the conversation and operation store protocols."""

from __future__ import annotations

import asyncio
import copy
import time
from typing import Any, Mapping, Sequence


TERMINAL_STATUSES = frozenset({"completed", "rejected", "cancelled", "failed"})


def _now() -> int:
    """§작업 기록과 상태: milliseconds since 1970-01-01T00:00:00Z."""
    return int(time.time() * 1000)


class InMemoryOperationStore:
    """§작업 저장소 프로토콜: operations kept in memory, in creation order.

    One lock guards the transition, the delivery claim and the delivery release, so a
    decision and a cancellation that arrive together change the operation only once. The
    store never invents a field: `updatedAt` is whatever the caller passed, and confirming
    a delivery is a transition rather than a request of its own.
    """

    def __init__(self) -> None:
        self.operations: dict[tuple[str, str], dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def list(self, session_id: str | None = None) -> list[dict[str, Any]]:
        return copy.deepcopy([value for (sid, _), value in self.operations.items() if session_id is None or sid == session_id])

    async def get(self, session_id: str, operation_id: str) -> dict[str, Any] | None:
        return copy.deepcopy(self.operations.get((session_id, operation_id)))

    async def save(self, operation: dict[str, Any]) -> None:
        operation_id = str(operation["operationId"])
        async with self._lock:
            self.operations[(operation["sessionId"], operation_id)] = copy.deepcopy(operation)

    async def transition(self, session_id: str, operation_id: str, expected: Sequence[str], updates: Mapping[str, Any]) -> dict[str, Any] | None:
        """Overwrite the given fields while the stored `status` is one of the expected ones."""
        async with self._lock:
            current = self.operations.get((session_id, operation_id))
            if current is None or current.get("status") not in expected:
                return None
            return self._write(session_id, operation_id, {**current, **copy.deepcopy(dict(updates))})

    async def claim_delivery(self, session_id: str, operation_id: str, updated_at: int) -> dict[str, Any] | None:
        """Take the one completion delivery: `pending` → `delivering`."""
        async with self._lock:
            current = self.operations.get((session_id, operation_id))
            if current is None or current.get("deliveryStatus") != "pending":
                return None
            return self._write(session_id, operation_id, {**current, "deliveryStatus": "delivering", "updatedAt": updated_at})

    async def release_delivery(self, session_id: str, operation_id: str, delivery_id: str, updated_at: int) -> dict[str, Any] | None:
        """Give this delivery back: `delivering` → `pending`, for the claimed `deliveryId` only."""
        async with self._lock:
            current = self.operations.get((session_id, operation_id))
            if current is None or current.get("deliveryId") != delivery_id or current.get("deliveryStatus") != "delivering":
                return None
            return self._write(session_id, operation_id, {**current, "deliveryStatus": "pending", "updatedAt": updated_at})

    def _write(self, session_id: str, operation_id: str, operation: dict[str, Any]) -> dict[str, Any]:
        self.operations[(session_id, operation_id)] = operation
        return copy.deepcopy(operation)


class InMemoryConversationStore:
    """§실행 범위: 세션 식별자와 에이전트 이름의 조합마다 대화 하나를 보관한다.

    두 값을 문자열로 합치지 않고 튜플을 키로 사용하며, 저장한 메시지는 같은 JSON 값으로
    복사하여 돌려준다.
    """

    def __init__(self) -> None:
        self.conversations: dict[tuple[str, str], list[dict[str, Any]]] = {}

    async def load(self, session_id: str, agent: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self.conversations.get((session_id, agent), []))

    async def append(self, session_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
        self.conversations.setdefault((session_id, agent), []).extend(copy.deepcopy(messages))

    async def replace(self, session_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
        self.conversations[(session_id, agent)] = copy.deepcopy(messages)

    async def delete_session(self, session_id: str) -> None:
        prefix = f"{session_id}#"
        self.conversations = {
            key: value
            for key, value in self.conversations.items()
            if key[0] != session_id and not key[0].startswith(prefix)
        }
