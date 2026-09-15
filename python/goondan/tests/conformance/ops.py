"""The closed operation library the case files use.

Value operations run anywhere a case can put an operation. Hook operations additionally
use the hook context, so they only run inside an extension instance hook. Every error an
operation raises is a script error, which is what the step `scriptError` expectation
compares.
"""

from __future__ import annotations

import copy
import inspect
from typing import Any, Callable, Mapping

from .errors import CaseFailure, ScriptError, UnsupportedFeature
from .gates import GateOwner, Gates
from .jsonptr import MISSING, parse_pointer, pointer_get, pointer_set, PointerError
from .values import json_equal, merge_values

VALUE_OP_NAMES = frozenset(
    ("identity", "constant", "get", "set", "merge", "wrap", "equals", "text", "textSuffix", "result",
     "sequence", "chain", "throw", "await", "nonJson")
)
HOOK_OP_NAMES = frozenset(("append", "runAgent", "runModel", "render", "complete"))


async def resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def member(holder: Any, name: str, feature: str) -> Any:
    """Read a context member by its Python name, or fail as an unsupported host API."""
    if isinstance(holder, Mapping):
        if name in holder:
            return holder[name]
    elif hasattr(holder, name):
        return getattr(holder, name)
    raise UnsupportedFeature(feature)


def _text_of(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping) and isinstance(value.get("content"), list):
        return "".join(part.get("text", "") for part in value["content"]
                       if isinstance(part, Mapping) and part.get("type") == "text")
    raise ScriptError(f"the text operation needs a string or a value with content, got {type(value).__name__}")


class HookBridge:
    """The hook context a hook operation uses, read with the Python member names."""

    def __init__(self, context: Any, report: Callable[[str], None] | None = None):
        self.context = context
        self.report = report

    def _member(self, holder: Any, name: str, feature: str) -> Any:
        try:
            return member(holder, name, feature)
        except UnsupportedFeature:
            if self.report is not None:
                self.report(feature)
            raise

    async def append(self, messages: list[Mapping[str, Any]]) -> Any:
        builder = self._member(self.context, "message", "hook context 'message'")
        append = self._member(self.context, "append", "hook context 'append'")
        built = []
        for item in messages:
            extra = {key: item[key] for key in ("key", "keep", "meta") if key in item}
            factory = self._member(builder, item["role"], f"hook context message.{item['role']}")
            built.append(await resolve(factory(item["text"], **extra)))
        return await resolve(append(*built))

    async def run_agent(self, name: str, value: Any) -> Any:
        return await resolve(self._member(self.context, "run_agent", "hook context 'run_agent'")(name, value))

    async def run_model(self, messages: Any) -> Any:
        return await resolve(self._member(self.context, "run_model", "hook context 'run_model'")(messages))

    async def render(self, template: str, variables: Mapping[str, Any]) -> Any:
        return await resolve(self._member(self.context, "render", "hook context 'render'")(template, variables))

    async def complete(self, message: Mapping[str, Any]) -> Any:
        execution = self._member(self.context, "execution", "hook context 'execution'")
        return await resolve(self._member(execution, "complete", "hook context 'execution.complete'")(message))


