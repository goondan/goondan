"""Public data types, protocols, type aliases and errors shared by the Goondan Python host."""

from __future__ import annotations

import asyncio
import copy
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence

if TYPE_CHECKING:
    from .runtime import Goondan

Json = None | bool | int | float | str | list["Json"] | dict[str, "Json"]
ValueName = str
VALUE_NAMES = {"onInput", "onPrompt", "onStep", "onModelInput", "onModelResult", "onToolCall", "onToolResult", "onOutput", "onError"}


class GoondanError(Exception):
    pass


class GoondanExecutionError(GoondanError):
    """§실행 오류: a failed agent run, carrying the execution error as attributes.

    The same value is what the `error` stage receives and what the failing turn raises, so
    `value()` renders it once for both. Python spells `toolCall` as `tool_call`.
    """

    def __init__(self, where: str, codes: Sequence[str], message: str, attempt: int = 1, tool_call: Mapping[str, Any] | None = None, cause: BaseException | None = None):
        super().__init__(message)
        self.where = where
        self.codes = [str(code) for code in codes]
        self.message = message
        self.attempt = attempt
        self.tool_call = dict(tool_call) if tool_call is not None else None
        self.cause = cause

    def value(self) -> dict[str, Any]:
        found: dict[str, Any] = {"where": self.where, "codes": list(self.codes), "message": self.message, "attempt": self.attempt}
        if self.tool_call is not None:
            found["toolCall"] = copy.deepcopy(self.tool_call)
        return found


class GoondanAbortError(GoondanError):
    """§실행 중단: 호스트가 `abort(session_id)` 또는 `close()`로 중단한 실행이다.

    The run fails with `where` `runtime` and `codes` `["aborted"]`, never reaches the
    `error` stage, and is never turned into a tool or hook failure. The error carries the
    same members as an execution error, and no `tool_call`, so that a host reads every
    failed run the same way.
    """

    def __init__(self, message: str):
        super().__init__(message)
        self.where = "runtime"
        self.codes = ["aborted"]
        self.message = message
        self.attempt = 1
        self.tool_call: dict[str, Any] | None = None

    def value(self) -> dict[str, Any]:
        return {"where": self.where, "codes": list(self.codes), "message": self.message, "attempt": self.attempt}


class GoondanConfigError(GoondanError):
    """A configuration, template or host binding that does not satisfy the specification.

    `issues` holds one `{code, path, message}` entry per violation, sorted by position
    and de-duplicated. `raw_issues` keeps the same entries with their path segments.
    """

    def __init__(self, issues: Sequence[Mapping[str, Any]]):
        from ._schema import issue as _issue, report as _report

        raw = [_issue(item["code"], item.get("segments", ()), item["message"]) for item in issues]
        reported = _report(raw)
        super().__init__("Invalid Goondan configuration:\n" + "\n".join(
            f"- {entry['path'] or '(root)'}: {entry['message']} [{entry['code']}]" for entry in reported
        ))
        self.issues = reported
        self.raw_issues = raw


class GoondanConfig(dict[str, Any]):
    """Effective Goondan configuration with everything `load_config` read for it.

    `templates` maps the absolute path of every declared template and every file it
    statically includes to the file's text, so a runtime built from this result never
    reads a template file again. It is `None` when no file was read, as after
    `validate_config`.
    """

    directory: str | None = None
    templates: dict[str, str] | None = None


def _message(role: str, text: str, source: str) -> dict[str, Any]:
    """§단계 값과 대화 저장: a new message with one `text` part and no optional field."""
    return {"id": uuid.uuid4().hex, "role": role, "content": [{"type": "text", "text": text}], "source": source}


@dataclass(frozen=True)
class Append:
    append: list[dict[str, Any]]


@dataclass
class Extension:
    hooks: dict[str, Callable[..., Any]] = field(default_factory=dict)
    tools: list["Tool"] = field(default_factory=list)
    on: dict[str, Callable[..., Any]] = field(default_factory=dict)
    dispose: Callable[[], Any] | None = None


@dataclass(frozen=True)
class ExtensionDefinition:
    """`hooks` and `tools` are the value stages and tool names the extension declares it provides.

    A list with at least one entry counts as a declaration, and the binding phase checks it.
    An empty list defers the check to the moment the extension instance is created.
    """

    name: str
    create: Callable[..., Extension]
    hooks: tuple[str, ...] = ()
    tools: tuple[str, ...] = ()
    requires: tuple[str, ...] = ()
    validate_options: Callable[[Any], Any] | None = None


def define_extension(*, name: str, create: Callable[..., Extension], hooks: Sequence[str] = (), tools: Sequence[str] = (), requires: Sequence[str] = (), validate_options: Callable[[Any], Any] | None = None) -> ExtensionDefinition:
    return ExtensionDefinition(name, create, tuple(hooks), tuple(tools), tuple(requires), validate_options)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input: Mapping[str, Any]
    execute: Callable[..., Any]


def define_tool(*, name: str, description: str, input: Mapping[str, Any], execute: Callable[..., Any]) -> Tool:
    return Tool(name, description, input, execute)


