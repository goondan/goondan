"""The Python conformance runner.

One case runs in the order the README fixes: find the case, check the case files, build
the bindings, read the configuration and create the runtime, run the steps, collect the
observations, close the runtimes and finally compare. A part the Python host cannot
express fails the case with `unsupported by Python runner`; no case is skipped and no
failure is marked as expected.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping, Sequence

from goondan import GoondanConfigError, create_goondan, load_config, validate_config

from .bindings import CaseState, RuntimeBindings, project_operation, snapshot
from .casefile import CASE_ID, STEP_ACTIONS, check_case
from .compare import ABSENT, Difference, diff_listed_keys, diff_values, format_differences
from .errors import CaseFailure, CaseFormatError, ScriptError, UnsupportedFeature
from .jsonptr import format_pointer
from .normalize import SECTION_ORDER, message_ids, normalize_document
from .ops import resolve
from .values import KIND_NUMBER, json_equal, kind_of

STEP_TIMEOUT = 5.0
RESULT_KEYS = ("output", "outputs", "usage", "finishReason", "status", "runs")
USAGE_KEYS = ("input", "output", "cacheRead", "cacheWrite")
CASE_FILES = ("case.json", "expected.json")
CASE_DIRECTORIES = ("config",)
UNEXPECTED_OPTION = re.compile(r"unexpected keyword argument '([^']+)'")

NO_RESULT = object()


def fixtures_root() -> Path:
    return Path(__file__).resolve().parents[4] / "fixtures" / "conformance"


def discover_cases(root: Path) -> list[Path]:
    """Every case directory, in code point order of the directory name."""
    entries = [entry for entry in root.iterdir() if not entry.name.startswith(".") and entry.is_dir()]
    return sorted(entries, key=lambda entry: entry.name)


def library_problems(root: Path) -> list[str]:
    problems: list[str] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            if not re.match(CASE_ID, entry.name):
                problems.append(f"the case directory {entry.name!r} is not a lower case identifier")
        elif entry.name != "README.md":
            problems.append(f"{entry.name!r} is neither a case directory nor the README")
    return problems


def case_directory_problems(case_dir: Path) -> list[str]:
    problems: list[str] = []
    for entry in sorted(case_dir.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            if entry.name not in CASE_DIRECTORIES:
                problems.append(f"{entry.name!r} is not a directory a case may have")
        elif entry.name not in CASE_FILES:
            problems.append(f"{entry.name!r} is not a file a case may have")
    for name in CASE_FILES:
        if not (case_dir / name).is_file():
            problems.append(f"the case has no {name}")
    return problems


def missing_options(function: Any, names: Sequence[str]) -> list[str]:
    try:
        parameters = inspect.signature(function).parameters
    except (TypeError, ValueError):
        return []
    if any(parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):
        return []
    return [name for name in names if name not in parameters]


def check_config_error(error: GoondanConfigError) -> list[str]:
    """The invariants every configuration error must satisfy."""
    problems: list[str] = []
    issues = getattr(error, "issues", None)
    if not isinstance(issues, list) or not issues:
        return ["a configuration error must carry at least one issue"]
    for index, issue in enumerate(issues):
        at = f"issues/{index}"
        if not isinstance(issue, Mapping) or set(issue) != {"code", "path", "message"}:
            problems.append(f"{at} must have exactly the keys code, path and message")
            continue
        if not isinstance(issue["message"], str) or not issue["message"]:
            problems.append(f"{at}/message must be a non-empty string")
        if not isinstance(issue["code"], str) or not isinstance(issue["path"], str):
            problems.append(f"{at} must have a string code and a string path")
    expected = "Invalid Goondan configuration:\n" + "\n".join(
        f"- {issue['path'] or '(root)'}: {issue['message']} [{issue['code']}]"
        for issue in issues if isinstance(issue, Mapping) and set(issue) == {"code", "path", "message"}
    )
    if str(error) != expected:
        problems.append(f"the exception message must be\n{expected}\nbut was\n{error}")
    return problems


def check_operations(operations: Sequence[Any]) -> list[str]:
    problems: list[str] = []
    for operation in operations:
        if not isinstance(operation, Mapping):
            problems.append("a stored operation must be an object")
            continue
        name = operation.get("operationId")
        for key in ("createdAt", "updatedAt"):
            if kind_of(operation.get(key)) is not KIND_NUMBER:
                problems.append(f"the operation {name!r} must have a number {key}")
        if "deliveredAt" in operation:
            if kind_of(operation["deliveredAt"]) is not KIND_NUMBER:
                problems.append(f"the operation {name!r} must have a number deliveredAt")
            if operation.get("deliveryStatus") != "delivered":
                problems.append(f"the operation {name!r} has deliveredAt but is not delivered")
    return problems


def check_usage(outcomes: Sequence[Any]) -> list[str]:
    """A successful turn result must carry the sum of the usage of its agent runs."""
    problems: list[str] = []
    for outcome in outcomes:
        if not isinstance(outcome, Mapping):
            continue
        if "parallel" in outcome:
            for branch in outcome["parallel"]:
                problems.extend(check_usage(branch))
            continue
        result = outcome.get("result")
        if not isinstance(result, Mapping) or not isinstance(result.get("runs"), list) or "usage" not in result:
            continue
        total = {key: 0 for key in USAGE_KEYS}
        for run in result["runs"]:
            usage = run.get("usage") if isinstance(run, Mapping) else None
            if isinstance(usage, Mapping):
                for key in USAGE_KEYS:
                    value = usage.get(key, 0)
                    total[key] += value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
        if not json_equal(total, result["usage"]):
            problems.append(f"the turn usage {result['usage']} is not the sum of the agent runs {total}")
    return problems


def diff_issues(expected: Sequence[Any], actual: Any, base: Sequence[Any]) -> list[Difference]:
    if not isinstance(actual, list):
        return [Difference(format_pointer(base), expected, actual)]
    differences: list[Difference] = []
    if len(expected) != len(actual):
        differences.append(Difference(format_pointer(base), expected, actual))
    for index in range(min(len(expected), len(actual))):
        wanted, found = expected[index], actual[index]
        if isinstance(wanted, Mapping) and isinstance(found, Mapping) and "message" not in wanted:
            found = {key: value for key, value in found.items() if key != "message"}
        differences.extend(diff_values(wanted, found, (*base, index)))
    return differences


def diff_error(expected: Mapping[str, Any], actual: Mapping[str, Any], base: Sequence[Any]) -> list[Difference]:
    if "issues" in expected and "issues" in actual:
        differences = diff_values({key: value for key, value in expected.items() if key != "issues"},
                                  {key: value for key, value in actual.items() if key != "issues"}, base)
        return differences + diff_issues(expected["issues"], actual["issues"], (*base, "issues"))
    compared = {key: value for key, value in actual.items() if key != "message" or "message" in expected}
    return diff_values(expected, compared, base)


class CaseRunner:
    """Runs one case and reports every way it differs from `expected.json`."""

    def __init__(self, case_dir: Path, case: Mapping[str, Any], expected: Mapping[str, Any]):
        self.case_dir = case_dir
        self.case = case
        self.expected = expected
        self.state = CaseState(case, str(case_dir))
        self.runtimes: list[tuple[Any, RuntimeBindings]] = []
        self.closed: set[int] = set()
        self.effective_config: Any = None
        self.config_error: tuple[str, Exception] | None = None
        self.outcomes: list[Any] = []
        self.operations: Any = None
        self.observations: dict[str, Any] | None = None
        self.problems: list[str] = []
        self.loaded: Any = None
        self.document: Any = None
        self.directory: str | None = None

    # -- host API access -----------------------------------------------------------------

    def call(self, function: Any, label: str, options: Mapping[str, Any], *arguments: Any) -> Any:
        missing = missing_options(function, list(options))
        if missing:
            raise self.state.unsupported_feature(f"{label} has no {' and no '.join(missing)} option")
        try:
            return function(*arguments, **options)
        except TypeError as error:
            found = UNEXPECTED_OPTION.search(str(error))
            if found:
                raise self.state.unsupported_feature(f"{label} has no {found.group(1)} option") from error
            raise

    @property
    def runtime(self) -> Any:
        if not self.runtimes:
            raise CaseFailure("the case has no runtime")
        return self.runtimes[-1][0]

    def method(self, name: str, runtime: Any = None) -> Any:
        """The runtime method `name`, or an `unsupported by Python runner` failure."""
        holder = self.runtime if runtime is None else runtime
        found = getattr(holder, name, None)
        if not callable(found):
            raise self.state.unsupported_feature(f"runtime {name}()")
        return found

    # -- setup ---------------------------------------------------------------------------

    def create_goondan(self) -> None:
        binding = RuntimeBindings(self.state, f"runtime-{len(self.runtimes) + 1}")
        options: dict[str, Any] = {
            "config": self.document if self.document is not None else self.loaded,
            "models": binding.models,
            "tools": binding.tools,
            "functions": binding.functions,
            "extensions": binding.extensions,
            "ports": binding.ports,
            "conversation_store": self.state.conversation_store,
            "operation_store": self.state.operation_store,
            "emit": binding.emit(),
        }
        if self.directory is not None:
            options["directory"] = self.directory
        if binding.host is not None:
            options["host"] = binding.host
        bindings = self.state.bindings
        if "maxRetries" in bindings:
            options["max_retries"] = bindings["maxRetries"]
        if "maxSteps" in bindings:
            options["max_steps"] = bindings["maxSteps"]
        runtime = self.call(create_goondan, "create_goondan", options)
        self.runtimes.append((runtime, binding))

    def start(self) -> None:
        spec = self.case.get("config") or {}
        if "document" in spec:
            self.document = spec["document"]
            self.directory = str((self.case_dir / spec.get("directory", "config")).resolve())
            try:
                self.effective_config = dict(validate_config(self.document))
            except GoondanConfigError as error:
                self.config_error = ("validate", error)
                return
        else:
            entry = str((self.case_dir / spec.get("path", "config")).resolve())
            try:
                self.loaded = load_config(entry, variants=list(spec.get("variants", [])))
            except GoondanConfigError as error:
                self.config_error = ("load", error)
                return
            self.effective_config = dict(self.loaded)
        try:
            self.create_goondan()
        except GoondanConfigError as error:
            self.config_error = ("create", error)
        except ValueError as error:
            self.config_error = ("create", error)

    # -- steps ---------------------------------------------------------------------------

    async def run_steps(self) -> None:
        for index, step in enumerate(self.case.get("steps", [])):
            label = f"steps/{index}"
            self.outcomes.append(await self.run_step(step, label=label))
            if "reach" not in step and step.get("settle") is not False:
                await self.settle(label)

    async def settle(self, label: str) -> None:
        idle = self.method("idle")
        try:
            await asyncio.wait_for(resolve(idle()), STEP_TIMEOUT)
        except asyncio.TimeoutError as error:
            raise CaseFailure(
                f"idle() after {label} did not return within {STEP_TIMEOUT} seconds; "
                "check whether the step needs \"settle\": false"
            ) from error

    async def run_step(self, step: Mapping[str, Any], *, label: str) -> dict[str, Any]:
        action = next((name for name in STEP_ACTIONS if name in step), None)
        if action is None:
            raise CaseFailure(f"the step {label} has no action")
        argument = step[action]
        if action == "parallel":
            branches = await asyncio.wait_for(self.run_parallel(argument, label), STEP_TIMEOUT)
            return {"parallel": branches}
        try:
            value = await asyncio.wait_for(self.perform(action, argument, label), STEP_TIMEOUT)
        except (UnsupportedFeature, CaseFailure, CaseFormatError):
            raise
        except asyncio.TimeoutError as error:
            raise CaseFailure(f"the step {label} did not finish within {STEP_TIMEOUT} seconds") from error
        except Exception as error:
            return {"error": self.project_error(error, label)}
        return {} if value is NO_RESULT else {"result": value}

    async def run_parallel(self, branches: Sequence[Sequence[Mapping[str, Any]]], label: str) -> list[list[Any]]:
        async def run_branch(index: int, steps: Sequence[Mapping[str, Any]]) -> list[Any]:
            outcomes = []
            for position, step in enumerate(steps):
                outcomes.append(await self.run_step(step, label=f"{label}/parallel/{index}/{position}"))
            return outcomes

        tasks = [asyncio.ensure_future(run_branch(index, steps)) for index, steps in enumerate(branches)]
        return list(await asyncio.gather(*tasks))

    async def perform(self, action: str, argument: Any, label: str) -> Any:
        if action == "release":
            self.state.gates.release(argument)
            return NO_RESULT
        if action == "reach":
            await self.state.gates.reach(argument)
            return NO_RESULT
        if action == "restart":
            self.create_goondan()
            return NO_RESULT
        if action == "close":
            await self.close_runtime(len(self.runtimes) - 1)
            return NO_RESULT
        if action == "run":
            options: dict[str, Any] = {"session_id": argument["sessionId"]}
            if "agent" in argument:
                options["agent"] = argument["agent"]
            if "startAgent" in argument:
                options["start_agent"] = argument["startAgent"]
            result = await resolve(self.call(self.method("run"), "run", options, argument["input"]))
            return {key: snapshot(result[key]) for key in RESULT_KEYS if key in result} if isinstance(result, Mapping) else snapshot(result)
        if action in ("decide", "cancel"):
            session_id, operation_id = self.operation_arguments(argument, label)
            name = f"{action}_operation"
            arguments = [session_id, operation_id] + ([argument["value"]] if action == "decide" else [])
            return project_operation(await resolve(self.call(self.method(name), name, {}, *arguments)))
        if action == "list":
            arguments = [argument["sessionId"]] if "sessionId" in argument else []
            found = await resolve(self.call(self.method("list_operations"), "list_operations", {}, *arguments))
            return [project_operation(operation) for operation in found] if isinstance(found, list) else snapshot(found)
        if action == "recover":
            arguments = [argument["sessionId"]] if "sessionId" in argument else []
            await resolve(self.call(self.method("recover_operations"), "recover_operations", {}, *arguments))
            return NO_RESULT
        if action == "abort":
            return await resolve(self.method("abort")(argument["sessionId"]))
        if action == "steer":
            options = {"agent": argument["agent"]} if "agent" in argument else {}
            await resolve(self.call(self.method("steer"), "steer", options, argument["sessionId"], argument["value"]))
            return NO_RESULT
        if action == "deleteSession":
            sessions = getattr(self.runtime, "sessions", None)
            delete = getattr(sessions, "delete", None)
            if not callable(delete):
                raise self.state.unsupported_feature("goondan.sessions.delete()")
            await resolve(delete(argument["sessionId"]))
            return NO_RESULT
        raise CaseFailure(f"the step {label} uses the unknown action {action!r}")

    def operation_arguments(self, argument: Mapping[str, Any], label: str) -> tuple[str, str]:
        wanted = argument["operation"]
        if not wanted.startswith("<op:"):
            if "sessionId" not in argument:
                raise CaseFailure(f"the step {label} needs a sessionId for the operation {wanted!r}")
            return argument["sessionId"], wanted
        store = self.state.operation_store
        aliases = store.aliases()
        found = [key for key in store.keys() if aliases.get(key[1]) == wanted]
        if not found:
            raise CaseFailure(f"the step {label} refers to {wanted}, which the operation store does not have")
        session_id, operation_id = found[0]
        return argument.get("sessionId", session_id), operation_id

    def project_error(self, error: Exception, label: str) -> dict[str, Any]:
        if isinstance(error, GoondanConfigError):
            self.problems.extend(check_config_error(error))
            return {"issues": [dict(issue) for issue in error.issues]}
        if isinstance(error, ScriptError):
            return {"scriptError": error.script_message}
        where, codes, attempt = getattr(error, "where", None), getattr(error, "codes", None), getattr(error, "attempt", None)
        if isinstance(where, str) and isinstance(codes, list) and attempt is not None:
            projected: dict[str, Any] = {"where": where, "codes": list(codes), "attempt": attempt}
            call = getattr(error, "tool_call", None)
            if call is not None:
                projected["toolCall"] = snapshot(call)
            projected["message"] = str(getattr(error, "message", error))
            return projected
        raise CaseFailure(f"the step {label} raised an unexpected {type(error).__name__}: {error}")

    # -- shutdown and observations -------------------------------------------------------

    async def close_runtime(self, index: int) -> None:
        if index in self.closed:
            return
        self.closed.add(index)
        runtime, binding = self.runtimes[index]
        closer = self.method("close", runtime)

        async def close() -> None:
            await resolve(closer())

        task = asyncio.ensure_future(close())
        await asyncio.sleep(0)
        binding.owner.stop()
        try:
            await asyncio.wait_for(task, STEP_TIMEOUT)
        except asyncio.TimeoutError as error:
            raise CaseFailure(f"close() of runtime {index + 1} did not return within {STEP_TIMEOUT} seconds") from error

    async def collect(self) -> None:
        """Build every observation section before any runtime is closed (README step 6)."""
        if self.runtimes:
            try:
                found = await resolve(self.method("list_operations")())
            except Exception:
                found = None
            if isinstance(found, list):
                self.problems.extend(check_operations(found))
                self.operations = [project_operation(operation) for operation in found]
            else:
                self.operations = found
        self.observations = snapshot(self.state.observation_document(self.effective_config, self.operations))

    async def teardown(self) -> None:
        for index in range(len(self.runtimes)):
            await self.close_runtime(index)
        self.state.gates.finish()
        await asyncio.sleep(0)

    # -- comparison ----------------------------------------------------------------------

    def build_document(self) -> dict[str, Any]:
        observations = self.observations
        if observations is None:
            observations = snapshot(self.state.observation_document(self.effective_config, self.operations))
        return {"steps": self.outcomes, "observations": observations}

    def compare(self) -> list[str]:
        failures: list[str] = []
        if self.config_error is not None or "error" in self.expected:
            failures.extend(self.compare_error())
            return failures
        document = self.build_document()
        for identifier in message_ids(document):
            if not isinstance(identifier, str) or not identifier:
                failures.append("every message must have a non-empty string id before normalization")
                break
        self.problems.extend(check_usage(self.outcomes))
        normalized = normalize_document(
            document,
            case_paths=[str(self.case_dir), os.path.realpath(self.case_dir)],
            operation_aliases=self.state.operation_store.aliases(),
        )
        differences: list[Difference] = []
        if "steps" in self.expected:
            differences.extend(self.diff_steps(self.expected["steps"], normalized["steps"], self.case.get("steps", []), ("steps",)))
        for section in SECTION_ORDER:
            if section in self.expected.get("observations", {}):
                differences.extend(diff_values(self.expected["observations"][section],
                                               normalized["observations"].get(section),
                                               ("observations", section)))
        if differences:
            failures.append("the result differs from expected.json:\n" + format_differences(differences))
        return failures

    def compare_error(self) -> list[str]:
        expected = self.expected.get("error")
        if self.config_error is None:
            return [f"expected the configuration error {json.dumps(expected, ensure_ascii=False)} but the runtime was created"]
        phase, error = self.config_error
        if isinstance(error, GoondanConfigError):
            self.problems.extend(check_config_error(error))
            actual: dict[str, Any] = {"phase": phase, "issues": [dict(issue) for issue in error.issues]}
        else:
            actual = {"phase": phase, "invalidArgument": True}
        if expected is None:
            return [f"the case did not expect a configuration error, but {phase} failed with {error}"]
        differences = diff_error(expected, actual, ("error",))
        if not differences:
            return []
        report = "the error differs from expected.json:\n" + format_differences(differences)
        if not isinstance(error, GoondanConfigError):
            report += f"\n  the {phase} call raised {type(error).__name__}: {error}"
        return [report]

    def diff_steps(self, expected: Sequence[Any], actual: Sequence[Any], steps: Sequence[Any], base: Sequence[Any]) -> list[Difference]:
        differences: list[Difference] = []
        if len(expected) != len(actual):
            differences.append(Difference(format_pointer(base), expected, actual))
        for index in range(min(len(expected), len(actual))):
            step = steps[index] if index < len(steps) else {}
            differences.extend(self.diff_step(expected[index], actual[index], step, (*base, index)))
        return differences

    def diff_step(self, expected: Mapping[str, Any], actual: Mapping[str, Any], step: Mapping[str, Any], base: Sequence[Any]) -> list[Difference]:
        if "parallel" in expected:
            branches = actual.get("parallel")
            if not isinstance(branches, list):
                return [Difference(format_pointer((*base, "parallel")), expected["parallel"], ABSENT)]
            differences: list[Difference] = []
            if len(expected["parallel"]) != len(branches):
                differences.append(Difference(format_pointer((*base, "parallel")), expected["parallel"], branches))
            for index in range(min(len(expected["parallel"]), len(branches))):
                steps = step.get("parallel", [])[index] if index < len(step.get("parallel", [])) else []
                differences.extend(self.diff_steps(expected["parallel"][index], branches[index], steps, (*base, "parallel", index)))
            return differences
        if "error" in expected:
            if "error" not in actual:
                return [Difference(format_pointer((*base, "error")), expected["error"], ABSENT)]
            return diff_error(expected["error"], actual["error"], (*base, "error"))
        if "error" in actual:
            return [Difference(format_pointer((*base, "error")), ABSENT, actual["error"])]
        if "result" in expected:
            if "result" not in actual:
                return [Difference(format_pointer((*base, "result")), expected["result"], ABSENT)]
            if "run" in step and isinstance(expected["result"], Mapping):
                return diff_listed_keys(expected["result"], actual["result"], (*base, "result"))
            return diff_values(expected["result"], actual["result"], (*base, "result"))
        return []


async def run_case(case_dir: Path) -> None:
    """Run one case and raise `CaseFailure` with every problem it has."""
    problems = case_directory_problems(case_dir)
    if problems:
        raise CaseFailure("the case directory does not follow the layout:\n" + "\n".join(f"  {item}" for item in problems))
    case = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
    expected = json.loads((case_dir / "expected.json").read_text(encoding="utf-8"))
    check_case(case, expected)
    runner = CaseRunner(case_dir, case, expected)
    failures: list[str] = []
    try:
        runner.start()
        if runner.config_error is None and runner.runtimes:
            await runner.run_steps()
            await runner.collect()
    except (UnsupportedFeature, CaseFailure) as error:
        failures.append(str(error))
    finally:
        try:
            await runner.teardown()
        except (UnsupportedFeature, CaseFailure) as error:
            failures.append(str(error))
    if not failures:
        failures.extend(runner.compare())
    failures.extend(runner.state.unused_scripts())
    failures.extend(runner.state.problems)
    failures.extend(runner.problems)
    for feature in runner.state.unsupported:
        message = str(UnsupportedFeature(feature))
        if message not in failures:
            failures.append(message)
    if failures:
        raise CaseFailure("\n".join(failures))
