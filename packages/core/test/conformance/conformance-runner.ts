/**
 * The conformance runner: case discovery, execution and comparison.
 *
 * Every rule this file implements comes from fixtures/conformance/README.md
 * ("러너 계약"). A case never skips and never declares an expected failure: a
 * feature the TypeScript host cannot express fails the case with
 * `unsupported by TypeScript runner: <feature>`.
 */

import { readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CaseFile,
  type ExpectedFile,
  type ExpectedStep,
  type ExpectedStepError,
  type ObservationSection,
  type Step,
  CASE_ID_PATTERN,
  CaseFormatError,
  OBSERVATION_SECTIONS,
  parseCase,
  parseExpected,
} from "./conformance-case.ts";
import {
  CaseScripts,
  buildBindings,
  conversationRecorder,
  operationRecorder,
  projectOperation,
  recordStore,
} from "./conformance-bindings.ts";
import { GateCancelledError } from "./conformance-gates.ts";
import {
  type ConfigErrorInfo,
  UnsupportedError,
  asConfigError,
  asExecutionError,
  callMethod,
  createGoondan,
  effectiveConfigOf,
  loadConfig,
  member,
  newConversationStore,
  newOperationStore,
  validateConfig,
} from "./conformance-host.ts";
import {
  type Json,
  type JsonObject,
  diffJson,
  formatDifferences,
  isJsonArray,
  isJsonObject,
  isNumber,
  isPromiseLike,
  isString,
  snapshot,
} from "./conformance-json.ts";
import { type ResultDocument, compareCodePoints, messagesWithoutId, normalizeDocument } from "./conformance-normalize.ts";
import { ScriptError } from "./conformance-ops.ts";

const STEP_TIMEOUT_MS = 5_000;
const USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export interface DiscoveredCases {
  cases: string[];
  problems: string[];
}

/** Case directories under `fixtures/conformance`, in code point order. */
export async function discoverCases(root: string): Promise<DiscoveredCases> {
  const entries = await readdir(root, { withFileTypes: true });
  const cases: string[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (!CASE_ID_PATTERN.test(entry.name)) {
        problems.push(`${entry.name} is not a valid case identifier`);
        continue;
      }
      cases.push(entry.name);
      continue;
    }
    if (entry.name === "README.md") continue;
    problems.push(`${entry.name} is not a case directory or the README`);
  }
  cases.sort(compareCodePoints);
  problems.sort(compareCodePoints);
  return { cases, problems };
}

class CaseFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseFailure";
  }
}

interface RuntimeHandle {
  runtime: unknown;
  owner: object;
  closed: boolean;
}

type StepOutcome =
  | { kind: "value"; value: unknown }
  | { kind: "none" }
  | { kind: "error"; error: unknown }
  | { kind: "parallel"; branches: StepOutcome[][] };

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CaseFailure(`${label} did not finish within ${String(STEP_TIMEOUT_MS)}ms`)), STEP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CaseResult {
  failures: string[];
}

function describeError(error: unknown): string {
  if (error instanceof CaseFailure || error instanceof UnsupportedError || error instanceof CaseFormatError) {
    return error.message;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `unexpected failure: ${String(error)}`;
}

export async function runCase(root: string, caseId: string): Promise<CaseResult> {
  const failures: string[] = [];
  try {
    await executeCase(root, caseId, failures);
  } catch (error) {
    failures.push(describeError(error));
  }
  return { failures };
}

async function readCaseFiles(caseDirectory: string): Promise<{ caseFile: CaseFile; expected: ExpectedFile }> {
  const entries = await readdir(caseDirectory, { withFileTypes: true });
  const allowed = new Set(["case.json", "expected.json", "config"]);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!allowed.has(entry.name)) throw new CaseFailure(`case directory must not contain ${entry.name}`);
    if (entry.name === "config" && !entry.isDirectory()) throw new CaseFailure("config must be a directory");
    if (entry.name !== "config" && !entry.isFile()) throw new CaseFailure(`${entry.name} must be a file`);
  }
  const caseFile = parseCase(await readJsonFile(join(caseDirectory, "case.json")));
  const expected = parseExpected(await readJsonFile(join(caseDirectory, "expected.json")), caseFile);
  return { caseFile, expected };
}

