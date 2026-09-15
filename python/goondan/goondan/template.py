"""§템플릿 지원 범위: the common template grammar, the preloaded template map and rendering.

Templates are read once, at configuration load, together with the whole static
`include` closure they reach. The runtime renders from that map and never touches
the file system again. The grammar this module accepts is the intersection the
specification defines for Nunjucks and Jinja2: a lexer pass rejects spellings the
parsed tree hides (tag names, `+` whitespace markers, number and string forms,
constant spellings) and an allowlist walk over the Jinja2 AST rejects every node
the specification does not list.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from jinja2 import BaseLoader, Environment, StrictUndefined, TemplateError, TemplateNotFound, TemplateSyntaxError, Undefined, nodes
from jinja2.compiler import CodeGenerator, Frame
from jinja2.parser import Parser
from jinja2.runtime import LoopContext
from jinja2.visitor import NodeTransformer

from ._json import json_pretty_text, json_text
from ._schema import Issue, Segment, issue, json_equal, json_type
from .types import GoondanError

ALLOWED_TAGS = ("elif", "else", "endfor", "endif", "for", "if", "include")
ALLOWED_FILTERS = ("default", "join", "json", "length", "lower", "replace", "trim", "upper")
LOOP_KEYS = ("first", "index", "index0", "last", "length")
ALLOWED_TESTS = ("defined",)

_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# §식: an integer part is a single `0` or starts with a non-zero digit, so `012`, `00` and
# `01.5` are not number literals; an exponent, a `_` separator and a `0x` prefix are not either.
_INTEGER = re.compile(r"0|[1-9][0-9]*")
_FLOAT = re.compile(r"(?:0|[1-9][0-9]*)\.[0-9]+")
_DRIVE = re.compile(r"[A-Za-z]:")
_ESCAPES = frozenset("\\'\"ntr")
_CONSTANT_SPELLINGS = frozenset({"true", "false", "none", "null"})
_BOOLEANS = frozenset({"true", "false"})
# Unicode `White_Space` characters, used by the `trim` filter in both hosts.
_WHITESPACE = "".join(
    chr(code) for code in (
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680,
        *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
    )
)

Token = tuple[int, str, str]


# --- paths and files -----------------------------------------------------------------------


def relative_path(path: str, directory: str | None) -> str:
    """§템플릿 구성 오류: a path written relative to the configuration directory with `/` separators."""
    if not directory:
        return path.replace(os.sep, "/")
    try:
        relative = os.path.relpath(path, directory)
    except ValueError:
        return path.replace(os.sep, "/")
    return relative.replace(os.sep, "/")


def resolve_include(parent: str, path: str) -> str:
    """Resolve an `include` path against the directory of the template file that declares it."""
    directory = os.path.dirname(parent)
    segments = [segment for segment in path.split("/") if segment not in ("", ".")]
    return os.path.normpath(os.path.join(directory, *segments)) if segments else directory


def _normalize(text: str) -> str:
    if text.startswith("\ufeff"):
        text = text[1:]
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _read_template(path: str) -> str | None:
    """Read a template file, or return `None` when it is missing, not a regular file or not UTF-8."""
    try:
        if not os.path.isfile(path):
            return None
        data = Path(path).read_bytes()
    except OSError:
        return None
    try:
        return _normalize(data.decode("utf-8"))
    except UnicodeDecodeError:
        return None


def _inside(base: str, target: str) -> bool:
    try:
        relative = os.path.relpath(target, base)
    except ValueError:
        return False
    return relative not in (os.curdir, os.pardir) and not relative.startswith(os.pardir + os.sep) and not os.path.isabs(relative)


def _include_reason(path: str) -> str | None:
    if not path:
        return "path is empty"
    if "\\" in path:
        return "backslashes are not allowed"
    if path.startswith("/") or _DRIVE.match(path):
        return "absolute paths are not allowed"
    if any(segment == ".." for segment in path.split("/")):
        return '".." segments are not allowed'
    return None


# --- declared templates --------------------------------------------------------------------


def declared_templates(config: Mapping[str, Any]) -> list[tuple[list[Segment], str]]:
    """Every template path an effective configuration declares, with its position in the document."""
    found: list[tuple[list[Segment], str]] = []

    def add(at: list[Segment], holder: Any) -> None:
        if isinstance(holder, Mapping) and isinstance(holder.get("template"), str):
            found.append(([*at, "template"], holder["template"]))

    for name, agent in config["agents"].items():
        if "config" in agent:
            continue
        add(["agents", name, "input"], agent.get("input"))
        blocks = agent.get("systemMessage")
        if isinstance(blocks, Mapping):
            add(["agents", name, "systemMessage"], blocks)
        for index, block in enumerate(blocks if isinstance(blocks, list) else []):
            add(["agents", name, "systemMessage", index], block)
        for phase, entries in agent.get("hooks", {}).items():
            for index, entry in enumerate(entries):
                add(["agents", name, "hooks", phase, index], entry)
    flow = config.get("flow")
    for index, route in enumerate(flow.get("routes", []) if isinstance(flow, Mapping) else []):
        carry = route.get("carry")
        add(["flow", "routes", index, "carry", "message"], carry.get("message") if isinstance(carry, Mapping) else None)
    return found


# --- lexer pass ----------------------------------------------------------------------------


def _bad_escape(literal: str) -> bool:
    body = literal[1:-1]
    index = 0
    while index < len(body):
        if body[index] != "\\":
            index += 1
            continue
        if index + 1 >= len(body) or body[index + 1] not in _ESCAPES:
            return True
        index += 2
    return False


def _expression_problem(tokens: Sequence[Token]) -> bool:
    previous: Token | None = None
    for token in tokens:
        _, kind, value = token
        after_dot = previous is not None and previous[1] == "operator" and previous[2] == "."
        if kind == "string":
            if previous is not None and previous[1] == "string":
                return True
            if _bad_escape(value):
                return True
        elif kind == "integer":
            if _INTEGER.fullmatch(value) is None:
                return True
            # §식: `.` takes a name, so `a.0` is not a key access; an array item is read as `a[0]`.
            # Jinja2 parses `a.0` into the same `Getitem` node as `a[0]`, so only the tokens show it.
            if after_dot:
                return True
        elif kind == "float":
            if _FLOAT.fullmatch(value) is None:
                return True
            if after_dot:
                return True
        elif kind == "name":
            if _NAME.fullmatch(value) is None:
                return True
            if not after_dot and value.lower() in _CONSTANT_SPELLINGS and value not in _BOOLEANS:
                return True
        previous = token
    return False


def _lex_scan(env: Environment, source: str) -> tuple[set[str], bool]:
    """Collect unsupported tag names and spelling problems the parsed tree cannot show."""
    tokens: list[Token] = []
    problem = False
    stream = env.lex(source)
    try:
        for token in stream:
            tokens.append(token)
    except TemplateSyntaxError:
        problem = True
    tags: set[str] = set()
    index = 0
    while index < len(tokens):
        _, kind, value = tokens[index]
        if kind == "raw_begin":
            tags.add("raw")
            index += 1
            continue
        if kind == "comment_begin":
            problem = problem or "+" in value
            index += 1
            while index < len(tokens) and tokens[index][1] != "comment_end":
                index += 1
            if index < len(tokens):
                problem = problem or "+" in tokens[index][2]
                index += 1
            continue
        if kind not in ("block_begin", "variable_begin"):
            index += 1
            continue
        problem = problem or "+" in value
        closing = "block_end" if kind == "block_begin" else "variable_end"
        inner: list[Token] = []
        index += 1
        while index < len(tokens) and tokens[index][1] != closing:
            if tokens[index][1] != "whitespace":
                inner.append(tokens[index])
            index += 1
        if index < len(tokens):
            problem = problem or "+" in tokens[index][2]
            index += 1
        if kind == "variable_begin":
            problem = problem or _expression_problem(inner)
            continue
        names = [entry for entry in inner if entry[1] == "name"]
        if not names:
            problem = True
            continue
        tag = names[0][2]
        if tag not in ALLOWED_TAGS:
            tags.add(tag)
            continue
        if inner[0] is not names[0]:
            problem = True
            continue
        if tag == "include":
            problem = problem or len(inner) != 2 or inner[1][1] != "string" or _bad_escape(inner[1][2])
            continue
        problem = problem or _expression_problem(inner[1:])
    return tags, problem


# --- expression allowlist ------------------------------------------------------------------


def _is_literal(node: Any) -> bool:
    if isinstance(node, nodes.Const):
        return isinstance(node.value, (str, bool, int, float))
    return isinstance(node, nodes.Neg) and _is_number(node.node)


def _is_number(node: Any) -> bool:
    return isinstance(node, nodes.Const) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool)


def _is_index(node: Any) -> bool:
    return isinstance(node, nodes.Const) and isinstance(node.value, int) and not isinstance(node.value, bool) and node.value >= 0


def _is_text(node: Any) -> bool:
    return isinstance(node, nodes.Const) and isinstance(node.value, str)


def _filter_arguments(name: str, args: Sequence[Any]) -> bool:
    if name == "default":
        return len(args) == 1
    if name == "join":
        return not args or (len(args) == 1 and _is_text(args[0]))
    if name in ("trim", "upper", "lower", "length"):
        return not args
    if name == "replace":
        if len(args) not in (2, 3) or not _is_text(args[0]) or not args[0].value or not _is_text(args[1]):
            return False
        return len(args) == 2 or _is_index(args[2])
    if name == "json":
        return not args or (len(args) == 1 and _is_index(args[0]) and args[0].value == 0)
    return True


def _is_loop(node: Any) -> bool:
    return isinstance(node, nodes.Name) and node.name == "loop"


def _ok_expr(node: Any, depth: int, conditional: bool = True) -> bool:
    if isinstance(node, nodes.Const):
        return isinstance(node.value, (str, bool, int, float))
    if isinstance(node, nodes.Neg):
        return _is_number(node.node)
    if isinstance(node, nodes.Name):
        return node.ctx == "load" and _NAME.fullmatch(node.name) is not None and not (depth and node.name == "loop")
    if isinstance(node, nodes.Getattr):
        if node.ctx != "load" or _NAME.fullmatch(node.attr) is None:
            return False
        if depth and _is_loop(node.node):
            return node.attr in LOOP_KEYS
        return _ok_expr(node.node, depth, conditional)
    if isinstance(node, nodes.Getitem):
        if node.ctx != "load" or not (_is_text(node.arg) or _is_index(node.arg)):
            return False
        if depth and _is_loop(node.node):
            return False
        return _ok_expr(node.node, depth, conditional)
    if isinstance(node, nodes.Filter):
        if node.node is None or node.kwargs or node.dyn_args is not None or node.dyn_kwargs is not None:
            return False
        if _NAME.fullmatch(node.name) is None or isinstance(node.node, nodes.Test):
            return False
        if not all(_is_literal(argument) for argument in node.args):
            return False
        if node.name in ALLOWED_FILTERS and not _filter_arguments(node.name, node.args):
            return False
        return _ok_expr(node.node, depth, conditional)
    if isinstance(node, nodes.Test):
        if node.args or node.kwargs or node.dyn_args is not None or node.dyn_kwargs is not None:
            return False
        if _NAME.fullmatch(node.name) is None:
            return False
        if not isinstance(node.node, (nodes.Name, nodes.Getattr, nodes.Getitem)):
            return False
        return _ok_expr(node.node, depth, conditional)
    if isinstance(node, nodes.Not):
        return _ok_expr(node.node, depth, conditional)
    if isinstance(node, (nodes.And, nodes.Or)):
        return _ok_expr(node.left, depth, conditional) and _ok_expr(node.right, depth, conditional)
    if isinstance(node, nodes.Compare):
        if len(node.ops) != 1 or node.ops[0].op not in ("eq", "ne"):
            return False
        if isinstance(node.expr, nodes.Test) or isinstance(node.ops[0].expr, nodes.Test):
            return False
        return _ok_expr(node.expr, depth, conditional) and _ok_expr(node.ops[0].expr, depth, conditional)
    if isinstance(node, nodes.CondExpr):
        if not conditional or node.expr2 is None:
            return False
        return all(_ok_expr(child, depth, False) for child in (node.test, node.expr1, node.expr2))
    return False


def _ok_body(body: Iterable[Any], depth: int) -> bool:
    return all(_ok_stmt(node, depth) for node in body)


def _ok_stmt(node: Any, depth: int) -> bool:
    if isinstance(node, nodes.Output):
        return all(isinstance(child, nodes.TemplateData) or _ok_expr(child, depth) for child in node.nodes)
    if isinstance(node, nodes.If):
        return (
            _ok_expr(node.test, depth)
            and _ok_body(node.body, depth)
            and all(isinstance(branch, nodes.If) and _ok_stmt(branch, depth) for branch in node.elif_)
            and _ok_body(node.else_, depth)
        )
    if isinstance(node, nodes.For):
        if node.recursive or node.test is not None or node.else_:
            return False
        target = node.target
        if not isinstance(target, nodes.Name) or target.ctx != "store" or _NAME.fullmatch(target.name) is None or target.name == "loop":
            return False
        return _ok_expr(node.iter, depth) and _ok_body(node.body, depth + 1)
    if isinstance(node, nodes.Include):
        return _is_text(node.template) and not node.ignore_missing and bool(node.with_context)
    return False


# --- per-file inspection -------------------------------------------------------------------


def _unsupported(label: str, items: Iterable[str]) -> tuple[str, str]:
    return ("template.unsupported", f"{label} uses unsupported syntax: " + ", ".join(sorted(items)))


def _inspect(env: Environment, key: str, source: str, directory: str | None) -> nodes.Template | tuple[str, str]:
    """§템플릿 구성 오류 step 2: tag names, then syntax, then filter and test names."""
    label = relative_path(key, directory)
    tags, problem = _lex_scan(env, source)
    if tags:
        return _unsupported(label, (f"tag {name}" for name in tags))
    if problem:
        return ("template.syntax", f"{label} has invalid syntax")
    try:
        parsed = Parser(env, source, key).parse()
    except TemplateSyntaxError:
        return ("template.syntax", f"{label} has invalid syntax")
    if not _ok_body(parsed.body, 0):
        return ("template.syntax", f"{label} has invalid syntax")
    items = {f"filter {node.name}" for node in parsed.find_all(nodes.Filter) if node.name not in ALLOWED_FILTERS}
    items |= {f"test {node.name}" for node in parsed.find_all(nodes.Test) if node.name not in ALLOWED_TESTS}
    if items:
        return _unsupported(label, items)
    return parsed


# --- the static include closure ------------------------------------------------------------


class _Closure:
    """Reads and checks one declared template and every file it statically includes."""

    def __init__(self, env: Environment, directory: str | None):
        self.env = env
        self.directory = directory
        self.sources: dict[str, str] = {}
        self.clean: set[str] = set()

    def declared(self, key: str) -> tuple[str, str] | None:
        if key in self.clean:
            return None
        source = _read_template(key)
        if source is None:
            return ("template.not_found", f"cannot read {relative_path(key, self.directory)}")
        self.sources[key] = source
        return self._file(key, source, [(key, os.path.realpath(key))])

    def _file(self, key: str, source: str, chain: list[tuple[str, str]]) -> tuple[str, str] | None:
        found = _inspect(self.env, key, source, self.directory)
        if isinstance(found, tuple):
            return found
        for node in found.find_all(nodes.Include):
            problem = self._include(key, node.template.value, chain)
            if problem is not None:
                return problem
        self.clean.add(key)
        return None

    def _include(self, key: str, path: str, chain: list[tuple[str, str]]) -> tuple[str, str] | None:
        label = relative_path(key, self.directory)
        reason = _include_reason(path)
        if reason is not None:
            return ("template.unsupported", f'{label} includes "{path}": {reason}')
        target = resolve_include(key, path)
        unreadable = ("template.not_found", f'{label} includes "{path}": cannot read {relative_path(target, self.directory)}')
        if not os.path.exists(target):
            return unreadable
        base = os.path.dirname(key)
        real_target = os.path.realpath(target)
        if not _inside(os.path.realpath(base), real_target):
            return ("template.unsupported", f'{label} includes "{path}": resolves outside {relative_path(base, self.directory)}')
        source = self.sources[target] if target in self.clean else _read_template(target)
        if source is None:
            return unreadable
        for index, (_, ancestor) in enumerate(chain):
            if ancestor == real_target:
                names = [relative_path(item, self.directory) for item, _ in chain[index:]]
                names.append(relative_path(target, self.directory))
                return ("template.unsupported", "include cycle: " + " -> ".join(names))
        self.sources[target] = source
        if target in self.clean:
            return None
        return self._file(target, source, [*chain, (target, real_target)])


def load_templates(config: Mapping[str, Any], directory: str | None) -> tuple[dict[str, str], list[Issue]]:
    """Read and check every declared template and its static include closure."""
    closure = _Closure(_validation_environment(), directory)
    issues: list[Issue] = []
    for at, key in declared_templates(config):
        problem = closure.declared(key)
        if problem is not None:
            issues.append(issue(problem[0], at, problem[1]))
    return closure.sources, issues


# --- rendering -----------------------------------------------------------------------------


def _output_text(value: Any) -> str:
    """§값 출력: a string prints as itself, every other JSON value as JSON text."""
    return value if isinstance(value, str) else json_text(value)


def _defined(value: Any) -> Any:
    if isinstance(value, Undefined):
        raise GoondanError("the value is not defined")
    return value


def _finalize(value: Any) -> Any:
    return value if isinstance(value, Undefined) else _output_text(value)


def _filter_default(value: Any, fallback: Any = "") -> Any:
    return fallback if isinstance(value, Undefined) else value


def _filter_join(value: Any, separator: str = "") -> str:
    if not isinstance(_defined(value), list):
        raise GoondanError("join needs an array")
    return separator.join(_output_text(_defined(item)) for item in value)


def _filter_trim(value: Any) -> str:
    return _output_text(_defined(value)).strip(_WHITESPACE)


def _filter_upper(value: Any) -> str:
    return _output_text(_defined(value)).upper()


def _filter_lower(value: Any) -> str:
    return _output_text(_defined(value)).lower()


def _filter_replace(value: Any, find: str, replacement: str, count: int | None = None) -> str:
    text = _output_text(_defined(value))
    return text.replace(find, replacement) if count is None else text.replace(find, replacement, count)


def _filter_length(value: Any) -> int:
    value = _defined(value)
    if isinstance(value, str) or isinstance(value, list) or isinstance(value, Mapping):
        return len(value)
    raise GoondanError("length needs a string, an array or an object")


def _filter_json(value: Any, indent: int = 2) -> str:
    """§필터: `json(0)` writes the compact text and `json` without an argument the indented one."""
    return json_text(_defined(value)) if indent == 0 else json_pretty_text(_defined(value))


class _MapLoader(BaseLoader):
    """Serves the templates read at configuration load and never touches the file system."""

    def __init__(self, templates: Mapping[str, str]):
        self.templates = templates

    def get_source(self, environment: Environment, template: str) -> tuple[str, str, Any]:
        source = self.templates.get(template)
        if source is None:
            raise TemplateNotFound(template)
        return source, template, lambda: True


class _CodeGenerator(CodeGenerator):
    """Keeps `loop` out of the context an `include` passes to the template it includes."""

    def dump_local_context(self, frame: Frame) -> str:
        """§반복: an included template receives the loop variables but never `loop` itself."""
        items = ", ".join(f"{name!r}: {target}" for name, target in frame.symbols.dump_stores().items() if name != "loop")
        return "{" + items + "}"


class _Rewriter(NodeTransformer):
    """Replaces the host engine's semantics where the specification differs from Jinja2."""

    def visit_Compare(self, node: nodes.Compare) -> nodes.Node:
        node = self.generic_visit(node)
        operand = node.ops[0]
        call = nodes.Call(nodes.EnvironmentAttribute("equal_values"), [node.expr, operand.expr], [], None, None)
        call.set_lineno(node.lineno)
        if operand.op == "ne":
            negated = nodes.Not(call)
            negated.set_lineno(node.lineno)
            return negated
        return call

    def visit_For(self, node: nodes.For) -> nodes.Node:
        node = self.generic_visit(node)
        call = nodes.Call(nodes.EnvironmentAttribute("iterate_array"), [node.iter], [], None, None)
        call.set_lineno(node.lineno)
        node.iter = call
        return node


