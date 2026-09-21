"""Runtime execution: extension instances, value-stage hooks, the model and tool loop, route processing and operations."""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, Sequence

from . import _schema
from ._schema import issue as _issue
from ._json import json_text
from ._values import (
    USAGE_KEYS,
    Control,
    append_messages,
    control_result,
    input_text,
    is_json,
    is_message,
    is_message_array,
    is_part,
    output_text,
    result_text,
    stage_error,
)
from .config import _merge, binding_issues, hook_identifier, prepare_config
from ._schema import json_equal
from .fold import fold
from .store import InMemoryStore, Store, StoreError, _ConversationProjection, _OperationProjection, _now
from .template import TemplateRenderer
from .types import (
    Append,
    Completion,
    ExecutionHandle,
    Extension,
    ExtensionDefinition,
    GoondanAbortError,
    GoondanConfigError,
    GoondanError,
    GoondanExecutionError,
    HookContext,
    Json,
    ModelContext,
    NoLog,
    Tool,
    ValueName,
    _message,
)

TERMINAL_STATUSES = frozenset({"completed", "rejected", "cancelled", "failed"})


def _consume_task_result(task: asyncio.Task[Any]) -> None:
    """호스트 대기자가 없는 내부 턴의 예외를 이벤트 루프에서 회수합니다."""
    if not task.cancelled():
        task.exception()

# §인라인 훅: an `fn` that returned nothing ends the hook without a result.
_NOTHING = object()
_SKIPPED = object()
_SCHEDULED = object()


async def _await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _model_codes(error: BaseException) -> list[str]:
    """§모델 실패: `model_error`, followed by the code the model implementation set on the error.

    Only a model call adds a second code. A failed tool implementation is always
    `["tool_error"]`, whatever attributes its exception carries ([§도구](spec),
    [§이벤트 종류](spec)).
    """
    code = getattr(error, "code", None)
    return ["model_error", code] if isinstance(code, str) and code else ["model_error"]


def _route_error(message: str) -> GoondanExecutionError:
    """§흐름: 에이전트 실행 밖에서 발생한 route 오류다."""
    return GoondanExecutionError("runtime", ["route_error"], message)


def _usage() -> dict[str, float]:
    return {key: 0 for key in USAGE_KEYS}


def _usage_of(result: Mapping[str, Any]) -> dict[str, float]:
    """§사용량 집계: the usage of one model result, with every omitted key counted as 0."""
    reported = result.get("usage")
    found = reported if isinstance(reported, Mapping) else {}
    return {key: found.get(key, 0) for key in USAGE_KEYS}


@dataclass
class _Lineage:
    """실행의 직접 원인과 군단 턴 식별자입니다."""

    parent_execution_id: str | None
    operation_id: str | None
    turn_id: str


@dataclass
class _ActiveAgent:
    """stateful 인스턴스에서 현재 입력을 소비하는 실행입니다."""

    execution_id: str
    task: asyncio.Task[dict[str, Any]]
    requests: int = 1
    accepting: bool = True


@dataclass
class _RunRecord:
    """§에이전트 실행 기록: one entry of a turn result's `runs`.

    `children` holds the records of the runs this one started, in starting order, so that
    the turn lists them by a pre-order walk of the tree.
    """

    agent: str
    instance: str
    execution_id: str
    turn_id: str
    lineage: _Lineage
    kind: str
    usage: dict[str, float] = field(default_factory=_usage)
    status: str = "failed"
    finish_reason: str | None = None
    children: list["_RunRecord"] = field(default_factory=list)

    def value(self) -> dict[str, Any]:
        found: dict[str, Any] = {
            "agent": self.agent,
            "instance": self.instance,
            "executionId": self.execution_id,
            "turnId": self.turn_id,
            "kind": self.kind,
            "usage": dict(self.usage),
        }
        if self.lineage.parent_execution_id is not None:
            found["parentExecutionId"] = self.lineage.parent_execution_id
        if self.lineage.operation_id is not None:
            found["operationId"] = self.lineage.operation_id
        if self.finish_reason is not None:
            found["finishReason"] = self.finish_reason
        found["status"] = self.status
        return found


def _listed(records: Sequence[_RunRecord]) -> list[dict[str, Any]]:
    """§에이전트 실행 기록: each record followed by the records of the runs it started."""
    found: list[dict[str, Any]] = []
    for record in records:
        found.append(record.value())
        found.extend(_listed(record.children))
    return found


def _total_usage(records: Sequence[_RunRecord]) -> dict[str, float]:
    """§사용량 집계: the turn total, which is the sum of every run record's usage."""
    total = _usage()
    for record in records:
        for key in USAGE_KEYS:
            total[key] += record.usage[key]
        nested = _total_usage(record.children)
        for key in USAGE_KEYS:
            total[key] += nested[key]
    return total


def _execution_error(error: BaseException) -> dict[str, Any]:
    """§실행 오류: the execution error a failed agent run reports."""
    if isinstance(error, (GoondanAbortError, GoondanExecutionError)):
        return error.value()
    if isinstance(error, GoondanConfigError):
        return {"where": "runtime", "codes": [str(item["code"]) for item in error.issues], "message": str(error), "attempt": 1}
    return {"where": "runtime", "codes": ["runtime_error"], "message": str(error), "attempt": 1}


def _delivery_id(operation: Mapping[str, Any]) -> str:
    """§작업 저장소 프로토콜: the stored `deliveryId`, which every delivery return must name."""
    found = operation.get("deliveryId")
    return found if isinstance(found, str) else ""


def _completion_input(operation: Mapping[str, Any]) -> dict[str, Any]:
    """§완료 전달: the completion input of a terminal operation, with its keys in order."""
    completion: dict[str, Any] = {
        "type": "operation_completion",
        "deliveryId": str(operation["deliveryId"]),
        "operationId": str(operation["operationId"]),
        "sessionId": str(operation["sessionId"]),
        "agent": str(operation["agent"]),
        "turnId": str(operation["turnId"]),
        "instance": str(operation["instance"]),
        "executionId": str(operation["executionId"]),
        "status": str(operation["status"]),
        "toolCall": copy.deepcopy(operation["toolCall"]),
    }
    for key in ("result", "error", "errorCode"):
        if key in operation:
            completion[key] = copy.deepcopy(operation[key])
    return completion


def _claimed_result(output: Any) -> Mapping[str, Any]:
    """§단계 값과 대화 저장: the tool result one tool implementation's return value claims.

    A part array is the content of the result. A mapping with `content` is the tool result
    itself, so the `isError`, `keep` and `meta` it declared stay on the result. Any other value
    becomes one `json` part. The claim still goes through the `toolResult` value check, so a
    mapping whose `content` is no part array fails with `value_invalid`.
    """
    if isinstance(output, list) and all(is_part(item) for item in output):
        return {"content": output}
    if isinstance(output, Mapping) and "content" in output:
        return output
    return {"content": [{"type": "json", "value": output}]}


def _tool_result(call: Mapping[str, Any], claimed: Mapping[str, Any]) -> dict[str, Any]:
    """§단계 값과 대화 저장: the tool result of one call.

    The `name` and `args` of a tool result the runtime makes are the executed call's values and
    its `callId` is that call's `id`, so a claim only contributes the rest of the result.
    """
    result: dict[str, Any] = {"callId": call["id"], "name": call["name"], "args": call["args"]}
    for key, value in claimed.items():
        if key not in ("callId", "name", "args"):
            result[key] = copy.deepcopy(value)
    return result


def _tool_message(result: Mapping[str, Any]) -> dict[str, Any]:
    """§단계 값과 대화 저장: the tool result message one tool result becomes.

    `isError`, `keep` and `meta` move over when the tool result declared them; a field the
    result left out stays out of the message.
    """
    part: dict[str, Any] = {"type": "tool.result", "callId": result["callId"], "content": copy.deepcopy(result["content"])}
    if "isError" in result: part["isError"] = result["isError"]
    message: dict[str, Any] = {"id": uuid.uuid4().hex, "role": "tool", "source": "tool", "content": [part]}
    for key in ("keep", "meta"):
        if key in result: message[key] = copy.deepcopy(result[key])
    return message


