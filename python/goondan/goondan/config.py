"""File composition, variants, path declarations, inheritance and the four validation phases."""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from . import _schema
from ._schema import Issue, Segment, issue
from ._yaml import YamlDocumentError, parse_document
from .types import GoondanConfig, GoondanConfigError

_ENTRY_NAME = "goondan.yaml"
_YAML_SUFFIXES = (".yaml", ".yml")


# --- value merging -------------------------------------------------------------------------


def _merge(base: Any, overlay: Any) -> Any:
    if isinstance(base, dict) and isinstance(overlay, dict):
        result = copy.deepcopy(base)
        for key, value in overlay.items():
            result[key] = _merge(result[key], value) if key in result else copy.deepcopy(value)
        return result
    return copy.deepcopy(overlay)


# --- read phase ----------------------------------------------------------------------------


def _fail(code: str, segments: Sequence[Segment], message: str) -> None:
    raise GoondanConfigError([issue(code, segments, message)])


def _absolute(reference: str, directory: str) -> str:
    return os.path.normpath(os.path.join(directory, reference))


def _identity(path: str) -> tuple[Any, ...]:
    try:
        info = os.stat(path)
    except OSError:
        return ("path", os.path.realpath(path))
    return ("file", info.st_dev, info.st_ino)


def _target_of(path: str, segments: Sequence[Segment], *, directories: bool, origin: str | None = None) -> str:
    """Apply the path checks of §읽기 오류 and return the file to read.

    A lookup error belongs to the file that declared the reference, so `origin` names it.
    """
    declared = f" declared in {origin}" if origin else ""
    try:
        if not os.path.exists(path):
            _fail("load.not_found", segments, f"cannot find the configuration file {path}{declared}")
        if directories and os.path.isdir(path):
            path = os.path.join(path, _ENTRY_NAME)
            if not os.path.exists(path):
                _fail("load.not_found", segments, f"cannot find the configuration file {path}{declared}")
        if not path.lower().endswith(_YAML_SUFFIXES) or not os.path.isfile(path):
            _fail("load.not_yaml", segments, f"{path}{declared} is not a YAML file")
    except OSError:
        _fail("load.not_found", segments, f"cannot read the configuration file {path}{declared}")
    return path


def _read_text(path: str, reference: Sequence[Segment]) -> str:
    """Read a configuration file. A lookup failure belongs to the declaring file, a decoding failure to this one."""
    try:
        return Path(path).read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        _fail("load.yaml", (), f"{path} is not valid UTF-8 text")
    except OSError:
        _fail("load.not_found", reference, f"cannot read the configuration file {path}")
    return ""


def _compose_file(
    path: str,
    graph: dict[tuple[Any, ...], str],
    stack: tuple[tuple[Any, ...], ...],
    stack_paths: tuple[str, ...],
    reference: Sequence[Segment],
) -> dict[str, Any]:
    key = _identity(path)
    if key in stack:
        chain = " -> ".join((*stack_paths, path))
        _fail("load.resource_cycle", reference, f"configuration resources form a cycle: {chain}")
    if key in graph:
        _fail("load.duplicate_resource", reference, f"{path} is already part of this resource graph")
    graph[key] = path
    text = _read_text(path, reference)
    try:
        document = parse_document(text)
    except YamlDocumentError as error:
        raise GoondanConfigError([issue("load.yaml", error.segments, f"{path}: {error.message}")]) from error
    if not isinstance(document, dict):
        _fail("load.not_object", (), f"{path} must contain a YAML object")

    for field in ("extends", "resources"):
        if field in document:
            found = _schema.validate_definition(field, document[field], [field])
            if found:
                raise GoondanConfigError([issue(item["code"], item["segments"], f"{path}: {item['message']}") for item in found])

    directory = os.path.dirname(os.path.realpath(path))
    merged: dict[str, Any] = {}
    next_stack = (*stack, key)
    next_paths = (*stack_paths, path)
    if "extends" in document:
        child = _target_of(_absolute(document["extends"], directory), ["extends"], directories=True, origin=path)
        merged = _merge(merged, _compose_file(child, graph, next_stack, next_paths, ["extends"]))
    for index, entry in enumerate(document.get("resources", [])):
        child = _target_of(_absolute(entry, directory), ["resources", index], directories=True, origin=path)
        merged = _merge(merged, _compose_file(child, graph, next_stack, next_paths, ["resources", index]))
    own = {key_: value for key_, value in document.items() if key_ not in ("extends", "resources")}
    return _merge(merged, _absolute_declared_paths(own, directory))