class _TemplateEnvironment(Environment):
    """Applies the key access, iteration, comparison and include rules of the specification."""

    code_generator_class = _CodeGenerator

    def join_path(self, template: str, parent: str) -> str:
        return resolve_include(parent, template)

    def _parse(self, source: str, name: str | None, filename: str | None) -> nodes.Template:
        return _Rewriter().visit(Parser(self, source, name, filename).parse())

    def getattr(self, obj: Any, attribute: str) -> Any:
        return self._read(obj, attribute)

    def getitem(self, obj: Any, argument: Any) -> Any:
        return self._read(obj, argument)

    def _read(self, obj: Any, key: Any) -> Any:
        """§식: key access reads JSON data only, never host attributes or methods."""
        if isinstance(obj, Undefined):
            raise GoondanError(f"cannot read {key!r} of an undefined value")
        if isinstance(obj, LoopContext):
            if isinstance(key, str) and key in LOOP_KEYS:
                return getattr(obj, key)
            return self.undefined(name=str(key))
        if isinstance(key, str):
            return obj[key] if isinstance(obj, Mapping) and key in obj else self.undefined(name=key)
        if isinstance(key, int) and not isinstance(key, bool):
            return obj[key] if isinstance(obj, list) and 0 <= key < len(obj) else self.undefined(name=str(key))
        return self.undefined(name=str(key))

    def equal_values(self, left: Any, right: Any) -> bool:
        """§JSON 값 비교: values of different JSON types are never equal."""
        if json_type(_defined(left)) == "invalid" or json_type(_defined(right)) == "invalid":
            raise GoondanError("comparison needs JSON values")
        return json_equal(left, right)

    def iterate_array(self, value: Any) -> list[Any]:
        if not isinstance(_defined(value), list):
            raise GoondanError("only an array can be iterated")
        return value


