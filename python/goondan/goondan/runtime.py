from __future__ import annotations

import asyncio
import copy
import inspect
import json
import math
import time
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, Protocol

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined, TemplateSyntaxError, meta, nodes

Json = None | bool | int | float | str | list["Json"] | dict[str, "Json"]
ValueName = str
VALUE_NAMES = {"input", "conversation", "modelInput", "modelResult", "toolCall", "toolResult", "output", "error"}
ALLOWED_FILTERS = {"default", "join", "trim", "length", "upper", "lower", "replace", "json"}


class GoondanError(Exception):
    pass


class GoondanExecutionError(GoondanError):
    def __init__(self, where: str, cause: Exception):
        super().__init__(str(cause)); self.where = where; self.cause = cause


async def _await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _merge(base: Any, overlay: Any) -> Any:
    if isinstance(base, dict) and isinstance(overlay, dict):
        result = copy.deepcopy(base)
        for key, value in overlay.items():
            result[key] = _merge(result[key], value) if key in result else copy.deepcopy(value)
        return result
    return copy.deepcopy(overlay)


class GoondanConfig(dict[str, Any]):
    """Validated Goondan configuration with its project root attached."""


def _normalize_declared_paths(raw: dict[str, Any], directory: Path) -> dict[str, Any]:
    result = copy.deepcopy(raw)
    agents = result.get("agents")
    for agent in agents.values() if isinstance(agents, dict) else []:
        if not isinstance(agent, dict):
            continue
        if isinstance(agent.get("config"), str):
            agent["config"] = str((directory / agent["config"]).resolve())
        input_rule = agent.get("input")
        if isinstance(input_rule, dict) and isinstance(input_rule.get("template"), str):
            input_rule["template"] = str((directory / input_rule["template"]).resolve())
        blocks = agent.get("systemMessage", [])
        for block in ([blocks] if isinstance(blocks, dict) else blocks or []):
            if isinstance(block, dict) and isinstance(block.get("template"), str):
                block["template"] = str((directory / block["template"]).resolve())
        hooks = agent.get("hooks")
        if isinstance(hooks, dict):
            for entries in hooks.values():
                for entry in entries if isinstance(entries, list) else []:
                    if isinstance(entry, dict) and isinstance(entry.get("template"), str):
                        entry["template"] = str((directory / entry["template"]).resolve())
    flow = result.get("flow")
    if isinstance(flow, dict):
        for route in flow.get("routes", []):
            carry = route.get("carry", {})
            message = carry.get("message")
            if isinstance(message, dict) and isinstance(message.get("template"), str):
                message["template"] = str((directory / message["template"]).resolve())
    return result


def _config_entry(path: Path) -> Path:
    resolved = path.resolve()
    return resolved / "goondan.yaml" if resolved.is_dir() else resolved


def _load_yaml(path: Path, loaded: set[Path] | None = None, stack: tuple[Path, ...] = ()) -> dict[str, Any]:
    loaded = set() if loaded is None else loaded
    path = _config_entry(path)
    if path in stack:
        chain = " -> ".join(str(item) for item in (*stack, path))
        raise GoondanError(f"configuration resource cycle: {chain}")
    if path in loaded:
        raise GoondanError(f"duplicate configuration resource: {path}")
    if not path.exists():
        raise GoondanError(f"configuration resource does not exist: {path}")
    if not path.is_file() or path.suffix.lower() not in {".yaml", ".yml"}:
        raise GoondanError(f"configuration resource must be a YAML file or directory: {path}")
    loaded.add(path)
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as error:
        raise GoondanError(f"cannot load {path}: {error}") from error
    if not isinstance(raw, dict):
        raise GoondanError(f"configuration document must be an object: {path}")
    parent = raw.pop("extends", None)
    resources = raw.pop("resources", [])
    if parent is not None and not isinstance(parent, str):
        raise GoondanError(f"extends must be a string: {path}")
    if not isinstance(resources, list) or any(not isinstance(item, str) for item in resources):
        raise GoondanError(f"resources must be a list of paths: {path}")
    merged: dict[str, Any] = {}
    next_stack = (*stack, path)
    if parent:
        merged = _merge(merged, _load_yaml(path.parent / parent, loaded, next_stack))
    for resource in resources:
        merged = _merge(merged, _load_yaml(path.parent / resource, loaded, next_stack))
    return _merge(merged, _normalize_declared_paths(raw, path.parent))


def _resolve_config(config: dict[str, Any]) -> dict[str, Any]:
    config = copy.deepcopy(config)
    raw_agents = config.get("agents", {})
    resolved: dict[str, Any] = {}
    active: set[str] = set()
    def resolve_agent(name: str) -> dict[str, Any]:
        if name in resolved: return resolved[name]
        if name in active: raise GoondanError(f"Circular agent inheritance: {name}")
        if name not in raw_agents: raise GoondanError(f"Unknown inherited agent: {name}")
        active.add(name)
        raw = copy.deepcopy(raw_agents[name])
        parent = raw.pop("inherit", None)
        removal = raw.pop("remove", {})
        agent = _merge(resolve_agent(parent) if parent else {}, raw)
        if set(removal) - {"extensions", "tools", "hooks"}: raise GoondanError("Unknown removal field")
        for key in ("extensions", "tools"):
            if key in removal and (not isinstance(removal[key], list) or any(not isinstance(item, str) for item in removal[key])): raise GoondanError(f"remove.{key} must be an array of names")
        for item in removal.get("extensions", []): agent.setdefault("extensions", {}).pop(item, None)
        if "tools" in removal:
            agent["tools"] = [tool for tool in agent.get("tools", []) if (tool if isinstance(tool, str) else tool.get("tool", tool.get("agent"))) not in removal["tools"]]
        for phase, names in removal.get("hooks", {}).items():
            if phase not in VALUE_NAMES or not isinstance(names, list): raise GoondanError("Invalid remove.hooks")
            agent.setdefault("hooks", {})[phase] = [hook for hook in agent.get("hooks", {}).get(phase, []) if hook.get("name", hook.get("extension", hook.get("fn", hook.get("template", "")))) not in names]
        for phase, hooks in agent.get("hooks", {}).items():
            for hook in hooks:
                if "extension" in hook and hook["extension"] not in agent.get("extensions", {}) and hook["extension"] not in removal.get("extensions", []): raise GoondanError(f"Unknown configured extension: {hook['extension']}")
            agent["hooks"][phase] = [hook for hook in hooks if "extension" not in hook or (hook["extension"] in agent.get("extensions", {}) and agent["extensions"][hook["extension"]].get("enabled", True))]
        active.remove(name); resolved[name] = agent; return agent
    for name in raw_agents: resolve_agent(name)
    config["agents"] = {name: resolved[name] for name in raw_agents}
    config.setdefault("version", 1); config.setdefault("name", "goondan")
    flow = config.get("flow")
    if flow is None and raw_agents: config["flow"] = {"in": next(iter(raw_agents))}
    elif isinstance(flow, list):
        if not flow or any(not isinstance(name, str) for name in flow): raise GoondanError("flow must contain agent names")
        if len(flow) != len(set(flow)): raise GoondanError("flow must contain unique agent names")
        config["flow"] = {"in": flow[0], "routes": [{"from": name, "to": flow[index + 1] if index + 1 < len(flow) else "out"} for index, name in enumerate(flow)]}
    return config


def load_config(directory: str | Path, variants: list[str] | None = None) -> GoondanConfig:
    root = Path(directory).resolve()
    path = _config_entry(root)
    loaded: set[Path] = set()
    config = _load_yaml(path, loaded)
    config["__root__"] = str(path.parent)
    for variant in variants or []:
        variant_path = path.parent / "variants" / (variant if variant.endswith((".yaml", ".yml")) else f"{variant}.yaml")
        variant_raw = _load_yaml(variant_path)
        variant_raw.pop("__root__", None)
        config = _merge(config, variant_raw)
    config = _resolve_config(config)
    validate_config(config)
    return GoondanConfig(config)


