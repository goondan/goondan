"""Checks of `case.json` and `expected.json` against the fixture format.

An unknown key, a value of the wrong shape, an operation in a position that does not
allow it and an error code outside the closed set all fail the case, so this module
gathers every problem it finds and reports them together.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from .errors import CaseFormatError

CASE_ID = r"^[a-z0-9]+(-[a-z0-9]+)*$"

STAGES = (
    "onInput", "onPrompt", "onStep", "onModelInput", "onModelResult",
    "onToolCall", "onToolResult", "onOutput", "onError",
)

SCHEMA_KEYWORDS = (
    "type", "const", "enum", "required", "additionalProperties", "propertyNames", "minProperties",
    "minItems", "uniqueItems", "minLength", "pattern", "exclusiveMinimum", "oneOf", "anyOf", "not", "false",
)

CONFIG_ERROR_CODES = frozenset(
    (
        "load.not_found", "load.not_yaml", "load.yaml", "load.not_object", "load.duplicate_resource",
        "load.resource_cycle", "config.not_json",
        "reference.agent", "reference.inherit", "reference.inherit_cycle", "reference.extension",
        "reference.duplicate_tool",
        "routes.reserved", "routes.no_input",
        "routes.unreachable", "routes.cycle", "routes.wait_cycle",
        "template.not_found", "template.syntax", "template.unsupported",
        "binding.model", "binding.tool", "binding.duplicate_tool", "binding.function", "binding.extension",
        "binding.port", "binding.extension_hook",
    )
    + tuple(f"schema.{keyword}" for keyword in SCHEMA_KEYWORDS)
)

EXECUTION_ERROR_CODES = frozenset(
    ("input_invalid", "model_error", "tool_error", "tool_unavailable", "hook_error", "value_invalid", "route_error",
     "operation_invalid", "runtime_error", "aborted")
)

# operation name -> (required arguments, optional arguments)
VALUE_OPS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "identity": ((), ()),
    "constant": (("value",), ()),
    "get": (("path",), ()),
    "set": (("path", "value"), ()),
    "merge": (("value",), ()),
    "wrap": (("key",), ("with",)),
    "equals": (("value",), ("path",)),
    "text": ((), ()),
    "textSuffix": (("suffix",), ()),
    "result": (("content",), ("isError",)),
    "sequence": (("items",), ()),
    "chain": (("ops",), ()),
    "throw": (("message",), ()),
    "await": (("gate",), ("then",)),
    "nonJson": ((), ()),
}

HOOK_OPS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "append": (("messages",), ()),
    "runAgent": (("name",), ("input",)),
    "runModel": (("messages",), ()),
    "render": (("template",), ("variables",)),
    "complete": (("message",), ("tool", "useResultContent")),
}

STEP_ACTIONS = (
    "run", "awaitRun", "decide", "list", "abort", "deleteSession", "restart", "close", "release", "reach",
    "acquireLease", "renewLease", "releaseLease", "appendJournal", "scanJournal", "headJournal",
    "appendOperationTransition", "deleteStoreSession", "parallel",
)

MODEL_RESPONSE_ACTIONS = ("text", "toolCalls", "content", "error", "raw", "await")
MODEL_RESPONSE_EXTRAS = ("finishReason", "usage", "meta", "id", "source", "deltas")
TOOL_RESULT_ACTIONS = ("text", "json", "content", "error", "value", "result", "runAgent", "await")

OBSERVATION_SECTIONS = (
    "effectiveConfig", "events", "journalEvents", "journalStates", "modelInputs", "modelContexts",
    "toolCalls", "toolContexts", "functionCalls", "functionContexts", "hookCalls", "hookContexts",
    "extensionLog", "conversations", "operations", "operationHistory",
)


class _Check:
    def __init__(self) -> None:
        self.problems: list[str] = []

    def add(self, path: str, message: str) -> None:
        self.problems.append(f"{path}: {message}")

    def mapping(self, value: Any, path: str) -> bool:
        if isinstance(value, Mapping):
            return True
        self.add(path, "must be an object")
        return False

    def array(self, value: Any, path: str) -> bool:
        if isinstance(value, list):
            return True
        self.add(path, "must be an array")
        return False

    def text(self, value: Any, path: str, *, allow_empty: bool = False) -> bool:
        if isinstance(value, str) and (allow_empty or value):
            return True
        self.add(path, "must be a non-empty string" if not allow_empty else "must be a string")
        return False

    def boolean(self, value: Any, path: str) -> bool:
        if isinstance(value, bool):
            return True
        self.add(path, "must be a boolean")
        return False

    def keys(self, value: Mapping[str, Any], path: str, allowed: Sequence[str], required: Sequence[str] = ()) -> None:
        for key in value:
            if key not in allowed:
                self.add(f"{path}/{key}", f"is not a key of this object; allowed keys are {', '.join(allowed)}")
        for key in required:
            if key not in value:
                self.add(path, f"must have the key {key!r}")

    def one_action(self, value: Mapping[str, Any], path: str, actions: Sequence[str]) -> str | None:
        present = [key for key in actions if key in value]
        if len(present) == 1:
            return present[0]
        self.add(path, f"must have exactly one of {', '.join(actions)}, found {len(present)}")
        return None

    # -- operations ---------------------------------------------------------------------

    def op(self, value: Any, path: str, *, hooks: bool) -> None:
        if not self.mapping(value, path):
            return
        name = value.get("op")
        if not isinstance(name, str):
            self.add(f"{path}/op", "must be the name of an operation")
            return
        catalogue = {**VALUE_OPS, **HOOK_OPS} if hooks else VALUE_OPS
        if name not in catalogue:
            known = "a value operation" if not hooks else "an operation"
            self.add(f"{path}/op", f"{name!r} is not {known} allowed in this position")
            return
        required, optional = catalogue[name]
        self.keys(value, path, ("op", *required, *optional), required)
        if name in ("get", "set"):
            self.text(value.get("path"), f"{path}/path", allow_empty=name == "get")
        if name == "merge":
            self.mapping(value.get("value"), f"{path}/value")
        if name == "wrap":
            self.text(value.get("key"), f"{path}/key")
            if "with" in value and self.mapping(value["with"], f"{path}/with") and value.get("key") in value["with"]:
                self.add(f"{path}/with", "must not repeat the key of the wrapper")
        if name == "equals" and "path" in value:
            self.text(value["path"], f"{path}/path", allow_empty=True)
        if name == "textSuffix":
            self.text(value.get("suffix"), f"{path}/suffix", allow_empty=True)
        if name == "throw":
            self.text(value.get("message"), f"{path}/message")
        if name == "result":
            self.array(value.get("content"), f"{path}/content")
            if "isError" in value:
                self.boolean(value["isError"], f"{path}/isError")
        if name == "sequence":
            if self.array(value.get("items"), f"{path}/items"):
                if not value["items"]:
                    self.add(f"{path}/items", "must have at least one operation")
                for index, item in enumerate(value["items"]):
                    self.op(item, f"{path}/items/{index}", hooks=hooks)
        if name == "chain" and self.array(value.get("ops"), f"{path}/ops"):
            for index, item in enumerate(value["ops"]):
                self.op(item, f"{path}/ops/{index}", hooks=hooks)
        if name == "await":
            self.gate(value.get("gate"), f"{path}/gate")
            if "then" in value:
                self.op(value["then"], f"{path}/then", hooks=hooks)
        if name == "append" and self.array(value.get("messages"), f"{path}/messages"):
            for index, item in enumerate(value["messages"]):
                at = f"{path}/messages/{index}"
                if self.mapping(item, at):
                    self.keys(item, at, ("role", "text", "key", "keep", "meta"), ("role", "text"))
                    if item.get("role") not in ("user", "system"):
                        self.add(f"{at}/role", "must be 'user' or 'system'")
                    self.text(item.get("text"), f"{at}/text", allow_empty=True)
        if name == "runAgent":
            self.text(value.get("name"), f"{path}/name")
        # `runModel` hands `messages` to `model.run` unchanged, so a case may pass a value that is
        # no message array to check the failure §훅 컨텍스트와 호스트 함수 defines for it.
        if name == "render":
            self.text(value.get("template"), f"{path}/template")
            if "variables" in value:
                self.mapping(value["variables"], f"{path}/variables")
        if name == "complete":
            self.mapping(value.get("message"), f"{path}/message")
            if "tool" in value:
                self.text(value["tool"], f"{path}/tool")
            if "useResultContent" in value:
                self.boolean(value["useResultContent"], f"{path}/useResultContent")

    def gate(self, value: Any, path: str, *, releasable: bool = False) -> None:
        if not self.text(value, path):
            return
        if releasable and value == "never":
            self.add(path, "the gate 'never' is reserved and cannot be released")

    # -- bindings -----------------------------------------------------------------------

    def model_response(self, value: Any, path: str) -> None:
        if not self.mapping(value, path):
            return
        action = self.one_action(value, path, MODEL_RESPONSE_ACTIONS)
        if action is None:
            return
        extras = MODEL_RESPONSE_EXTRAS if action in ("text", "toolCalls", "content") else ()
        if action == "error":
            extras = ("code",)
        if action == "await":
            extras = ("then",)
            if "then" not in value:
                self.add(path, "an await response must have 'then'")
        self.keys(value, path, (action, *extras))
        if action == "text":
            self.text(value["text"], f"{path}/text", allow_empty=True)
        if action == "toolCalls" and self.array(value["toolCalls"], f"{path}/toolCalls"):
            for index, call in enumerate(value["toolCalls"]):
                at = f"{path}/toolCalls/{index}"
                if self.mapping(call, at):
                    self.keys(call, at, ("callId", "name", "args"), ("callId", "name", "args"))
        if action == "content":
            self.array(value["content"], f"{path}/content")
        if action == "error":
            self.text(value["error"], f"{path}/error")
            if "code" in value:
                self.text(value["code"], f"{path}/code")
        if action == "await":
            self.gate(value["await"], f"{path}/await")
            if "then" in value:
                self.model_response(value["then"], f"{path}/then")
        if "usage" in value:
            self.mapping(value["usage"], f"{path}/usage")
        if "deltas" in value:
            self.array(value["deltas"], f"{path}/deltas")

    def tool_script(self, value: Any, path: str) -> None:
        if not self.mapping(value, path):
            return
        self.keys(value, path, ("description", "input", "results"), ("results",))
        if "description" in value:
            self.text(value["description"], f"{path}/description", allow_empty=True)
        if "input" in value:
            self.mapping(value["input"], f"{path}/input")
        if self.array(value.get("results"), f"{path}/results"):
            for index, item in enumerate(value["results"]):
                self.tool_result(item, f"{path}/results/{index}")

    def tool_result(self, value: Any, path: str) -> None:
        if not self.mapping(value, path):
            return
        action = self.one_action(value, path, TOOL_RESULT_ACTIONS)
        if action is None:
            return
        extras: tuple[str, ...] = ("isError", "keep", "meta") if action in ("text", "json", "content") else ()
        if action == "await":
            extras = ("then",)
            if "then" not in value:
                self.add(path, "an await result must have 'then'")
        self.keys(value, path, (action, *extras))
        if action == "text":
            self.text(value["text"], f"{path}/text", allow_empty=True)
        if action == "content":
            self.array(value["content"], f"{path}/content")
        if action == "error":
            self.text(value["error"], f"{path}/error")
        if action == "runAgent" and self.mapping(value["runAgent"], f"{path}/runAgent"):
            self.keys(value["runAgent"], f"{path}/runAgent", ("name", "input"), ("name",))
            self.text(value["runAgent"].get("name"), f"{path}/runAgent/name")
        if action == "await":
            self.gate(value["await"], f"{path}/await")
            if "then" in value:
                self.tool_result(value["then"], f"{path}/then")
        if "isError" in value:
            self.boolean(value["isError"], f"{path}/isError")
        if "keep" in value:
            self.boolean(value["keep"], f"{path}/keep")

    def extension_script(self, value: Any, path: str) -> None:
        if not self.mapping(value, path):
            return
        self.keys(value, path, ("definition", "instance"))
        definition = value.get("definition")
        if definition is not None and self.mapping(definition, f"{path}/definition"):
            at = f"{path}/definition"
            self.keys(definition, at, ("requires", "hooks", "tools", "validateOptions", "createError"))
            for key in ("requires", "hooks", "tools"):
                if key in definition and self.array(definition[key], f"{at}/{key}"):
                    for index, item in enumerate(definition[key]):
                        self.text(item, f"{at}/{key}/{index}")
                    if key == "hooks":
                        for index, item in enumerate(definition[key]):
                            if isinstance(item, str) and item not in STAGES:
                                self.add(f"{at}/hooks/{index}", f"{item!r} is not a value stage")
            if "validateOptions" in definition:
                self.op(definition["validateOptions"], f"{at}/validateOptions", hooks=False)
            if "createError" in definition:
                self.text(definition["createError"], f"{at}/createError")
        instance = value.get("instance")
        if instance is not None and self.mapping(instance, f"{path}/instance"):
            at = f"{path}/instance"
            self.keys(instance, at, ("hooks", "tools", "events"))
            if "hooks" in instance and self.mapping(instance["hooks"], f"{at}/hooks"):
                for stage, op in instance["hooks"].items():
                    if stage not in STAGES:
                        self.add(f"{at}/hooks/{stage}", "is not a value stage")
                    self.op(op, f"{at}/hooks/{stage}", hooks=True)
            if "tools" in instance and self.mapping(instance["tools"], f"{at}/tools"):
                for name, script in instance["tools"].items():
                    self.tool_script(script, f"{at}/tools/{name}")
            if "events" in instance and self.array(instance["events"], f"{at}/events"):
                for index, item in enumerate(instance["events"]):
                    self.text(item, f"{at}/events/{index}")

    def bindings(self, value: Any, path: str) -> None:
        if not self.mapping(value, path):
            return
        self.keys(value, path, ("models", "tools", "functions", "extensions", "ports", "maxRetries"))
        if "models" in value and self.mapping(value["models"], f"{path}/models"):
            for name, script in value["models"].items():
                at = f"{path}/models/{name}"
                if self.mapping(script, at):
                    self.keys(script, at, ("responses",), ("responses",))
                    if self.array(script.get("responses"), f"{at}/responses"):
                        for index, response in enumerate(script["responses"]):
                            self.model_response(response, f"{at}/responses/{index}")
        if "tools" in value and self.mapping(value["tools"], f"{path}/tools"):
            for name, script in value["tools"].items():
                self.tool_script(script, f"{path}/tools/{name}")
        if "functions" in value and self.mapping(value["functions"], f"{path}/functions"):
            for name, op in value["functions"].items():
                self.op(op, f"{path}/functions/{name}", hooks=False)
        if "extensions" in value and self.mapping(value["extensions"], f"{path}/extensions"):
            for name, script in value["extensions"].items():
                self.extension_script(script, f"{path}/extensions/{name}")
        if "ports" in value:
            self.mapping(value["ports"], f"{path}/ports")

    # -- steps --------------------------------------------------------------------------

    def step(self, value: Any, path: str, *, branch: bool) -> None:
        if not self.mapping(value, path):
            return
        action = self.one_action(value, path, STEP_ACTIONS)
        if action is None:
            return
        self.keys(value, path, (action, "settle"))
        if "settle" in value:
            if branch:
                self.add(f"{path}/settle", "a parallel branch step cannot use 'settle'")
            else:
                self.boolean(value["settle"], f"{path}/settle")
        if branch and action in ("restart", "parallel"):
            self.add(path, f"a parallel branch cannot use {action!r}")
        argument = value[action]
        at = f"{path}/{action}"
        if action in ("release", "reach"):
            self.gate(argument, at, releasable=action == "release")
            return
        if action == "parallel":
            if self.array(argument, at):
                for index, steps in enumerate(argument):
                    if self.array(steps, f"{at}/{index}"):
                        for position, item in enumerate(steps):
                            self.step(item, f"{at}/{index}/{position}", branch=True)
            return
        if not self.mapping(argument, at):
            return
        shapes = {
            "run": (("sessionId", "input", "meta", "agent", "startAgent", "awaitResult", "handle"), ("input",)),
            "awaitRun": (("handle",), ("handle",)),
            "decide": (("operation", "value", "sessionId"), ("operation", "value")),
            "list": (("sessionId",), ()),
            "abort": (("sessionId",), ("sessionId",)),
            "deleteSession": (("sessionId",), ("sessionId",)),
            "restart": ((), ()),
            "close": ((), ()),
            "acquireLease": (("sessionId", "owner", "lease"), ("sessionId", "owner", "lease")),
            "renewLease": (("lease",), ("lease",)),
            "releaseLease": (("lease",), ("lease",)),
            "appendJournal": (("events", "lease", "expected", "writeId"), ("events",)),
            "appendOperationTransition": (("sessionId", "operation", "status"), ("sessionId", "operation", "status")),
            "scanJournal": (("sessionId", "fromSeq", "limit"), ()),
            "headJournal": (("sessionId",), ("sessionId",)),
            "deleteStoreSession": (("sessionId", "lease"), ("sessionId", "lease")),
        }
        allowed, required = shapes[action]
        self.keys(argument, at, allowed, required)
        for key in ("sessionId", "operation", "status", "agent", "startAgent", "owner", "lease", "writeId"):
            if key in argument:
                self.text(argument[key], f"{at}/{key}")
        if action == "run":
            if "handle" in argument:
                self.text(argument["handle"], f"{at}/handle")
            if "meta" in argument:
                self.mapping(argument["meta"], f"{at}/meta")
            if "awaitResult" in argument:
                self.boolean(argument["awaitResult"], f"{at}/awaitResult")
            awaits = argument.get("awaitResult", True)
            if awaits is False and "handle" not in argument:
                self.add(at, "a run that does not await its result requires 'handle'")
            if awaits is not False and "handle" in argument:
                self.add(f"{at}/handle", "is only allowed when awaitResult is false")
        if action == "awaitRun":
            self.text(argument.get("handle"), f"{at}/handle")
        if action == "appendOperationTransition" and argument.get("status") not in (
            "approved", "running", "rejected", "delivering"
        ):
            self.add(f"{at}/status", "must be 'approved', 'running', 'rejected' or 'delivering'")
        if action == "appendJournal":
            self.array(argument.get("events"), f"{at}/events")
        operation = argument.get("operation")
        if isinstance(operation, str) and not operation.startswith("<op:") and "sessionId" not in argument:
            self.add(at, "an operation that is not an alias needs a sessionId")

    # -- expected -----------------------------------------------------------------------

    def issues(self, value: Any, path: str) -> None:
        if not self.array(value, path):
            return
        if not value:
            self.add(path, "must have at least one issue")
        for index, issue in enumerate(value):
            at = f"{path}/{index}"
            if not self.mapping(issue, at):
                continue
            self.keys(issue, at, ("code", "path", "message"), ("code", "path"))
            code = issue.get("code")
            if isinstance(code, str) and code not in CONFIG_ERROR_CODES:
                self.add(f"{at}/code", f"{code!r} is not a configuration error code of the specification")
            self.text(issue.get("path"), f"{at}/path", allow_empty=True)
            if "message" in issue:
                self.text(issue["message"], f"{at}/message")

    def step_error(self, value: Any, path: str) -> None:
        if not self.mapping(value, path):
            return
        if "storeError" in value:
            self.keys(value, path, ("storeError",))
            if value["storeError"] not in ("StoreConflictError", "StoreInputError"):
                self.add(f"{path}/storeError", "must name a store error")
            return
        if "issues" in value:
            self.keys(value, path, ("issues",))
            self.issues(value["issues"], f"{path}/issues")
            return
        if "scriptError" in value:
            self.keys(value, path, ("scriptError",))
            self.text(value["scriptError"], f"{path}/scriptError")
            return
        self.keys(value, path, ("where", "codes", "attempt", "toolCall", "message"), ("where", "codes", "attempt"))
        self.text(value.get("where"), f"{path}/where")
        if self.array(value.get("codes"), f"{path}/codes"):
            if not value["codes"]:
                self.add(f"{path}/codes", "must have at least one code")
            elif value["codes"][0] not in EXECUTION_ERROR_CODES:
                self.add(f"{path}/codes/0", f"{value['codes'][0]!r} is not an execution error code of the specification")
        if not isinstance(value.get("attempt"), int) or isinstance(value.get("attempt"), bool) or value.get("attempt", 0) < 1:
            self.add(f"{path}/attempt", "must be an integer of 1 or more")
        if "message" in value:
            self.text(value["message"], f"{path}/message")

    def step_expectation(self, value: Any, path: str, *, branch: bool = False) -> None:
        if not self.mapping(value, path):
            return
        present = [key for key in ("result", "error", "parallel") if key in value]
        if len(present) > 1:
            self.add(path, "must have at most one of result, error, parallel")
            return
        self.keys(value, path, ("result", "error", "parallel"))
        if "error" in value:
            self.step_error(value["error"], f"{path}/error")
        if "parallel" in value:
            if branch:
                self.add(path, "a parallel branch has no nested parallel result")
            elif self.array(value["parallel"], f"{path}/parallel"):
                for index, steps in enumerate(value["parallel"]):
                    if self.array(steps, f"{path}/parallel/{index}"):
                        for position, item in enumerate(steps):
                            self.step_expectation(item, f"{path}/parallel/{index}/{position}", branch=True)


def check_case(case: Any, expected: Any) -> None:
    """Raise `CaseFormatError` with every problem found in the two case files."""
    check = _Check()
    if check.mapping(case, "case.json"):
        check.keys(case, "case.json", ("description", "spec", "config", "bindings", "steps"), ("description", "spec", "steps"))
        if "description" in case:
            check.text(case["description"], "case.json/description")
        if "spec" in case and check.array(case["spec"], "case.json/spec"):
            if not case["spec"]:
                check.add("case.json/spec", "must cite at least one section heading")
            if len(set(map(str, case["spec"]))) != len(case["spec"]):
                check.add("case.json/spec", "must not repeat a section heading")
            for index, heading in enumerate(case["spec"]):
                check.text(heading, f"case.json/spec/{index}")
        config = case.get("config")
        if config is not None and check.mapping(config, "case.json/config"):
            check.keys(config, "case.json/config", ("path", "document", "directory"))
            if "path" in config and "document" in config:
                check.add("case.json/config", "must use either 'path' or 'document', not both")
            if "directory" in config and "document" not in config:
                check.add("case.json/config/directory", "belongs to the document mode")
            if "path" in config:
                check.text(config["path"], "case.json/config/path")
            if "directory" in config:
                check.text(config["directory"], "case.json/config/directory")
            if "document" in config:
                check.mapping(config["document"], "case.json/config/document")
        if "bindings" in case:
            check.bindings(case["bindings"], "case.json/bindings")
        if "steps" in case and check.array(case["steps"], "case.json/steps"):
            for index, step in enumerate(case["steps"]):
                check.step(step, f"case.json/steps/{index}", branch=False)
    if check.mapping(expected, "expected.json"):
        check.keys(expected, "expected.json", ("error", "steps", "observations"))
        if "error" in expected:
            for key in ("steps", "observations"):
                if key in expected:
                    check.add(f"expected.json/{key}", "cannot be used together with 'error'")
            if isinstance(case, Mapping) and case.get("steps"):
                check.add("case.json/steps", "must be empty when a configuration error is expected")
            error = expected["error"]
            if check.mapping(error, "expected.json/error"):
                if error.get("invalidArgument") is True:
                    check.keys(error, "expected.json/error", ("phase", "invalidArgument"), ("phase",))
                    if error.get("phase") != "create":
                        check.add("expected.json/error/phase", "an invalid argument error is reported by 'create'")
                else:
                    check.keys(error, "expected.json/error", ("phase", "issues"), ("phase", "issues"))
                    if error.get("phase") not in ("load", "validate", "create"):
                        check.add("expected.json/error/phase", "must be 'load', 'validate' or 'create'")
                    check.issues(error.get("issues"), "expected.json/error/issues")
        else:
            if check.array(expected.get("steps"), "expected.json/steps"):
                if isinstance(case, Mapping) and isinstance(case.get("steps"), list) and len(expected["steps"]) != len(case["steps"]):
                    check.add("expected.json/steps", f"must have {len(case['steps'])} entries, one per step")
                for index, item in enumerate(expected["steps"]):
                    check.step_expectation(item, f"expected.json/steps/{index}")
            if "observations" in expected and check.mapping(expected["observations"], "expected.json/observations"):
                for section in expected["observations"]:
                    if section not in OBSERVATION_SECTIONS:
                        check.add(f"expected.json/observations/{section}", "is not an observation section")
    if check.problems:
        raise CaseFormatError(check.problems)
