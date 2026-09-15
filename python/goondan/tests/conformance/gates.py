"""Named signals that fix the order of the asynchronous parts of a case.

Every gate starts closed and stays open once released. A wait ends when the gate opens,
when the runtime that owns the waiting call is closed, or when the case ends; the last
two end the wait as a cancellation.
"""

from __future__ import annotations

import asyncio

NEVER = "never"


class GateOwner:
    """The runtime a waiting call belongs to; closing the runtime ends its waits."""

    def __init__(self, label: str):
        self.label = label
        self.stopped = asyncio.Event()

    def stop(self) -> None:
        self.stopped.set()


class GateCancelled(asyncio.CancelledError):
    pass


class Gates:
    def __init__(self) -> None:
        self._open: dict[str, asyncio.Event] = {}
        self._reached: dict[str, asyncio.Event] = {}
        self.finished = asyncio.Event()

    @staticmethod
    def _slot(table: dict[str, asyncio.Event], name: str) -> asyncio.Event:
        if name not in table:
            table[name] = asyncio.Event()
        return table[name]

    def is_open(self, name: str) -> bool:
        return name in self._open and self._open[name].is_set()

    def release(self, name: str) -> None:
        if name == NEVER:
            raise ValueError("the gate 'never' is reserved and cannot be released")
        self._slot(self._open, name).set()

    async def reach(self, name: str) -> None:
        """Wait until at least one call has started waiting on `name` since the case began."""
        await self._slot(self._reached, name).wait()

    async def wait(self, name: str, owner: GateOwner) -> None:
        gate = self._slot(self._open, name)
        self._slot(self._reached, name).set()
        if gate.is_set():
            return
        waits = [asyncio.ensure_future(event.wait()) for event in (gate, owner.stopped, self.finished)]
        try:
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for pending in waits:
                pending.cancel()
        if not gate.is_set():
            raise GateCancelled(f"the wait on the gate {name!r} ended before it opened")

    def finish(self) -> None:
        self.finished.set()