# --- path declarations ---------------------------------------------------------------------


def _declared_path(value: Any, directory: str) -> Any:
    return _absolute(value, directory) if isinstance(value, str) and value else value


def _absolute_declared_paths(raw: Mapping[str, Any], directory: str) -> dict[str, Any]:
    result = copy.deepcopy(dict(raw))
    agents = result.get("agents")
    for agent in agents.values() if isinstance(agents, dict) else []:
        if not isinstance(agent, dict):
            continue
        rule = agent.get("input")
        if isinstance(rule, dict) and "template" in rule:
            rule["template"] = _declared_path(rule["template"], directory)
        blocks = agent.get("systemMessage")
        for block in [blocks] if isinstance(blocks, dict) else (blocks if isinstance(blocks, list) else []):
            if isinstance(block, dict) and "template" in block:
                block["template"] = _declared_path(block["template"], directory)
        hooks = agent.get("hooks")
        for entries in hooks.values() if isinstance(hooks, dict) else []:
            for entry in entries if isinstance(entries, list) else []:
                if isinstance(entry, dict) and "template" in entry:
                    entry["template"] = _declared_path(entry["template"], directory)
    return result


# --- schema phase --------------------------------------------------------------------------


def _with_defaults(document: Mapping[str, Any]) -> dict[str, Any]:
    prepared = copy.deepcopy(dict(document))
    if "version" not in prepared:
        prepared["version"] = 1
    if "name" not in prepared:
        prepared["name"] = "goondan"
    return prepared


def _schema_issues(document: Mapping[str, Any]) -> list[Issue]:
    return [*_schema.json_issues(document), *_schema.validate(document)]


# --- inheritance and removal ---------------------------------------------------------------


def hook_identifier(spec: Mapping[str, Any], directory: str | None = None) -> str:
    """§훅 식별자: the first declared field in the order name, extension, fn, agent, template."""
    for key in ("name", "extension", "fn"):
        if key in spec:
            return str(spec[key])
    if "agent" in spec:
        value = spec["agent"]
        return "+".join(str(item) for item in value) if isinstance(value, list) else str(value)
    if "template" in spec:
        template = str(spec["template"])
        if directory and os.path.isabs(template):
            return os.path.relpath(template, directory).replace(os.sep, "/")
        return template
    return ""


def _exposed_name(entry: Any) -> Any:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, Mapping):
        return entry.get("tool", entry.get("agent"))
    return None


def _apply_remove(agent: dict[str, Any], removal: Any, directory: str | None) -> None:
    if not isinstance(removal, Mapping):
        return
    dropped = [name for name in removal.get("extensions", []) if isinstance(name, str)]
    if "tools" in removal and isinstance(agent.get("tools"), list):
        agent["tools"] = [entry for entry in agent["tools"] if _exposed_name(entry) not in removal["tools"]]
    if dropped and isinstance(agent.get("extensions"), dict):
        for name in dropped:
            agent["extensions"].pop(name, None)
    hooks = agent.get("hooks")
    if isinstance(hooks, dict):
        if dropped:
            for phase, entries in hooks.items():
                if isinstance(entries, list):
                    hooks[phase] = [hook for hook in entries if not (isinstance(hook, Mapping) and hook.get("extension") in dropped)]
        for phase, names in (removal.get("hooks") or {}).items():
            entries = hooks.get(phase)
            if isinstance(entries, list) and isinstance(names, list):
                hooks[phase] = [hook for hook in entries if not (isinstance(hook, Mapping) and hook_identifier(hook, directory) in names)]


