"""Section headings of `spec/goondan.md` and the coverage check over the cases.

A case cites the heading text exactly as the specification writes it, backticks
included. The coverage check fails on an uncited heading, an unknown citation and a
heading the specification repeats.
"""

from __future__ import annotations

import re
from typing import Iterable, Mapping, Sequence

HEADING = re.compile(r"^(#{2,4})\s+(.+?)\s*$")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")


def spec_headings(markdown: str) -> list[str]:
    """Return the `##`, `###` and `####` headings outside fenced code blocks, in order."""
    headings: list[str] = []
    fence: str | None = None
    for line in markdown.splitlines():
        opened = FENCE.match(line)
        if fence is not None:
            if opened and opened.group(1)[0] == fence[0] and len(opened.group(1)) >= len(fence):
                fence = None
            continue
        if opened:
            fence = opened.group(1)
            continue
        match = HEADING.match(line)
        if match:
            headings.append(match.group(2))
    return headings


def duplicate_headings(headings: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for heading in headings:
        if heading in seen and heading not in duplicates:
            duplicates.append(heading)
        seen.add(heading)
    return duplicates


def coverage_problems(headings: Sequence[str], citations: Mapping[str, Iterable[str]]) -> list[str]:
    """Report headings no case cites, citations the specification does not have and duplicates."""
    problems = [f"the specification repeats the heading {heading!r}" for heading in duplicate_headings(headings)]
    known = set(headings)
    cited: set[str] = set()
    for case, entries in sorted(citations.items()):
        for entry in entries:
            cited.add(entry)
            if entry not in known:
                problems.append(f"case {case!r} cites {entry!r}, which is not a heading of the specification")
    reported: set[str] = set()
    for heading in headings:
        if heading not in cited and heading not in reported:
            reported.add(heading)
            problems.append(f"no case cites the heading {heading!r}")
    return problems