def validate_config(config: Mapping[str, Any]) -> None:
    errors: list[str] = []
    if config.get("version") != 1:
        errors.append("version must be 1")
    agents = config.get("agents")
    if not isinstance(agents, Mapping) or not agents:
        errors.append("agents must be a non-empty object")
        agents = {}
    flow = config.get("flow", {})
    if flow and flow.get("in") not in agents:
        errors.append("flow.in must name an agent")
    for route in flow.get("routes", []):
        if route.get("from") not in agents or (route.get("to") != "out" and route.get("to") not in agents): errors.append("Unknown flow agent")
    for agent_name, agent in agents.items():
        if not isinstance(agent, Mapping):
            errors.append(f"agents.{agent_name} must be an object")
            continue
        if "config" not in agent and "model" not in agent:
            errors.append(f"agents.{agent_name}.model is required")
        for tool in agent.get("tools", []):
            if isinstance(tool, Mapping) and "endsTurn" in tool: errors.append("Tool execution policy belongs in a toolResult hook")
        configured_extensions = agent.get("extensions", {}) or {}
        if not isinstance(configured_extensions, Mapping):
            errors.append(f"agents.{agent_name}.extensions must be an object")
            configured_extensions = {}
        for extension_name, extension_config in configured_extensions.items():
            if not isinstance(extension_config, Mapping):
                errors.append(f"agents.{agent_name}.extensions.{extension_name} must be an object")
            elif "extension" in extension_config or "ext" in extension_config:
                errors.append(f"agents.{agent_name}.extensions.{extension_name}.extension is not supported")
        hooks = agent.get("hooks", {})
        for value_name, entries in hooks.items():
            if value_name not in VALUE_NAMES:
                errors.append(f"agents.{agent_name}.hooks.{value_name} is not a value")
            if not isinstance(entries, list):
                errors.append(f"agents.{agent_name}.hooks.{value_name} must be a list")
                continue
            names: set[str] = set()
            for entry in entries:
                if not isinstance(entry, Mapping):
                    errors.append(f"agents.{agent_name}.hooks.{value_name} entry must be an object")
                    continue
                name = _hook_name(entry)
                if name in names and "name" not in entry:
                    errors.append(f"duplicate derived hook name {name} in {agent_name}.{value_name}")
                names.add(name)
                if entry.get("mode") == "async" and value_name != "conversation":
                    errors.append(f"async hook {name} must be a conversation hook")
        extension_names = set((agent.get("extensions") or {}).keys())
        for value_name, entries in hooks.items():
            for entry in entries:
                if isinstance(entry, Mapping) and "extension" in entry and entry["extension"] not in extension_names:
                    errors.append(f"unknown extension instance {entry['extension']} in {agent_name}.{value_name}")
    if errors:
        raise GoondanError("invalid configuration:\n- " + "\n- ".join(errors))


def _hook_name(spec: Mapping[str, Any]) -> str:
    if "name" in spec:
        return str(spec["name"])
    if "extension" in spec:
        return str(spec["extension"])
    for key in ("fn", "agent", "template"):
        if key in spec:
            value = spec[key]
            return "+".join(value) if isinstance(value, list) else str(value)
    return "inline"


def _text(parts: Any) -> str:
    if isinstance(parts, str):
        return parts
    if isinstance(parts, Mapping) and "content" in parts:
        parts = parts["content"]
    if not isinstance(parts, list):
        return _json(parts, 0)
    return "".join(str(part.get("text", "")) for part in parts if isinstance(part, Mapping) and part.get("type") == "text")


def _number(value: int | float) -> str:
    if isinstance(value, int): return str(value)
    if not math.isfinite(value): raise GoondanError("JSON numbers must be finite")
    if value == 0: return "0"
    absolute = abs(value)
    raw = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        if "e" in raw:
            raw = format(Decimal(raw), "f").rstrip("0").rstrip(".")
        elif raw.endswith(".0"):
            raw = raw[:-2]
        return raw
    if "e" not in raw: return raw
    mantissa, exponent = raw.split("e")
    mantissa = mantissa.rstrip("0").rstrip(".")
    sign = "+" if int(exponent) >= 0 else "-"
    return f"{mantissa}e{sign}{abs(int(exponent))}"


def _json(value: Any, indent: int = 2, level: int = 0) -> str:
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, (int, float)): return _number(value)
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    compact = indent == 0
    if isinstance(value, list):
        if not value: return "[]"
        if compact: return "[" + ",".join(_json(item, 0) for item in value) + "]"
        inner = ",\n".join("  " * (level + 1) + _json(item, indent, level + 1) for item in value)
        return "[\n" + inner + "\n" + "  " * level + "]"
    if isinstance(value, Mapping):
        if not value: return "{}"
        if compact: return "{" + ",".join(f"{json.dumps(str(key), ensure_ascii=False)}:{_json(item, 0)}" for key, item in value.items()) + "}"
        inner = ",\n".join("  " * (level + 1) + f"{json.dumps(str(key), ensure_ascii=False)}: {_json(item, indent, level + 1)}" for key, item in value.items())
        return "{\n" + inner + "\n" + "  " * level + "}"
    raise GoondanError(f"value is not JSON: {type(value).__name__}")


def _message(role: str, text: str, source: str, *, key: str | None = None, keep: bool = False, meta_value: dict[str, Json] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"id": uuid.uuid4().hex, "role": role, "content": [{"type": "text", "text": text}], "source": source}
    if key is not None:
        result["key"] = key
    if keep:
        result["keep"] = True
    if meta_value:
        result["meta"] = meta_value
    return result


@dataclass(frozen=True)
class Append:
    append: list[dict[str, Any]]


@dataclass(frozen=True)
class HookSpec:
    input: str = "self"
    append_only: bool = False
    async_safe: bool = False
    timeout: int | None = None


@dataclass
class Extension:
    hooks: dict[str, Callable[..., Any]] = field(default_factory=dict)
    tools: list["Tool"] = field(default_factory=list)
    on: dict[str, Callable[..., Any]] = field(default_factory=dict)
    dispose: Callable[[], Any] | None = None


@dataclass(frozen=True)
class ExtensionDefinition:
    name: str
    create: Callable[..., Extension]
    hooks: Mapping[str, HookSpec] = field(default_factory=dict)
    requires: tuple[str, ...] = ()
    validate_options: Callable[[Any], Any] | None = None


def define_extension(*, name: str, create: Callable[..., Extension], hooks: Mapping[str, HookSpec] | None = None, requires: list[str] | tuple[str, ...] = (), validate_options: Callable[[Any], Any] | None = None) -> ExtensionDefinition:
    return ExtensionDefinition(name, create, hooks or {}, tuple(requires), validate_options)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input: Mapping[str, Any]
    execute: Callable[..., Any]


def define_tool(*, name: str, description: str, input: Mapping[str, Any], execute: Callable[..., Any]) -> Tool:
    return Tool(name, description, input, execute)


class ConversationStore(Protocol):
    async def load(self, conversation_id: str, agent: str) -> list[dict[str, Any]]: ...
    async def append(self, conversation_id: str, agent: str, messages: list[dict[str, Any]]) -> None: ...
    async def replace(self, conversation_id: str, agent: str, messages: list[dict[str, Any]]) -> None: ...
    async def finish(self, conversation_id: str, agent: str, status: str, value: Any) -> None: ...


