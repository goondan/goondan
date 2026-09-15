"""Host bindings built from the case scripts, and the observations they record.

`CaseState` holds everything a case shares across runtimes: the gates, the script
cursors, the stores and the observations. `RuntimeBindings` builds one set of binding
objects for one runtime, so every call can be traced back to the runtime it belongs to.
"""

from __future__ import annotations

import copy
from typing import Any, Callable, Mapping, Sequence

from goondan import Extension, define_extension, define_tool
from goondan.store import InMemoryConversationStore, InMemoryOperationStore

from .casefile import HOST_CALLBACKS
from .errors import CaseFailure, ScriptError, UnsupportedFeature
from .gates import GateOwner, Gates
from .ops import HookBridge, OpRunner, resolve

EVENT_DATA_KEYS: dict[str, tuple[str, ...]] = {
    "turn.start": ("input",),
    "turn.done": ("output", "steps", "usage"),
    "turn.error": ("where", "codes"),
    "step.start": ("step",),
    "step.textDelta": ("step", "delta"),
    "step.done": ("step", "finishReason"),
    "step.error": ("step", "codes"),
    "tool.start": ("tool", "callId", "args"),
    "tool.done": ("tool", "callId", "args", "result"),
    "tool.error": ("tool", "callId", "args", "codes"),
    "humanApproval.created": ("operationId", "tool", "callId", "reasons"),
    "hook.applied": ("value", "hook"),
    "hook.skipped": ("value", "hook"),
    "hook.failed": ("value", "hook"),
}

OPERATION_TIMESTAMPS = ("createdAt", "updatedAt", "deliveredAt")