@dataclass
class _AgentSession:
    """§확장 인스턴스: the state one execution scope keeps."""

    extensions: dict[str, Extension]
    tools: dict[str, Tool] = field(default_factory=dict)
    pending: dict[str, asyncio.Task[Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class _Scope:
    """§실행 중단, §실행 중 입력.

    `host`는 호스트가 요청한 세션 식별자이며, `abort(host)`가 턴이 시작한 모든 실행에
    도달하도록 한다. 비동기 훅과 승인 작업처럼 자체 수명을 가진 작업은 `None`을 쓴다.
    `foreground`는 steer 값을 받을 수 있는 흐름 실행을 표시한다.
    """

    host: str | None
    foreground: bool


@dataclass
class _JournalWriter:
    lease: Any
    expected: int
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    renewal: asyncio.Task[None] | None = None
    failure: GoondanExecutionError | None = None


@dataclass(eq=False)
class _Run:
    """One agent run or turn in progress, and the task that carries it."""

    task: "asyncio.Task[Any] | None"
    agent: str | None = None
    foreground: bool = False
    aborted: bool = False


@dataclass
class _RunState:
    """One model agent run: everything its value stages share."""

    agent_name: str
    session_id: str
    instance: str
    execution_id: str
    turn_id: str
    lineage: _Lineage
    session: _AgentSession
    scope: _Scope
    run: _Run | None
    agent_input: list[dict[str, Any]] | Json
    input_requests: list[list[dict[str, Any]]]
    conversation: list[dict[str, Any]]
    stateful: bool
    completion: Completion
    # §에이전트 실행 기록: this run's entry. The runs it starts become its children, so a
    # record that no turn collected keeps its whole subtree out of every turn result.
    record: _RunRecord
    recorded_conversation: list[dict[str, Any]] = field(default_factory=list)
    input_kind: str = "start"
    retry_count: int = 0
    step: int = 0
    # §이벤트 순서: the model call or tool execution to report as aborted if the run is stopped.
    in_flight: tuple[str, dict[str, Any]] | None = None

    def aborted(self) -> bool:
        return self.run is not None and self.run.aborted


class _Deltas:
    """§텍스트 조각: the `step.textDelta` events of one model call.

    The model implementation hands over chunks while it generates, so they are queued and
    reported by one task that keeps their order. Chunks that arrive after the call ended,
    after the run was aborted, or that are not strings are dropped.
    """

    def __init__(self, runtime: "Goondan", state: "_RunState", step: int):
        self._runtime, self._state, self._step = runtime, state, step
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._task = asyncio.create_task(self._forward())
        self._open = True

    def push(self, delta: Any) -> None:
        if not self._open or not isinstance(delta, str) or self._state.aborted():
            return
        self._queue.put_nowait(delta)

    async def _forward(self) -> None:
        while True:
            delta = await self._queue.get()
            if delta is None:
                return
            await self._runtime._emit(
                self._state.session, "step.textDelta", self._state.agent_name,
                self._state.session_id, self._state.turn_id, {"step": self._step, "delta": delta},
                instance=self._state.instance, lineage=self._state.lineage,
            )

    async def close(self) -> None:
        """Report every chunk received so far, so they all precede `step.done` or `step.error`."""
        self._open = False
        self._queue.put_nowait(None)
        await asyncio.wait({self._task})

    def cancel(self) -> None:
        self._open = False
        self._task.cancel()


@dataclass(frozen=True)
class _Approved:
    """§승인된 작업의 실행: what the checks before `running` resolved for one operation."""

    runtime: "Goondan"
    agent_name: str
    session: _AgentSession
    configured: Mapping[str, Any]


@dataclass
class _Stage:
    """The outcome of one value stage."""

    value: Any
    approvals: list[dict[str, Any]] = field(default_factory=list)
    execution: dict[str, Any] | None = None
    # §제어 결과: the `result` or `retry` that ended the stage before its remaining hooks.
    control: Control | None = None


class _Sessions:
    """군단 객체의 세션 관리 API다."""

    def __init__(self, goondan: "Goondan") -> None:
        self._goondan = goondan

    async def delete(self, session_id: str) -> None:
        await self._goondan._delete_session(session_id)


class _Operations:
    """저널의 승인 작업 뷰를 다루는 공개 API입니다."""

    def __init__(self, goondan: "Goondan") -> None:
        self._goondan = goondan

    async def list(self, session_id: str | None = None) -> list[dict[str, Any]]:
        return await self._goondan._list_operations(session_id)

    async def decide(self, session_id: str, operation_id: str, value: Any) -> dict[str, Any]:
        return await self._goondan._decide_operation(session_id, operation_id, value)


class _ToolContext(Mapping[str, Any]):
    """도구에 전달하는 공개 키와 동적으로 바뀌는 취소 상태를 함께 제공한다."""

    def __init__(self, members: Mapping[str, Any], cancelled: Callable[[], bool]) -> None:
        self._members = dict(members)
        self._cancelled = cancelled

    def __getitem__(self, key: str) -> Any:
        if key == "cancelled":
            task = asyncio.current_task()
            return self._cancelled() or (task is not None and task.cancelling() > 0)
        return self._members[key]

    def __iter__(self) -> Iterator[str]:
        yield from self._members
        yield "cancelled"

    def __len__(self) -> int:
        return len(self._members) + 1


class Goondan:
    def __init__(self, *, config: Mapping[str, Any], models: Mapping[str, Any], tools: Mapping[str, Tool] | None = None, functions: Mapping[str, Callable[..., Any]] | None = None, extensions: Mapping[str, ExtensionDefinition] | None = None, store: Store | None = None, ports: Mapping[str, Any] | None = None, host: Any = None, emit: Callable[..., Any] | None = None, logger: Any = None, max_retries: int = 3, directory: str | Path | None = None, _conversation_projection: Any = None, _operation_projection: Any = None):
        if isinstance(max_retries, bool) or not isinstance(max_retries, int) or max_retries < 0:
            raise ValueError("max_retries must be an integer that is 0 or more")
        self.config = prepare_config(config, directory)
        self.models, self.tools, self.functions, self.extensions = dict(models), dict(tools or {}), dict(functions or {}), dict(extensions or {})
        self.store, self.ports, self.host = store or InMemoryStore(), dict(ports or {}), host
        self._conversation_projection = _conversation_projection or _ConversationProjection()
        # §이벤트 형식과 전달: the host's event sink. A host that bundles its callbacks in one
        # object can provide it as `host.emit` instead.
        self.emit = emit if emit is not None else getattr(host, "emit", None)
        # §확장 인스턴스: the logger every extension instance receives as `log`.
        self.logger = logger if logger is not None else NoLog()
        self.max_retries = max_retries
        self._operation_projection = _operation_projection or _OperationProjection()
        self.directory = self.config.directory
        self._agent_sessions: dict[tuple[str, str], _AgentSession] = {}
        self.sessions = _Sessions(self)
        self.operations = _Operations(self)
        self._delivery_tasks: set[asyncio.Task[Any]] = set()
        # §복구: the operations this runtime is executing or delivering right now.
        self._in_flight: dict[tuple[str, str], int] = {}
        self._delivery_locks: dict[str, asyncio.Lock] = {}
        self._root: Goondan = self
        self._scopes: dict[str, _Scope] = {}
        self._runs: dict[str, set[_Run]] = {}
        self._detached: set[_Run] = set()
        self._steering: dict[str, list[tuple[str | None, Json, str | None]]] = {}
        self._turn_locks: dict[str, asyncio.Lock] = {}
        self._turn_counts: dict[str, int] = {}
        self._turn_tasks: dict[str, asyncio.Task[dict[str, Any]]] = {}
        self._internal_turns: set[asyncio.Task[dict[str, Any]]] = set()
        self._turn_lineages: dict[str, _Lineage] = {}
        self._agent_locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._active_agents: dict[tuple[str, str], _ActiveAgent] = {}
        self._wait_edges: dict[str, set[str]] = {}
        self._journal_writers: dict[str, _JournalWriter] = {}
        self._recovered_sessions: set[str] = set()
        self._journal_owner = uuid.uuid4().hex
        self._active_execution_ids: dict[tuple[str, str], str] = {}
        self._closed = False
        issues = binding_issues(self.config, models=self.models, tools=self.tools, functions=self.functions, extensions=self.extensions, ports=self.ports)
        if issues: raise GoondanConfigError(issues)
        self.renderer = TemplateRenderer(self.config.templates, self.directory)
        self.templates = self.renderer.templates

    def render(self, template: str, variables: Mapping[str, Any]) -> str:
        """§템플릿을 읽는 시점: render a template that was read at configuration load."""
        return self.renderer.render(template, variables)

    # --- 실행 등록 -----------------------------------------------------------------------------

    def _resolve(self, name: str) -> tuple["Goondan", str]:
        if name not in self.config["agents"]:
            raise GoondanError(f"unknown agent: {name}")
        return self, name

    def _register(self, scope: _Scope, agent: str | None = None) -> _Run:
        run = _Run(asyncio.current_task(), agent, scope.foreground)
        if scope.host is None: self._root._detached.add(run)
        else: self._root._runs.setdefault(scope.host, set()).add(run)
        return run

    def _release(self, scope: _Scope, run: _Run) -> None:
        if scope.host is None: self._root._detached.discard(run); return
        runs = self._root._runs.get(scope.host)
        if runs is None: return
        runs.discard(run)
        if not runs: self._root._runs.pop(scope.host, None)

    def _check_host_session_id(self, session_id: str) -> None:
        if not isinstance(session_id, str):
            raise GoondanExecutionError("runtime", ["runtime_error"], "session_id must be a string")

    def abort(self, session_id: str) -> bool:
        """§실행 중단: session_id에서 진행 중인 턴을 중단한다.

        Python tells a call in progress by cancelling the task that runs it. The task that
        asks for the abort is not cancelled: it is running rather than waiting, so its own
        run stops at the next stage, model call, tool execution, hook or route step, and a
        host that aborts from inside a tool or hook keeps its task.
        """
        self._check_host_session_id(session_id)
        root = self._root
        if root._closed: return False
        runs = root._runs.get(session_id)
        turn_task = root._turn_tasks.get(session_id)
        if not runs and (turn_task is None or turn_task.done()): return False
        current = asyncio.current_task()
        tasks: set[asyncio.Task[Any]] = set()
        for run in runs or ():
            run.aborted = True
            if run.task is not None and run.task is not current: tasks.add(run.task)
        if turn_task is not None and not turn_task.done() and turn_task is not current:
            tasks.add(turn_task)
        for task in tasks: task.cancel()
        return True

    def _background_tasks(self) -> list[asyncio.Task[Any]]:
        tasks = [task for task in self._delivery_tasks if not task.done()]
        tasks.extend(task for task in self._internal_turns if not task.done())
        for session in self._agent_sessions.values():
            tasks.extend(task for task in session.pending.values() if not task.done())
        return list(dict.fromkeys(tasks))

    async def idle(self) -> None:
        """Return once the work the runtime carries on by itself, and anything it starts, is finished."""
        while True:
            tasks = self._background_tasks()
            if not tasks: return
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _delete_session(self, session_id: str) -> None:
        self._check_host_session_id(session_id)
        self._require_open()
        has_operation_work = any(stored_session == session_id for stored_session, _ in self._in_flight)
        if self._turn_counts.get(session_id, 0) or self._runs.get(session_id) or self._steering.get(session_id) or has_operation_work:
            raise GoondanExecutionError("runtime", ["runtime_error"], "the session has an active or waiting turn")
        for key, session in list(self._agent_sessions.items()):
            stored_session = key[1]
            if stored_session != session_id:
                continue
            tasks = list(session.pending.values())
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            await self._dispose(session.extensions)
            self._agent_sessions.pop(key, None)
        self._steering.pop(session_id, None)
        for key in [key for key in self._agent_locks if key[0] == session_id]:
            self._agent_locks.pop(key, None)
        lease = await self.store.acquire_lease(session_id, self._journal_owner)
        if lease is None:
            raise GoondanExecutionError("runtime", ["runtime_error"], "the session lease is held by another writer")
        events = [event async for event in self.store.scan(session_id=session_id)]
        state = fold(session_id, events)
        if any(turn["status"] == "running" for turn in state["turns"]) or any(operation["status"] == "running" or operation["deliveryStatus"] == "delivering" for operation in state["operations"]):
            await lease.release()
            raise GoondanExecutionError("runtime", ["runtime_error"], "the session journal has active work")
        await self.store.delete_session(session_id, token=lease.token)
        await self._conversation_projection.delete_session(session_id)

    # --- extension instances ------------------------------------------------------------------

    async def _session(self, agent_name: str, session_id: str) -> _AgentSession:
        """§확장 인스턴스: prepare this execution scope's instances, once, in declaration order."""
        key = (agent_name, session_id)
        agent = self.config["agents"][agent_name]
        stateful = agent.get("stateful", True) is True
        if stateful and key in self._agent_sessions:
            return self._agent_sessions[key]
        instances: dict[str, Extension] = {}
        try:
            for instance_name, use in (agent.get("extensions", {}) or {}).items():
                if use.get("enabled") is False: continue
                definition = self.extensions[instance_name]
                options = use.get("options", {})
                if definition.validate_options:
                    replaced = await _await(definition.validate_options(copy.deepcopy(options)))
                    if replaced is not None: options = replaced
                selected_ports = {name: self.ports[name] for name in definition.requires}
                identity = {"name": agent_name, "spec": copy.deepcopy(dict(agent))}
                instances[instance_name] = await _await(definition.create(options=options, ports=selected_ports, agent=identity, log=self.logger))
        except BaseException:
            await self._dispose(instances)
            raise
        instance_tools: dict[str, Tool] = {}
        duplicated: set[str] = set()
        for instance in instances.values():
            for tool in instance.tools:
                if tool.name in instance_tools or tool.name in self.tools: duplicated.add(tool.name)
                instance_tools[tool.name] = tool
        issues = self._instance_issues(agent_name, agent, instances, instance_tools, duplicated)
        if issues:
            await self._dispose(instances)
            raise GoondanConfigError(issues)
        session = _AgentSession(instances, instance_tools)
        if stateful:
            self._agent_sessions[key] = session
        return session

    async def _dispose(self, instances: Mapping[str, Extension]) -> None:
        """§확장 인스턴스: clean up instances in creation order."""
        for instance in list(instances.values()):
            if instance.dispose:
                try: await _await(instance.dispose())
                except Exception: continue

    def _instance_issues(self, agent_name: str, agent: Mapping[str, Any], instances: Mapping[str, Extension], instance_tools: Mapping[str, Tool], duplicated: set[str]) -> list[dict[str, Any]]:
        """§확장 인스턴스 step 2: check the stages and tools the instances actually provide."""
        issues: list[dict[str, Any]] = []
        for phase, entries in agent.get("hooks", {}).items():
            for index, hook in enumerate(entries):
                instance = instances.get(hook["extension"]) if "extension" in hook else None
                if instance is not None and phase not in instance.hooks:
                    issues.append(_issue("binding.extension_hook", ["agents", agent_name, "hooks", phase, index, "extension"], f"the extension {hook['extension']!r} does not provide a {phase} hook"))
        for index, entry in enumerate(agent.get("tools", [])):
            if isinstance(entry, Mapping) and "agent" in entry: continue
            name = entry if isinstance(entry, str) else entry["tool"]
            at = ["agents", agent_name, "tools", index] if isinstance(entry, str) else ["agents", agent_name, "tools", index, "tool"]
            if name in duplicated:
                issues.append(_issue("binding.duplicate_tool", at, f"the tool name {name!r} is provided more than once"))
            elif name not in self.tools and name not in instance_tools:
                issues.append(_issue("binding.tool", at, f"names the tool {name!r}, which no host tool or extension provides"))
        return issues

    async def _open_journal(self, session_id: str) -> _JournalWriter:
        current = self._journal_writers.get(session_id)
        if current is not None:
            return current
        while True:
            lease = await self.store.acquire_lease(session_id, self._journal_owner)
            if lease is not None:
                break
            await asyncio.sleep(0)
        events = [event async for event in self.store.scan(session_id=session_id)]
        journal_state = fold(session_id, events)
        await self._conversation_projection.delete_session(session_id)
        for conversation in journal_state["conversations"]:
            await self._conversation_projection.replace(session_id, conversation["agent"], conversation["messages"])
        for operation in journal_state["operations"]:
            await self._operation_projection.save(operation)
        writer = _JournalWriter(lease, journal_state["head"])
        self._journal_writers[session_id] = writer
        if lease.expires_at is not None:
            writer.renewal = asyncio.create_task(self._renew_lease(session_id, writer))
        if session_id not in self._recovered_sessions:
            self._recovered_sessions.add(session_id)
            recovery_events: list[dict[str, Any]] = []
            aborted = GoondanAbortError("the previous runtime stopped before the execution finished").value()
            for execution in journal_state["executions"]:
                if execution["status"] != "running":
                    continue
                event: dict[str, Any] = {
                    "version": 1,
                    "type": "agent.error",
                    "sessionId": session_id,
                    "agent": execution["agent"],
                    "instance": execution["instance"],
                    "turnId": execution["turnId"],
                    "executionId": execution["executionId"],
                    "data": {"status": "aborted", "error": copy.deepcopy(aborted), "usage": _usage()},
                }
                for key in ("parentExecutionId", "operationId"):
                    if key in execution:
                        event[key] = execution[key]
                recovery_events.append(event)
            for turn in journal_state["turns"]:
                if turn["status"] == "running":
                    recovery_events.append({
                        "version": 1,
                        "type": "turn.error",
                        "sessionId": session_id,
                        "turnId": turn["turnId"],
                        "data": {"status": "aborted", "error": copy.deepcopy(aborted)},
                    })
            if recovery_events:
                await self._journal(None, recovery_events)
                stream = [event async for event in self.store.scan(session_id=session_id)]
                journal_state = fold(session_id, stream)
            task = asyncio.create_task(self._recover_session_operations(session_id, journal_state["operations"]))
            self._delivery_tasks.add(task)
            task.add_done_callback(self._delivery_tasks.discard)
        return writer

    async def _renew_lease(self, session_id: str, writer: _JournalWriter) -> None:
        """유한 임대를 남은 수명의 절반이 지나기 전에 갱신합니다."""
        try:
            while self._journal_writers.get(session_id) is writer:
                expires_at = writer.lease.expires_at
                if expires_at is None:
                    return
                remaining_ms = max(0, expires_at - _now())
                await asyncio.sleep(remaining_ms / 2000)
                if self._journal_writers.get(session_id) is not writer:
                    return
                try:
                    kept = await writer.lease.renew()
                except Exception as broken:
                    self._lose_lease(session_id, writer, f"the session lease renewal failed: {broken}")
                    return
                if not kept:
                    self._lose_lease(session_id, writer, "the session lease was lost while the turn was running")
                    return
        except asyncio.CancelledError:
            return

    def _lose_lease(self, session_id: str, writer: _JournalWriter, message: str) -> None:
        """임대 상실을 기록하고 진행 중인 턴을 중단하여 런타임 오류로 끝냅니다."""
        if writer.failure is not None:
            return
        writer.failure = GoondanExecutionError("runtime", ["runtime_error"], message)
        turn = self._turn_tasks.get(session_id)
        if turn is not None and not turn.done():
            turn.cancel()

    async def _recover_session_operations(self, session_id: str, operations: Sequence[Mapping[str, Any]]) -> None:
        """재생한 작업 목록을 저장 순서대로 이어서 처리합니다."""
        for stored in operations:
            if self._closed:
                return
            operation_id = str(stored["operationId"])
            key = (session_id, operation_id)
            if key in self._in_flight:
                continue
            operation: Mapping[str, Any] = stored
            status = operation["status"]
            if status == "pending":
                continue
            if status == "approved":
                self._start(self._execute_operation(operation), key)
                continue
            if status == "running":
                changed = await self._transition(session_id, operation_id, ["running"], {
                    "status": "failed",
                    "error": "Operation execution outcome is unknown because the previous runtime stopped",
                    "errorCode": "execution_interrupted",
                })
                if changed is not None:
                    self._start(self._deliver_operation(changed), key)
                continue
            if status not in TERMINAL_STATUSES:
                continue
            if operation.get("deliveryStatus") == "delivering":
                changed = await self._transition(session_id, operation_id, [status], {"deliveryOutcome": "interrupted"})
                if changed is not None:
                    operation = changed
            if operation.get("deliveryStatus") == "pending":
                self._start(self._deliver_operation(operation), key)

    async def _close_journal(self, session_id: str) -> None:
        writer = self._journal_writers.pop(session_id, None)
        if writer is not None:
            renewal = writer.renewal
            if renewal is not None and renewal is not asyncio.current_task():
                renewal.cancel()
                await asyncio.gather(renewal, return_exceptions=True)
            await writer.lease.release()

    async def _publish(self, session: _AgentSession | None, event: Mapping[str, Any]) -> None:
        sink = self._root.emit
        receivers: list[Callable[..., Any]] = [sink] if sink is not None else []
        if session is not None:
            receivers.extend(handler for extension in session.extensions.values() if (handler := extension.on.get(str(event["type"]))) is not None)
        for receiver in receivers:
            try:
                await _await(receiver(copy.deepcopy(dict(event))))
            except Exception:
                continue

    async def _journal(self, session: _AgentSession | None, events: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
        if not events:
            return []
        session_id = str(events[0]["sessionId"])
        writer = await self._open_journal(session_id)
        if writer.failure is not None:
            raise writer.failure
        async with writer.lock:
            if writer.failure is not None:
                raise writer.failure
            try:
                stored = await self.store.append(
                    events,
                    expected=writer.expected,
                    token=writer.lease.token,
                    write_id=uuid.uuid4().hex,
                )
            except StoreError as broken:
                raise GoondanExecutionError("runtime", ["runtime_error"], str(broken), cause=broken) from broken
            writer.expected = stored[-1]["seq"]
        for event in stored:
            await self._publish(session, event)
        return stored

    async def _emit(self, session: _AgentSession | None, name: str, agent_name: str, session_id: str, turn_id: str, data: dict[str, Any], *, instance: str, lineage: _Lineage) -> None:
        """§이벤트 형식과 전달: host `emit` first, then this scope's instances in creation order.

        A receiver that fails is ignored; the remaining receivers still get the event.
        """
        event: dict[str, Any] = {
            "type": name,
            "agent": agent_name,
            "sessionId": session_id,
            "turnId": turn_id,
            "instance": instance,
            "at": _now(),
            "data": data,
            "observational": True,
        }
        execution_id = self._active_execution_ids.get((session_id, instance))
        if execution_id is not None:
            event["executionId"] = execution_id
        if lineage.parent_execution_id is not None:
            event["parentExecutionId"] = lineage.parent_execution_id
        if lineage.operation_id is not None:
            event["operationId"] = lineage.operation_id
        await self._publish(session, event)

    def _conversation_event(self, state: _RunState, event_type: str, data: Mapping[str, Any]) -> dict[str, Any]:
        event: dict[str, Any] = {
            "version": 1,
            "type": event_type,
            "sessionId": state.session_id,
            "agent": state.agent_name,
            "instance": state.instance,
            "turnId": state.turn_id,
            "executionId": state.execution_id,
            "data": copy.deepcopy(dict(data)),
        }
        if state.lineage.parent_execution_id is not None:
            event["parentExecutionId"] = state.lineage.parent_execution_id
        if state.lineage.operation_id is not None:
            event["operationId"] = state.lineage.operation_id
        return event

    async def _append_conversation(self, state: _RunState, messages: Sequence[Mapping[str, Any]]) -> None:
        if not messages:
            return
        copied = [copy.deepcopy(dict(message)) for message in messages]
        await self._journal(state.session, [
            self._conversation_event(state, "conversation.message.appended", {"message": message})
            for message in copied
        ])
        state.recorded_conversation.extend(copy.deepcopy(copied))
        if state.stateful:
            await self._conversation_projection.append(state.session_id, state.agent_name, copied)

    async def _replace_conversation(self, state: _RunState, messages: Sequence[Mapping[str, Any]]) -> None:
        before = state.recorded_conversation
        after = [copy.deepcopy(dict(message)) for message in messages]
        if before == after:
            return
        before_ids = [message.get("id") for message in before]
        after_ids = [message.get("id") for message in after]
        if len(set(after_ids)) != len(after_ids):
            raise GoondanError("conversation messages must have distinct ids")
        events: list[dict[str, Any]] = []
        if len(after) < len(before) and after == before[len(before) - len(after):]:
            events.append(self._conversation_event(state, "conversation.truncated", {"keepLast": len(after)}))
        elif before_ids == after_ids:
            for old, new in zip(before, after):
                if old != new:
                    events.append(self._conversation_event(state, "conversation.message.replaced", {"messageId": old["id"], "message": new}))
        elif before_ids == after_ids[:len(before_ids)]:
            for old, new in zip(before, after):
                if old != new:
                    events.append(self._conversation_event(state, "conversation.message.replaced", {"messageId": old["id"], "message": new}))
            for message in after[len(before):]:
                events.append(self._conversation_event(state, "conversation.message.appended", {"message": message}))
        else:
            for message in before:
                events.append(self._conversation_event(state, "conversation.message.removed", {"messageId": message["id"]}))
            for message in after:
                events.append(self._conversation_event(state, "conversation.message.appended", {"message": message}))
        if events:
            await self._journal(state.session, events)
        state.recorded_conversation = copy.deepcopy(after)
        if state.stateful:
            await self._conversation_projection.replace(state.session_id, state.agent_name, after)

    # --- value stages and hooks ---------------------------------------------------------------

    def _hook_specs(self, agent_name: str, stage: ValueName) -> list[Mapping[str, Any]]:
        return list((self.config["agents"][agent_name].get("hooks", {}) or {}).get(stage, []))

    def _seen(self, spec: Mapping[str, Any], stage: ValueName, current: Any, state: _RunState) -> Any:
        return current

    async def _call_function(self, function: Callable[..., Any], value: Any, context: Any) -> Any:
        """호스트 함수가 새 컨텍스트 인수를 받도록 하되 단항 구현도 호출합니다."""
        try:
            signature = inspect.signature(function)
            signature.bind(copy.deepcopy(value), context)
        except (TypeError, ValueError):
            return await _await(function(copy.deepcopy(value)))
        return await _await(function(copy.deepcopy(value), context))

    async def _hook_body(self, spec: Mapping[str, Any], stage: ValueName, seen: Any, ctx: HookContext, state: _RunState) -> Any:
        """§훅 실행과 결과 step 3: an extension's stage function, or the inline pipeline."""
        if "extension" in spec:
            instance = state.session.extensions.get(spec["extension"])
            function = instance.hooks.get(stage) if instance is not None else None
            if function is None:
                # §확장 인스턴스: a missing stage function is a configuration error, not a hook failure.
                raise GoondanConfigError([_issue("binding.extension_hook", ["agents", state.agent_name, "hooks", stage], f"the extension {spec['extension']!r} does not provide a {stage} hook")])
            return await _await(function(copy.deepcopy(seen), ctx))
        agent = self.config["agents"][state.agent_name]
        transformed = seen
        if "fn" in spec:
            transformed = await self._call_function(self.functions[spec["fn"]], transformed, ctx)
            if transformed is None: return _NOTHING
            if not is_json(transformed): raise GoondanError(f"the function {spec['fn']!r} returned a value that is not JSON")
        if "agent" in spec:
            names = spec["agent"] if isinstance(spec["agent"], list) else [spec["agent"]]
            try:
                transformed = await self._hook_agents(names, transformed, ctx)
            except Exception:
                # §인라인 훅: whatever error the targets chose, a run that was told to stop is
                # reported as `aborted` under the rules of §실행 중단.
                self._running(state)
                raise
        if "template" in spec:
            transformed = self.render(spec["template"], {"text": transformed, "input": state.agent_input, "inputText": input_text(state.agent_input), "params": agent.get("params", {})})
        augments = "agent" in spec or "template" in spec or "role" in spec
        if stage in ("onPrompt", "onStep", "onModelInput") and augments:
            content = copy.deepcopy(transformed["content"]) if is_message(transformed) else [{"type": "text", "text": result_text(transformed)}]
            message = {"id": uuid.uuid4().hex, "role": spec.get("role", "user"), "source": ctx._source, "content": content}
            return {"append": [message]}
        if stage == "onOutput" and ("agent" in spec or "template" in spec):
            content = copy.deepcopy(transformed["content"]) if is_message(transformed) else [{"type": "text", "text": result_text(transformed)}]
            return {"id": seen["id"], "role": "assistant", "source": ctx._source, "content": content}
        return transformed

    async def _hook_agents(self, names: Sequence[str], value: Json, ctx: HookContext) -> Any:
        """§인라인 훅 2: start every agent in declaration order, run them together and join the texts.

        The hook waits for all of them even when one fails, so a failed hook leaves no sub-run
        behind that would keep writing to the conversation after the hook reported its failure.
        """
        outcomes = await asyncio.gather(*(ctx.run_agent(name, value) for name in names), return_exceptions=True)
        broken = [item for item in outcomes if isinstance(item, BaseException)]
        # A cancellation is the event loop stopping this hook, not an execution error of a target.
        stopped = next((item for item in broken if not isinstance(item, Exception)), None)
        if stopped is not None:
            raise stopped
        if broken:
            # §인라인 훅: the failure of the earliest declared target that failed is the failure of
            # the hook; neither the order in which they failed nor the kind of failure decides it.
            raise broken[0]
        outputs = [copy.deepcopy(dict(item)) for item in outcomes if isinstance(item, Mapping)]
        if len(outputs) == 1:
            return outputs[0]
        return "\n".join(output_text(item) for item in outputs)

    async def _invoke(self, spec: Mapping[str, Any], stage: ValueName, seen: Any, ctx: HookContext, state: _RunState) -> Any:
        """§훅 실패: run the hook body under its `timeout`, which cancels the task on expiry."""
        timeout = spec.get("timeout")
        handle = ctx.execution
        handle._allowed = stage == "onToolResult" and "extension" in spec
        try:
            if not timeout:
                return await self._hook_body(spec, stage, seen, ctx, state)
            try:
                return await asyncio.wait_for(self._hook_body(spec, stage, seen, ctx, state), timeout / 1000)
            except asyncio.TimeoutError as expired:
                raise GoondanError(f"the hook did not finish within {timeout}ms") from expired
        finally:
            handle._allowed = False
            handle._active = False

    def _running(self, state: _RunState) -> None:
        """§실행 중단: an aborted run starts no further work and stores no further message."""
        if state.aborted():
            raise GoondanAbortError(f"run of {state.agent_name} in {state.session_id} was aborted")

    async def _pipeline(self, stage: ValueName, value: Any, state: _RunState, *, call_id: str | None = None, persist: bool = True) -> _Stage:
        """§훅 실행과 결과: run the stage's hooks in declaration order over the current value."""
        # §실행 중단: an aborted run starts no stage, so a stage without hooks stores nothing either.
        self._running(state)
        result = _Stage(value)
        for spec in self._hook_specs(state.agent_name, stage):
            # §실행 중단: an aborted run starts no further hook and uses no hook result.
            self._running(state)
            identifier = hook_identifier(spec, self.directory)
            # §비동기 훅: an asynchronous hook is optional whatever `optional` says.
            optional = True if spec.get("mode") == "async" else spec.get("optional", False)
            ctx = HookContext(
                runtime=self,
                agent=state.agent_name,
                session_id=state.session_id,
                turn_id=state.turn_id,
                instance=state.instance,
                execution_id=state.execution_id,
                parent_execution_id=state.lineage.parent_execution_id,
                operation_id=state.lineage.operation_id,
                input_kind=state.input_kind if stage in ("onInput", "onPrompt") else None,
                step=state.step or None,
                retry_count=state.retry_count,
                input=copy.deepcopy(state.agent_input),
                conversation=copy.deepcopy(result.value if stage == "onStep" else state.conversation),
                execution=ExecutionHandle(state.completion),
                log=self.logger,
                source=identifier,
                cancelled=state.aborted,
                run_state=state,
            )
            try:
                outcome = await self._hook(spec, stage, result, ctx, state, identifier, call_id)
            except (GoondanAbortError, GoondanConfigError):
                raise
            except Exception as error:
                await self._emit(state.session, "hook.failed", state.agent_name, state.session_id, state.turn_id, {"value": stage, "hook": identifier, "error": str(error)}, instance=state.instance, lineage=state.lineage)
                if optional: continue
                raise GoondanExecutionError(stage, ["hook_error"], str(error), state.retry_count + 1, cause=error) from error
            if outcome is _SCHEDULED: continue
            if outcome is _SKIPPED:
                await self._emit(state.session, "hook.skipped", state.agent_name, state.session_id, state.turn_id, {"value": stage, "hook": identifier}, instance=state.instance, lineage=state.lineage)
                continue
            # §실행 중단: a hook result that arrives after the abort is not used.
            self._running(state)
            await self._apply(stage, outcome, result, state, persist)
            await self._emit(state.session, "hook.applied", state.agent_name, state.session_id, state.turn_id, {"value": stage, "hook": identifier}, instance=state.instance, lineage=state.lineage)
            if result.control is not None: break
        return result

    async def _hook(self, spec: Mapping[str, Any], stage: ValueName, result: _Stage, ctx: HookContext, state: _RunState, identifier: str, call_id: str | None) -> Any:
        """§훅 실행과 결과: `using`, `when`, the hook body and the checks its result must pass."""
        seen = self._seen(spec, stage, result.value, state)
        condition = spec.get("when")
        if condition is not None:
            decided = await self._call_function(self.functions[condition["fn"]], seen, ctx)
            # D3: a `when` function returns a JSON boolean and nothing else.
            if not isinstance(decided, bool): raise GoondanError(f"the function {condition['fn']!r} must return true or false")
            if not decided: return _SKIPPED
        if spec.get("mode") == "async":
            self._schedule(spec, stage, seen, ctx, state, identifier)
            return _SCHEDULED
        outcome = await self._invoke(spec, stage, seen, ctx, state)
        return self._checked(stage, outcome, result, state, call_id)

    def _checked(self, stage: ValueName, outcome: Any, result: _Stage, state: _RunState, call_id: str | None) -> Any:
        """§훅 실행과 결과 step 4: a control result, a replacement value, or nothing at all."""
        if outcome is _NOTHING or outcome is None: return _NOTHING
        if isinstance(outcome, Append): outcome = {"append": [copy.deepcopy(item) for item in outcome.append]}
        if not is_json(outcome): raise GoondanError("a hook returns a JSON value")
        try:
            control = control_result(stage, outcome, call_id)
        except ValueError as invalid:
            raise GoondanError(str(invalid)) from invalid
        if control is None:
            found = stage_error(stage, outcome, call_id)
            if found: raise GoondanError(f"a {stage} hook result {found}")
            return outcome
        if control.kind == "retry" and stage == "onModelResult" and state.retry_count >= self.max_retries:
            raise GoondanError(f"the retry limit of {self.max_retries} was already reached")
        return control

    async def _apply(self, stage: ValueName, outcome: Any, result: _Stage, state: _RunState, persist: bool) -> None:
        """§훅 실행과 결과 step 4: put the hook's result into the stage."""
        if outcome is _NOTHING: return
        if not isinstance(outcome, Control):
            result.value = outcome
            if stage == "onStep":
                state.conversation = result.value
                if persist: await self._replace_conversation(state, state.conversation)
            return
        if outcome.kind == "append":
            if stage == "onModelInput":
                updated, _ = append_messages(result.value["messages"], outcome.value)
                result.value = {**result.value, "messages": updated}
                return
            result.value, added = append_messages(result.value, outcome.value)
            if stage == "onStep":
                state.conversation = result.value
                if persist and added: await self._append_conversation(state, added)
            return
        if outcome.kind == "approval":
            result.approvals.append(dict(outcome.value)); return
        if outcome.kind == "call":
            result.value = outcome.value
            if outcome.execution is not None: result.execution = outcome.execution
            return
        if outcome.kind == "complete":
            state.completion.message = copy.deepcopy(outcome.value)
        result.control = outcome

    # --- asynchronous hooks -------------------------------------------------------------------

    def _schedule(self, spec: Mapping[str, Any], stage: ValueName, seen: Any, ctx: HookContext, state: _RunState, identifier: str) -> None:
        """§비동기 훅: schedule the work unless this scope already has it running or waiting."""
        session = state.session
        if identifier in session.pending: return
        ctx._detached = True
        task = asyncio.create_task(self._async_hook(spec, stage, copy.deepcopy(seen), ctx, state, identifier))
        session.pending[identifier] = task

    async def _async_hook(self, spec: Mapping[str, Any], stage: ValueName, seen: Any, ctx: HookContext, state: _RunState, identifier: str) -> Control | None:
        """§비동기 훅: an always-optional hook whose only result is an `append` or nothing."""
        session, agent_name, session_id, turn_id = state.session, state.agent_name, state.session_id, state.turn_id
        try:
            outcome = await self._hook_body(spec, stage, seen, ctx, state)
            if outcome is _NOTHING or outcome is None:
                control = None
            else:
                if not is_json(outcome):
                    raise GoondanError("a hook returns a JSON value")
                content = copy.deepcopy(outcome["content"]) if is_message(outcome) else ([{"type": "text", "text": outcome}] if isinstance(outcome, str) else [{"type": "json", "value": copy.deepcopy(outcome)}])
                control = Control("append", [{"id": uuid.uuid4().hex, "role": spec.get("role", "user"), "source": identifier, "content": content}])
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self._emit(session, "hook.failed", agent_name, session_id, turn_id, {"value": stage, "hook": identifier, "error": str(error)}, instance=state.instance, lineage=state.lineage)
            return None
        await self._emit(session, "hook.applied", agent_name, session_id, turn_id, {"value": stage, "hook": identifier}, instance=state.instance, lineage=state.lineage)
        return control

    async def _drain_pending(self, state: _RunState) -> None:
        """§비동기 훅: apply the finished work in scheduling order, once, and keep the rest."""
        session = state.session
        for identifier, task in list(session.pending.items()):
            if not task.done():
                break
            del session.pending[identifier]
            if self._root._closed or task.cancelled() or task.exception() is not None: continue
            control = task.result()
            if control is None: continue
            state.conversation, added = append_messages(state.conversation, control.value)
            if state.stateful and added: await self._append_conversation(state, added)

    async def _drain_steering(self, state: _RunState) -> bool:
        """대기열 입력마다 onInput을 적용하고 한 묶음으로 onPrompt를 실행합니다."""
        host = state.session_id
        queued = self._root._steering.get(host, [])
        values = [(value, operation_id) for target, value, operation_id in queued if target is None or target == state.agent_name]
        if host is not None:
            self._root._steering[host] = [(target, value, operation_id) for target, value, operation_id in queued if target is not None and target != state.agent_name]
            if not self._root._steering[host]:
                self._root._steering.pop(host, None)
        if not values: return False
        state.input_kind = "steer"
        bundled: list[dict[str, Any]] = []
        for value, operation_id in values:
            messages = self._turn_input(state.agent_name, value, kind="steer", operation_id=operation_id)
            state.agent_input = messages
            transformed = (await self._pipeline("onInput", messages, state, persist=False)).value
            bundled.extend(await self._input_messages(state.agent_name, transformed))
        state.agent_input = bundled
        prompted = (await self._pipeline("onPrompt", bundled, state, persist=False)).value
        state.conversation = [*state.conversation, *copy.deepcopy(prompted)]
        await self._append_conversation(state, prompted)
        return True

    def _has_steering(self, state: _RunState) -> bool:
        """현재 인스턴스가 안전 지점에서 처리할 입력이 있는지 확인합니다."""
        return any(
            target is None or target == state.agent_name
            for target, _, _ in self._root._steering.get(state.session_id, [])
        )

    async def _safe_point(self, state: _RunState) -> bool:
        """완료된 비동기 결과를 반영한 뒤 대기열 입력을 처리합니다."""
        # §실행 중단: an aborted run stores neither steered input nor finished asynchronous work.
        self._running(state)
        # 이미 열린 gate를 기다리던 작업이 완료 상태를 기록한 뒤 대기열과 순서를 비교합니다.
        await asyncio.sleep(0)
        self._running(state)
        await self._drain_pending(state)
        return await self._drain_steering(state) if state.stateful else False

    async def _repair(self, state: _RunState) -> None:
        """§실패한 실행과 대화: drop the `tool.call` and `tool.result` parts that lost their pair."""
        conversation = state.conversation
        calls = {part["callId"] for message in conversation for part in message.get("content", []) if part.get("type") == "tool.call"}
        results = {part["callId"] for message in conversation for part in message.get("content", []) if part.get("type") == "tool.result"}
        paired = calls & results
        repaired: list[dict[str, Any]] = []
        for message in conversation:
            content = message.get("content", [])
            parts = [part for part in content if part.get("type") not in {"tool.call", "tool.result"} or part.get("callId") in paired]
            if parts or not content:
                changed = copy.deepcopy(message); changed["content"] = parts; repaired.append(changed)
        if repaired != conversation:
            state.conversation = repaired
            await self._replace_conversation(state, repaired)

    # --- model input and tools ----------------------------------------------------------------

    def _configured_tool(self, agent_name: str, name: str) -> Mapping[str, Any]:
        for entry in self.config["agents"][agent_name].get("tools", []) or []:
            use = {"tool": entry} if isinstance(entry, str) else entry
            if use.get("tool") == name or use.get("agent") == name: return use
        raise GoondanError(f"Tool {name} is not available to agent {agent_name}")

    def _tool_definitions(self, agent_name: str, session: _AgentSession | None = None) -> list[dict[str, Any]]:
        definitions = []
        for spec in self.config["agents"][agent_name].get("tools", []) or []:
            if isinstance(spec, Mapping) and "agent" in spec:
                child = self.config["agents"][spec["agent"]]
                definitions.append({"name": spec["agent"], "description": child["description"] if "description" in child else f"Run {spec['agent']}", "input": {"type": "object"}}); continue
            name = spec if isinstance(spec, str) else spec["tool"]
            tool = self.tools.get(name) or (session.tools.get(name) if session else None)
            if tool:
                description = tool.description + (("\n" + spec["hint"]) if isinstance(spec, Mapping) and spec.get("hint") else "")
                definitions.append({"name": name, "description": description, "input": tool.input})
        return definitions

    def _system(self, agent_name: str, session: _AgentSession | None = None, agent_input: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        """§시스템 메시지와 매개변수: the system blocks of one model call, in declaration order."""
        agent = self.config["agents"][agent_name]; blocks = agent.get("systemMessage", []); blocks = [blocks] if isinstance(blocks, Mapping) else blocks
        tools = self._tool_definitions(agent_name, session); result = []
        for index, block in enumerate(blocks):
            if "text" in block:
                text = block["text"]
            else:
                try:
                    messages = agent_input or []
                    text = self.render(block["template"], {"params": agent.get("params", {}), "tools": tools, "agent": {"name": agent_name}, "model": agent.get("model"), "input": messages, "inputText": input_text(messages)})
                except Exception as broken:
                    # §시스템 메시지와 매개변수: a failed system block render fails the run at modelInput.
                    raise GoondanExecutionError("onModelInput", ["runtime_error"], str(broken), cause=broken) from broken
            result.append({"text": text, "source": f"system:{index}", **({"cache": True} if block.get("cache") is True else {})})
        return result

    async def _call_model(self, agent_name: str, model_input: dict[str, Any], ctx: ModelContext) -> Any:
        """§모델 호출: one call of the bound model implementation with a copy of the model input."""
        name = self.config["agents"][agent_name]["model"]
        model = self.models[name]
        generate = getattr(model, "generate", None)
        if callable(generate):
            return await _await(generate(copy.deepcopy(model_input), ctx))
        if callable(model):
            try:
                signature = inspect.signature(model)
                signature.bind(copy.deepcopy(model_input), ctx)
            except (TypeError, ValueError):
                return await _await(model(copy.deepcopy(model_input)))
            return await _await(model(copy.deepcopy(model_input), ctx))
        raise GoondanError(f"the model {name!r} must be callable or provide generate(modelInput, ctx)")

    def _filled(self, result: Any) -> Any:
        """§모델 결과: fill `id` and `source` before the stage value is checked."""
        if not isinstance(result, Mapping) or not isinstance(result.get("message"), Mapping): return result
        message = dict(result["message"])
        message.setdefault("id", uuid.uuid4().hex)
        message.setdefault("source", "model")
        return {**result, "message": message}

    async def _run_hook_model(self, ctx: HookContext, messages: Any) -> dict[str, Any]:
        """§훅 컨텍스트와 호스트 함수: `model.run`, which stores nothing and runs no stage hooks.

        The call keeps the requesting agent run's identity and its last model call number,
        which it does not increase ([§모델 호출](spec)).
        """
        state = ctx._run_state
        step = state.step if isinstance(state, _RunState) else 0
        result = await self._model_once(ctx.agent, messages, ctx.session_id, turn_id=ctx.turn_id, step=step, origin=ctx)
        # §에이전트 실행 기록, §사용량 집계: 동기 훅의 model.run은 별도 실행이
        # 아니며, 호출한 에이전트 실행의 직접 사용량에만 합산합니다.
        if not ctx._detached and isinstance(state, _RunState):
            counted = _usage_of(result)
            for key in USAGE_KEYS:
                state.record.usage[key] += counted[key]
        return result

    async def _model_once(self, agent_name: str, messages: Any, session_id: str, *, turn_id: str = "", step: int = 0, origin: HookContext | None = None) -> dict[str, Any]:
        if not is_message_array(messages): raise GoondanError("model.run needs an array of messages")
        session = await self._session(agent_name, session_id)
        model_input = {"system": self._system(agent_name, session), "messages": copy.deepcopy(messages), "tools": self._tool_definitions(agent_name, session), "options": {}}
        # §텍스트 조각: chunks of a `model.run` call are not reported.
        ctx = ModelContext(
            agent_name,
            session_id,
            turn_id,
            origin.instance if origin is not None else f"{session_id}/{agent_name}",
            origin.execution_id if origin is not None else "model.run",
            origin.parent_execution_id if origin is not None else None,
            origin.operation_id if origin is not None else None,
            origin.cancelled if origin is not None else False,
            self.logger,
            step,
            lambda delta: None,
        )
        result = self._filled(await self._call_model(agent_name, model_input, ctx))
        found = stage_error("onModelResult", result)
        if found: raise GoondanError(f"the model result {found}")
        return result

    def _turn_input(self, agent_name: str, value: Json, *, kind: str = "start", operation_id: str | None = None) -> list[dict[str, Any]]:
        """§입력: 호스트 값을 턴 입력 메시지 배열로 바꾼다."""
        if is_message_array(value):
            return copy.deepcopy(value)
        if isinstance(value, list) and value and all(is_part(item) for item in value):
            content = copy.deepcopy(value)
        elif isinstance(value, str):
            content = [{"type": "text", "text": value}]
        else:
            content = [{"type": "json", "value": copy.deepcopy(value)}]
        meta: dict[str, Any] = {"kind": kind}
        if operation_id is not None:
            meta["operationId"] = operation_id
        return [{"id": uuid.uuid4().hex, "role": "user", "source": agent_name, "content": content, "meta": meta}]

    async def _input_messages(self, agent_name: str, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """§입력: 각 메시지의 직접 json 부분만 text 부분으로 바꾼다."""
        rule = self.config["agents"][agent_name].get("input", "asis")
        result = copy.deepcopy(messages)
        for message in result:
            converted: list[dict[str, Any]] = []
            for part in message["content"]:
                if part.get("type") != "json":
                    converted.append(part)
                    continue
                value = part.get("value")
                text: Any = value
                if isinstance(rule, Mapping) and "fn" in rule:
                    try:
                        text = await _await(self.functions[rule["fn"]](copy.deepcopy(value)))
                    except Exception as broken:
                        raise GoondanExecutionError("onInput", ["runtime_error"], str(broken), cause=broken) from broken
                    if text is not None and not is_json(text):
                        raise GoondanExecutionError("onInput", ["value_invalid"], f"the function {rule['fn']!r} returned a value that is not JSON")
                elif isinstance(rule, Mapping) and "template" in rule:
                    variables = dict(value) if isinstance(value, Mapping) else {"text": value}
                    try:
                        text = self.render(rule["template"], variables)
                    except Exception as broken:
                        raise GoondanExecutionError("onInput", ["runtime_error"], str(broken), cause=broken) from broken
                converted.append({"type": "text", "text": text if isinstance(text, str) else json_text(text)})
            message["content"] = converted
        return result

    def _tool_context(self, agent_name: str, session_id: str, turn_id: str, instance: str, execution_id: str, turn_input: list[dict[str, Any]] | Json, conversation: list[dict[str, Any]], call: Mapping[str, Any], execution: Any, scope: _Scope, records: list[_RunRecord] | None, lineage: _Lineage, cancelled: Callable[[], bool] = lambda: False) -> Mapping[str, Any]:
        """§도구 컨텍스트: the members a host or extension tool receives beside its arguments."""
        async def run_agent(name: str, value: Json) -> dict[str, Any]:
            messages = self._turn_input(name, value)
            result = await self._run_agent(name, messages, session_id, lineage=_Lineage(execution_id, None, turn_id), scope=_Scope(scope.host, False), records=records, kind="tool")
            return copy.deepcopy(result["output"])

        return _ToolContext({
            "input": copy.deepcopy(turn_input), "conversation": copy.deepcopy(conversation), "agent": agent_name,
            "session_id": session_id, "turn_id": turn_id, "instance": instance, "execution_id": execution_id,
            "parent_execution_id": lineage.parent_execution_id, "operation_id": lineage.operation_id,
            "log": self.logger, "tool_call": copy.deepcopy(dict(call)),
            "execution": copy.deepcopy(execution) if isinstance(execution, Mapping) else {}, "run_agent": run_agent,
        }, cancelled)

    async def _run_hook_agent(self, ctx: HookContext, name: str, value: Json) -> dict[str, Any]:
        """훅 컨텍스트의 agents.run을 같은 세션에서 실행합니다.

        An async hook has its own lifetime, so what it starts is detached from the turn that
        scheduled it and `abort` does not stop it ([§실행 중단](spec)).
        """
        parent = None if ctx._detached else self._scopes.get(ctx.execution_id)
        state = ctx._run_state
        records = state.record.children if not ctx._detached and isinstance(state, _RunState) else None
        messages = self._turn_input(name, value)
        lineage = _Lineage(ctx.execution_id, None, ctx.turn_id)
        result = await self._run_agent(name, messages, ctx.session_id, lineage=lineage, scope=_Scope(parent.host if parent is not None else None, False), records=records, kind="hook")
        return copy.deepcopy(result["output"])

    # --- agent runs ---------------------------------------------------------------------------

    async def _run_agent(self, agent_name: str, value: list[dict[str, Any]], session_id: str, *, lineage: _Lineage, scope: _Scope | None = None, records: list[_RunRecord] | None = None, kind: str = "turn", input_requests: list[list[dict[str, Any]]] | None = None) -> dict[str, Any]:
        agent = self.config["agents"].get(agent_name)
        if not isinstance(agent, Mapping):
            raise GoondanError(f"agent {agent_name} is not declared in this configuration")
        execution_id = uuid.uuid4().hex
        if agent.get("stateful", True) is not True:
            self._add_wait_edge(lineage.parent_execution_id, execution_id)
            try:
                return await self._run_agent_unlocked(agent_name, value, session_id, lineage=lineage, scope=scope, records=records, kind=kind, execution_id=execution_id, input_requests=input_requests)
            finally:
                self._remove_wait_edge(lineage.parent_execution_id, execution_id)
        key = (session_id, agent_name)
        lock = self._agent_locks.setdefault(key, asyncio.Lock())
        predecessor: asyncio.Task[dict[str, Any]] | None = None
        async with lock:
            active = self._active_agents.get(key)
            if active is not None and active.task.done():
                self._active_agents.pop(key, None)
                active = None
            if active is None:
                self._add_wait_edge(lineage.parent_execution_id, execution_id)
                task = asyncio.create_task(self._run_agent_unlocked(
                    agent_name, value, session_id, lineage=lineage, scope=scope,
                    records=records, kind=kind, execution_id=execution_id,
                    input_requests=input_requests,
                ))
                active = _ActiveAgent(execution_id, task)
                self._active_agents[key] = active
                task.add_done_callback(lambda done, target=key: self._finish_active_agent(target, done))
            elif not active.accepting:
                predecessor = active.task
            else:
                self._add_wait_edge(lineage.parent_execution_id, active.execution_id)
                active.requests += 1
                self._steering.setdefault(session_id, []).append((agent_name, copy.deepcopy(value), None))
        if predecessor is not None:
            try:
                await asyncio.shield(predecessor)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            return await self._run_agent(
                agent_name, value, session_id, lineage=lineage, scope=scope,
                records=records, kind=kind, input_requests=input_requests,
            )
        try:
            return copy.deepcopy(await asyncio.shield(active.task))
        except asyncio.CancelledError:
            # 단독 하위 실행의 대기자가 사라지면 실행도 취소합니다. 둘 이상의 입력을
            # 소비하는 공유 실행에서는 이 호출의 대기만 끝냅니다.
            if active.requests == 1 and not active.task.done():
                active.task.cancel()
                await asyncio.gather(active.task, return_exceptions=True)
            raise
        finally:
            self._remove_wait_edge(lineage.parent_execution_id, active.execution_id)

    def _finish_active_agent(self, key: tuple[str, str], task: asyncio.Task[dict[str, Any]]) -> None:
        """완료한 인스턴스를 다음 입력이 시작할 수 있도록 비웁니다."""
        active = self._active_agents.get(key)
        if active is not None and active.task is task:
            self._active_agents.pop(key, None)
        _consume_task_result(task)

    def _close_agent_admission(self, state: _RunState) -> None:
        """마지막 안전 지점을 지난 실행으로 새 입력이 합류하지 않게 합니다."""
        active = self._active_agents.get((state.session_id, state.agent_name))
        if active is not None and active.execution_id == state.execution_id:
            active.accepting = False

    def _add_wait_edge(self, waiter: str | None, target: str) -> None:
        """실제 출력 대기 간선을 추가하며 생기는 동기 순환을 거부합니다."""
        if waiter is None:
            return
        if waiter == target or self._wait_reaches(target, waiter):
            raise GoondanExecutionError("runtime", ["runtime_error"], "synchronous agent wait would form a cycle")
        self._wait_edges.setdefault(waiter, set()).add(target)

    def _remove_wait_edge(self, waiter: str | None, target: str) -> None:
        if waiter is None:
            return
        targets = self._wait_edges.get(waiter)
        if targets is None:
            return
        targets.discard(target)
        if not targets:
            self._wait_edges.pop(waiter, None)

    def _wait_reaches(self, start: str, goal: str) -> bool:
        seen: set[str] = set()
        pending = [start]
        while pending:
            current = pending.pop()
            if current == goal:
                return True
            if current in seen:
                continue
            seen.add(current)
            pending.extend(self._wait_edges.get(current, ()))
        return False

    async def _run_agent_unlocked(self, agent_name: str, value: list[dict[str, Any]], session_id: str, *, lineage: _Lineage, scope: _Scope | None = None, records: list[_RunRecord] | None = None, kind: str = "turn", execution_id: str | None = None, input_requests: list[list[dict[str, Any]]] | None = None) -> dict[str, Any]:
        """One agent run. `records` collects its [실행 기록](spec §에이전트 실행 기록), or is `None`
        when the run has its own lifetime and no turn waits for it."""
        scope = scope if scope is not None else _Scope(session_id, True)
        agent = self.config["agents"].get(agent_name)
        # §에이전트 실행 기록: a run that could not start because the agent does not exist
        # makes no entry.
        if not isinstance(agent, Mapping): raise GoondanError(f"agent {agent_name} is not declared in this configuration")
        turn_id = lineage.turn_id
        execution_id = execution_id or uuid.uuid4().hex
        stateful = agent.get("stateful", True) is True
        instance = f"{session_id}/{agent_name}" if stateful else uuid.uuid4().hex
        record = _RunRecord(agent_name, instance, execution_id, turn_id, lineage, kind)
        if records is not None: records.append(record)
        try:
            session = await self._session(agent_name, session_id)
        except GoondanConfigError as invalid:
            # §이벤트 순서: a failed extension preparation reports turn.error without
            # turn.start, and only to the host, because this scope has no instances.
            codes = [str(item["code"]) for item in invalid.issues]
            raise
        except GoondanAbortError:
            raise
        except Exception as broken:
            # §확장 인스턴스: a failing options validator or `create` is a runtime error.
            failure = GoondanExecutionError("runtime", ["runtime_error"], str(broken), 1, cause=broken)
            raise failure from broken
        self._scopes[execution_id] = scope
        run = self._register(scope, agent_name)
        conversation = await self._conversation_projection.load(session_id, agent_name) if stateful else []
        requests = copy.deepcopy(input_requests) if input_requests is not None else [copy.deepcopy(value)]
        state = _RunState(agent_name, session_id, instance, execution_id, turn_id, lineage, session, scope, run, value, requests, conversation, stateful, Completion(), record, copy.deepcopy(conversation))
        self._active_execution_ids[(session_id, instance)] = execution_id
        start_event: dict[str, Any] = {
            "version": 1,
            "type": "agent.start",
            "sessionId": session_id,
            "agent": agent_name,
            "instance": instance,
            "turnId": turn_id,
            "executionId": execution_id,
            "data": {"kind": kind, "input": copy.deepcopy(value)},
        }
        if lineage.parent_execution_id is not None:
            start_event["parentExecutionId"] = lineage.parent_execution_id
        if lineage.operation_id is not None:
            start_event["operationId"] = lineage.operation_id
        await self._journal(session, [start_event])
        try:
            response = await self._run_stages(state)
            response["instance"] = instance
            record.status, record.finish_reason = "done", response["finishReason"]
            await self._journal(session, [{
                "version": 1, "type": "agent.done", "sessionId": session_id,
                "agent": agent_name, "instance": instance, "turnId": turn_id,
                "executionId": execution_id,
                "data": {"output": copy.deepcopy(response["output"]), "finishReason": response["finishReason"], "usage": copy.deepcopy(response["usage"])},
                **({"parentExecutionId": lineage.parent_execution_id} if lineage.parent_execution_id is not None else {}),
                **({"operationId": lineage.operation_id} if lineage.operation_id is not None else {}),
            }])
            return response
        except asyncio.CancelledError:
            if not run.aborted: raise
            task = asyncio.current_task()
            if task is not None and task.cancelling(): task.uncancel()
            aborted = GoondanAbortError(f"run of {agent_name} in {session_id} was aborted")
            record.status = "failed"
            await self._fail(aborted, state)
            raise aborted from None
        except Exception as error:
            # §실행 중단: after the abort was signalled every failure of this run is the
            # aborted error, whatever its cause.
            if run.aborted and not isinstance(error, GoondanAbortError):
                error = GoondanAbortError(f"run of {agent_name} in {session_id} was aborted")
                record.status = "failed"
                await self._fail(error, state)
                raise error from None
            # §실행 오류: a failed agent run always ends as an execution error, so a failure
            # of the host's own code (a conversation store, for example) becomes the
            # `runtime_error` of §오류 코드 rather than escaping as it was raised.
            failure = error if isinstance(error, (GoondanAbortError, GoondanExecutionError, GoondanConfigError)) else GoondanExecutionError("runtime", ["runtime_error"], str(error), state.retry_count + 1, cause=error)
            await self._fail(failure, state)
            if failure is error: raise
            raise failure from error
        finally:
            self._scopes.pop(execution_id, None)
            self._active_execution_ids.pop((session_id, instance), None)
            self._release(scope, run)
            if not stateful:
                task = asyncio.create_task(self._finish_stateless_session(session))
                self._delivery_tasks.add(task)
                task.add_done_callback(self._delivery_tasks.discard)

    async def _finish_stateless_session(self, session: _AgentSession) -> None:
        """stateless 비동기 훅은 완료 이벤트까지 실행하고 결과 메시지는 폐기합니다."""
        tasks = list(session.pending.values())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        session.pending.clear()
        await self._dispose(session.extensions)

    async def _run_stages(self, state: _RunState) -> dict[str, Any]:
        """입력 묶음 훅을 적용한 뒤 모델·도구 반복을 실행합니다."""
        session, agent_name, session_id, turn_id = state.session, state.agent_name, state.session_id, state.turn_id
        bundled: list[dict[str, Any]] = []
        for request in state.input_requests:
            state.agent_input = request
            transformed = (await self._pipeline("onInput", request, state, persist=False)).value
            bundled.extend(await self._input_messages(state.agent_name, transformed))
        state.agent_input = bundled
        prompted = (await self._pipeline("onPrompt", bundled, state, persist=False)).value
        state.conversation = [*state.conversation, *copy.deepcopy(prompted)]
        await self._append_conversation(state, prompted)
        await self._repair(state)
        await self._safe_point(state)
        # §사용량 집계: this run's own entry, which a failed run keeps as it stands.
        usage = state.record.usage
        while True:
            if state.step:
                await self._safe_point(state)
            state.conversation = (await self._pipeline("onStep", state.conversation, state)).value
            model_input = {"system": self._system(state.agent_name, session, state.agent_input), "messages": copy.deepcopy(state.conversation), "tools": self._tool_definitions(state.agent_name, session), "options": {}}
            model_input = (await self._pipeline("onModelInput", model_input, state, persist=False)).value
            result = await self._step(state, model_input)
            if result is None:
                continue
            # §사용량 집계: the usage of the result the model returned, counted before the
            # modelResult stage, so a retried response stays in the total.
            counted = _usage_of(result)
            for key in USAGE_KEYS:
                usage[key] += counted[key]
            stage = await self._pipeline("onModelResult", result, state)
            if stage.control is not None:
                # §재시도: the message of a retried model result is not stored.
                state.retry_count += 1
                await self._wait(stage.control.value["afterMs"], state)
                continue
            result = stage.value
            assistant = copy.deepcopy(result["message"])
            calls = [part for part in assistant.get("content", []) if part.get("type") == "tool.call"]
            state.conversation = [*state.conversation, assistant]
            await self._append_conversation(state, [assistant])
            scheduled = False
            if calls:
                await self._run_calls(state, calls)
                if state.completion.message is None:
                    continue
                assistant = state.completion.message
                scheduled = True
            if scheduled:
                # §제어 결과: complete 뒤에도 안전 지점의 결과와 입력을 저장하되 모델은 다시 부르지 않습니다.
                await self._safe_point(state)
            elif self._has_steering(state) and await self._safe_point(state):
                continue
            self._close_agent_admission(state)
            output = (await self._pipeline("onOutput", assistant, state, persist=False)).value
            if scheduled:
                state.conversation = [*state.conversation, copy.deepcopy(output)]
                await self._append_conversation(state, [output])
            else:
                assistant_id = assistant.get("id")
                output_index = next(
                    (index for index in range(len(state.conversation) - 1, -1, -1) if state.conversation[index].get("id") == assistant_id),
                    None,
                )
                if output_index is None:
                    raise GoondanError("the model output is missing from the conversation")
                state.conversation = [*state.conversation[:output_index], copy.deepcopy(output), *state.conversation[output_index + 1:]]
                await self._replace_conversation(state, state.conversation)
            finish_reason = "tool" if scheduled else result.get("finishReason", "stop")
            return {"output": output, "conversation": state.conversation, "usage": dict(usage), "finishReason": finish_reason, "status": "done"}

    async def _step(self, state: _RunState, model_input: dict[str, Any]) -> dict[str, Any] | None:
        """One model call. Returns `None` when an `error` hook asked to call the model again.

        §모델 호출: the call number starts at 1 in every agent run and grows with every call,
        including the calls a retry makes.
        """
        session, agent_name, session_id, turn_id = state.session, state.agent_name, state.session_id, state.turn_id
        # §실행 중단: an aborted run starts no model call, so it reports no step event either.
        self._running(state)
        state.step += 1
        state.in_flight = ("step", {"step": state.step})
        deltas = _Deltas(self, state, state.step)
        ctx = ModelContext(
            agent_name,
            session_id,
            turn_id,
            state.instance,
            state.execution_id,
            state.lineage.parent_execution_id,
            state.lineage.operation_id,
            state.aborted(),
            self.logger,
            state.step,
            deltas.push,
        )
        await self._emit(session, "step.start", agent_name, session_id, turn_id, {"step": state.step}, instance=state.instance, lineage=state.lineage)
        try:
            result = await self._call_model(state.agent_name, model_input, ctx)
        except GoondanAbortError:
            deltas.cancel()
            raise
        except asyncio.CancelledError:
            deltas.cancel()
            raise
        except Exception as broken:
            await deltas.close()
            # §이벤트 순서: a call that was in progress when the abort was signalled reports
            # step.error with the code `aborted`, whatever the model did in the meantime.
            if state.aborted(): raise GoondanAbortError(f"run of {agent_name} in {session_id} was aborted") from None
            state.in_flight = None
            failure = GoondanExecutionError("model", _model_codes(broken), str(broken), state.retry_count + 1, cause=broken)
            await self._emit(session, "step.error", agent_name, session_id, turn_id, {"step": state.step, "codes": failure.codes, "error": failure.message}, instance=state.instance, lineage=state.lineage)
            if await self._recovered(state, failure, "model"): return None
            raise failure from broken
        state.in_flight = None
        await deltas.close()
        if state.aborted():
            # §실행 중단: a model result that arrives after the abort is not used.
            await self._emit(session, "step.error", agent_name, session_id, turn_id, {"step": state.step, "codes": ["aborted"], "error": "the run was aborted"}, instance=state.instance, lineage=state.lineage)
            raise GoondanAbortError(f"run of {agent_name} in {session_id} was aborted")
        result = self._filled(result)
        found = stage_error("onModelResult", result)
        if found:
            # §단계 값과 대화 저장: an invalid model result never reaches the error stage.
            await self._emit(session, "step.error", agent_name, session_id, turn_id, {"step": state.step, "codes": ["value_invalid"], "error": f"the model result {found}"}, instance=state.instance, lineage=state.lineage)
            raise GoondanExecutionError("onModelResult", ["value_invalid"], f"the model result {found}", state.retry_count + 1)
        await self._emit(session, "step.done", agent_name, session_id, turn_id, {"step": state.step, "finishReason": result["finishReason"]}, instance=state.instance, lineage=state.lineage)
        return result

    async def _recovered(self, state: _RunState, failure: GoondanExecutionError, target: str, retryable: bool = True) -> bool:
        """§단계 실행 순서, §재시도: run the `error` stage once and report whether to retry.

        The stage runs for every model and tool failure; `retryable` tells whether this
        failure may still be retried at all, and a refused request leaves the original error.
        """
        stage = await self._pipeline("onError", failure.value(), state)
        control = stage.control
        if control is None or not retryable or control.value["target"] != target or state.retry_count >= self.max_retries:
            return False
        state.retry_count += 1
        await self._wait(control.value["afterMs"], state)
        return True

    async def _wait(self, after: Any, state: _RunState) -> None:
        """§재시도: hold the retry for `afterMs`.

        An aborted run follows no retry request, so the wait is where the abort ends it
        rather than `afterMs` later. A request from another task also cancels this sleep.
        """
        self._running(state)
        if isinstance(after, (int, float)) and not isinstance(after, bool) and after > 0:
            await asyncio.sleep(after / 1000)
        self._running(state)

    async def _run_calls(self, state: _RunState, calls: list[dict[str, Any]]) -> None:
        """§단계 실행 순서 4: process the response's calls one at a time, in order."""
        for part in calls:
            call: dict[str, Any] = {"id": part["callId"], "name": part["name"], "args": part.get("args")}
            stage = await self._pipeline("onToolCall", call, state, call_id=call["id"])
            call = stage.value
            reasons = [str(item["reason"]) for item in stage.approvals]
            if stage.control is not None:
                # §제어 결과: a hook result skips the availability check and any approval.
                claimed = _claimed_result(stage.control.value)
                await self._finish_call(state, call, _tool_result(call, claimed), started=False)
                continue
            await self._process_call(state, call, stage.execution, reasons)

    async def _process_call(self, state: _RunState, call: dict[str, Any], execution: dict[str, Any] | None, reasons: list[str]) -> None:
        """§승인 작업 생성, §재시도: check, approve or run one call until it has a result."""
        call_data = {"tool": call["name"], "callId": call["id"], "args": call["args"]}
        while True:
            # §이벤트 순서: a call that reports no tool.start reports no tool.error either.
            started = False
            # §재시도: a call whose tool result is already stored follows no retry request.
            stored = False
            try:
                configured = self._available(state, call)
                approvals = [*reasons, f"Tool {call['name']} requires approval"] if configured.get("approval") == "required" else list(reasons)
                if approvals:
                    await self._create_operation(state, call, execution, approvals)
                    stored = True
                    return
                started = True
                result = await self._execute_call(state, call, call_data, configured, execution)
                await self._finish_call(state, call, result, started=True)
                return
            except GoondanAbortError:
                raise
            except Exception as broken:
                # §이벤트 순서: a tool execution that was in progress when the abort was
                # signalled reports tool.error with the code `aborted`, so `in_flight` stays.
                if state.aborted(): raise GoondanAbortError(f"run of {state.agent_name} in {state.session_id} was aborted") from None
                state.in_flight = None
                if isinstance(broken, GoondanConfigError):
                    # §확장 인스턴스: a configuration error is neither a tool failure nor a hook
                    # failure, so it reaches no `error` stage; §이벤트 순서 still pairs the
                    # tool.start this attempt reported with one tool.error.
                    if started:
                        value = _execution_error(broken)
                        await self._emit(state.session, "tool.error", state.agent_name, state.session_id, state.turn_id, {**call_data, "codes": value["codes"], "error": value["message"]}, instance=state.instance, lineage=state.lineage)
                    raise
                # §도구: a failed tool implementation is `["tool_error"]` and adds no second code.
                failure = broken if isinstance(broken, GoondanExecutionError) else GoondanExecutionError("tool", ["tool_error"], str(broken), state.retry_count + 1, call, broken)
                if started:
                    await self._emit(state.session, "tool.error", state.agent_name, state.session_id, state.turn_id, {**call_data, "codes": failure.codes, "error": failure.message}, instance=state.instance, lineage=state.lineage)
                # §실행 오류: a hook failure or an invalid tool result is not a tool failure,
                # so it ends the run without reaching the error stage.
                if failure.where == "tool" and await self._recovered(state, failure, "tool", not stored): continue
                if failure is broken: raise
                raise failure from broken

    def _available(self, state: _RunState, call: Mapping[str, Any]) -> Mapping[str, Any]:
        """§도구: only a name in the agent's effective `tools` list can be called."""
        try:
            return self._configured_tool(state.agent_name, call["name"])
        except GoondanError as unavailable:
            raise GoondanExecutionError("tool", ["tool_unavailable"], str(unavailable), state.retry_count + 1, call, unavailable) from unavailable

    async def _execute_call(self, state: _RunState, call: dict[str, Any], call_data: dict[str, Any], configured: Mapping[str, Any], execution: dict[str, Any] | None) -> dict[str, Any]:
        """Run an agent tool or a host/extension tool and build the tool result."""
        session, agent_name, session_id, turn_id = state.session, state.agent_name, state.session_id, state.turn_id
        # §실행 중단: an aborted run starts no tool execution, so it reports no tool event either.
        self._running(state)
        state.in_flight = ("tool", call_data)
        await self._emit(session, "tool.start", agent_name, session_id, turn_id, dict(call_data), instance=state.instance, lineage=state.lineage)
        if "agent" in configured:
            try:
                target = str(configured["agent"])
                messages = self._turn_input(target, call["args"])
                child = await self._run_agent(
                    target,
                    messages,
                    session_id,
                    lineage=_Lineage(state.execution_id, None, state.turn_id),
                    scope=_Scope(state.scope.host, False),
                    records=state.record.children,
                    kind="tool",
                )
            except (GoondanAbortError, GoondanConfigError):
                # §확장 인스턴스: a configuration error fails the whole turn whatever started
                # the run, so it never becomes this call's tool failure.
                raise
            except Exception as broken:
                # §에이전트 도구: the target run's failure becomes this call's tool failure.
                raise GoondanExecutionError("tool", ["tool_error"], str(broken), state.retry_count + 1, call, broken) from broken
            claimed: Mapping[str, Any] = {"content": child["output"]["content"]}
        else:
            tool = self.tools.get(call["name"]) or session.tools[call["name"]]
            context = self._tool_context(
                state.agent_name, session_id, turn_id, state.instance, state.execution_id, state.agent_input, state.conversation,
                call, execution, state.scope, state.record.children,
                state.lineage, state.aborted,
            )
            output = await _await(tool.execute(copy.deepcopy(call["args"]), context))
            claimed = _claimed_result(output)
        state.in_flight = None
        if state.aborted():
            await self._emit(session, "tool.error", agent_name, session_id, turn_id, {**call_data, "codes": ["aborted"], "error": "the run was aborted"}, instance=state.instance, lineage=state.lineage)
            raise GoondanAbortError(f"run of {agent_name} in {session_id} was aborted")
        result = _tool_result(call, claimed)
        found = stage_error("onToolResult", result, call["id"])
        if found:
            # §단계 값과 대화 저장: an invalid tool result never reaches the error stage.
            raise GoondanExecutionError("onToolResult", ["value_invalid"], f"the tool result {found}", state.retry_count + 1)
        return result

    async def _finish_call(self, state: _RunState, call: Mapping[str, Any], result: dict[str, Any], *, started: bool) -> None:
        """§단계 값과 대화 저장: the toolResult stage, and the tool result message it stores."""
        stage = await self._pipeline("onToolResult", result, state, call_id=call["id"])
        result = stage.value
        message = _tool_message(result)
        state.conversation = [*state.conversation, message]
        await self._append_conversation(state, [message])
        if started:
            # §이벤트 종류: tool.done follows the stored tool result message.
            await self._emit(state.session, "tool.done", state.agent_name, state.session_id, state.turn_id, {"tool": call["name"], "callId": call["id"], "args": call["args"], "result": result}, instance=state.instance, lineage=state.lineage)

    async def _create_operation(self, state: _RunState, call: dict[str, Any], execution: dict[str, Any] | None, reasons: list[str]) -> None:
        """승인 작업과 대기 중인 도구 결과를 한 저널 배치에 기록합니다."""
        session, agent_name, session_id, turn_id = state.session, state.agent_name, state.session_id, state.turn_id
        operation_id = f"operation_{uuid.uuid4().hex}"
        now = _now()
        operation: dict[str, Any] = {
            "operationId": operation_id,
            "deliveryId": f"operation:{operation_id}:completion",
            "agent": agent_name,
            "sessionId": session_id,
            "turnId": turn_id,
            "instance": state.instance,
            "executionId": state.execution_id,
            "toolCall": copy.deepcopy(call),
            "reasons": list(reasons),
            "status": "pending",
            "deliveryStatus": "pending",
            "createdAt": now,
            "updatedAt": now,
        }
        if state.lineage.parent_execution_id is not None:
            operation["parentExecutionId"] = state.lineage.parent_execution_id
        if execution is not None: operation["execution"] = copy.deepcopy(execution)
        # §승인 작업 생성 5: the pending tool result the model sees, which skips toolResult hooks.
        pending = {"status": "pending", "operationId": operation_id}
        message = _tool_message({"callId": call["id"], "content": [{"type": "json", "value": dict(pending)}], "meta": dict(pending)})
        operation_event = self._conversation_event(state, "operation.created", {"operation": operation})
        operation_event.pop("parentExecutionId", None)
        operation_event["operationId"] = operation_id
        conversation_event = self._conversation_event(state, "conversation.message.appended", {"message": message})
        await self._journal(session, [operation_event, conversation_event])
        await self._operation_projection.save(operation)
        state.conversation = [*state.conversation, message]
        state.recorded_conversation.append(copy.deepcopy(message))
        if state.stateful:
            await self._conversation_projection.append(session_id, agent_name, [message])

    async def _fail(self, error: BaseException, state: _RunState) -> None:
        """§실행 오류: record the failure and report `turn.error` with its own codes.

        The `error` stage already ran where the specification asks for it, so a failure that
        reaches here is reported as it is ([§단계 실행 순서](spec)).
        """
        value = _execution_error(error)
        # §이벤트 순서: the model call or tool execution still running when the abort was
        # signalled reports step.error or tool.error with the code `aborted`.
        if isinstance(error, GoondanAbortError) and state.in_flight is not None:
            kind, payload = state.in_flight
            state.in_flight = None
            await self._emit(state.session, "step.error" if kind == "step" else "tool.error", state.agent_name, state.session_id, state.turn_id, {**payload, "codes": ["aborted"], "error": "the run was aborted"}, instance=state.instance, lineage=state.lineage)
        status = "aborted" if isinstance(error, GoondanAbortError) else "failed"
        await self._journal(state.session, [{
            "version": 1,
            "type": "agent.error",
            "sessionId": state.session_id,
            "agent": state.agent_name,
            "instance": state.instance,
            "turnId": state.turn_id,
            "executionId": state.execution_id,
            "data": {"status": status, "error": value, "usage": copy.deepcopy(state.record.usage)},
            **({"parentExecutionId": state.lineage.parent_execution_id} if state.lineage.parent_execution_id is not None else {}),
            **({"operationId": state.lineage.operation_id} if state.lineage.operation_id is not None else {}),
        }])

    # --- turns and routes ---------------------------------------------------------------------

    async def run(self, value: Json, *, session_id: str, start_agent: str | None = None, agent: str | None = None) -> dict[str, Any]:
        """입력을 수락하고 열린 턴이 있으면 그 턴의 안전 지점에 합류시킵니다."""
        self._check_host_session_id(session_id)
        self._require_open()
        if agent is not None and start_agent is not None:
            raise _route_error("a turn names either agent or start_agent")
        accept = self._turn_locks.setdefault(session_id, asyncio.Lock())
        async with accept:
            task = self._turn_tasks.get(session_id)
            if task is not None and not task.done():
                lineage = self._turn_lineages[session_id]
                input_id = uuid.uuid4().hex
                data: dict[str, Any] = {"input": copy.deepcopy(value)}
                if agent is not None: data["agent"] = agent
                if start_agent is not None: data["startAgent"] = start_agent
                await self._journal(None, [{"version": 1, "type": "input.received", "sessionId": session_id, "turnId": lineage.turn_id, "inputId": input_id, "data": data}])
                foreground = [run for run in self._runs.get(session_id, set()) if run.foreground and not run.aborted]
                targets = [agent or start_agent] if agent is not None or start_agent is not None else [run.agent for run in foreground]
                if not targets:
                    targets = [None]
                for target in dict.fromkeys(targets):
                    self._steering.setdefault(session_id, []).append((target, copy.deepcopy(value), None))
            else:
                lineage = _Lineage(None, None, uuid.uuid4().hex)
                await self._open_journal(session_id)
                input_id = uuid.uuid4().hex
                data = {"input": copy.deepcopy(value)}
                if agent is not None: data["agent"] = agent
                if start_agent is not None: data["startAgent"] = start_agent
                await self._journal(None, [
                    {"version": 1, "type": "turn.start", "sessionId": session_id, "turnId": lineage.turn_id, "data": {}},
                    {"version": 1, "type": "input.received", "sessionId": session_id, "turnId": lineage.turn_id, "inputId": input_id, "data": data},
                ])
                task = asyncio.create_task(self._execute_open_turn(value, session_id=session_id, start_agent=start_agent, agent=agent, lineage=lineage))
                self._turn_tasks[session_id] = task
                self._turn_lineages[session_id] = lineage
        return await asyncio.shield(task)

    async def _execute_open_turn(self, value: Json, *, session_id: str, start_agent: str | None, agent: str | None, lineage: _Lineage) -> dict[str, Any]:
        self._turn_counts[session_id] = self._turn_counts.get(session_id, 0) + 1
        try:
            scope = _Scope(session_id, True)
            records: list[_RunRecord] = []
            if agent is not None:
                if agent not in self.config["agents"]:
                    raise _route_error(f"unknown agent {agent!r}")
                result = await self._run_agent(agent, self._turn_input(agent, value, operation_id=lineage.operation_id), session_id, lineage=lineage, scope=scope, records=records, kind="turn")
                outputs = [(result["output"], result["finishReason"])]
            else:
                outputs = await self._run_routes(value, session_id, start_agent, scope, records, lineage)
            turn_result = self._turn_result(lineage.turn_id, outputs, records)
            accept = self._turn_locks[session_id]
            async with accept:
                await self._journal(None, [{"version": 1, "type": "turn.done", "sessionId": session_id, "turnId": lineage.turn_id, "data": {"result": copy.deepcopy(turn_result)}}])
                self._turn_tasks.pop(session_id, None)
                self._turn_lineages.pop(session_id, None)
                await self._close_journal(session_id)
            return turn_result
        except BaseException as error:
            writer = self._journal_writers.get(session_id)
            lease_failure = writer.failure if writer is not None else None
            if isinstance(error, asyncio.CancelledError) and lease_failure is not None:
                stopped: BaseException = lease_failure
            elif isinstance(error, asyncio.CancelledError):
                stopped = GoondanAbortError(f"turn {lineage.turn_id} in {session_id} was aborted")
            else:
                stopped = error
            value_error = _execution_error(stopped)
            status = "aborted" if isinstance(stopped, GoondanAbortError) else "failed"
            accept = self._turn_locks[session_id]
            async with accept:
                if lease_failure is None:
                    await self._journal(None, [{"version": 1, "type": "turn.error", "sessionId": session_id, "turnId": lineage.turn_id, "data": {"status": status, "error": value_error}}])
                self._turn_tasks.pop(session_id, None)
                self._turn_lineages.pop(session_id, None)
                await self._close_journal(session_id)
            if stopped is error:
                raise
            raise stopped from None
        finally:
            remaining = self._turn_counts.get(session_id, 1) - 1
            if remaining:
                self._turn_counts[session_id] = remaining
            else:
                self._turn_counts.pop(session_id, None)

    def _effective_routes(self, start_agent: str | None) -> list[Mapping[str, Any]]:
        declared = self.config.get("routes")
        if isinstance(declared, list):
            return [route for route in declared if isinstance(route, Mapping)]
        selected = start_agent or next(iter(self.config["agents"]), None)
        if not isinstance(selected, str):
            raise _route_error("the configuration declares no start agent")
        return [{"from": "$input", "to": selected}, {"from": selected, "to": "$output"}]

    def _departure_sets(self, routes: Sequence[Mapping[str, Any]]) -> dict[str, set[str]]:
        def key(endpoint: Any) -> str:
            return f"fn:{endpoint['fn']}" if isinstance(endpoint, Mapping) else str(endpoint)
        edges: dict[str, list[str]] = {}
        for route in routes:
            target = key(route["to"])
            if target != "$output":
                edges.setdefault(key(route["from"]), []).append(target)
        nodes = set(self.config["agents"])
        nodes.update(
            endpoint
            for route in routes
            for endpoint in (key(route["from"]), key(route["to"]))
            if endpoint.startswith("fn:")
        )
        found: dict[str, set[str]] = {}
        for target in self.config["agents"]:
            without = {source: [item for item in values if item != target] for source, values in edges.items() if source != target}
            sources = {
                source for source in nodes if source != target
                and self._graph_reaches(edges, source, target)
                and self._graph_reaches(without, "$input", source)
            }
            found[target] = sources
        return found

    @staticmethod
    def _graph_reaches(edges: Mapping[str, Sequence[str]], start: str, goal: str) -> bool:
        seen, stack = {start}, [start]
        while stack:
            current = stack.pop()
            if current == goal:
                return True
            for target in edges.get(current, ()):
                if target not in seen:
                    seen.add(target)
                    stack.append(target)
        return False

    async def _run_routes(self, value: Json, session_id: str, start_agent: str | None, scope: _Scope, records: list[_RunRecord], lineage: _Lineage) -> list[tuple[dict[str, Any], str]]:
        if start_agent is not None and start_agent not in self.config["agents"]:
            raise _route_error(f"unknown start agent {start_agent!r}")
        routes = self._effective_routes(start_agent)
        departures = self._departure_sets(routes)
        pending: dict[str, list[tuple[int, int, list[dict[str, Any]], list[dict[str, Any]]]]] = {}
        active: dict[asyncio.Task[Any], tuple[str, list[dict[str, Any]]]] = {}
        active_counts: dict[str, int] = {}
        completed: asyncio.Queue[asyncio.Task[Any]] = asyncio.Queue()
        routed_outputs: list[tuple[int, int, dict[str, Any], str]] = []
        sequence = 0

        def entry_messages(source_name: str) -> list[dict[str, Any]]:
            """$input이 함수 노드와 조건에 전달하는 호스트 입력 메시지입니다."""
            if is_message_array(value):
                return copy.deepcopy(value)
            if isinstance(value, list) and value and all(is_part(item) for item in value):
                content = copy.deepcopy(value)
            elif isinstance(value, str):
                content = [{"type": "text", "text": value}]
            else:
                content = [{"type": "json", "value": copy.deepcopy(value)}]
            return [{"id": uuid.uuid4().hex, "role": "user", "source": source_name, "content": content}]

        def launch(name: str, messages: list[dict[str, Any]], initial_input: list[dict[str, Any]], requests: list[list[dict[str, Any]]] | None = None) -> None:
            task = asyncio.create_task(self._run_agent(name, messages, session_id, lineage=lineage, scope=scope, records=records, kind="turn", input_requests=requests))
            active[task] = (name, initial_input)
            active_counts[name] = active_counts.get(name, 0) + 1
            task.add_done_callback(completed.put_nowait)

        async def run_function(name: str, route_index: int, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
            fn_name = name.removeprefix("fn:")
            context = {"session_id": session_id, "turn_id": lineage.turn_id, "route": route_index, "cancelled": False, "log": self.logger}
            try:
                output = await self._call_function(self.functions[fn_name], messages, context)
                if output is not None and not is_message_array(output):
                    raise GoondanError("a route function returns a message array or nothing")
                data: dict[str, Any] = {"route": route_index, "fn": fn_name, "status": "done", "input": copy.deepcopy(messages)}
                if output is not None:
                    data["output"] = copy.deepcopy(output)
                await self._journal(None, [{"version": 1, "type": "route.function", "sessionId": session_id, "turnId": lineage.turn_id, "data": data}])
            except asyncio.CancelledError:
                raise
            except Exception as broken:
                failure = _route_error(f"the route function {fn_name!r} failed: {broken}")
                await self._journal(None, [{"version": 1, "type": "route.function", "sessionId": session_id, "turnId": lineage.turn_id, "data": {"route": route_index, "fn": fn_name, "status": "error", "input": copy.deepcopy(messages), "error": failure.value()}}])
                raise failure from broken
            return {"functionOutput": output} if output is not None else None

        def launch_function(name: str, route_index: int, messages: list[dict[str, Any]]) -> None:
            task = asyncio.create_task(run_function(name, route_index, messages))
            active[task] = (name, copy.deepcopy(messages))
            active_counts[name] = active_counts.get(name, 0) + 1
            task.add_done_callback(completed.put_nowait)

        def launch_ready() -> None:
            progressed = True
            while progressed:
                progressed = False
                ordered = sorted((items[0][0], items[0][1], name) for name, items in pending.items() if items)
                for _, _, name in ordered:
                    items = pending.get(name, [])
                    if not items:
                        continue
                    stateful = self.config["agents"][name].get("stateful", True) is True
                    if not stateful:
                        route_index, order, messages, initial_input = items.pop(0)
                        if not items:
                            pending.pop(name, None)
                        launch(name, messages, initial_input, [messages])
                        progressed = True
                        continue
                    sources = departures.get(name, set())
                    if active_counts.get(name, 0) or any(active_counts.get(source, 0) or pending.get(source) for source in sources):
                        continue
                    pending.pop(name, None)
                    merged: list[dict[str, Any]] = []
                    ordered_items = sorted(items)
                    for _, _, messages, _ in ordered_items:
                        merged.extend(messages)
                    launch(name, merged, ordered_items[0][3], [messages for _, _, messages, _ in ordered_items])
                    progressed = True

        def endpoint_key(endpoint: Any) -> str:
            if isinstance(endpoint, Mapping):
                return f"fn:{endpoint['fn']}"
            return str(endpoint)

        def routed_messages(source: str, result: Mapping[str, Any] | None, condition_input: list[dict[str, Any]], target: str) -> list[dict[str, Any]]:
            if result is None:
                if source == "$input" and not target.startswith("fn:"):
                    return self._turn_input(target, value)
                return copy.deepcopy(condition_input)
            function_output = result.get("functionOutput")
            if isinstance(function_output, list):
                messages = copy.deepcopy(function_output)
                for message in messages:
                    meta = dict(message.get("meta", {})) if isinstance(message.get("meta"), Mapping) else {}
                    meta.update({"from": source.removeprefix("fn:"), "kind": "start"})
                    message["meta"] = meta
                return messages
            return [{
                "id": uuid.uuid4().hex,
                "role": "user",
                "source": target,
                "content": copy.deepcopy(result["output"]["content"]),
                "meta": {"from": source, "instance": result["instance"], "kind": "start"},
            }]

        async def route_from(source: str, result: Mapping[str, Any] | None, initial_input: list[dict[str, Any]] | None) -> None:
            nonlocal sequence
            candidates = [(index, route) for index, route in enumerate(routes) if endpoint_key(route.get("from")) == source]
            matched: list[tuple[int, Mapping[str, Any], list[dict[str, Any]]]] = []
            for index, route in candidates:
                target = endpoint_key(route["to"])
                condition_input = initial_input
                if condition_input is None:
                    if source == "$input":
                        condition_input = entry_messages("input")
                    else:
                        condition_input = self._turn_input(target if target != "$output" else next(iter(self.config["agents"])), value)
                function_output = result.get("functionOutput") if result is not None else None
                output = function_output if isinstance(function_output, list) else (result.get("output") if result is not None else None)
                text_value = input_text(function_output) if isinstance(function_output, list) else (output_text(output) if output is not None else input_text(condition_input))
                argument = {"output": copy.deepcopy(output), "text": text_value, "input": copy.deepcopy(condition_input)}
                if await self._route_matches(route, argument):
                    matched.append((index, route, condition_input))
            if candidates and not matched:
                raise _route_error(f"no route from {source!r} matched its condition")
            if not candidates:
                return
            for index, route, condition_input in matched:
                sequence += 1
                target = endpoint_key(route["to"])
                if target == "$output":
                    if result is None:
                        raise _route_error("$input cannot route directly to $output")
                    function_output = result.get("functionOutput")
                    if isinstance(function_output, list):
                        for message in function_output:
                            sequence += 1
                            routed_outputs.append((index, sequence, copy.deepcopy(message), "stop"))
                    else:
                        routed_outputs.append((index, sequence, copy.deepcopy(result["output"]), str(result["finishReason"])))
                    continue
                messages = routed_messages(source, result, condition_input, target)
                if target.startswith("fn:"):
                    launch_function(target, index, messages)
                    continue
                execution_input = messages if source == "$input" else condition_input
                pending.setdefault(target, []).append((index, sequence, messages, copy.deepcopy(execution_input)))
            launch_ready()

        try:
            if start_agent is None:
                await route_from("$input", None, None)
            else:
                initial_input = self._turn_input(start_agent, value)
                pending.setdefault(start_agent, []).append((-1, 0, initial_input, copy.deepcopy(initial_input)))
                launch_ready()
            while active:
                task = await completed.get()
                name, initial_input = active.pop(task)
                active_counts[name] -= 1
                if not active_counts[name]:
                    active_counts.pop(name)
                result = task.result()
                if result is None:
                    launch_ready()
                    continue
                await route_from(name, result, initial_input)
            if any(pending.values()):
                raise _route_error("the route graph left inputs waiting")
        except BaseException:
            for task in active:
                for run in self._runs.get(session_id, set()):
                    if run.task is task:
                        run.aborted = True
                task.cancel()
            if active:
                await asyncio.gather(*active, return_exceptions=True)
            pending.clear()
            raise
        routed_outputs.sort(key=lambda item: (item[0], item[1]))
        return [(message, reason) for _, _, message, reason in routed_outputs]

    async def _route_matches(self, route: Mapping[str, Any], argument: Mapping[str, Any]) -> bool:
        """§route 조건: 함수 조건과 출력 조건을 평가한다."""
        condition = route.get("when")
        if condition is None:
            return True
        if "fn" in condition:
            name = condition["fn"]
            try:
                decided = await _await(self.functions[name](copy.deepcopy(dict(argument))))
            except Exception as broken:
                raise _route_error(f"the route condition {name!r} failed: {broken}") from broken
            if not isinstance(decided, bool):
                raise _route_error(f"the route condition {name!r} must return true or false")
            return decided
        expected = condition.get("output")
        text = str(argument["text"])
        if isinstance(expected, str):
            return text == expected
        try:
            parsed = json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (ValueError, TypeError, json.JSONDecodeError):
            return False
        return isinstance(parsed, dict) and isinstance(expected, Mapping) and all(key in parsed and json_equal(parsed[key], value) for key, value in expected.items())

    def _combined(self, outputs: Sequence[tuple[dict[str, Any], str]]) -> tuple[dict[str, Any], str]:
        """§턴 결과, §종료 사유: the representative route output and its finish reason."""
        if not outputs:
            raise _route_error("the turn reached no output")
        if len(outputs) == 1:
            return copy.deepcopy(outputs[0][0]), outputs[0][1]
        reasons = [reason for _, reason in outputs]
        message = _message("assistant", "\n\n".join(output_text(item) for item, _ in outputs), "goondan")
        return message, reasons[0] if all(reason == reasons[0] for reason in reasons) else "other"

    def _turn_result(self, turn_id: str, outputs: Sequence[tuple[dict[str, Any], str]], records: Sequence[_RunRecord]) -> dict[str, Any]:
        """§턴 결과: what a successful turn returns."""
        result: dict[str, Any] = {
            "turnId": turn_id,
            "outputs": [copy.deepcopy(item) for item, _ in outputs],
            "usage": _total_usage(records),
            "status": "done",
            "runs": _listed(records),
        }
        if outputs:
            _, finish_reason = self._combined(outputs)
            result["output"] = "\n\n".join(output_text(item) for item, _ in outputs)
            result["finishReason"] = finish_reason
        return result

    # --- approval operations ------------------------------------------------------------------

    def _require_open(self) -> None:
        """§군단 객체 종료와 작업: 닫힌 객체는 새 요청을 받지 않는다."""
        if self._root._closed:
            raise GoondanExecutionError("runtime", ["runtime_error"], "the runtime is closed")

    def _invalid_operation(self, message: str) -> GoondanExecutionError:
        return GoondanExecutionError("runtime", ["operation_invalid"], message)

    def _start(self, work: Any, key: tuple[str, str]) -> None:
        """Carry on with an operation's execution or delivery without waiting for it."""
        root = self._root
        root._hold(key)
        task = asyncio.create_task(self._released(work, key))
        root._delivery_tasks.add(task)
        task.add_done_callback(root._delivery_tasks.discard)

    async def _released(self, work: Any, key: tuple[str, str]) -> None:
        try:
            await work
        finally:
            self._root._drop(key)

    def _hold(self, key: tuple[str, str]) -> None:
        counts = self._root._in_flight
        counts[key] = counts.get(key, 0) + 1

    def _drop(self, key: tuple[str, str]) -> None:
        counts = self._root._in_flight
        if counts.get(key, 0) > 1:
            counts[key] -= 1
        else:
            counts.pop(key, None)

    async def _list_operations(self, session_id: str | None = None) -> list[dict[str, Any]]:
        """저널을 fold하여 저장된 승인 작업을 반환합니다."""
        events = [event async for event in self.store.scan(session_id=session_id)] if session_id is not None else [event async for event in self.store.scan()]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for event in events:
            grouped.setdefault(str(event["sessionId"]), []).append(event)
        operations = [operation for sid, stream in grouped.items() for operation in fold(sid, stream)["operations"]]
        operations.sort(key=lambda operation: (operation["createdAt"], operation["sessionId"]))
        return copy.deepcopy(operations)

    def _operation_event(self, operation: Mapping[str, Any], event_type: str, data: Mapping[str, Any]) -> dict[str, Any]:
        event: dict[str, Any] = {
            "version": 1, "type": event_type, "sessionId": operation["sessionId"],
            "agent": operation["agent"], "instance": operation["instance"],
            "turnId": operation["turnId"], "executionId": operation["executionId"],
            "operationId": operation["operationId"], "data": copy.deepcopy(dict(data)),
        }
        return event

    async def _transition(self, session_id: str, operation_id: str, expected: Sequence[str], updates: Mapping[str, Any]) -> dict[str, Any] | None:
        writer = await self._open_journal(session_id)
        async with writer.lock:
            stream = [event async for event in self.store.scan(session_id=session_id)]
            state = fold(session_id, stream)
            operation = next((item for item in state["operations"] if item["operationId"] == operation_id), None)
            if operation is None or operation.get("status") not in expected:
                return None
            updated_at = _now()
            target = updates.get("status", operation["status"])
            event_type: str
            data: dict[str, Any] = {"updatedAt": updated_at}
            delivery_status = updates.get("deliveryStatus")
            delivery_outcome = updates.get("deliveryOutcome")
            if delivery_status == "delivering" and operation.get("deliveryStatus") == "pending":
                event_type = "operation.delivery.claimed"
            elif delivery_outcome in ("delivered", "failed", "interrupted") and operation.get("deliveryStatus") == "delivering":
                event_type = "operation.delivery.finished"
                data["outcome"] = delivery_outcome
                if delivery_outcome == "delivered":
                    data["deliveredAt"] = updates["deliveredAt"]
            elif operation["status"] == "pending" and target in ("approved", "rejected", "cancelled"):
                event_type = f"operation.{target}"
                if target == "approved" and "inputPatch" in updates:
                    data["inputPatch"] = copy.deepcopy(updates["inputPatch"])
                    data["resolvedToolCall"] = copy.deepcopy(updates["resolvedToolCall"])
            elif operation["status"] == "approved" and target == "running":
                event_type = "operation.execution.started"
            elif target == "completed" and operation["status"] == "running":
                event_type = "operation.completed"
                data["result"] = copy.deepcopy(updates["result"])
            elif target == "failed" and operation["status"] in ("approved", "running"):
                event_type = "operation.failed"
                data["error"] = str(updates["error"])
                data["errorCode"] = str(updates["errorCode"])
            else:
                return None
            stored = await self.store.append(
                [self._operation_event(operation, event_type, data)],
                expected=writer.expected,
                token=writer.lease.token,
                write_id=uuid.uuid4().hex,
            )
            writer.expected = stored[-1]["seq"]
        for event in stored:
            await self._publish(None, event)
        refreshed_stream = [event async for event in self.store.scan(session_id=session_id)]
        refreshed = fold(session_id, refreshed_stream)
        changed = next(item for item in refreshed["operations"] if item["operationId"] == operation_id)
        await self._operation_projection.save(changed)
        return copy.deepcopy(changed)

    async def _decide_operation(self, session_id: str, operation_id: str, decision: Any) -> dict[str, Any]:
        """§결정과 취소: approve or reject a pending operation and return it right away."""
        self._require_open()
        root = self._root
        await root._open_journal(session_id)
        operation = await root._operation_projection.get(session_id, operation_id)
        if operation is None:
            raise self._invalid_operation(f"session {session_id!r} has no operation {operation_id!r}")
        if not isinstance(decision, Mapping) or decision.get("decision") not in {"approved", "rejected", "cancelled"}:
            raise self._invalid_operation("a decision is an object whose decision is approved, rejected or cancelled")
        updates: dict[str, Any] = {"status": decision["decision"]}
        if "inputPatch" in decision:
            updates.update(await self._input_patch(operation, decision))
        updated = await self._transition(session_id, operation_id, ["pending"], updates)
        if updated is None:
            # §결정과 취소: an operation that is no longer pending keeps its stored state.
            return await root._operation_projection.get(session_id, operation_id) or operation
        key = (session_id, operation_id)
        if updated["status"] == "approved":
            root._start(root._execute_operation(updated), key)
        else:
            root._start(root._deliver_operation(updated), key)
        return updated

    async def _input_patch(self, operation: Mapping[str, Any], decision: Mapping[str, Any]) -> dict[str, Any]:
        """§결정과 취소 3, 4: the input patch and the call it resolves, once the host allows it."""
        patch = decision["inputPatch"]
        args = operation["toolCall"].get("args")
        if decision["decision"] != "approved" or not isinstance(patch, dict) or not is_json(patch) or not isinstance(args, dict):
            raise self._invalid_operation("an inputPatch approves a call whose arguments and patch are both JSON objects")
        resolved = {**copy.deepcopy(operation["toolCall"]), "args": _merge(args, patch)}
        try:
            configured = self._configured_tool(str(operation["agent"]), str(resolved["name"]))
            schema = {"type": "object"} if "agent" in configured else (self.tools.get(str(resolved["name"])) or (await self._session(str(operation["agent"]), str(operation["sessionId"]))).tools[str(resolved["name"])]).input
            if _schema._check(schema, schema, resolved["args"], []):
                raise self._invalid_operation("inputPatch does not satisfy the tool input schema")
        except GoondanExecutionError:
            raise
        except Exception as broken:
            raise self._invalid_operation(f"cannot validate inputPatch: {broken}") from broken
        return {"inputPatch": copy.deepcopy(patch), "resolvedToolCall": resolved}

    async def _execute_operation(self, operation: Mapping[str, Any]) -> None:
        """§승인된 작업의 실행: check the approved operation, run its tool and record the outcome."""
        session_id, operation_id = str(operation["sessionId"]), str(operation["operationId"])
        call = copy.deepcopy(operation.get("resolvedToolCall") or operation["toolCall"])
        approved = await self._validated_operation(operation, call)
        if isinstance(approved, str):
            # §승인된 작업의 실행 1: a failed check never reaches running and runs no tool.
            failed = await self._transition(session_id, operation_id, ["approved"], {"status": "failed", "error": approved, "errorCode": "validation_failed"})
            if failed is not None:
                await self._deliver_operation(failed)
            return
        runtime, agent_name, session = approved.runtime, approved.agent_name, approved.session
        stateless = runtime.config["agents"][agent_name].get("stateful", True) is not True
        lineage = _Lineage(None, str(operation["operationId"]), str(operation["turnId"]))
        instance = str(operation["instance"])
        delivery: Mapping[str, Any] | None = None
        try:
            # §승인된 작업의 실행 2: 그사이 취소된 작업은 실행하지 않는다.
            if await self._transition(session_id, operation_id, ["approved"], {"status": "running"}) is None:
                return
            agent_name_for_event, turn_id = agent_name, str(operation["turnId"])
            data = {"tool": call["name"], "callId": call["id"], "args": call["args"], "operationId": operation_id}
            try:
                await runtime._emit(session, "tool.start", agent_name_for_event, session_id, turn_id, dict(data), instance=instance, lineage=lineage)
                result = await runtime._operation_result(approved, operation, call)
            except asyncio.CancelledError:
                raise
            except Exception as broken:
                # §군단 객체 종료와 작업: 닫힌 뒤에 끝난 실행은 결과를 기록하지 않는다.
                if self._root._closed:
                    return
                codes = broken.codes if isinstance(broken, GoondanExecutionError) else ["tool_error"]
                failed = await self._transition(session_id, operation_id, ["running"], {"status": "failed", "error": str(broken), "errorCode": "execution_failed"})
                await runtime._emit(session, "tool.error", agent_name_for_event, session_id, turn_id, {**data, "codes": codes, "error": str(broken)}, instance=instance, lineage=lineage)
                delivery = failed
            else:
                # §군단 객체 종료와 작업: 닫힌 뒤에 끝난 실행은 결과를 기록하지 않는다.
                if self._root._closed:
                    return
                completed = await self._transition(session_id, operation_id, ["running"], {"status": "completed", "result": result})
                await runtime._emit(session, "tool.done", agent_name_for_event, session_id, turn_id, {**data, "result": result}, instance=instance, lineage=lineage)
                delivery = completed
        finally:
            if stateless:
                await runtime._dispose(session.extensions)
        if delivery is not None:
            await self._deliver_operation(delivery)

    async def _validated_operation(self, operation: Mapping[str, Any], call: Mapping[str, Any]) -> _Approved | str:
        """§승인된 작업의 실행 1: the checks before `running`, or the message of the first failure."""
        failed = "Operation validation failed"
        try:
            runtime, agent_name = self._resolve(str(operation["agent"]))
        except GoondanError:
            return failed
        agent = runtime.config["agents"][agent_name]
        try:
            configured = runtime._configured_tool(agent_name, str(call["name"]))
        except GoondanError:
            return failed
        try:
            session = await runtime._session(agent_name, str(operation["sessionId"]))
        except Exception:
            return failed
        stateless = agent.get("stateful", True) is not True
        accepted = False
        try:
            if "agent" in configured:
                if configured["agent"] not in runtime.config["agents"]:
                    return failed
                schema: Mapping[str, Any] = {"type": "object"}
            elif call["name"] not in runtime.tools and call["name"] not in session.tools:
                return failed
            else:
                tool = runtime.tools.get(str(call["name"])) or session.tools[str(call["name"])]
                schema = tool.input
            if _schema._check(schema, schema, call.get("args"), []):
                return failed
            accepted = True
            return _Approved(runtime, agent_name, session, configured)
        except Exception as broken:
            return str(broken)
        finally:
            if stateless and not accepted:
                await runtime._dispose(session.extensions)

    async def _operation_result(self, approved: _Approved, operation: Mapping[str, Any], call: Mapping[str, Any]) -> dict[str, Any]:
        """§승인된 작업의 실행 3, 4: run the tool of an approved operation and apply its hooks."""
        agent_name, session, configured = approved.agent_name, approved.session, approved.configured
        session_id, turn_id = str(operation["sessionId"]), str(operation["turnId"])
        operation_id, agent_name = str(operation["operationId"]), agent_name
        scope = _Scope(None, False)
        lineage = _Lineage(None, operation_id, turn_id)
        input_value: Json = {"type": "operation_execution", "operationId": operation_id}
        stateful = self.config["agents"][agent_name].get("stateful", True) is True
        conversation = await self._conversation_projection.load(session_id, agent_name) if stateful else []
        if "agent" in configured:
            target = str(configured["agent"])
            child = await self._run_agent(
                target,
                self._turn_input(target, call["args"]),
                session_id,
                lineage=_Lineage(None, operation_id, turn_id),
                scope=scope,
                kind="tool",
            )
            claimed: Mapping[str, Any] = {"content": child["output"]["content"]}
        else:
            tool = self.tools.get(str(call["name"])) or session.tools[str(call["name"])]
            context = self._tool_context(
                agent_name, session_id, turn_id, str(operation["instance"]), str(operation["executionId"]), input_value, conversation, call,
                operation.get("execution"), scope, None,
                _Lineage(None, operation_id, turn_id),
            )
            output = await _await(tool.execute(copy.deepcopy(call["args"]), context))
            claimed = _claimed_result(output)
        result = _tool_result(call, claimed)
        found = stage_error("onToolResult", result, str(call["id"]))
        if found:
            raise GoondanExecutionError("onToolResult", ["value_invalid"], f"the tool result {found}")
        instance = str(operation["instance"])
        state = _RunState(
            agent_name, session_id, instance, str(operation["executionId"]), turn_id, lineage, session, scope, None, input_value,
            [], conversation, stateful, Completion(effective=False), _RunRecord(agent_name, instance, str(operation["executionId"]), turn_id, lineage, "tool"), copy.deepcopy(conversation),
        )
        owned = state.execution_id not in self._scopes
        if owned: self._scopes[state.execution_id] = scope
        try:
            stage = await self._pipeline("onToolResult", result, state)
        finally:
            if owned: self._scopes.pop(state.execution_id, None)
        return stage.value

    async def _deliver_operation(self, operation: Mapping[str, Any]) -> None:
        """종료 작업의 완료 입력을 대상 인스턴스 대기열에 한 번 수락시킵니다."""
        root = self._root
        if root._closed or operation.get("status") not in TERMINAL_STATUSES:
            return
        session_id, operation_id = str(operation["sessionId"]), str(operation["operationId"])
        stream = [event async for event in root.store.scan(session_id=session_id)]
        stored = fold(session_id, stream) if stream else None
        current = next((item for item in stored["operations"] if item["operationId"] == operation_id), None) if stored is not None else None
        if current is None:
            await root._publish(None, {
                "type": "operation.completion.orphaned",
                "sessionId": session_id,
                "operationId": operation_id,
                "at": _now(),
                "observational": True,
                "data": {},
            })
            return
        claimed = await root._transition(session_id, operation_id, [str(current["status"])], {"deliveryStatus": "delivering"})
        if claimed is None:
            return
        completion = _completion_input(claimed)
        try:
            await root._accept_operation_input(claimed, completion)
        except asyncio.CancelledError:
            raise
        except Exception:
            if root._closed:
                return
            await root._transition(
                session_id,
                operation_id,
                [str(claimed["status"])],
                {"deliveryOutcome": "failed"},
            )
            return
        if root._closed:
            return
        await root._transition(
            session_id,
            operation_id,
            [str(claimed["status"])],
            {"deliveryOutcome": "delivered", "deliveredAt": _now()},
        )

    async def _accept_operation_input(self, operation: Mapping[str, Any], completion: Mapping[str, Any]) -> None:
        """완료 입력을 기록하고, 실행 종료를 기다리지 않은 채 처리 작업을 시작합니다."""
        session_id = str(operation["sessionId"])
        agent_name = str(operation["agent"])
        operation_id = str(operation["operationId"])
        accept = self._turn_locks.setdefault(session_id, asyncio.Lock())
        async with accept:
            task = self._turn_tasks.get(session_id)
            input_id = uuid.uuid4().hex
            if task is not None and not task.done():
                lineage = self._turn_lineages[session_id]
                await self._journal(None, [{
                    "version": 1,
                    "type": "input.received",
                    "sessionId": session_id,
                    "turnId": lineage.turn_id,
                    "inputId": input_id,
                    "operationId": operation_id,
                    "data": {"input": copy.deepcopy(dict(completion)), "agent": agent_name},
                }])
                self._steering.setdefault(session_id, []).append((agent_name, copy.deepcopy(dict(completion)), operation_id))
                return
            lineage = _Lineage(None, operation_id, uuid.uuid4().hex)
            await self._journal(None, [
                {"version": 1, "type": "turn.start", "sessionId": session_id, "turnId": lineage.turn_id, "data": {}},
                {
                    "version": 1,
                    "type": "input.received",
                    "sessionId": session_id,
                    "turnId": lineage.turn_id,
                    "inputId": input_id,
                    "operationId": operation_id,
                    "data": {"input": copy.deepcopy(dict(completion)), "agent": agent_name},
                },
            ])
            task = asyncio.create_task(self._execute_open_turn(dict(completion), session_id=session_id, start_agent=None, agent=agent_name, lineage=lineage))
            self._turn_tasks[session_id] = task
            self._turn_lineages[session_id] = lineage
            self._internal_turns.add(task)
            task.add_done_callback(self._internal_turns.discard)
            task.add_done_callback(_consume_task_result)

    def _delivery_lock(self, session_id: str) -> asyncio.Lock:
        locks = self._root._delivery_locks
        lock = locks.get(session_id)
        if lock is None:
            lock = locks[session_id] = asyncio.Lock()
        return lock

    async def _session_idle(self, session_id: str) -> None:
        """§완료 전달 3: wait until no other turn of this session is in progress."""
        while True:
            runs = self._root._runs.get(session_id)
            tasks = {run.task for run in runs if run.task is not None and not run.task.done()} if runs else set()
            if not tasks:
                return
            await asyncio.wait(tasks)

    async def close(self) -> None:
        """§군단 객체 종료와 작업: 실행을 중단하고 보유한 인스턴스를 정리한다."""
        if self._closed:
            return
        for session_id in set(self._runs) | set(self._turn_tasks):
            self.abort(session_id)
        current = asyncio.current_task()
        turns = [task for task in self._turn_tasks.values() if task is not current and not task.done()]
        for run in list(self._detached):
            run.aborted = True
            if run.task is not None: run.task.cancel()
        self._closed = True
        self._steering.clear()
        # §실행 중단: an approved operation and its completion delivery are only stopped here.
        background = list(self._delivery_tasks)
        for task in background:
            task.cancel()
        if background:
            await asyncio.gather(*background, return_exceptions=True)
        self._delivery_tasks.clear()
        for session in self._agent_sessions.values():
            tasks = list(session.pending.values())
            for task in tasks: task.cancel()
            if tasks: await asyncio.gather(*tasks, return_exceptions=True)
            session.pending.clear()
            await self._dispose(session.extensions)
        self._agent_sessions.clear()
        if turns:
            await asyncio.gather(*turns, return_exceptions=True)
        for session_id in list(self._journal_writers):
            await self._close_journal(session_id)


def create_goondan(config: Mapping[str, Any], **bindings: Any) -> Goondan:
    """구성과 호스트 바인딩으로 군단 객체를 만든다."""
    return Goondan(config=config, **bindings)