def _environment(templates: Mapping[str, str]) -> Environment:
    env = _TemplateEnvironment(
        loader=_MapLoader(templates),
        undefined=StrictUndefined,
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
        finalize=_finalize,
    )
    env.filters = {
        "default": _filter_default,
        "join": _filter_join,
        "trim": _filter_trim,
        "upper": _filter_upper,
        "lower": _filter_lower,
        "replace": _filter_replace,
        "length": _filter_length,
        "json": _filter_json,
    }
    env.tests = {"defined": lambda value: not isinstance(value, Undefined)}
    return env


_VALIDATION_ENVIRONMENT: list[Environment] = []


def _validation_environment() -> Environment:
    """A plain environment used only to lex and parse; it never renders."""
    if not _VALIDATION_ENVIRONMENT:
        _VALIDATION_ENVIRONMENT.append(Environment(autoescape=False, trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True))
    return _VALIDATION_ENVIRONMENT[0]


class TemplateRenderer:
    """Renders the templates a configuration loaded, addressed by absolute or configuration-relative path."""

    def __init__(self, templates: Mapping[str, str] | None = None, directory: str | None = None):
        self.templates = dict(templates or {})
        self.directory = directory
        self.env = _environment(self.templates)

    def resolve(self, template: str) -> str | None:
        """§템플릿을 읽는 시점: only a loaded template, named absolutely or from the configuration directory."""
        if template in self.templates:
            return template
        if self.directory:
            key = os.path.normpath(os.path.join(self.directory, template))
            if key in self.templates:
                return key
        return None

    def render(self, template: str, variables: Mapping[str, Any]) -> str:
        key = self.resolve(template)
        if key is None:
            raise GoondanError(f"template {relative_path(template, self.directory)} is not loaded")
        try:
            return self.env.get_template(key).render(dict(variables))
        except GoondanError as error:
            raise GoondanError(f"template {relative_path(key, self.directory)}: {error}") from error
        except TemplateError as error:
            raise GoondanError(f"template {relative_path(key, self.directory)}: {error}") from error