def snapshot(value: Any) -> Any:
    """Copy a value so later changes do not rewrite an observation."""
    if isinstance(value, Mapping):
        return {str(key): snapshot(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [snapshot(item) for item in value]
    return value


def read_member(holder: Any, name: str, camel: str) -> Any:
    """Read a context member by its Python name, accepting the serialized name as well."""
    for candidate in (name, camel):
        if isinstance(holder, Mapping):
            if candidate in holder:
                return holder[candidate]
        elif hasattr(holder, candidate):
            return getattr(holder, candidate)
    return None


def has_member(holder: Any, name: str, camel: str) -> bool:
    for candidate in (name, camel):
        if isinstance(holder, Mapping):
            if candidate in holder:
                return True
        elif hasattr(holder, candidate):
            return True
    return False


MEMBER_NAMES = {
    "agent": "agent", "conversation_id": "conversationId", "turn_id": "turnId", "step": "step",
    "tool_call": "toolCall", "input": "input", "conversation": "conversation", "execution": "execution",
    "retry_count": "retryCount",
}


def project_members(context: Any, names: Sequence[str]) -> dict[str, Any]:
    """Project the listed context members with camelCase keys, omitting the ones that are missing."""
    projected: dict[str, Any] = {}
    for name in names:
        camel = MEMBER_NAMES[name]
        if has_member(context, name, camel):
            projected[camel] = snapshot(read_member(context, name, camel))
    return projected


def project_operation(operation: Any) -> Any:
    if not isinstance(operation, Mapping):
        return snapshot(operation)
    return {key: snapshot(value) for key, value in operation.items() if key not in OPERATION_TIMESTAMPS}


def project_event(event: Mapping[str, Any]) -> dict[str, Any]:
    data = event.get("data")
    kept: dict[str, Any] = {}
    if isinstance(data, Mapping):
        allowed = EVENT_DATA_KEYS.get(str(event.get("name")))
        names = allowed if allowed is not None else tuple(key for key in data if key != "error")
        for key in names:
            if key in data:
                kept[key] = snapshot(data[key])
        if "operationId" in data and "operationId" not in kept:
            kept["operationId"] = snapshot(data["operationId"])
    return {"name": event.get("name"), "agent": event.get("agent"), "conversationId": event.get("conversationId"),
            "turnId": event.get("turnId"), "data": kept}


class Observations:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.model_inputs: dict[str, list[Any]] = {}
        self.model_contexts: dict[str, list[Any]] = {}
        self.tool_calls: list[dict[str, Any]] = []
        self.tool_contexts: list[dict[str, Any]] = []
        self.function_calls: list[dict[str, Any]] = []
        self.hook_calls: list[dict[str, Any]] = []
        self.hook_contexts: list[dict[str, Any]] = []
        self.host_calls: list[dict[str, Any]] = []
        self.extension_log: list[dict[str, Any]] = []


class RecordingConversationStore(InMemoryConversationStore):
    """The host's in-memory conversation store with a record of the scopes it stored.

    The runner store is the language's memory store plus recording, so the runtime sees
    exactly the store protocol the host ships. Scopes come out in the order they were
    first written; a scope that was only read is not an observation.
    """

    def observation(self) -> dict[str, Any]:
        return {f"{conversation_id}/{agent}": snapshot(messages)
                for (conversation_id, agent), messages in self.conversations.items()}


class RecordingOperationStore(InMemoryOperationStore):
    """The host's in-memory operation store with a record of the changes it accepted.

    Every method the runtime calls goes through the store the host ships, and the runner
    only adds the history entry a change that was accepted produces. A transition the
    store refused returns `None` and leaves the history alone.
    """

    def __init__(self) -> None:
        super().__init__()
        self.history: dict[tuple[str, str], list[str]] = {}

    def _note(self, operation: Any) -> None:
        if not isinstance(operation, Mapping):
            return
        key = (str(operation.get("conversationId")), str(operation.get("operationId")))
        entries = self.history.setdefault(key, [])
        entry = f"{operation.get('status')}/{operation.get('deliveryStatus')}"
        if not entries or entries[-1] != entry:
            entries.append(entry)

    async def save(self, operation: dict[str, Any]) -> None:
        await super().save(operation)
        self._note(operation)

    async def transition(self, *arguments: Any, **options: Any) -> dict[str, Any] | None:
        changed = await super().transition(*arguments, **options)
        self._note(changed)
        return changed

    async def claim_delivery(self, *arguments: Any, **options: Any) -> dict[str, Any] | None:
        changed = await super().claim_delivery(*arguments, **options)
        self._note(changed)
        return changed

    async def release_delivery(self, *arguments: Any, **options: Any) -> dict[str, Any] | None:
        changed = await super().release_delivery(*arguments, **options)
        self._note(changed)
        return changed

    def keys(self) -> list[tuple[str, str]]:
        """The stored operations in the order they were first saved."""
        return list(self.operations)

    def aliases(self) -> dict[str, str]:
        """Map each operation identifier to `<op:callId>`, numbering repeats from the second."""
        used: dict[str, int] = {}
        mapping: dict[str, str] = {}
        for key in self.keys():
            operation = self.operations.get(key, {})
            call = operation.get("toolCall") if isinstance(operation, Mapping) else None
            call_id = call.get("id") if isinstance(call, Mapping) else None
            label = str(call_id) if isinstance(call_id, str) else "unknown"
            used[label] = used.get(label, 0) + 1
            suffix = "" if used[label] == 1 else f"#{used[label]}"
            mapping[key[1]] = f"<op:{label}{suffix}>"
        return mapping

    def observation_history(self, aliases: Mapping[str, str]) -> dict[str, list[str]]:
        return {aliases.get(key[1], key[1]): list(entries) for key, entries in self.history.items()}


class CaseState:
    """Everything one case shares between its runtimes."""

    def __init__(self, case: Mapping[str, Any], case_path: str):
        self.case = case
        self.case_path = case_path
        self.gates = Gates()
        self.ops = OpRunner(self.gates)
        self.observations = Observations()
        self.conversation_store = RecordingConversationStore()
        self.operation_store = RecordingOperationStore()
        self.model_cursor: dict[str, int] = {}
        self.tool_cursor: dict[str, int] = {}
        self.instances = 0
        self.problems: list[str] = []
        self.unsupported: list[str] = []

    @property
    def bindings(self) -> Mapping[str, Any]:
        found = self.case.get("bindings", {})
        return found if isinstance(found, Mapping) else {}

    def fail(self, problem: str) -> None:
        if problem not in self.problems:
            self.problems.append(problem)

    def note_unsupported(self, feature: str) -> None:
        if feature not in self.unsupported:
            self.unsupported.append(feature)

    def unsupported_feature(self, feature: str) -> UnsupportedFeature:
        self.note_unsupported(feature)
        return UnsupportedFeature(feature)

    def next_model_response(self, name: str) -> Mapping[str, Any]:
        script = self.bindings.get("models", {}).get(name, {})
        responses = script.get("responses", [])
        used = self.model_cursor.get(name, 0)
        if used >= len(responses):
            self.fail(f"the model {name!r} was called {used + 1} times but the case scripts {len(responses)} responses")
            raise ScriptError(f"the model {name!r} has no response left")
        self.model_cursor[name] = used + 1
        return responses[used]

    def next_tool_result(self, key: str, results: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
        used = self.tool_cursor.get(key, 0)
        if used >= len(results):
            self.fail(f"the tool {key!r} was called {used + 1} times but the case scripts {len(results)} results")
            raise ScriptError(f"the tool {key!r} has no result left")
        self.tool_cursor[key] = used + 1
        return results[used]

    def unused_scripts(self) -> list[str]:
        left: list[str] = []
        for name, script in self.bindings.get("models", {}).items():
            remaining = len(script.get("responses", [])) - self.model_cursor.get(name, 0)
            if remaining > 0:
                left.append(f"the model {name!r} has {remaining} unused responses")
        for key, count in self.tool_script_sizes().items():
            remaining = count - self.tool_cursor.get(key, 0)
            if remaining > 0:
                left.append(f"the tool {key!r} has {remaining} unused results")
        return left

    def tool_script_sizes(self) -> dict[str, int]:
        sizes = {name: len(script.get("results", [])) for name, script in self.bindings.get("tools", {}).items()}
        for name, script in self.bindings.get("extensions", {}).items():
            instance = script.get("instance", {}) if isinstance(script, Mapping) else {}
            for tool_name, tool_script in (instance.get("tools", {}) or {}).items():
                sizes[f"{name}.{tool_name}"] = len(tool_script.get("results", []))
        return sizes

    def observation_document(self, effective_config: Any, operations: Any) -> dict[str, Any]:
        aliases = self.operation_store.aliases()
        observed = self.observations
        return {
            "effectiveConfig": effective_config,
            "events": observed.events,
            "modelInputs": observed.model_inputs,
            "modelContexts": observed.model_contexts,
            "toolCalls": observed.tool_calls,
            "toolContexts": observed.tool_contexts,
            "functionCalls": observed.function_calls,
            "hookCalls": observed.hook_calls,
            "hookContexts": observed.hook_contexts,
            "hostCalls": observed.host_calls,
            "extensionLog": observed.extension_log,
            "conversations": self.conversation_store.observation(),
            "operations": operations,
            "operationHistory": self.operation_store.observation_history(aliases),
        }


class RuntimeBindings:
    """The binding objects of one runtime."""

    def __init__(self, state: CaseState, label: str):
        self.state = state
        self.owner = GateOwner(label)
        self.models = {name: self._model(name) for name in state.bindings.get("models", {})}
        self.tools = {name: self._tool(name, name, script) for name, script in state.bindings.get("tools", {}).items()}
        self.functions = {name: self._function(name, op) for name, op in state.bindings.get("functions", {}).items()}
        self.extensions = {name: self._extension(name, script) for name, script in state.bindings.get("extensions", {}).items()}
        self.ports = copy.deepcopy(dict(state.bindings.get("ports", {})))
        self.host = self._host()

    # -- models --------------------------------------------------------------------------

    def _model(self, name: str) -> Any:
        state = self.state
        owner = self.owner

        class ScriptedModel:
            async def generate(self, model_input: Any, context: Any = None) -> Any:
                state.observations.model_inputs.setdefault(name, []).append(snapshot(model_input))
                state.observations.model_contexts.setdefault(name, []).append(
                    project_members(context, ("agent", "conversation_id", "turn_id", "step")) if context is not None else None
                )
                response = state.next_model_response(name)
                return await self._respond(response, context)

            async def _respond(self, response: Mapping[str, Any], context: Any) -> Any:
                if "await" in response:
                    await state.gates.wait(response["await"], owner)
                    return await self._respond(response["then"], context)
                if "error" in response:
                    raise ScriptError(response["error"], response.get("code"))
                for delta in response.get("deltas", []):
                    if context is None or not has_member(context, "on_text_delta", "onTextDelta"):
                        raise state.unsupported_feature("model context 'on_text_delta'")
                    await resolve(read_member(context, "on_text_delta", "onTextDelta")(delta))
                if "raw" in response:
                    return copy.deepcopy(response["raw"])
                if "text" in response:
                    content = [{"type": "text", "text": response["text"]}]
                elif "toolCalls" in response:
                    content = [{"type": "tool.call", "callId": call["callId"], "name": call["name"],
                                "args": copy.deepcopy(call["args"])} for call in response["toolCalls"]]
                else:
                    content = copy.deepcopy(response["content"])
                message: dict[str, Any] = {"role": "assistant", "content": content}
                for key in ("id", "source", "meta"):
                    if key in response:
                        message[key] = copy.deepcopy(response[key])
                calls = any(part.get("type") == "tool.call" for part in content if isinstance(part, Mapping))
                result: dict[str, Any] = {"message": message,
                                          "finishReason": response.get("finishReason", "tool" if calls else "stop")}
                if "usage" in response:
                    result["usage"] = copy.deepcopy(response["usage"])
                return result

            async def __call__(self, model_input: Any, context: Any = None) -> Any:
                return await self.generate(model_input, context)

        return ScriptedModel()

    # -- tools ---------------------------------------------------------------------------

    def _tool(self, name: str, key: str, script: Mapping[str, Any]) -> Any:
        state = self.state
        owner = self.owner
        results = script.get("results", [])

        async def execute(args: Any, context: Any) -> Any:
            state.observations.tool_calls.append({"tool": name, "args": snapshot(args)})
            projected = {"tool": name}
            projected.update(project_members(context, ("agent", "conversation_id", "turn_id")))
            call = read_member(context, "tool_call", "toolCall")
            if call is not None:
                projected["toolCall"] = {"id": read_member(call, "id", "id"), "name": read_member(call, "name", "name"),
                                         "args": snapshot(read_member(call, "args", "args"))}
            projected.update(project_members(context, ("input", "conversation")))
            execution = read_member(context, "execution", "execution")
            projected["execution"] = snapshot(execution) if isinstance(execution, Mapping) else {}
            state.observations.tool_contexts.append(projected)
            return await run_result(state.next_tool_result(key, results), context)

        async def run_result(item: Mapping[str, Any], context: Any) -> Any:
            if "await" in item:
                await state.gates.wait(item["await"], owner)
                return await run_result(item["then"], context)
            if "error" in item:
                raise ScriptError(item["error"])
            if "raw" in item:
                return copy.deepcopy(item["raw"])
            if "runAgent" in item:
                request = item["runAgent"]
                run = read_member(context, "run_agent", "runAgent")
                if run is None:
                    raise state.unsupported_feature("tool context 'run_agent'")
                outcome = await resolve(run(request["name"], copy.deepcopy(request.get("input"))))
                output = outcome.get("output") if isinstance(outcome, Mapping) else None
                content = output.get("content") if isinstance(output, Mapping) else None
                return snapshot(content)
            if "text" in item:
                content = [{"type": "text", "text": item["text"]}]
            elif "json" in item:
                content = [{"type": "json", "value": copy.deepcopy(item["json"])}]
            else:
                content = copy.deepcopy(item["content"])
            extras = {extra: copy.deepcopy(item[extra]) for extra in ("isError", "keep", "meta") if extra in item}
            return {"content": content, **extras} if extras else content

        return define_tool(name=name, description=script.get("description", ""),
                           input=copy.deepcopy(script.get("input", {"type": "object"})), execute=execute)

    # -- functions -----------------------------------------------------------------------

    def _function(self, name: str, op: Mapping[str, Any]) -> Callable[..., Any]:
        state = self.state
        owner = self.owner

        async def call(value: Any) -> Any:
            state.observations.function_calls.append({"fn": name, "value": snapshot(value)})
            return await state.ops.run(op, value, site=f"functions/{name}", owner=owner)

        return call

    # -- extensions ----------------------------------------------------------------------

    def _extension(self, name: str, script: Mapping[str, Any]) -> Any:
        state = self.state
        owner = self.owner
        definition = script.get("definition", {}) or {}
        instance_script = script.get("instance", {}) or {}

        async def validate_options(options: Any) -> Any:
            state.observations.extension_log.append({"action": "validateOptions", "extension": name, "options": snapshot(options)})
            return await state.ops.run(definition["validateOptions"], options, site=f"extensions/{name}/definition/validateOptions", owner=owner)

        def create(**inputs: Any) -> Extension:
            state.instances += 1
            number = state.instances
            agent = inputs.get("agent")
            state.observations.extension_log.append({
                "action": "create", "instance": number, "extension": name,
                "options": snapshot(inputs.get("options")), "ports": snapshot(inputs.get("ports")),
                "agent": snapshot(agent),
            })
            if "createError" in definition:
                raise ScriptError(definition["createError"])
            hooks = {stage: self._hook(name, stage, op) for stage, op in (instance_script.get("hooks", {}) or {}).items()}
            tools = [self._tool(tool_name, f"{name}.{tool_name}", tool_script)
                     for tool_name, tool_script in (instance_script.get("tools", {}) or {}).items()]
            events = {event: self._event_handler(number, event) for event in (instance_script.get("events", []) or [])}

            async def dispose() -> None:
                state.observations.extension_log.append({"action": "dispose", "instance": number})

            return Extension(hooks=hooks, tools=tools, on=events, dispose=dispose)

        arguments: dict[str, Any] = {"name": name, "create": create}
        for key in ("requires", "hooks", "tools"):
            if key in definition:
                arguments[key] = list(definition[key])
        if "validateOptions" in definition:
            arguments["validate_options"] = validate_options
        return define_extension(**arguments)

    def _hook(self, extension: str, stage: str, op: Mapping[str, Any]) -> Callable[..., Any]:
        state = self.state
        owner = self.owner

        async def hook(value: Any, context: Any) -> Any:
            state.observations.hook_calls.append({"extension": extension, "stage": stage, "value": snapshot(value)})
            projected = {"extension": extension, "stage": stage}
            projected.update(project_members(context, ("agent", "conversation_id", "turn_id", "input", "conversation", "retry_count")))
            state.observations.hook_contexts.append(projected)
            return await state.ops.run(op, value, site=f"extensions/{extension}/instance/hooks/{stage}",
                                       owner=owner, hook=HookBridge(context, state.note_unsupported))

        return hook

    def _event_handler(self, instance: int, event: str) -> Callable[..., Any]:
        state = self.state

        async def handle(value: Any) -> None:
            state.observations.extension_log.append({"action": "event", "instance": instance, "name": event})

        return handle

    # -- host callbacks and events -------------------------------------------------------

    def _host(self) -> Any:
        scripts = self.state.bindings.get("host", {})
        if not scripts:
            return None
        namespace: dict[str, Any] = {}
        for callback, script in scripts.items():
            namespace[HOST_CALLBACKS[callback]] = staticmethod(self._callback(callback, script))
        return type("ConformanceHost", (), namespace)()

    def _callback(self, callback: str, script: Any) -> Callable[..., Any]:
        state = self.state
        owner = self.owner
        defaults = {"validateOperation": True, "validateOperationInputPatch": True}

        async def call(*arguments: Any) -> Any:
            if callback == "validateOperationInputPatch":
                if len(arguments) != 2:
                    raise CaseFailure(f"{callback} expects the operation and the input patch, got {len(arguments)} arguments")
                value: Any = {"operation": project_operation(arguments[0]), "inputPatch": snapshot(arguments[1])}
            elif callback == "validateOperation":
                value = project_operation(arguments[0]) if arguments else None
            else:
                value = snapshot(arguments[0]) if arguments else None
            state.observations.host_calls.append({"callback": callback, "value": value})
            if script is True:
                return defaults.get(callback)
            return await state.ops.run(script, value, site=f"host/{callback}", owner=owner)

        return call

    def emit(self) -> Callable[..., Any]:
        state = self.state

        async def receive(event: Any) -> None:
            if not isinstance(event, Mapping):
                state.fail(f"an event must be an object, got {type(event).__name__}")
                return
            at = event.get("at")
            if isinstance(at, bool) or not isinstance(at, (int, float)):
                state.fail(f"the event {event.get('name')!r} must have a number 'at'")
            state.observations.events.append(project_event(event))

        return receive