class _Messages:
    """§훅 컨텍스트와 호스트 함수: `message.user(text, extra)` and `message.system(text, extra)`.

    `extra` names the optional fields the new message carries; it may be a mapping or the
    same names as keyword arguments. A field the caller did not name is left out.
    """

    def __init__(self, source: str): self._source = source

    def _made(self, role: str, text: str, extra: Mapping[str, Any] | None, named: Mapping[str, Any]) -> dict[str, Any]:
        fields = {**(extra or {}), **named}
        message = _message(role, text, self._source)
        for key in ("key", "keep", "meta"):
            if key in fields:
                message[key] = copy.deepcopy(fields[key])
        return message

    def user(self, text: str, extra: Mapping[str, Any] | None = None, **named: Any) -> dict[str, Any]: return self._made("user", text, extra, named)
    def system(self, text: str, extra: Mapping[str, Any] | None = None, **named: Any) -> dict[str, Any]: return self._made("system", text, extra, named)


@dataclass
class Completion:
    """§`execution.complete`: the message one agent run scheduled, if any.

    `effective` is false while an approved operation runs, because that execution has no
    agent run to end: a valid call is accepted and then has no effect.
    """

    message: dict[str, Any] | None = None
    effective: bool = True


@dataclass
class ExecutionHandle:
    """The `execution` member of one hook invocation.

    Only a synchronous `toolResult` extension hook may schedule a message, and only while
    its own call has not returned or failed, so the permission belongs to the invocation
    rather than to the turn.
    """

    _completion: Completion
    _allowed: bool = False
    _active: bool = True

    def complete(self, message: Mapping[str, Any]) -> None:
        if not self._allowed or not self._active:
            raise GoondanError("execution.complete is available while a synchronous toolResult extension hook runs")
        if not isinstance(message, Mapping) or message.get("role") != "assistant":
            raise GoondanError("execution.complete needs an assistant message")
        if not isinstance(message.get("id"), str) or not isinstance(message.get("source"), str) or not isinstance(message.get("content"), list):
            raise GoondanError("execution.complete needs a message with a string id, a string source and an array content")
        if self._completion.message is not None:
            raise GoondanError("this agent run already scheduled a message")
        self._completion.message = copy.deepcopy(dict(message))


class NoLog:
    """§확장 인스턴스: the logger an extension receives when the host injected none."""

    def info(self, message: str, fields: Mapping[str, Any] | None = None) -> None: ...
    def warn(self, message: str, fields: Mapping[str, Any] | None = None) -> None: ...
    def error(self, message: str, fields: Mapping[str, Any] | None = None) -> None: ...


@dataclass(frozen=True)
class ModelContext:
    """§모델 호출: what a model implementation receives beside the model input.

    A model implementation is a callable `generate(model_input, ctx)` on an object, or a
    plain callable that takes the model input alone. Python has no `signal` member: the
    runtime cancels the task that runs the model call instead.
    """

    agent: str
    session_id: str
    turn_id: str
    instance: str
    execution_id: str
    parent_execution_id: str | None
    operation_id: str | None
    cancelled: bool
    log: Any
    step: int
    on_text_delta: Callable[[str], None]


class HookContext:
    """§훅 컨텍스트와 호스트 함수.

    공개 멤버는 두 호스트가 공유하는 규격을 따릅니다. 런타임 참조와 훅 식별자처럼
    Python 구현에만 필요한 상태는 밑줄로 시작하는 비공개 멤버에 둡니다.
    """

    agent: str
    session_id: str
    turn_id: str
    instance: str
    execution_id: str
    parent_execution_id: str | None
    operation_id: str | None
    input_kind: str | None
    step: int | None
    retry_count: int
    input: list[dict[str, Any]]
    conversation: list[dict[str, Any]]
    execution: ExecutionHandle
    log: Any

    def __init__(
        self,
        *,
        runtime: "Goondan",
        agent: str,
        session_id: str,
        turn_id: str,
        instance: str,
        execution_id: str,
        parent_execution_id: str | None,
        operation_id: str | None,
        input_kind: str | None,
        step: int | None,
        retry_count: int,
        input: list[dict[str, Any]],
        conversation: list[dict[str, Any]],
        execution: ExecutionHandle,
        log: Any,
        source: str,
        cancelled: Callable[[], bool],
        run_state: Any,
    ) -> None:
        self.agent = agent
        self.session_id = session_id
        self.turn_id = turn_id
        self.instance = instance
        self.execution_id = execution_id
        self.parent_execution_id = parent_execution_id
        self.operation_id = operation_id
        if input_kind is not None:
            self.input_kind = input_kind
        self.step = step
        self.retry_count = retry_count
        self.input = input
        self.conversation = conversation
        self.execution = execution
        self.log = log
        self._runtime = runtime
        self._source = source
        self._cancelled = cancelled
        self._run_state = run_state
        self._detached = False

    @property
    def cancelled(self) -> bool:
        """런타임이나 현재 asyncio 작업이 이 훅에 취소를 알렸는지 반환합니다."""
        task = asyncio.current_task()
        return self._cancelled() or (task is not None and task.cancelling() > 0)

    @property
    def message(self) -> _Messages: return _Messages(self._source)

    def append(self, *items: Mapping[str, Any]) -> dict[str, Any]:
        """§제어 결과: the `append` control result carrying these messages."""
        return {"append": [copy.deepcopy(dict(item)) for item in items]}

    async def run_agent(self, name: str, value: Json) -> dict[str, Any]:
        return await self._runtime._run_hook_agent(self, name, value)

    async def run_model(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._runtime._run_hook_model(self, messages)

    async def render(self, template: str, variables: Mapping[str, Any]) -> str:
        return self._runtime.render(template, variables)