class OpRunner:
    """Runs operations for one case; the `sequence` counters are shared across runtimes."""

    def __init__(self, gates: Gates):
        self.gates = gates
        self.counters: dict[str, int] = {}

    async def run(self, op: Mapping[str, Any], value: Any, *, site: str, owner: GateOwner, hook: HookBridge | None = None) -> Any:
        name = op["op"]
        if name in HOOK_OP_NAMES and hook is None:
            raise CaseFailure(f"the operation {name!r} at {site} needs a hook context")
        if name not in VALUE_OP_NAMES and name not in HOOK_OP_NAMES:
            raise CaseFailure(f"unknown operation {name!r} at {site}")
        return await getattr(self, f"_op_{name.lower()}")(op, value, site, owner, hook)

    # -- value operations ----------------------------------------------------------------

    async def _op_identity(self, op, value, site, owner, hook):
        return value

    async def _op_constant(self, op, value, site, owner, hook):
        return copy.deepcopy(op["value"])

    async def _op_get(self, op, value, site, owner, hook):
        found = pointer_get(value, self._segments(op["path"]))
        return None if found is MISSING else copy.deepcopy(found)

    async def _op_set(self, op, value, site, owner, hook):
        try:
            return pointer_set(value, self._segments(op["path"]), op["value"])
        except PointerError as error:
            raise ScriptError(str(error)) from error

    async def _op_merge(self, op, value, site, owner, hook):
        if not isinstance(value, Mapping):
            raise ScriptError("the merge operation needs an object")
        return merge_values(copy.deepcopy(value), copy.deepcopy(op["value"]))

    async def _op_wrap(self, op, value, site, owner, hook):
        return {op["key"]: copy.deepcopy(value), **copy.deepcopy(op.get("with", {}))}

    async def _op_equals(self, op, value, site, owner, hook):
        if "path" in op:
            found = pointer_get(value, self._segments(op["path"]))
            value = None if found is MISSING else found
        return json_equal(value, op["value"])

    async def _op_text(self, op, value, site, owner, hook):
        return _text_of(value)

    async def _op_textsuffix(self, op, value, site, owner, hook):
        return _text_of(value) + op["suffix"]

    async def _op_result(self, op, value, site, owner, hook):
        if not isinstance(value, Mapping) or not isinstance(value.get("id"), str) or not isinstance(value.get("name"), str):
            raise ScriptError("the result operation needs a tool call with a string id and name")
        result = {"callId": value["id"], "name": value["name"], "args": copy.deepcopy(value.get("args")),
                  "content": copy.deepcopy(op["content"])}
        if "isError" in op:
            result["isError"] = op["isError"]
        return {"result": result}

    async def _op_sequence(self, op, value, site, owner, hook):
        used = self.counters.get(site, 0)
        self.counters[site] = used + 1
        index = min(used, len(op["items"]) - 1)
        return await self.run(op["items"][index], value, site=f"{site}/items/{index}", owner=owner, hook=hook)

    async def _op_chain(self, op, value, site, owner, hook):
        for index, item in enumerate(op["ops"]):
            value = await self.run(item, value, site=f"{site}/ops/{index}", owner=owner, hook=hook)
        return value

    async def _op_throw(self, op, value, site, owner, hook):
        raise ScriptError(op["message"])

    async def _op_await(self, op, value, site, owner, hook):
        await self.gates.wait(op["gate"], owner)
        follow = op.get("then", {"op": "identity"})
        return await self.run(follow, value, site=f"{site}/then", owner=owner, hook=hook)

    async def _op_nonjson(self, op, value, site, owner, hook):
        return float("nan")

    # -- hook operations -----------------------------------------------------------------

    async def _op_append(self, op, value, site, owner, hook):
        return await hook.append(op["messages"])

    async def _op_runagent(self, op, value, site, owner, hook):
        await hook.run_agent(op["name"], copy.deepcopy(op["input"]) if "input" in op else value)
        return None

    async def _op_runmodel(self, op, value, site, owner, hook):
        await hook.run_model(copy.deepcopy(op["messages"]))
        return None

    async def _op_render(self, op, value, site, owner, hook):
        return await hook.render(op["template"], copy.deepcopy(op.get("variables", {})))

    async def _op_complete(self, op, value, site, owner, hook):
        if "tool" in op and not (isinstance(value, Mapping) and value.get("name") == op["tool"]):
            return None
        message = copy.deepcopy(op["message"])
        if op.get("useResultContent") is True:
            message["content"] = copy.deepcopy(value.get("content")) if isinstance(value, Mapping) else None
        await hook.complete(message)
        return None

    @staticmethod
    def _segments(pointer: str) -> list[str]:
        try:
            return parse_pointer(pointer)
        except PointerError as error:
            raise ScriptError(str(error)) from error
