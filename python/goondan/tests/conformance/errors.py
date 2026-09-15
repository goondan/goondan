"""Failure kinds the runner tells apart.

`CaseFormatError` and `CaseFailure` both fail a case. `UnsupportedFeature` fails a case
with the `unsupported by Python runner: <feature>` message the README requires; the
runner never skips a case and never marks a failure as expected. `ScriptError` is the
error a case script raises on purpose, so the runner can recognise it again when it
comes back out of a step.
"""

from __future__ import annotations

LANGUAGE = "Python"


class CaseFormatError(Exception):
    """`case.json` or `expected.json` does not follow the fixture format."""

    def __init__(self, problems: list[str]):
        super().__init__("\n".join(problems))
        self.problems = list(problems)


class CaseFailure(Exception):
    """The case ran but did not satisfy the contract."""


class UnsupportedFeature(Exception):
    """The Python host has no API or option for a part of the case."""

    def __init__(self, feature: str):
        super().__init__(f"unsupported by {LANGUAGE} runner: {feature}")
        self.feature = feature


class ScriptError(Exception):
    """An error a model, tool, function, hook or host callback script raised on purpose."""

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.script_message = message
        if code is not None:
            self.code = code