class OperationStore(Protocol):
    async def list(self, conversation_id: str | None = None) -> list[dict[str, Any]]: ...
    async def get(self, conversation_id: str, operation_id: str) -> dict[str, Any] | None: ...
    async def save(self, operation: dict[str, Any]) -> None: ...
    async def delete(self, conversation_id: str, operation_id: str) -> None: ...
    async def transition(self, conversation_id: str, operation_id: str, expected: set[str], updates: Mapping[str, Any]) -> dict[str, Any] | None: ...
    async def claim_delivery(self, conversation_id: str, operation_id: str, claim_id: str) -> dict[str, Any] | None: ...
    async def release_delivery(self, conversation_id: str, operation_id: str, delivery_id: str) -> dict[str, Any] | None: ...


class InMemoryOperationStore:
    def __init__(self) -> None:
        self.operations: dict[tuple[str, str], dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def list(self, conversation_id: str | None = None) -> list[dict[str, Any]]:
        return copy.deepcopy([value for (cid, _), value in self.operations.items() if conversation_id is None or cid == conversation_id])

    async def get(self, conversation_id: str, operation_id: str) -> dict[str, Any] | None:
        return copy.deepcopy(self.operations.get((conversation_id, operation_id)))

    async def save(self, operation: dict[str, Any]) -> None:
        operation_id = str(operation["operationId"])
        async with self._lock:
            self.operations[(operation["conversationId"], operation_id)] = copy.deepcopy(operation)

    async def transition(self, conversation_id: str, operation_id: str, expected: set[str], updates: Mapping[str, Any]) -> dict[str, Any] | None:
        async with self._lock:
            current = self.operations.get((conversation_id, operation_id))
            if current is None or current.get("status", "pending") not in expected:
                return None
            updated = {**current, **copy.deepcopy(dict(updates)), "updatedAt": int(time.time() * 1000)}
            self.operations[(conversation_id, operation_id)] = updated
            return copy.deepcopy(updated)

    async def claim_delivery(self, conversation_id: str, operation_id: str, claim_id: str) -> dict[str, Any] | None:
        async with self._lock:
            current = self.operations.get((conversation_id, operation_id))
            terminal = {"completed", "rejected", "cancelled", "failed"}
            if current is None or current.get("status") not in terminal or current.get("deliveryStatus") != "pending":
                return None
            updated = {**current, "deliveryStatus": "delivering", "deliveryClaimId": claim_id, "deliveryClaimedAt": int(time.time() * 1000)}
            self.operations[(conversation_id, operation_id)] = updated
            return copy.deepcopy(updated)

    async def release_delivery(self, conversation_id: str, operation_id: str, delivery_id: str) -> dict[str, Any] | None:
        async with self._lock:
            current = self.operations.get((conversation_id, operation_id))
            if current is None or current.get("deliveryId") != delivery_id or current.get("deliveryStatus") != "delivering":
                return None
            updated = {**current, "deliveryStatus": "pending", "deliveryClaimId": None, "updatedAt": int(time.time() * 1000)}
            self.operations[(conversation_id, operation_id)] = updated
            return copy.deepcopy(updated)

    async def delete(self, conversation_id: str, operation_id: str) -> None:
        self.operations.pop((conversation_id, operation_id), None)




class InMemoryConversationStore:
    def __init__(self) -> None:
        self.conversations: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.finishes: list[dict[str, Any]] = []

    async def load(self, conversation_id: str, agent: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self.conversations.get((conversation_id, agent), []))

    async def append(self, conversation_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
        self.conversations.setdefault((conversation_id, agent), []).extend(copy.deepcopy(messages))

    async def replace(self, conversation_id: str, agent: str, messages: list[dict[str, Any]]) -> None:
        self.conversations[(conversation_id, agent)] = copy.deepcopy(messages)

    async def finish(self, conversation_id: str, agent: str, status: str, value: Any) -> None:
        self.finishes.append({"conversationId": conversation_id, "agent": agent, "status": status, "value": copy.deepcopy(value)})


class _Messages:
    def __init__(self, source: str): self.source = source
    def user(self, text: str, **extra: Any) -> dict[str, Any]: return _message("user", text, self.source, key=extra.get("key"), keep=extra.get("keep", False), meta_value=extra.get("meta"))
    def system(self, text: str, **extra: Any) -> dict[str, Any]: return _message("system", text, self.source, key=extra.get("key"), keep=extra.get("keep", False), meta_value=extra.get("meta"))


@dataclass
class ExecutionControl:
    output: dict[str, Any] | None = None
    allowed: bool = False

    def complete(self, output: dict[str, Any]) -> None:
        if not self.allowed: raise GoondanError("execution.complete is available in synchronous toolResult hooks")
        if output.get("role") != "assistant" or not isinstance(output.get("content"), list): raise GoondanError("execution.complete requires an assistant message")
        if self.output is not None: raise GoondanError("Execution completion is already requested")
        self.output = copy.deepcopy(output)


@dataclass
class HookContext:
    runtime: "Runtime"
    agent: str
    conversation_id: str
    turn_id: str
    input: Json
    conversation: list[dict[str, Any]]
    source: str
    step: int | None = None
    retry_count: int = 0

    @property
    def execution(self) -> "ExecutionControl": return self.runtime._execution_controls[self.turn_id]
    @property
    def message(self) -> _Messages: return _Messages(self.source)
    def append(self, *items: dict[str, Any]) -> Append: return Append(list(items))
    async def run_agent(self, name: str, value: Json, conversation: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return await self.runtime._run_agent(name, value, self.conversation_id, conversation, nested=True)
    async def run_model(self, messages: list[dict[str, Any]], max_steps: int = 1) -> dict[str, Any]:
        return await self.runtime._model_once(self.agent, messages, max_steps=max_steps)
    async def render(self, template: str, variables: Mapping[str, Any]) -> str:
        return self.runtime.render(template, variables)


@dataclass
class _AgentSession:
    extensions: dict[str, Extension]
    tools: dict[str, Tool] = field(default_factory=dict)
    pending: dict[str, asyncio.Task[Any]] = field(default_factory=dict)
    active_turns: set[str] = field(default_factory=set)


class Runtime:
    def __init__(self, *, config: Mapping[str, Any], models: Mapping[str, Any], tools: Mapping[str, Tool] | None = None, functions: Mapping[str, Callable[..., Any]] | None = None, extensions: Mapping[str, ExtensionDefinition] | None = None, store: ConversationStore | None = None, operation_store: OperationStore | None = None, ports: Mapping[str, Any] | None = None, host: Any = None):
        self.config = _resolve_config(dict(config)); validate_config(self.config)
        self.models, self.tools, self.functions, self.extensions = dict(models), dict(tools or {}), dict(functions or {}), dict(extensions or {})
        self.store, self.ports, self.host = store or InMemoryConversationStore(), dict(ports or {}), host
        self.operation_store = operation_store or InMemoryOperationStore()
        self.root = Path(str(self.config.get("__root__", "."))).resolve()
        self._execution_controls: dict[str, ExecutionControl] = {}
        self.sessions: dict[tuple[str, str], _AgentSession] = {}
        self.child_runtimes: dict[str, Runtime] = {}
        self.records: list[dict[str, Any]] = []
        self._delivery_tasks: set[asyncio.Task[Any]] = set()
        self._validate_bindings()
        self.env = Environment(loader=FileSystemLoader("/"), undefined=StrictUndefined, autoescape=False, trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True)
        self.env.filters["json"] = _json
        self._validate_templates()

    def _validate_templates(self) -> None:
        referenced: set[str] = set()
        for agent in self.config["agents"].values():
            input_rule = agent.get("input")
            if isinstance(input_rule, Mapping) and input_rule.get("template"): referenced.add(input_rule["template"])
            blocks = agent.get("systemMessage", []); blocks = [blocks] if isinstance(blocks, Mapping) else blocks
            referenced.update(block["template"] for block in blocks if "template" in block)
            for entries in (agent.get("hooks", {}) or {}).values():
                referenced.update(entry["template"] for entry in entries if "template" in entry)
        checked: set[str] = set()
        while referenced - checked:
            name = next(iter(referenced - checked)); checked.add(name)
            try: source, _, _ = self.env.loader.get_source(self.env, name)
            except Exception as error: raise GoondanError(f"template {name}: {error}") from error
            forbidden = ("{% macro", "{% extends", "{% import", "{% from", "{% call", "{% block")
            if any(token in source for token in forbidden): raise GoondanError(f"template {name} uses unsupported Jinja syntax")
            parsed = self.env.parse(source)
            for filter_node in parsed.find_all(nodes.Filter):
                if filter_node.name not in ALLOWED_FILTERS: raise GoondanError(f"template {name} uses unsupported filter {filter_node.name}")
            for test_node in parsed.find_all(nodes.Test):
                if test_node.name != "defined": raise GoondanError(f"template {name} uses unsupported test {test_node.name}")
            for included in meta.find_referenced_templates(parsed):
                if included is None: raise GoondanError(f"template {name} has a dynamic include")
                referenced.add(included)

    def _validate_bindings(self) -> None:
        errors: list[str] = []
        for agent_name, agent in self.config["agents"].items():
            if "config" in agent: continue
            if agent.get("model") not in self.models: errors.append(f"model {agent.get('model')} for {agent_name}")
            configured = agent.get("extensions", {}) or {}
            refs: dict[str, int] = {}
            for value, entries in (agent.get("hooks", {}) or {}).items():
                for entry in entries:
                    if "extension" in entry: refs[f"{entry['extension']}:{value}"] = refs.get(f"{entry['extension']}:{value}", 0) + 1
                    for fn_key in ("fn",):
                        if fn_key in entry and entry[fn_key] not in self.functions: errors.append(f"function {entry[fn_key]} for {agent_name}")
                    for condition_key in ("when", "using"):
                        condition = entry.get(condition_key)
                        if isinstance(condition, Mapping) and condition.get("fn") not in self.functions: errors.append(f"function {condition.get('fn')} for {agent_name}")
            for instance_name, config in configured.items():
                if config.get("enabled") is False: continue
                definition = self.extensions.get(instance_name)
                if definition is None: errors.append(f"extension {instance_name} for {agent_name}"); continue
                for port in definition.requires:
                    if port not in self.ports: errors.append(f"port {port} for extension {instance_name}")
                for value in definition.hooks:
                    if refs.get(f"{instance_name}:{value}") != 1: errors.append(f"extension hook {instance_name}.{value} must appear exactly once")
            for tool_spec in agent.get("tools", []) or []:
                if isinstance(tool_spec, str) and tool_spec not in self.tools and not configured: errors.append(f"tool {tool_spec} for {agent_name}")
                if isinstance(tool_spec, Mapping) and "tool" in tool_spec and tool_spec["tool"] not in self.tools and not configured: errors.append(f"tool {tool_spec['tool']} for {agent_name}")
                if isinstance(tool_spec, Mapping) and "agent" in tool_spec and tool_spec["agent"] not in self.config["agents"]: errors.append(f"agent tool {tool_spec['agent']} for {agent_name}")
        if errors: raise GoondanError("missing runtime bindings:\n- " + "\n- ".join(errors))

    def render(self, template: str, variables: Mapping[str, Any]) -> str:
        try: return self.env.get_template(template).render(**variables)
        except (TemplateSyntaxError, OSError) as error: raise GoondanError(f"template {template}: {error}") from error

    async def _session(self, agent_name: str, conversation_id: str) -> _AgentSession:
        key = (agent_name, conversation_id)
        if key in self.sessions: return self.sessions[key]
        agent = self.config["agents"][agent_name]
        instances: dict[str, Extension] = {}
        for instance_name, config in (agent.get("extensions", {}) or {}).items():
            if config.get("enabled") is False: continue
            definition = self.extensions[instance_name]
            options = config.get("options", {})
            if definition.validate_options: options = definition.validate_options(options)
            selected_ports = {name: self.ports[name] for name in definition.requires}
            instance = await _await(definition.create(options=options, ports=selected_ports, agent={"name": agent_name}, log=self.records))
            instances[instance_name] = instance
        instance_tools: dict[str, Tool] = {}
        for instance in instances.values():
            for tool in instance.tools:
                if tool.name in instance_tools or tool.name in self.tools:
                    raise GoondanError(f"duplicate tool {tool.name}")
                instance_tools[tool.name] = tool
        configured_tool_names = {
            spec if isinstance(spec, str) else spec.get("tool")
            for spec in agent.get("tools", []) or [] if not (isinstance(spec, Mapping) and "agent" in spec)
        }
        missing_tools = configured_tool_names - set(self.tools) - set(instance_tools)
        if missing_tools:
            raise GoondanError(f"unknown tools for {agent_name}: {', '.join(sorted(str(name) for name in missing_tools))}")
        session = _AgentSession(instances, instance_tools); self.sessions[key] = session; return session

    async def _emit(self, session: _AgentSession, event: str, payload: dict[str, Any]) -> None:
        for extension in session.extensions.values():
            callback = extension.on.get(event)
            if callback: await _await(callback(payload))
        if self.host and hasattr(self.host, "event"): await _await(self.host.event(event, payload))

    async def _apply_append(self, current: Any, result: Append, value_name: str, conversation_id: str, agent_name: str, persist: bool) -> Any:
        if value_name == "modelInput":
            updated = copy.deepcopy(current); updated["messages"].extend(result.append); return updated
        if value_name != "conversation": raise GoondanError(f"append is invalid for {value_name}")
        updated = list(current)
        added: list[dict[str, Any]] = []
        for message in result.append:
            duplicate = next((m for m in reversed(updated) if m.get("source") == message.get("source") and m.get("key") == message.get("key")), None)
            if duplicate and duplicate.get("role") == message.get("role") and duplicate.get("content") == message.get("content"): continue
            updated.append(message); added.append(message)
        if persist and added: await self.store.append(conversation_id, agent_name, added)
        return updated

    async def _pipeline(self, value_name: ValueName, value: Any, agent_name: str, conversation_id: str, turn_id: str, turn_input: Json, conversation: list[dict[str, Any]], step: int | None = None, retry_count: int = 0, persist: bool = True) -> Any:
        agent = self.config["agents"][agent_name]; session = await self._session(agent_name, conversation_id); current = value
        approvals: list[dict[str, Any]] = []
        for spec in (agent.get("hooks", {}) or {}).get(value_name, []):
            name = _hook_name(spec); source = str(spec.get("extension", name)); started = time.monotonic()
            seen = current
            using = spec.get("using", "self")
            if using == "input": seen = turn_input
            elif using == "conversation": seen = conversation
            elif isinstance(using, Mapping): seen = await _await(self.functions[using["fn"]](current, {"input": turn_input, "conversation": conversation}))
            condition = spec.get("when")
            if condition and not await _await(self.functions[condition["fn"]](seen)):
                self.records.append({"value": value_name, "hook": name, "status": "skipped"}); await self._emit(session, "hook.skipped", {"value": value_name, "hook": name}); continue
            ctx = HookContext(self, agent_name, conversation_id, turn_id, turn_input, conversation, source, step, retry_count)
            async def invoke() -> Any:
                if "extension" in spec:
                    extension = session.extensions.get(spec["extension"])
                    if extension is None: return None
                    control = self._execution_controls.get(turn_id)
                    if control: control.allowed = value_name == "toolResult" and spec.get("mode") != "async"
                    try: return await _await(extension.hooks[value_name](seen, ctx))
                    finally:
                        if control: control.allowed = False
                transformed = seen
                if "fn" in spec: transformed = await _await(self.functions[spec["fn"]](transformed))
                if "agent" in spec:
                    names = spec["agent"] if isinstance(spec["agent"], list) else [spec["agent"]]
                    runs = await asyncio.gather(*(ctx.run_agent(child, transformed) for child in names))
                    transformed = "\n".join(_text(run["output"]) for run in runs)
                if "template" in spec:
                    transformed = self.render(spec["template"], {"text": transformed, "input": turn_input, "params": agent.get("params", {})})
                if value_name in {"conversation", "modelInput"}: return ctx.append(_message(spec.get("role", "user"), str(transformed), source))
                if value_name == "output": return _message("assistant", str(transformed), source)
                return transformed
            timeout = spec.get("timeout")
            try:
                if spec.get("mode") == "async":
                    prior = session.pending.get(name)
                    if prior is None or prior.done(): session.pending[name] = asyncio.create_task(invoke())
                    self.records.append({"value": value_name, "hook": name, "status": "scheduled"}); continue
                result = await asyncio.wait_for(invoke(), timeout / 1000) if timeout else await invoke()
            except Exception as error:
                self.records.append({"value": value_name, "hook": name, "status": "failed", "error": str(error)})
                await self._emit(session, "hook.failed", {"value": value_name, "hook": name, "error": str(error)})
                if spec.get("optional", bool(spec.get("agent"))): continue
                raise GoondanExecutionError(value_name, error) from error
            if result is None: pass
            elif isinstance(result, Append): current = await self._apply_append(current, result, value_name, conversation_id, agent_name, persist)
            elif isinstance(result, Mapping) and "approval" in result:
                approvals.append(dict(result["approval"]))
            elif isinstance(result, Mapping) and (result.get("retry") or "result" in result or result.get("fail")): return dict(result)
            else:
                current = result
                if persist and value_name == "conversation": await self.store.replace(conversation_id, agent_name, current)
            self.records.append({"value": value_name, "hook": name, "status": "applied", "durationMs": round((time.monotonic()-started)*1000, 3)})
            await self._emit(session, "hook.applied", {"value": value_name, "hook": name})
        if value_name == "toolCall" and approvals:
            return {"call": current, "approvals": approvals}
        return current

    async def _drain_pending(self, session: _AgentSession, conversation: list[dict[str, Any]], conversation_id: str, agent_name: str) -> list[dict[str, Any]]:
        for name, task in list(session.pending.items()):
            if task.done():
                del session.pending[name]
                try: result = task.result()
                except Exception: continue
                if isinstance(result, Append): conversation = await self._apply_append(conversation, result, "conversation", conversation_id, agent_name, True)
        return conversation

    def _repair_tool_pairs(self, conversation: list[dict[str, Any]]) -> list[dict[str, Any]]:
        calls = {part["callId"] for message in conversation for part in message.get("content", []) if part.get("type") == "tool.call"}
        results = {part["callId"] for message in conversation for part in message.get("content", []) if part.get("type") == "tool.result"}
        paired = calls & results
        repaired = []
        for message in conversation:
            parts = [part for part in message.get("content", []) if part.get("type") not in {"tool.call", "tool.result"} or part.get("callId") in paired]
            if parts:
                changed = copy.deepcopy(message); changed["content"] = parts; repaired.append(changed)
        return repaired

    def _tool_definitions(self, agent_name: str, session: _AgentSession | None = None) -> list[dict[str, Any]]:
        definitions = []
        for spec in self.config["agents"][agent_name].get("tools", []) or []:
            if isinstance(spec, Mapping) and "agent" in spec:
                child = self.config["agents"][spec["agent"]]; fields = child.get("input", {}).get("fields", {"text": "string"}) if isinstance(child.get("input"), Mapping) else {"text": "string"}
                definitions.append({"name": spec["agent"], "description": child.get("description", ""), "input": {"type": "object", "properties": fields}}); continue
            name = spec if isinstance(spec, str) else spec["tool"]
            tool = self.tools.get(name) or (session.tools.get(name) if session else None)
            if tool:
                description = tool.description + (("\n" + spec["hint"]) if isinstance(spec, Mapping) and spec.get("hint") else "")
                definitions.append({"name": name, "description": description, "input": tool.input})
        return definitions

    def _system(self, agent_name: str, session: _AgentSession | None = None) -> list[dict[str, Any]]:
        agent = self.config["agents"][agent_name]; blocks = agent.get("systemMessage", []); blocks = [blocks] if isinstance(blocks, Mapping) else blocks
        tools = self._tool_definitions(agent_name, session); result = []
        for index, block in enumerate(blocks):
            text = block.get("text") if "text" in block else self.render(block["template"], {"params": agent.get("params", {}), "tools": tools, "agent": {"name": agent_name}, "model": agent.get("model")})
            result.append({"text": text, "source": f"system:{index}", **({"cache": True} if block.get("cache") else {})})
        return result

    async def _model_once(self, agent_name: str, messages: list[dict[str, Any]], max_steps: int = 1) -> dict[str, Any]:
        model = self.models[self.config["agents"][agent_name]["model"]]
        session = await self._session(agent_name, "ephemeral")
        model_input = {"system": self._system(agent_name, session), "messages": messages, "tools": self._tool_definitions(agent_name, session), "options": {}}
        return await _await(model(model_input)) if callable(model) else await _await(model.run(model_input))

    async def _input_message(self, agent_name: str, value: Json) -> dict[str, Any]:
        rule = self.config["agents"][agent_name].get("input", "asis")
        if rule == "asis": text = value if isinstance(value, str) else _json(value, 0)
        elif "template" in rule:
            variables = value if isinstance(value, Mapping) else {"text": value}; text = self.render(rule["template"], variables)
        else: text = await _await(self.functions[rule["fn"]](value))
        return _message("user", str(text), agent_name)

    async def _run_agent(self, agent_name: str, value: Json, conversation_id: str, initial_conversation: list[dict[str, Any]] | None = None, nested: bool = False) -> dict[str, Any]:
        agent = self.config["agents"][agent_name]
        if "config" in agent:
            child = self.child_runtimes.get(agent_name)
            if child is None:
                child_config = load_config(agent["config"])
                child = Runtime(config=child_config, models=self.models, tools=self.tools, functions=self.functions, extensions=self.extensions, store=self.store, operation_store=self.operation_store, ports=self.ports, host=self.host)
                self.child_runtimes[agent_name] = child
            outputs = await child.run_turn(value, conversation_id=conversation_id)
            if not outputs: raise GoondanError(f"nested config {agent_name} produced no output")
            if len(outputs) == 1: return outputs[0]
            combined = _message("assistant", "\n\n".join(_text(item["output"]) for item in outputs), agent_name)
            return {"output": combined, "conversation": [], "finishReason": "stop", "status": "done"}
        turn_id = uuid.uuid4().hex; session = await self._session(agent_name, conversation_id); session.active_turns.add(turn_id)
        self._execution_controls[turn_id] = ExecutionControl()
        conversation = copy.deepcopy(initial_conversation) if initial_conversation is not None else await self.store.load(conversation_id, agent_name)
        try:
            value = await self._pipeline("input", value, agent_name, conversation_id, turn_id, value, conversation)
            await self._emit(session, "turn.start", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "input": value})
            first = await self._input_message(agent_name, value); conversation.append(first); await self.store.append(conversation_id, agent_name, [first])
            retry_count = 0; step = 0
            while True:
                conversation = await self._drain_pending(session, conversation, conversation_id, agent_name)
                repaired = self._repair_tool_pairs(conversation)
                if repaired != conversation:
                    conversation = repaired; await self.store.replace(conversation_id, agent_name, conversation)
                conversation = await self._pipeline("conversation", conversation, agent_name, conversation_id, turn_id, value, conversation, step or None, retry_count)
                step += 1
                model_input = {"system": self._system(agent_name, session), "messages": copy.deepcopy(conversation), "tools": self._tool_definitions(agent_name, session), "options": {}}
                model_input = await self._pipeline("modelInput", model_input, agent_name, conversation_id, turn_id, value, conversation, step, retry_count, False)
                await self._emit(session, "step.start", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "step": step, "messages": len(model_input["messages"]), "tools": [t["name"] for t in model_input["tools"]]})
                model = self.models[agent["model"]]
                try:
                    result = await _await(model(model_input)) if callable(model) else await _await(model.run(model_input))
                except Exception as model_error:
                    retry_count += 1
                    await self._emit(session, "step.error", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "step": step, "error": str(model_error)})
                    turn_error = {"where": "model", "codes": [getattr(model_error, "code", "model_error")], "message": str(model_error), "attempt": retry_count}
                    decision = await self._pipeline("error", turn_error, agent_name, conversation_id, turn_id, value, conversation, step, retry_count)
                    if isinstance(decision, Mapping) and decision.get("retry"):
                        if decision.get("afterMs"): await asyncio.sleep(decision["afterMs"] / 1000)
                        if decision.get("conversation") is not None: conversation = copy.deepcopy(decision["conversation"]); await self.store.replace(conversation_id, agent_name, conversation)
                        continue
                    raise
                result = await self._pipeline("modelResult", result, agent_name, conversation_id, turn_id, value, conversation, step, retry_count)
                await self._emit(session, "step.done", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "step": step, "modelResult": result})
                if isinstance(result, Mapping) and result.get("retry"):
                    retry_count += 1
                    if result.get("conversation") is not None: conversation = copy.deepcopy(result["conversation"]); await self.store.replace(conversation_id, agent_name, conversation)
                    continue
                assistant = copy.deepcopy(result["message"]); assistant.setdefault("id", uuid.uuid4().hex); assistant.setdefault("source", "model")
                calls = [p for p in assistant.get("content", []) if p.get("type") == "tool.call"]
                conversation.append(assistant); await self.store.append(conversation_id, agent_name, [assistant])
                if calls:
                    for call_part in calls:
                        call = {"id": call_part["callId"], "name": call_part["name"], "args": call_part.get("args")}
                        configured = next((s for s in agent.get("tools", []) if isinstance(s, Mapping) and (s.get("tool") == call["name"] or s.get("agent") == call["name"])), None)
                        decision = await self._pipeline("toolCall", call, agent_name, conversation_id, turn_id, value, conversation, step, retry_count)
                        if configured and configured.get("approval") == "required":
                            existing = list(decision.get("approvals", [])) if isinstance(decision, Mapping) else []
                            decision = {"call": decision.get("call", call) if isinstance(decision, Mapping) else call, "approvals": [*existing, {"reason": f"{call['name']} requires approval"}]}
                        if isinstance(decision, Mapping) and decision.get("approvals"):
                            reasons = [str(item["reason"]) for item in decision["approvals"]]
                            operation_id = f"operation_{turn_id}_{call['id']}"
                            now = int(time.time() * 1000)
                            request = {"operationId": operation_id, "conversationId": conversation_id, "turnId": turn_id, "agent": agent_name, "toolCall": copy.deepcopy(call), "reasons": reasons}
                            context: Json = None
                            capture_context = getattr(self.host, "capture_operation_context", None)
                            if capture_context is not None:
                                context = await _await(capture_context(copy.deepcopy(request)))
                            operation = {
                                "operationId": operation_id,
                                "conversationId": conversation_id, "agent": agent_name,
                                "turnId": turn_id, "toolName": call["name"], "toolCall": copy.deepcopy(call),
                                "execution": copy.deepcopy(decision.get("execution", {})), "reasons": reasons,
                                "status": "pending", "createdAt": now, "updatedAt": now,
                                "deliveryId": f"operation:{operation_id}:completion", "deliveryStatus": "pending",
                                **({"context": context} if context is not None else {}),
                            }
                            await self.operation_store.save(operation)
                            await self._emit(session, "humanApproval.created", {**operation, "reason": "\n".join(reasons)})
                            request_approval = getattr(self.host, "request_approval", None)
                            if request_approval is not None:
                                task = asyncio.create_task(_await(request_approval(request)))
                                self._delivery_tasks.add(task); task.add_done_callback(self._delivery_tasks.discard)
                            tool_result = {"callId": call["id"], "name": call["name"], "args": call["args"], "content": [{"type": "json", "value": {"status": "pending", "operationId": operation_id}}]}
                            tool_message = {"id": uuid.uuid4().hex, "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": call["id"], "content": tool_result["content"]}]}
                            conversation.append(tool_message); await self.store.append(conversation_id, agent_name, [tool_message])
                            continue
                        execution = decision.get("execution", {}) if isinstance(decision, Mapping) else {}
                        if isinstance(decision, Mapping) and "call" in decision:
                            call = decision["call"]
                        elif isinstance(decision, Mapping) and "name" in decision and "id" in decision:
                            call = dict(decision)
                        if isinstance(decision, Mapping) and "result" in decision: tool_result = decision["result"]
                        elif call["name"] in self.config["agents"]:
                            tool_started = time.monotonic(); await self._emit(session, "tool.start", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "tool": call["name"], "callId": call["id"], "args": call["args"]})
                            child = await self._run_agent(call["name"], call["args"], conversation_id, nested=True)
                            tool_result = {"callId": call["id"], "name": call["name"], "args": call["args"], "content": child["output"]["content"]}
                        else:
                            tool = self.tools.get(call["name"]) or session.tools[call["name"]]
                            tool_started = time.monotonic(); await self._emit(session, "tool.start", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "tool": call["name"], "callId": call["id"], "args": call["args"]})
                            tool_attempt = 0
                            while True:
                                try:
                                    output = await _await(tool.execute(call["args"], {"input": value, "conversation": conversation, "execution": execution}))
                                    content = output if isinstance(output, list) else [{"type": "json", "value": output}]
                                    tool_result = {"callId": call["id"], "name": call["name"], "args": call["args"], "content": content}
                                    break
                                except Exception as tool_error:
                                    tool_attempt += 1
                                    await self._emit(session, "tool.error", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "tool": call["name"], "callId": call["id"], "args": call["args"], "error": str(tool_error), "codes": [getattr(tool_error, "code", "tool_error")]})
                                    turn_error = {"where": "tool", "codes": [getattr(tool_error, "code", "tool_error")], "message": str(tool_error), "attempt": tool_attempt, "toolCall": call}
                                    recovery = await self._pipeline("error", turn_error, agent_name, conversation_id, turn_id, value, conversation, step, tool_attempt)
                                    if isinstance(recovery, Mapping) and "result" in recovery:
                                        tool_result = recovery["result"]; break
                                    if isinstance(recovery, Mapping) and recovery.get("retry") and recovery.get("target") == "tool":
                                        if recovery.get("afterMs"): await asyncio.sleep(recovery["afterMs"] / 1000)
                                        continue
                                    raise
                        tool_result = await self._pipeline("toolResult", tool_result, agent_name, conversation_id, turn_id, value, conversation, step, retry_count)
                        if 'tool_started' in locals():
                            await self._emit(session, "tool.done", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "tool": call["name"], "callId": call["id"], "args": call["args"], "result": tool_result, "durationMs": round((time.monotonic() - tool_started) * 1000, 3)})
                            del tool_started
                        tool_message = {"id": uuid.uuid4().hex, "role": "tool", "source": "tool", "content": [{"type": "tool.result", "callId": call["id"], "content": tool_result["content"], **({"isError": True} if tool_result.get("isError") else {})}]}
                        conversation.append(tool_message); await self.store.append(conversation_id, agent_name, [tool_message])
                    completed = self._execution_controls[turn_id].output
                    if completed is None: continue
                    assistant = completed
                    conversation.append(assistant); await self.store.append(conversation_id, agent_name, [assistant])
                output = await self._pipeline("output", assistant, agent_name, conversation_id, turn_id, value, conversation, step, retry_count)
                conversation[-1] = copy.deepcopy(output); await self.store.replace(conversation_id, agent_name, conversation)
                response = {"output": output, "conversation": conversation, "usage": result.get("usage"), "finishReason": result.get("finishReason", "stop"), "status": "done"}
                await self.store.finish(conversation_id, agent_name, "done", response); await self._emit(session, "turn.done", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "output": output, "usage": result.get("usage"), "steps": step})
                return response
        except Exception as error:
            turn_error = {"where": error.where if isinstance(error, GoondanExecutionError) else "runtime", "codes": ["hook_error" if isinstance(error, GoondanExecutionError) else getattr(error, "code", "runtime_error")], "message": str(error), "attempt": 1}
            try: decision = await self._pipeline("error", turn_error, agent_name, conversation_id, turn_id, value, conversation, retry_count=0)
            except Exception: decision = turn_error
            await self.store.finish(conversation_id, agent_name, "failed", decision); await self._emit(session, "turn.error", {"agent": agent_name, "conversationId": conversation_id, "turnId": turn_id, "error": decision})
            raise
        finally:
            self._execution_controls.pop(turn_id, None)
            session.active_turns.discard(turn_id)
            for name, task in list(session.pending.items()):
                if not task.done(): task.cancel()
                del session.pending[name]

    async def run_turn(self, value: Json, *, conversation_id: str = "default", start_agent: str | None = None) -> list[dict[str, Any]]:
        start = start_agent or self.config.get("flow", {}).get("in") or next(iter(self.config["agents"])); pending = [(start, value, None)]; outputs = []
        while pending:
            agent_name, agent_input, carried = pending.pop(0)
            result = await self._run_agent(agent_name, agent_input, conversation_id, carried)
            if agent_name != start and not self.config.get("flow", {}).get("routes"): outputs.append(result); continue
            routes = [route for route in self.config.get("flow", {}).get("routes", []) if route["from"] == agent_name]
            if not routes: outputs.append(result); continue
            matched = False
            route_value = {"output": result["output"], "conversation": result["conversation"], "input": agent_input}
            for route in routes:
                condition = route.get("when"); ok = True if not condition else await _await(self.functions[condition["fn"]](route_value))
                if not ok: continue
                matched = True
                if route["to"] == "out": outputs.append(result); continue
                carry = route.get("carry", {}); message_rule = carry.get("message", "output")
                if message_rule == "output": next_value = _text(result["output"])
                elif isinstance(message_rule, Mapping) and "fn" in message_rule: next_value = await _await(self.functions[message_rule["fn"]](route_value))
                else: next_value = self.render(message_rule["template"], route_value)
                conversation_rule = carry.get("conversation", "none")
                if conversation_rule == "asis": next_conversation = result["conversation"]
                elif isinstance(conversation_rule, Mapping): next_conversation = await _await(self.functions[conversation_rule["fn"]](result["conversation"]))
                else: next_conversation = None
                pending.append((route["to"], next_value, next_conversation))
            if not matched: raise GoondanError(f"no flow route matched from {agent_name}")
        return outputs

    async def _transition_operation(self, conversation_id: str, operation_id: str, expected: set[str], **updates: Any) -> dict[str, Any] | None:
        return await self.operation_store.transition(conversation_id, operation_id, expected, updates)

    async def _complete_operation(self, conversation_id: str, operation_id: str, terminal_status: str, *, result: Json = None, error: Json = None) -> dict[str, Any]:
        operation = await self._transition_operation(conversation_id, operation_id, {"pending", "approved"}, status=terminal_status, result=result, error=error)
        if operation is None:
            existing = await self.operation_store.get(conversation_id, operation_id)
            if existing is None: raise GoondanError(f"operation not found: {operation_id}")
            operation = existing
        await self._schedule_delivery(operation)
        return operation

    async def approve_operation(self, conversation_id: str, operation_id: str) -> dict[str, Any]:
        operation = await self.operation_store.get(conversation_id, operation_id)
        if operation is None: raise GoondanError(f"operation not found: {operation_id}")
        if operation.get("status") in {"completed", "rejected", "cancelled", "failed"}:
            await self._schedule_delivery(operation); return operation
        approved = await self._transition_operation(conversation_id, operation_id, {"pending"}, status="approved")
        if approved is None:
            approved = await self.operation_store.get(conversation_id, operation_id)
        validate_operation = getattr(self.host, "validate_operation", None)
        if approved is not None and approved.get("status") == "approved" and validate_operation is not None:
            valid = await _await(validate_operation(copy.deepcopy(approved)))
            if not valid:
                failed = await self._transition_operation(conversation_id, operation_id, {"approved"}, status="failed", error="Operation validation failed", errorCode="validation_failed")
                if failed is None: return await self.operation_store.get(conversation_id, operation_id) or approved
                await self._schedule_delivery(failed)
                return failed
        claimed = await self._transition_operation(conversation_id, operation_id, {"approved"}, status="running")
        if claimed is None:
            current = await self.operation_store.get(conversation_id, operation_id)
            return current or approved or operation
        operation = claimed
        agent_name = str(operation["agent"]); call = copy.deepcopy(operation.get("resolvedToolCall") or operation["toolCall"])
        session = await self._session(agent_name, conversation_id)
        try:
            await self._emit(session, "tool.start", {"agent": agent_name, "conversationId": conversation_id, "turnId": operation["turnId"], "tool": call["name"], "callId": call["id"], "args": call["args"]})
            if call["name"] in self.config["agents"]:
                child = await self._run_agent(call["name"], call["args"], conversation_id, nested=True)
                raw_output: Json = child["output"]["content"]
            else:
                tool = self.tools.get(call["name"]) or session.tools.get(call["name"])
                if tool is None: raise GoondanError(f"approved tool is no longer available: {call['name']}")
                raw_output = await _await(tool.execute(copy.deepcopy(call["args"]), {"input": {"type": "operation_execution", "operationId": operation_id}, "conversation": await self.store.load(conversation_id, agent_name), "agent": agent_name, "conversationId": conversation_id, "turnId": operation["turnId"], "execution": operation.get("execution", {}), "operationId": operation_id, "toolCall": copy.deepcopy(call)}))
            content = raw_output if isinstance(raw_output, list) else [{"type": "json", "value": raw_output}]
            tool_result = {"callId": call["id"], "name": call["name"], "args": call["args"], "content": content}
            conversation = await self.store.load(conversation_id, agent_name)
            tool_result = await self._pipeline("toolResult", tool_result, agent_name, conversation_id, str(operation["turnId"]), {"type": "operation_execution", "operationId": operation_id}, conversation)
            completed = await self._transition_operation(conversation_id, operation_id, {"running"}, status="completed", result=tool_result)
            if completed is None: raise GoondanError(f"operation changed while executing: {operation_id}")
            await self._emit(session, "tool.done", {"agent": agent_name, "conversationId": conversation_id, "turnId": operation["turnId"], "tool": call["name"], "callId": call["id"], "args": call["args"], "operationId": operation_id, "result": tool_result})
        except Exception as execution_error:
            completed = await self._transition_operation(conversation_id, operation_id, {"running"}, status="failed", error=str(execution_error), errorCode="execution_failed")
            if completed is None: raise
        await self._schedule_delivery(completed)
        return completed

    async def reject_operation(self, conversation_id: str, operation_id: str) -> dict[str, Any]:
        return await self._complete_operation(conversation_id, operation_id, "rejected")

    async def cancel_operation(self, conversation_id: str, operation_id: str) -> dict[str, Any]:
        return await self._complete_operation(conversation_id, operation_id, "cancelled")

    async def _schedule_delivery(self, operation: Mapping[str, Any]) -> None:
        if operation.get("deliveryStatus") == "delivered": return
        task = asyncio.create_task(self._deliver_operation(copy.deepcopy(dict(operation))))
        self._delivery_tasks.add(task); task.add_done_callback(self._delivery_tasks.discard)

    async def _deliver_operation(self, operation: dict[str, Any]) -> None:
        conversation_id = str(operation["conversationId"]); agent_name = str(operation["agent"])
        session = await self._session(agent_name, conversation_id)
        while session.active_turns:
            await asyncio.sleep(0)
        operation_id = str(operation["operationId"]); claim_id = uuid.uuid4().hex
        current = await self.operation_store.claim_delivery(conversation_id, operation_id, claim_id)
        if current is None or current.get("deliveryStatus") == "delivered": return
        completion = {"type": "operation_completion", "deliveryId": current["deliveryId"], "operationId": current["operationId"], "conversationId": conversation_id, "agent": agent_name, "status": current["status"]}
        completion["toolCall"] = copy.deepcopy(current["toolCall"])
        if current.get("result") is not None: completion["result"] = copy.deepcopy(current["result"])
        if current.get("error") is not None: completion["error"] = copy.deepcopy(current["error"])
        if current.get("errorCode") is not None: completion["errorCode"] = str(current["errorCode"])
        deliver = getattr(self.host, "deliver_operation_completion", None)
        if deliver is not None:
            await _await(deliver(copy.deepcopy(completion)))
        else:
            await self.run_turn(completion, conversation_id=conversation_id, start_agent=agent_name)
        await self._transition_operation(conversation_id, operation_id, {str(current["status"])}, deliveryStatus="delivered", deliveredAt=int(time.time() * 1000), deliveryClaimId=None)

    async def recover_operations(self, conversation_id: str | None = None) -> None:
        terminal = {"completed", "rejected", "cancelled", "failed"}
        for operation in await self.operation_store.list(conversation_id):
            if operation.get("status") == "pending":
                request_approval = getattr(self.host, "request_approval", None)
                if request_approval is not None:
                    request = {"operationId": operation["operationId"], "conversationId": operation["conversationId"], "turnId": operation["turnId"], "agent": operation["agent"], "toolCall": copy.deepcopy(operation["toolCall"]), "reasons": copy.deepcopy(operation["reasons"])}
                    await _await(request_approval(request))
            elif operation.get("status") == "approved":
                task = asyncio.create_task(self.approve_operation(str(operation["conversationId"]), str(operation["operationId"])))
                self._delivery_tasks.add(task); task.add_done_callback(self._delivery_tasks.discard)
            elif operation.get("status") == "running":
                operation = await self._transition_operation(str(operation["conversationId"]), str(operation["operationId"]), {"running"}, status="failed", error="Operation execution was interrupted before completion", errorCode="execution_interrupted") or operation
            if operation.get("deliveryStatus") == "delivering":
                operation = await self.operation_store.release_delivery(str(operation["conversationId"]), str(operation["operationId"]), str(operation["deliveryId"])) or operation
            if operation.get("status") in terminal and operation.get("deliveryStatus") != "delivered":
                await self._schedule_delivery(operation)
        if self._delivery_tasks:
            await asyncio.gather(*list(self._delivery_tasks))

    async def list_pending_operations(self, conversation_id: str | None = None) -> list[dict[str, Any]]:
        return [item for item in await self.operation_store.list(conversation_id) if item.get("status", "pending") == "pending"]

    async def list_operations(self, conversation_id: str | None = None) -> list[dict[str, Any]]:
        return await self.operation_store.list(conversation_id)

    async def decide_operation(self, conversation_id: str, operation_id: str, resolution: Mapping[str, Any]) -> dict[str, Any]:
        operation = await self.operation_store.get(conversation_id, operation_id)
        if operation is None: raise GoondanError(f"operation not found: {operation_id}")
        decision = resolution.get("decision")
        if decision not in {"approved", "rejected"}: raise GoondanError(f"invalid operation decision: {decision}")
        input_patch = resolution.get("inputPatch")
        resolved_tool_call = None
        if input_patch is not None:
            if decision != "approved": raise GoondanError("operation inputPatch is only valid for approval")
            if not isinstance(input_patch, Mapping): raise GoondanError("operation inputPatch must be an object")
            original_args = operation["toolCall"].get("args")
            if not isinstance(original_args, Mapping): raise GoondanError("operation inputPatch requires object tool arguments")
            validate_patch = getattr(self.host, "validate_operation_input_patch", None)
            valid = await _await(validate_patch(copy.deepcopy(operation), copy.deepcopy(dict(input_patch)))) if validate_patch is not None else False
            if not valid: raise GoondanError("operation inputPatch validation failed")
            input_patch = copy.deepcopy(dict(input_patch))
            resolved_tool_call = {**copy.deepcopy(operation["toolCall"]), "args": {**copy.deepcopy(dict(original_args)), **input_patch}}
        updated = await self._transition_operation(conversation_id, operation_id, {"pending"}, status=decision, inputPatch=input_patch, resolvedToolCall=resolved_tool_call)
        if updated is None: return await self.operation_store.get(conversation_id, operation_id) or operation
        if decision == "rejected":
            await self._schedule_delivery(updated)
            return updated
        approved = updated
        if approved is None: return await self.operation_store.get(conversation_id, operation_id) or operation
        task = asyncio.create_task(self.approve_operation(conversation_id, operation_id))
        self._delivery_tasks.add(task); task.add_done_callback(self._delivery_tasks.discard)
        return approved

    async def maintain(self, conversation_id: str, *, agent: str | None = None) -> list[dict[str, Any]]:
        agent_name = agent or self.config.get("flow", {}).get("in") or next(iter(self.config["agents"])); conversation = await self.store.load(conversation_id, agent_name)
        maintained = await self._pipeline("conversation", conversation, agent_name, conversation_id, uuid.uuid4().hex, None, conversation)
        await self.store.replace(conversation_id, agent_name, maintained); return maintained

    async def prewarm(self, conversation_id: str, *, agent: str | None = None) -> dict[str, Any]:
        agent_name = agent or self.config.get("flow", {}).get("in") or next(iter(self.config["agents"])); conversation = await self.maintain(conversation_id, agent=agent_name)
        session = await self._session(agent_name, conversation_id)
        model_input = {"system": self._system(agent_name, session), "messages": conversation, "tools": self._tool_definitions(agent_name, session), "options": {"maxTokens": 1}}
        model_input = await self._pipeline("modelInput", model_input, agent_name, conversation_id, uuid.uuid4().hex, None, conversation, persist=False)
        model = self.models[self.config["agents"][agent_name]["model"]]
        return await _await(model(model_input)) if callable(model) else await _await(model.run(model_input))

    async def close(self) -> None:
        for child in self.child_runtimes.values(): await child.close()
        for session in self.sessions.values():
            for task in session.pending.values(): task.cancel()
            for extension in session.extensions.values():
                if extension.dispose: await _await(extension.dispose())


def create_runtime(**kwargs: Any) -> Runtime:
    return Runtime(**kwargs)