async function readJsonFile(path: string): Promise<Json> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new CaseFailure(`${path} is missing`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return snapshot(parsed);
  } catch (error) {
    throw new CaseFailure(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads a case without running it; used by the coverage test. */
export async function readCase(root: string, caseId: string): Promise<CaseFile> {
  return (await readCaseFiles(join(root, caseId))).caseFile;
}

async function executeCase(root: string, caseId: string, failures: string[]): Promise<void> {
  const caseDirectory = join(root, caseId);
  const { caseFile, expected } = await readCaseFiles(caseDirectory);
  const scripts = new CaseScripts(caseFile.bindings);
  const innerConversationStore = newConversationStore();
  const innerOperationStore = newOperationStore();
  const conversationStore = recordStore(innerConversationStore, conversationRecorder(scripts));
  const operationStore = recordStore(innerOperationStore, operationRecorder(scripts));
  const handles: RuntimeHandle[] = [];
  let effectiveConfig: Json = null;
  let loaded: unknown;

  const makeRuntime = async (): Promise<RuntimeHandle> => {
    const owner = {};
    const directory = caseFile.config.mode === "document" ? resolve(caseDirectory, caseFile.config.directory) : undefined;
    // A document-mode runtime reads its configuration directory from the bindings; see
    // spec/goondan.md "합성 결과와 유효 구성" and RuntimeBindings.directory.
    const bindings = buildBindings({ scripts, owner, conversationStore, operationStore, directory });
    const runtime = await createGoondan(caseFile.config.mode === "file" ? loaded : caseFile.config.document, bindings);
    const handle: RuntimeHandle = { runtime, owner, closed: false };
    handles.push(handle);
    return handle;
  };

  let current: RuntimeHandle | undefined;
  let setupError: { phase: "load" | "validate" | "create"; error: unknown } | undefined;
  try {
    if (caseFile.config.mode === "file") {
      const entry = resolve(caseDirectory, caseFile.config.path);
      try {
        loaded = await loadConfig(entry, caseFile.config.variants);
      } catch (error) {
        setupError = { phase: "load", error };
        throw error;
      }
      effectiveConfig = effectiveConfigOf(loaded);
    } else {
      try {
        effectiveConfig = snapshot(await validateConfig(caseFile.config.document));
      } catch (error) {
        setupError = { phase: "validate", error };
        throw error;
      }
    }
    try {
      current = await makeRuntime();
    } catch (error) {
      setupError = { phase: "create", error };
      throw error;
    }
  } catch (error) {
    if (error instanceof UnsupportedError) throw error;
    const phase = setupError?.phase ?? "create";
    compareSetupError(expected, phase, error, failures);
    await cleanup(handles, scripts, failures);
    return;
  }

  if (expected.error) {
    failures.push(`expected a ${expected.error.kind === "config" ? "configuration" : "invalid argument"} error before the runtime was created`);
  }

  const stepDocuments: Json[] = [];
  let stopped = false;
  try {
    for (const [index, step] of caseFile.steps.entries()) {
      const outcome = await withTimeout(runStep(step, () => current, makeRuntime, scripts, failures), `step ${String(index)} (${step.action})`);
      if (step.action === "restart") current = handles[handles.length - 1];
      stepDocuments.push(projectStepOutcome(step, outcome, failures));
      if (step.settle) {
        const handle = current;
        if (handle) {
          await withTimeout(
            idle(handle),
            `idle() after step ${String(index)} (${step.action}); add "settle": false if the step leaves work waiting on a closed gate`,
          );
        }
      }
    }
  } catch (error) {
    failures.push(describeError(error));
    stopped = true;
  }

  // Observations are collected while the runtimes are still open.
  let observations = new Map<ObservationSection, Json>();
  try {
    observations = await collectObservations(scripts, current, innerConversationStore, innerOperationStore, effectiveConfig, failures);
  } catch (error) {
    failures.push(describeError(error));
    stopped = true;
  }
  await cleanup(handles, scripts, failures);

  failures.push(...scripts.failures);
  failures.push(...scripts.leftovers());
  if (stopped) return;

  const document: ResultDocument = { steps: stepDocuments, observations };
  checkMessageIds(document, failures);
  const caseRealPath = await realpath(caseDirectory).catch(() => caseDirectory);
  const normalized = normalizeDocument(document, {
    casePaths: [caseDirectory, caseRealPath],
    operationAliases: scripts.observations.operationAliases,
  });
  compareSteps(caseFile.steps, expected.steps, normalized.document.steps, failures);
  compareObservations(expected, normalized.document, failures);
}

async function idle(handle: RuntimeHandle): Promise<void> {
  const result = callMethod(handle.runtime, "idle", [], "runtime.idle()");
  if (isPromiseLike(result)) await result;
}

async function runStep(
  step: Step,
  currentOf: () => RuntimeHandle | undefined,
  makeRuntime: () => Promise<RuntimeHandle>,
  scripts: CaseScripts,
  failures: string[],
): Promise<StepOutcome> {
  const handle = currentOf();
  switch (step.action) {
    case "release":
      scripts.gates.release(step.gate);
      return { kind: "none" };
    case "reach":
      await scripts.gates.reach(step.gate);
      return { kind: "none" };
    case "restart":
      await makeRuntime();
      return { kind: "none" };
    case "parallel": {
      const branches = await Promise.all(
        step.branches.map(async (branch) => {
          const outcomes: StepOutcome[] = [];
          for (const inner of branch) outcomes.push(await runStep(inner, currentOf, makeRuntime, scripts, failures));
          return outcomes;
        }),
      );
      return { kind: "parallel", branches };
    }
    default:
      break;
  }
  if (!handle) throw new CaseFailure("no runtime is available for this step");
  try {
    return await callRuntimeStep(step, handle, scripts);
  } catch (error) {
    return { kind: "error", error };
  }
}

async function callRuntimeStep(step: Step, handle: RuntimeHandle, scripts: CaseScripts): Promise<StepOutcome> {
  switch (step.action) {
    case "run": {
      const options: Record<string, unknown> = { sessionId: step.sessionId };
      if (step.agent !== undefined) options["agent"] = step.agent;
      if (step.startAgent !== undefined) options["startAgent"] = step.startAgent;
      return { kind: "value", value: await awaited(callMethod(handle.runtime, "run", [step.input, options], "goondan.run")) };
    }
    case "decide": {
      const target = resolveOperation(step.operation, step.sessionId, scripts);
      return {
        kind: "value",
        value: await awaited(
          callMethod(handle.runtime, "decideOperation", [target.sessionId, target.operationId, step.value], "runtime.decideOperation"),
        ),
      };
    }
    case "cancel": {
      const target = resolveOperation(step.operation, step.sessionId, scripts);
      return {
        kind: "value",
        value: await awaited(
          callMethod(handle.runtime, "cancelOperation", [target.sessionId, target.operationId], "runtime.cancelOperation"),
        ),
      };
    }
    case "list": {
      const args = step.sessionId === undefined ? [] : [step.sessionId];
      return { kind: "value", value: await awaited(callMethod(handle.runtime, "listOperations", args, "runtime.listOperations")) };
    }
    case "recover": {
      const args = step.sessionId === undefined ? [] : [step.sessionId];
      await awaited(callMethod(handle.runtime, "recoverOperations", args, "runtime.recoverOperations"));
      return { kind: "none" };
    }
    case "abort":
      return { kind: "value", value: await awaited(callMethod(handle.runtime, "abort", [step.sessionId], "runtime.abort")) };
    case "steer": {
      const options: Record<string, unknown> = {};
      if (step.agent !== undefined) options["agent"] = step.agent;
      await awaited(callMethod(handle.runtime, "steer", [step.sessionId, step.value, options], "runtime.steer"));
      return { kind: "none" };
    }
    case "deleteSession": {
      const sessions = member(handle.runtime, "sessions");
      await awaited(callMethod(sessions, "delete", [step.sessionId], "goondan.sessions.delete"));
      return { kind: "none" };
    }
    case "close": {
      const pending = callMethod(handle.runtime, "close", [], "runtime.close()");
      handle.closed = true;
      scripts.gates.cancelOwner(handle.owner);
      if (isPromiseLike(pending)) await pending;
      return { kind: "none" };
    }
    default:
      throw new CaseFailure(`step ${step.action} is not a runtime request`);
  }
}

async function awaited(value: unknown): Promise<unknown> {
  return isPromiseLike(value) ? await value : value;
}

function resolveOperation(
  operation: string,
  sessionId: string | undefined,
  scripts: CaseScripts,
): { operationId: string; sessionId: string } {
  if (!operation.startsWith("<op:")) {
    if (sessionId === undefined) {
      throw new CaseFailure(`step needs sessionId when operation ${operation} is not an alias`);
    }
    return { operationId: operation, sessionId };
  }
  for (const [operationId, alias] of scripts.observations.operationAliases) {
    if (alias !== operation) continue;
    if (sessionId !== undefined) return { operationId, sessionId };
    const record = scripts.observations.operationRecords.get(operationId);
    const stored = isJsonObject(record) ? record["sessionId"] : undefined;
    if (!isString(stored)) throw new CaseFailure(`operation ${operation} has no stored sessionId`);
    return { operationId, sessionId: stored };
  }
  throw new CaseFailure(`no operation matches the alias ${operation}`);
}

function projectStepOutcome(step: Step, outcome: StepOutcome, failures: string[]): Json {
  switch (outcome.kind) {
    case "none":
      return {};
    case "value": {
      const projected = projectReturnValue(step, outcome.value, failures);
      return projected === undefined ? {} : { result: projected };
    }
    case "error":
      return { error: projectStepError(outcome.error, failures) };
    default: {
      const branches = step.action === "parallel" ? step.branches : [];
      return {
        parallel: outcome.branches.map((branch, branchIndex) =>
          branch.map((item, index) => {
            const inner = branches[branchIndex]?.[index];
            return inner === undefined ? {} : projectStepOutcome(inner, item, failures);
          }),
        ),
      };
    }
  }
}

function projectReturnValue(step: Step, value: unknown, failures: string[]): Json | undefined {
  switch (step.action) {
    case "run": {
      const result = snapshot(value);
      if (!isJsonObject(result)) return result;
      const projected: JsonObject = {};
      for (const key of ["output", "outputs", "usage", "finishReason", "status", "runs"]) {
        if (Object.hasOwn(result, key)) projected[key] = result[key] ?? null;
      }
      checkUsageTotal(projected, failures);
      return projected;
    }
    case "decide":
    case "cancel":
      return projectOperation(snapshot(value));
    case "list": {
      const list = snapshot(value);
      return isJsonArray(list) ? list.map(projectOperation) : list;
    }
    case "abort":
      return snapshot(value);
    default:
      return undefined;
  }
}

function checkUsageTotal(result: JsonObject, failures: string[]): void {
  const usage = result["usage"];
  const runs = result["runs"];
  if (!isJsonObject(usage) || !isJsonArray(runs)) return;
  const total: Record<string, number> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const run of runs) {
    if (!isJsonObject(run)) continue;
    const runUsage = run["usage"];
    if (!isJsonObject(runUsage)) continue;
    for (const key of USAGE_KEYS) {
      const value = runUsage[key];
      if (isNumber(value)) total[key] = (total[key] ?? 0) + value;
    }
  }
  for (const key of USAGE_KEYS) {
    const value = usage[key];
    const expected = total[key] ?? 0;
    if (!isNumber(value) || value !== expected) {
      failures.push(`turn usage.${key} is ${JSON.stringify(value)} but the runs add up to ${String(expected)}`);
    }
  }
}

function projectStepError(error: unknown, failures: string[]): Json {
  const configError = asConfigError(error);
  if (configError) {
    checkConfigErrorShape(configError, failures);
    return { issues: configError.issues };
  }
  if (error instanceof ScriptError) return { scriptError: error.message };
  const executionError = asExecutionError(error);
  if (executionError) {
    const projected: JsonObject = {
      where: executionError.where,
      codes: executionError.codes,
      attempt: executionError.attempt,
      message: executionError.message,
    };
    if (executionError.toolCall !== undefined) projected["toolCall"] = executionError.toolCall;
    return projected;
  }
  if (error instanceof UnsupportedError) throw error;
  if (error instanceof GateCancelledError) throw new CaseFailure(error.message);
  throw new CaseFailure(`step threw an unexpected error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
}

async function collectObservations(
  scripts: CaseScripts,
  current: RuntimeHandle | undefined,
  conversationStore: object,
  operationStore: object,
  effectiveConfig: Json,
  failures: string[],
): Promise<Map<ObservationSection, Json>> {
  const observations = scripts.observations;
  const sections = new Map<ObservationSection, Json>();
  // Every section is copied here: the runner still has to close its runtimes after this point
  // (fixtures/conformance/README.md "러너의 실행 순서" steps 6-7) and closing appends dispose
  // entries and aborted turn events that the case must not observe.
  sections.set("effectiveConfig", effectiveConfig);
  sections.set("events", snapshot(observations.events));
  sections.set("modelInputs", snapshot(fromMap(observations.modelInputs)));
  sections.set("modelContexts", snapshot(fromMap(observations.modelContexts)));
  sections.set("toolCalls", snapshot(observations.toolCalls));
  sections.set("toolContexts", snapshot(observations.toolContexts));
  sections.set("functionCalls", snapshot(observations.functionCalls));
  sections.set("hookCalls", snapshot(observations.hookCalls));
  sections.set("hookContexts", snapshot(observations.hookContexts));
  sections.set("hostCalls", snapshot(observations.hostCalls));
  sections.set("extensionLog", snapshot(observations.extensionLog));

  const conversations: JsonObject = {};
  for (const [key, scope] of [...observations.conversationScopes].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const messages = await awaited(callMethod(conversationStore, "load", [scope.sessionId, scope.agent], "conversationStore.load"));
    conversations[key] = snapshot(messages);
  }
  sections.set("conversations", conversations);

  let listed: Json = [];
  if (current && !current.closed) {
    try {
      listed = snapshot(await awaited(callMethod(current.runtime, "listOperations", [], "runtime.listOperations")));
    } catch {
      listed = snapshot(await awaited(callMethod(operationStore, "list", [], "operationStore.list")));
    }
  } else {
    listed = snapshot(await awaited(callMethod(operationStore, "list", [], "operationStore.list")));
  }
  checkStoredOperations(listed, failures);
  sections.set("operations", isJsonArray(listed) ? listed.map(projectOperation) : listed);
  checkEvents(observations.rawEvents, failures);

  const history: JsonObject = {};
  for (const [operationId, entries] of observations.operationHistory) {
    const alias = observations.operationAliases.get(operationId) ?? operationId;
    history[alias] = [...entries];
  }
  sections.set("operationHistory", history);
  return sections;
}

function fromMap(map: ReadonlyMap<string, Json[]>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of map) result[key] = value;
  return result;
}

function checkStoredOperations(operations: Json, failures: string[]): void {
  if (!isJsonArray(operations)) return;
  for (const operation of operations) {
    if (!isJsonObject(operation)) continue;
    const id = isString(operation["operationId"]) ? operation["operationId"] : "(unknown)";
    if (!isNumber(operation["createdAt"])) failures.push(`operation ${id} has no numeric createdAt`);
    if (!isNumber(operation["updatedAt"])) failures.push(`operation ${id} has no numeric updatedAt`);
    const delivered = operation["deliveryStatus"] === "delivered";
    if (delivered && !isNumber(operation["deliveredAt"])) failures.push(`delivered operation ${id} has no numeric deliveredAt`);
    if (!delivered && Object.hasOwn(operation, "deliveredAt")) {
      failures.push(`operation ${id} has deliveredAt but deliveryStatus is not delivered`);
    }
  }
}

function checkEvents(events: readonly Json[], failures: string[]): void {
  for (const event of events) {
    if (!isJsonObject(event)) continue;
    if (!isNumber(event["at"])) failures.push(`event ${JSON.stringify(event["name"])} has no numeric at`);
  }
}

function checkMessageIds(document: ResultDocument, failures: string[]): void {
  const pointers = messagesWithoutId(document.steps, "/steps");
  for (const [section, value] of document.observations) {
    pointers.push(...messagesWithoutId(value, `/observations/${section}`));
  }
  for (const pointer of pointers) failures.push(`message at ${pointer} has no non-empty string id`);
}

async function cleanup(handles: readonly RuntimeHandle[], scripts: CaseScripts, failures: string[]): Promise<void> {
  for (const handle of handles) {
    if (handle.closed) continue;
    handle.closed = true;
    try {
      const pending = callMethod(handle.runtime, "close", [], "runtime.close()");
      scripts.gates.cancelOwner(handle.owner);
      if (isPromiseLike(pending)) await withTimeout(Promise.resolve(pending), "runtime.close()");
    } catch (error) {
      if (error instanceof UnsupportedError) throw error;
      failures.push(`closing a runtime failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  scripts.gates.cancelAll();
}

function compareSetupError(expected: ExpectedFile, phase: "load" | "validate" | "create", error: unknown, failures: string[]): void {
  const configError = asConfigError(error);
  if (configError) checkConfigErrorShape(configError, failures);
  const expectedError = expected.error;
  if (!expectedError) {
    failures.push(
      `${phase} failed but no error was expected: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
    return;
  }
  if (expectedError.kind === "invalidArgument") {
    if (!(error instanceof TypeError)) {
      failures.push(`expected a TypeError from createGoondan but got ${error instanceof Error ? error.name : String(error)}`);
    }
    if (phase !== "create") failures.push(`expected the invalid argument in create but it happened in ${phase}`);
    return;
  }
  if (!configError) {
    failures.push(
      `expected a GoondanConfigError but got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
    return;
  }
  const actual: Json = { phase, issues: restrictIssues(configError.issues, expectedError.issues) };
  const wanted: Json = { phase: expectedError.phase, issues: expectedError.issues };
  const differences = diffJson(actual, wanted, "/error");
  if (differences.length > 0) failures.push(formatDifferences(differences));
}

function restrictIssues(actual: readonly Json[], expected: readonly JsonObject[]): Json[] {
  return actual.map((issue, index) => {
    if (!isJsonObject(issue)) return issue;
    const wanted = expected[index];
    const keys = wanted === undefined ? ["code", "path"] : Object.keys(wanted);
    const projected: JsonObject = {};
    for (const key of keys) {
      if (Object.hasOwn(issue, key)) projected[key] = issue[key] ?? null;
    }
    for (const key of Object.keys(issue)) {
      if (key === "code" || key === "path" || key === "message") continue;
      projected[key] = issue[key] ?? null;
    }
    return projected;
  });
}

function checkConfigErrorShape(error: ConfigErrorInfo, failures: string[]): void {
  if (error.issues.length === 0) {
    failures.push("GoondanConfigError.issues must not be empty");
    return;
  }
  const lines: string[] = ["Invalid Goondan configuration:"];
  for (const issue of error.issues) {
    if (!isJsonObject(issue)) {
      failures.push("every configuration issue must be an object");
      continue;
    }
    const extra = Object.keys(issue).filter((key) => key !== "code" && key !== "path" && key !== "message");
    if (extra.length > 0) failures.push(`configuration issue has unexpected keys: ${extra.join(", ")}`);
    const code = issue["code"];
    const path = issue["path"];
    const message = issue["message"];
    if (!isString(code) || code === "") failures.push("configuration issue has no code");
    if (!isString(path)) failures.push("configuration issue has no path");
    if (!isString(message) || message === "") failures.push("configuration issue has no message");
    lines.push(`- ${isString(path) && path !== "" ? path : "(root)"}: ${isString(message) ? message : ""} [${isString(code) ? code : ""}]`);
  }
  const wanted = lines.join("\n");
  if (error.message !== wanted) {
    failures.push(`GoondanConfigError message must be\n${wanted}\nbut was\n${error.message}`);
  }
}

function compareSteps(steps: readonly Step[], expected: readonly ExpectedStep[], actual: readonly Json[], failures: string[]): void {
  for (const [index, wanted] of expected.entries()) {
    const value = actual[index];
    const step = steps[index];
    if (value === undefined || step === undefined) continue;
    compareStep(step, wanted, value, `/steps/${String(index)}`, failures);
  }
}

function compareStep(step: Step, expected: ExpectedStep, actual: Json, pointer: string, failures: string[]): void {
  const object = isJsonObject(actual) ? actual : {};
  const errorValue = object["error"];
  switch (expected.kind) {
    case "any":
      if (errorValue !== undefined) failures.push(`${pointer}: step failed unexpectedly: ${JSON.stringify(errorValue)}`);
      return;
    case "result": {
      if (errorValue !== undefined) {
        failures.push(`${pointer}: step failed unexpectedly: ${JSON.stringify(errorValue)}`);
        return;
      }
      const result = object["result"];
      if (result === undefined) {
        failures.push(`${pointer}/result: the step returned no value`);
        return;
      }
      const restricted = isJsonObject(expected.value) && isJsonObject(result) ? restrictKeys(result, Object.keys(expected.value)) : result;
      const differences = diffJson(restricted, expected.value, `${pointer}/result`);
      if (differences.length > 0) failures.push(formatDifferences(differences));
      return;
    }
    case "error": {
      if (errorValue === undefined) {
        failures.push(`${pointer}/error: the step did not fail`);
        return;
      }
      compareStepError(expected.error, errorValue, `${pointer}/error`, failures);
      return;
    }
    default: {
      const branches = object["parallel"];
      if (!isJsonArray(branches)) {
        failures.push(`${pointer}/parallel: the step is not a parallel step`);
        return;
      }
      const stepBranches = step.action === "parallel" ? step.branches : [];
      for (const [branchIndex, branch] of expected.branches.entries()) {
        const actualBranch = branches[branchIndex];
        if (!isJsonArray(actualBranch)) continue;
        for (const [index, inner] of branch.entries()) {
          const actualInner = actualBranch[index];
          const innerStep = stepBranches[branchIndex]?.[index];
          if (actualInner === undefined || innerStep === undefined) continue;
          compareStep(innerStep, inner, actualInner, `${pointer}/parallel/${String(branchIndex)}/${String(index)}`, failures);
        }
      }
    }
  }
}

function restrictKeys(value: JsonObject, keys: readonly string[]): JsonObject {
  const restricted: JsonObject = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) restricted[key] = value[key] ?? null;
  }
  return restricted;
}

function compareStepError(expected: ExpectedStepError, actual: Json, pointer: string, failures: string[]): void {
  const object = isJsonObject(actual) ? actual : {};
  switch (expected.kind) {
    case "script": {
      const message = object["scriptError"];
      if (message === undefined) {
        failures.push(`${pointer}/scriptError: the step did not fail with a script error: ${JSON.stringify(actual)}`);
        return;
      }
      const differences = diffJson(message, expected.message, `${pointer}/scriptError`);
      if (differences.length > 0) failures.push(formatDifferences(differences));
      return;
    }
    case "issues": {
      const issues = object["issues"];
      if (!isJsonArray(issues)) {
        failures.push(`${pointer}/issues: the step did not fail with a configuration error: ${JSON.stringify(actual)}`);
        return;
      }
      const differences = diffJson(restrictIssues(issues, expected.issues), expected.issues, `${pointer}/issues`);
      if (differences.length > 0) failures.push(formatDifferences(differences));
      return;
    }
    default: {
      if (object["where"] === undefined) {
        failures.push(`${pointer}: the step did not fail with an execution error: ${JSON.stringify(actual)}`);
        return;
      }
      const wanted: JsonObject = { where: expected.where, codes: expected.codes, attempt: expected.attempt };
      if (expected.toolCall !== undefined) wanted["toolCall"] = expected.toolCall;
      if (expected.message !== undefined) wanted["message"] = expected.message;
      const restricted = restrictKeys(object, Object.keys(wanted));
      if (expected.toolCall === undefined && Object.hasOwn(object, "toolCall")) restricted["toolCall"] = object["toolCall"] ?? null;
      const differences = diffJson(restricted, wanted, pointer);
      if (differences.length > 0) failures.push(formatDifferences(differences));
    }
  }
}

function compareObservations(expected: ExpectedFile, actual: ResultDocument, failures: string[]): void {
  for (const section of OBSERVATION_SECTIONS) {
    if (!expected.observations.has(section)) continue;
    const wanted = expected.observations.get(section);
    const value = actual.observations.get(section);
    if (wanted === undefined) continue;
    const differences = diffJson(value ?? null, wanted, `/observations/${section}`);
    if (differences.length > 0) failures.push(formatDifferences(differences));
  }
}