def _inheritance(agents: Mapping[str, Any], directory: str | None) -> tuple[dict[str, dict[str, Any]], list[Issue]]:
    order = list(agents)
    position = {name: index for index, name in enumerate(order)}
    resolved: dict[str, dict[str, Any]] = {}
    broken: set[str] = set()
    reported: set[frozenset[str]] = set()
    issues: list[Issue] = []

    def resolve(name: str, chain: tuple[str, ...]) -> dict[str, Any] | None:
        if name in resolved:
            return resolved[name]
        if name in broken:
            return None
        if name in chain:
            members = chain[chain.index(name):]
            signature = frozenset(members)
            if signature not in reported:
                reported.add(signature)
                first = min(members, key=lambda item: position[item])
                issues.append(issue("reference.inherit_cycle", ["agents", first, "inherit"], "inherits itself through a cycle"))
            broken.update(members)
            return None
        raw = agents[name]
        base: dict[str, Any] = {}
        if "inherit" in raw:
            parent = raw["inherit"]
            if not isinstance(parent, str) or parent not in agents:
                issues.append(issue("reference.inherit", ["agents", name, "inherit"], f"must name an agent declared in this configuration, not {parent!r}"))
                broken.add(name)
                return None
            inherited = resolve(parent, (*chain, name))
            if inherited is None:
                broken.add(name)
                return None
            base = inherited
        own = {key: value for key, value in raw.items() if key not in ("inherit", "remove")}
        agent = _merge(base, own)
        _apply_remove(agent, raw.get("remove"), directory)
        resolved[name] = agent
        return agent

    for name in order:
        resolve(name, ())
    return {name: resolved[name] for name in order if name in resolved}, issues


