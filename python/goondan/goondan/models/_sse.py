"""§스트리밍: the incremental server-sent events parser."""

from __future__ import annotations

import codecs

_LINE_FEED = "\n"
_CARRIAGE_RETURN = "\r"


class SseParser:
    """Returns the `data` of every finished event.

    - Body chunks are decoded as one UTF-8 stream, so a character may be split across chunks.
    - Lines end with `\\r\\n`, `\\n` or `\\r`; a chunk ending in `\\r` waits for the next chunk.
    - Lines starting with `:` are comments. Multiple `data` lines are joined with `\\n`.
      `event`, `id` and `retry` fields are ignored.
    - A blank line ends an event. `end()` also dispatches a last event with no blank line after it.
    """

    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._buffer = ""
        self._data: list[str] = []

    def push(self, chunk: bytes) -> list[str]:
        return self._consume(self._decoder.decode(chunk), False)

    def end(self) -> list[str]:
        return self._consume(self._decoder.decode(b"", True), True)

    def _consume(self, text: str, final: bool) -> list[str]:
        events: list[str] = []
        previous = self._buffer
        buffer = previous + text
        # The kept buffer holds no line break except possibly a trailing `\r`.
        index = len(previous) - 1 if previous.endswith(_CARRIAGE_RETURN) else len(previous)
        start = 0
        while index < len(buffer):
            character = buffer[index]
            if character not in (_LINE_FEED, _CARRIAGE_RETURN):
                index += 1
                continue
            if character == _CARRIAGE_RETURN and index + 1 == len(buffer) and not final:
                break
            self._line(buffer[start:index], events)
            index += 2 if character == _CARRIAGE_RETURN and buffer[index + 1:index + 2] == _LINE_FEED else 1
            start = index
        self._buffer = buffer[start:]
        if final:
            if self._buffer != "":
                self._line(self._buffer, events)
            self._buffer = ""
            self._dispatch(events)
        return events

    def _line(self, line: str, events: list[str]) -> None:
        if line == "":
            self._dispatch(events)
            return
        if line.startswith(":"):
            return
        colon = line.find(":")
        field = line if colon == -1 else line[:colon]
        if field != "data":
            return
        value = "" if colon == -1 else line[colon + 1:]
        self._data.append(value[1:] if value.startswith(" ") else value)

    def _dispatch(self, events: list[str]) -> None:
        if not self._data:
            return
        events.append(_LINE_FEED.join(self._data))
        self._data = []