def _effective_agent(agent: Mapping[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(dict(agent))
    extensions = result.get("extensions")
    disabled = {name for name, use in extensions.items() if isinstance(use, Mapping) and use.get("enabled") is False} if isinstance(extensions, Mapping) else set()
    hooks = result.get("hooks")
    if disabled and isinstance(hooks, dict):
        for phase, entries in hooks.items():
            if isinstance(entries, list):
                hooks[phase] = [hook for hook in entries if not (isinstance(hook, Mapping) and hook.get("extension") in disabled)]
    return result


def _normalized_routes(routes: Any) -> Any:
    if not isinstance(routes, list) or not routes or not all(isinstance(name, str) for name in routes):
        return copy.deepcopy(routes)
    result = [{"from": "$input", "to": routes[0]}]
    result.extend(
        {"from": name, "to": routes[index + 1] if index + 1 < len(routes) else "$output"}
        for index, name in enumerate(routes)
    )
    return result


# --- reference phase -----------------------------------------------------------------------


def _route_issues(document: Mapping[str, Any], agents: Mapping[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    declared = document.get("routes")
    if declared is None and "routes" not in document:
        return issues
    serial = isinstance(declared, list) and all(isinstance(name, str) for name in declared)
    if serial:
        for index, name in enumerate(declared):
            if name in {"$input", "$output"}:
                issues.append(issue("routes.reserved", ["routes", index], f"the reserved name {name!r} cannot be an agent in serial routes"))
            elif name not in agents:
                issues.append(issue("reference.agent", ["routes", index], f"must name an agent declared in this configuration, not {name!r}"))
        routes = _normalized_routes(declared)
        known = [
            (index, route)
            for index, route in enumerate(routes)
            if isinstance(route, Mapping)
            and route.get("from") in {"$input", *agents}
            and route.get("to") in {"$output", *agents}
            and not (route.get("from") == "$input" and route.get("to") == "$output")
        ]
        return [*issues, *_route_structure_issues(known, agents)]
    else:
        routes = declared
    if not isinstance(routes, list):
        return issues
    known: list[tuple[int, Mapping[str, Any]]] = []
    for index, route in enumerate(routes):
        if not isinstance(route, Mapping):
            continue
        source, target = route.get("from"), route.get("to")
        path_index = max(index - 1, 0) if serial else index
        if source == "$output":
            issues.append(issue("routes.reserved", ["routes", path_index] if serial else ["routes", index, "from"], "a route cannot start at $output"))
            continue
        if target == "$input":
            issues.append(issue("routes.reserved", ["routes", path_index] if serial else ["routes", index, "to"], "a route cannot end at $input"))
            continue
        if source == "$input" and target == "$output":
            issues.append(issue("routes.reserved", ["routes", path_index], "a route cannot connect $input directly to $output"))
            continue
        valid = True
        if source != "$input" and source not in agents:
            issues.append(issue("reference.agent", ["routes", path_index] if serial else ["routes", index, "from"], f"must name an agent or $input, not {source!r}"))
            valid = False
        if target != "$output" and target not in agents:
            issues.append(issue("reference.agent", ["routes", path_index] if serial else ["routes", index, "to"], f"must name an agent or $output, not {target!r}"))
            valid = False
        if valid:
            known.append((index, route))
    return [*issues, *_route_structure_issues(known, agents)]


def _reaches(edges: Mapping[str, list[str]], start: str, goal: str) -> bool:
    """Whether `goal` is reachable from `start` over `edges`, `start` itself included."""
    seen = {start}
    stack = [start]
    while stack:
        current = stack.pop()
        if current == goal:
            return True
        for target in edges.get(current, []):
            if target not in seen:
                seen.add(target)
                stack.append(target)
    return False


def _route_structure_issues(known: list[tuple[int, Mapping[str, Any]]], agents: Mapping[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    outgoing = {str(route["from"]) for _, route in known if route["from"] != "$input"}
    if not any(route["from"] == "$input" for _, route in known):
        issues.append(issue("routes.no_input", ["routes"], "routes must include an entry from $input"))
    if not any(route["to"] == "$output" for _, route in known):
        issues.append(issue("routes.no_output", ["routes"], "routes must include an exit to $output"))
    for index, route in known:
        target = route["to"]
        if target != "$output" and target not in outgoing:
            issues.append(issue("routes.no_route", ["routes", index, "to"], f"names the agent {target!r}, which has no route of its own"))

    edges: dict[str, list[str]] = {}
    for _, route in known:
        if route["to"] != "$output":
            edges.setdefault(str(route["from"]), []).append(str(route["to"]))
    for index, route in known:
        source = str(route["from"])
        if source not in {"$input", "$output"} and not _reaches(edges, "$input", source):
            issues.append(issue("routes.unreachable", ["routes", index, "from"], f"the agent {source!r} is not reachable from $input"))

    unconditional = [(index, route) for index, route in known if route["to"] != "$output" and "when" not in route]
    unconditional_edges: dict[str, list[str]] = {}
    for _, route in unconditional:
        unconditional_edges.setdefault(str(route["from"]), []).append(str(route["to"]))
    for index, route in unconditional:
        if _reaches(unconditional_edges, str(route["to"]), str(route["from"])):
            issues.append(issue("routes.cycle", ["routes", index], "belongs to a cycle of routes that have no when"))

    wait_edges: dict[str, list[str]] = {}
    stateful = {name for name, agent in agents.items() if agent.get("stateful", True) is True}
    for target in stateful:
        without_target = {
            source: [item for item in targets if item != target]
            for source, targets in edges.items()
            if source != target
        }
        for source in stateful - {target}:
            if _reaches(edges, source, target) and _reaches(without_target, "$input", source):
                wait_edges.setdefault(source, []).append(target)
    if any(_reaches(wait_edges, target, source) for source, targets in wait_edges.items() for target in targets):
        issues.append(issue("routes.wait_cycle", ["routes"], "stateful agent wait relationships form a cycle"))
    return issues


def _agent_reference_issues(agents: Mapping[str, Any], directory: str | None = None) -> list[Issue]:
    issues: list[Issue] = []
    for name, agent in agents.items():
        seen: set[str] = set()
        for index, entry in enumerate(agent.get("tools", [])):
            exposed = _exposed_name(entry)
            if isinstance(entry, Mapping) and "agent" in entry and entry["agent"] not in agents:
                issues.append(issue("reference.agent", ["agents", name, "tools", index, "agent"], f"must name an agent declared in this configuration, not {entry['agent']!r}"))
            if isinstance(exposed, str):
                if exposed in seen:
                    issues.append(issue("reference.duplicate_tool", ["agents", name, "tools", index], f"exposes the tool name {exposed!r} a second time"))
                seen.add(exposed)
        extensions = agent.get("extensions", {})
        for phase, entries in agent.get("hooks", {}).items():
            identifiers: set[str] = set()
            for index, hook in enumerate(entries):
                at = ["agents", name, "hooks", phase, index]
                if "extension" in hook and hook["extension"] not in extensions:
                    issues.append(issue("reference.extension", [*at, "extension"], f"must name an extension used by this agent, not {hook['extension']!r}"))
                targets = hook.get("agent")
                if isinstance(targets, str) and targets not in agents:
                    issues.append(issue("reference.agent", [*at, "agent"], f"must name an agent declared in this configuration, not {targets!r}"))
                elif isinstance(targets, list):
                    for position, target in enumerate(targets):
                        if target not in agents:
                            issues.append(issue("reference.agent", [*at, "agent", position], f"must name an agent declared in this configuration, not {target!r}"))
                if phase == "conversation" and hook.get("mode") == "async":
                    identifier = hook_identifier(hook, directory)
                    if identifier in identifiers:
                        issues.append(issue("reference.duplicate_hook", at, f"repeats the asynchronous hook identifier {identifier!r}"))
                    identifiers.add(identifier)
    return issues


# --- effective configuration ---------------------------------------------------------------


def _build(document: Mapping[str, Any], directory: str | None) -> tuple[dict[str, Any], list[Issue]]:
    inherited, issues = _inheritance(document.get("agents", {}), directory)
    effective = {name: _effective_agent(agent) for name, agent in inherited.items()}
    result: dict[str, Any] = {}
    for key, value in document.items():
        if key == "agents":
            result[key] = effective
        elif key == "routes":
            result[key] = _normalized_routes(value)
        else:
            result[key] = copy.deepcopy(value)
    result["version"] = 1
    return result, issues


def _reference_issues(document: Mapping[str, Any], effective: Mapping[str, Any], complete: bool, directory: str | None) -> list[Issue]:
    issues: list[Issue] = []
    if complete:
        issues.extend(_schema.validate(effective))
    issues.extend(_route_issues(document, effective["agents"]))
    issues.extend(_agent_reference_issues(effective["agents"], directory))
    return issues


# --- validation phases ---------------------------------------------------------------------


def _prepare(
    document: Mapping[str, Any],
    *,
    directory: str | None,
    read_files: bool,
) -> GoondanConfig:
    prepared = _with_defaults(_absolute_declared_paths(document, directory) if directory else document)
    issues = _schema_issues(prepared)
    if issues:
        raise GoondanConfigError(issues)

    effective, inherit_issues = _build(prepared, directory)
    complete = not inherit_issues
    issues = [*inherit_issues, *_reference_issues(prepared, effective, complete, directory)]
    templates: dict[str, str] | None = None
    if read_files and complete:
        from .template import load_templates

        templates, template_errors = load_templates(effective, directory)
        issues.extend(template_errors)
    if issues:
        raise GoondanConfigError(issues)

    config = GoondanConfig(effective)
    config.directory = directory
    config.templates = templates
    return config


def load_config(
    directory: str | Path,
    variants: Iterable[str] | None = None,
) -> GoondanConfig:
    """Read, compose and validate a configuration from disk (read, schema and reference phases)."""
    names = list(variants or [])
    for name in names:
        if not isinstance(name, str) or not name or "/" in name or "\\" in name:
            _fail("load.not_found", (), f"variant names must not be empty or contain a path separator: {name!r}")

    entry = _target_of(os.path.abspath(str(directory)), (), directories=True)
    entry_directory = os.path.dirname(os.path.realpath(entry))
    document = _compose_file(entry, {}, (), (), ())
    for name in names:
        variant = _target_of(os.path.join(entry_directory, "variants", f"{name}.yaml"), (), directories=False)
        document = _merge(document, _compose_file(variant, {}, (), (), ()))

    return _prepare(
        document,
        directory=entry_directory,
        read_files=True,
    )


def validate_config(config: Mapping[str, Any]) -> GoondanConfig:
    """Apply the schema and reference phases to a configuration document without reading files."""
    return _prepare(dict(config), directory=None, read_files=False)


def prepare_config(config: Mapping[str, Any], directory: str | Path | None = None) -> GoondanConfig:
    """Apply the phases `create_goondan` needs, reusing templates already read."""
    templates = config.templates if isinstance(config, GoondanConfig) else None
    root = directory if directory is not None else (config.directory if isinstance(config, GoondanConfig) else None)
    root = os.path.realpath(str(root)) if root is not None else os.path.realpath(os.getcwd())
    if templates is not None:
        prepared = _prepare(dict(config), directory=root, read_files=False)
        prepared.templates = templates
        return prepared
    return _prepare(dict(config), directory=root, read_files=True)


# --- binding phase -------------------------------------------------------------------------


def _function_references(agent: Mapping[str, Any], name: str) -> list[tuple[list[Segment], Any]]:
    found: list[tuple[list[Segment], Any]] = []
    rule = agent.get("input")
    if isinstance(rule, Mapping) and "fn" in rule:
        found.append((["agents", name, "input", "fn"], rule["fn"]))
    for phase, entries in agent.get("hooks", {}).items():
        for index, hook in enumerate(entries):
            at: list[Segment] = ["agents", name, "hooks", phase, index]
            if "fn" in hook:
                found.append(([*at, "fn"], hook["fn"]))
            for key in ("using", "when"):
                value = hook.get(key)
                if isinstance(value, Mapping) and "fn" in value:
                    found.append(([*at, key, "fn"], value["fn"]))
    return found


def _route_function_references(routes: Any) -> list[tuple[list[Segment], Any]]:
    found: list[tuple[list[Segment], Any]] = []
    if not isinstance(routes, list):
        return found
    for index, route in enumerate(routes):
        if not isinstance(route, Mapping):
            continue
        at: list[Segment] = ["routes", index]
        when = route.get("when")
        if isinstance(when, Mapping) and "fn" in when:
            found.append(([*at, "when", "fn"], when["fn"]))
    return found


def binding_issues(
    config: Mapping[str, Any],
    *,
    models: Mapping[str, Any],
    tools: Mapping[str, Any],
    functions: Mapping[str, Any],
    extensions: Mapping[str, Any],
    ports: Mapping[str, Any],
) -> list[Issue]:
    """§검증 단계 binding phase: every model, tool, function, extension and port a configuration names."""
    issues: list[Issue] = []
    for name, agent in config["agents"].items():
        if agent.get("model") not in models:
            issues.append(issue("binding.model", ["agents", name, "model"], f"names the model {agent.get('model')!r}, which the host did not register"))
        enabled: dict[str, Any] = {}
        for extension_name, use in agent.get("extensions", {}).items():
            if use.get("enabled") is False:
                continue
            definition = extensions.get(extension_name) if extension_name in extensions else None
            if definition is None:
                issues.append(issue("binding.extension", ["agents", name, "extensions", extension_name], f"names the extension {extension_name!r}, which the host did not register"))
                continue
            enabled[extension_name] = definition
            for port in definition.requires:
                if port not in ports:
                    issues.append(issue("binding.port", ["agents", name, "extensions", extension_name], f"requires the port {port!r}, which the host did not register"))
        for phase, entries in agent.get("hooks", {}).items():
            for index, hook in enumerate(entries):
                extension_name = hook.get("extension")
                definition = enabled.get(extension_name) if isinstance(extension_name, str) else None
                if definition is not None and definition.hooks and phase not in definition.hooks:
                    issues.append(issue("binding.extension_hook", ["agents", name, "hooks", phase, index, "extension"], f"the extension {extension_name!r} does not provide a {phase} hook"))
        provided: dict[str, int] = {}
        deferred = any(not definition.tools for definition in enabled.values())
        for entry in agent.get("tools", []):
            exposed = _exposed_name(entry)
            if not isinstance(entry, Mapping) or "agent" not in entry:
                provided.setdefault(exposed, 0)
        for exposed in list(provided):
            count = 1 if exposed in tools else 0
            count += sum(1 for definition in enabled.values() if exposed in definition.tools)
            provided[exposed] = count
        for index, entry in enumerate(agent.get("tools", [])):
            if isinstance(entry, Mapping) and "agent" in entry:
                continue
            exposed = _exposed_name(entry)
            at: list[Segment] = ["agents", name, "tools", index] if isinstance(entry, str) else ["agents", name, "tools", index, "tool"]
            if provided.get(exposed, 0) > 1:
                issues.append(issue("binding.duplicate_tool", at, f"the tool name {exposed!r} is provided more than once"))
            elif provided.get(exposed, 0) == 0 and not deferred:
                issues.append(issue("binding.tool", at, f"names the tool {exposed!r}, which no host tool or extension provides"))
        for at, reference in _function_references(agent, name):
            if reference not in functions:
                issues.append(issue("binding.function", at, f"names the function {reference!r}, which the host did not register"))
    for at, reference in _route_function_references(config.get("routes")):
        if reference not in functions:
            issues.append(issue("binding.function", at, f"names the function {reference!r}, which the host did not register"))
    return issues
