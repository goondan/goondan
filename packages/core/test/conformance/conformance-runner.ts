import { JournalFoldError } from "../../src/index.ts";
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
  projectEvent,
  projectOperation,
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
  executionEventIssues,
  foldJournal,
  loadConfig,
  member,
  newStore,
  validateConfig,
} from "./conformance-host.ts";
import {
  type Json,
  type JsonObject,
  diffJson,
  formatDifferences,
  isJsonArray,
  isJsonObject,
  isFunction,
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
  runs: Map<string, unknown>;
}

interface LeaseHandle {
  token: number;
  value: object;
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
  const store = newStore();
  const leases = new Map<string, LeaseHandle>();
  const deletedSessions = new Set<string>();
  const handles: RuntimeHandle[] = [];
  const runs = new Map<string, unknown>();
  let effectiveConfig: Json = null;
  let loaded: unknown;

  const makeRuntime = async (): Promise<RuntimeHandle> => {
    const owner = {};
    const directory = caseFile.config.mode === "document" ? resolve(caseDirectory, caseFile.config.directory) : undefined;
    // A document-mode runtime reads its configuration directory from the bindings; see
    // spec/goondan.md "합성 결과와 유효 구성" and RuntimeBindings.directory.
    const bindings = buildBindings({ scripts, owner, store, directory });
    const runtime = await createGoondan(caseFile.config.mode === "file" ? loaded : caseFile.config.document, bindings);
    const handle: RuntimeHandle = { runtime, owner, closed: false, runs };
    handles.push(handle);
    return handle;
  };

  let current: RuntimeHandle | undefined;
  let setupError: { phase: "load" | "validate" | "create"; error: unknown } | undefined;
  try {
    if (caseFile.config.mode === "file") {
      const entry = resolve(caseDirectory, caseFile.config.path);
      try {
        loaded = await loadConfig(entry);
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
      const outcome = await withTimeout(
        runStep(step, () => current, makeRuntime, scripts, store, leases, deletedSessions, failures),
        `step ${String(index)} (${step.action})`,
      );
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
    observations = await collectObservations(scripts, store, effectiveConfig, deletedSessions, failures);
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
  store: object,
  leases: Map<string, LeaseHandle>,
  deletedSessions: Set<string>,
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
          for (const inner of branch) {
            outcomes.push(await runStep(inner, currentOf, makeRuntime, scripts, store, leases, deletedSessions, failures));
          }
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
    return await callRuntimeStep(step, handle, scripts, store, leases, deletedSessions);
  } catch (error) {
    return { kind: "error", error };
  }
}

async function callRuntimeStep(
  step: Step,
  handle: RuntimeHandle,
  scripts: CaseScripts,
  store: object,
  leases: Map<string, LeaseHandle>,
  deletedSessions: Set<string>,
): Promise<StepOutcome> {
  switch (step.action) {
    case "run": {
      const options: Record<string, unknown> = {};
      if (step.sessionId !== undefined) options["sessionId"] = step.sessionId;
      if (step.meta !== undefined) options["meta"] = step.meta;
      if (step.agent !== undefined) options["agent"] = step.agent;
      if (step.startAgent !== undefined) options["startAgent"] = step.startAgent;
      const run = await awaited(callMethod(handle.runtime, "run", [step.input, options], "goondan.run"));
      if (!step.awaitResult) {
        if (step.handle === undefined) throw new CaseFailure("an unawaited run has no handle alias");
        if (handle.runs.has(step.handle)) throw new CaseFailure(`the run handle alias ${step.handle} is already in use`);
        handle.runs.set(step.handle, run);
        const sessionId = member(run, "sessionId");
        const turnId = member(run, "turnId");
        const inputId = member(run, "inputId");
        if (!isString(sessionId) || sessionId.length === 0 || !isString(turnId) || turnId.length === 0 || !isString(inputId) || inputId.length === 0) {
          throw new CaseFailure("goondan.run did not return non-empty sessionId, turnId and inputId members");
        }
        return { kind: "value", value: { sessionId: step.sessionId === undefined ? "<generated-session>" : sessionId, turnId, inputId } };
      }
      return { kind: "value", value: await awaited(member(run, "result")) };
    }
    case "awaitRun": {
      const run = handle.runs.get(step.handle);
      if (run === undefined) throw new CaseFailure(`no run handle has the alias ${step.handle}`);
      return { kind: "value", value: await awaited(member(run, "result")) };
    }
    case "decide": {
      const operations = member(handle.runtime, "operations");
      const target = await resolveOperation(step.operation, step.sessionId, scripts, operations);
      return {
        kind: "value",
        value: await awaited(callMethod(operations, "decide", [target.sessionId, target.operationId, step.value], "operations.decide")),
      };
    }
    case "list": {
      const operations = member(handle.runtime, "operations");
      const args = step.sessionId === undefined ? [] : [step.sessionId];
      return { kind: "value", value: await awaited(callMethod(operations, "list", args, "operations.list")) };
    }
    case "abort":
      return { kind: "value", value: await awaited(callMethod(handle.runtime, "abort", [step.sessionId], "runtime.abort")) };
    case "deleteSession": {
      const sessions = member(handle.runtime, "sessions");
      await awaited(callMethod(sessions, "delete", [step.sessionId], "goondan.sessions.delete"));
      deletedSessions.add(step.sessionId);
      return { kind: "none" };
    }
    case "close": {
      const pending = callMethod(handle.runtime, "close", [], "runtime.close()");
      handle.closed = true;
      scripts.gates.cancelOwner(handle.owner);
      if (isPromiseLike(pending)) await pending;
      return { kind: "none" };
    }
    case "acquireLease": {
      const value = await awaited(callMethod(store, "acquireLease", [step.sessionId, step.owner], "store.acquireLease"));
      if (value === null) return { kind: "value", value: null };
      if (typeof value !== "object") throw new CaseFailure("store.acquireLease did not return a lease or null");
      const token = member(value, "token");
      if (!isNumber(token)) throw new CaseFailure("store lease has no numeric token");
      const expiresAt = member(value, "expiresAt");
      if (expiresAt !== null && !isNumber(expiresAt)) throw new CaseFailure("store lease has no numeric or null expiresAt");
      leases.set(step.lease, { token, value });
      return { kind: "value", value: { token, expiresAt } };
    }
    case "renewLease": {
      const lease = requireLease(leases, step.lease);
      return { kind: "value", value: await awaited(callMethod(lease.value, "renew", [], "lease.renew")) };
    }
    case "releaseLease": {
      const lease = requireLease(leases, step.lease);
      await awaited(callMethod(lease.value, "release", [], "lease.release"));
      return { kind: "none" };
    }
    case "appendJournal": {
      const options: Record<string, unknown> = {};
      if (step.lease !== undefined) options["token"] = requireLease(leases, step.lease).token;
      if (step.expected !== undefined) options["expected"] = step.expected;
      if (step.writeId !== undefined) options["writeId"] = step.writeId;
      return { kind: "value", value: await awaited(callMethod(store, "append", [step.events, options], "store.append")) };
    }
    case "appendOperationTransition":
      await appendOperationTransition(store, scripts, step);
      return { kind: "none" };
    case "scanJournal": {
      const options: Record<string, unknown> = {};
      if (step.sessionId !== undefined) options["sessionId"] = step.sessionId;
      if (step.fromSeq !== undefined) options["fromSeq"] = step.fromSeq;
      if (step.limit !== undefined) options["limit"] = step.limit;
      const value = callMethod(store, "scan", [options], "store.scan");
      return { kind: "value", value: await collectValues(value) };
    }
    case "leaseRenewal":
      callMethod(store, "leaseRenewal", [step.sessionId, step.succeeds], "fixture store.leaseRenewal");
      return { kind: "none" };
    case "foldJournal": {
      try { return { kind: "value", value: await foldJournal(step.sessionId, step.events) }; }
      catch (error) {
        if (!(error instanceof JournalFoldError)) throw error;
        return { kind: "value", value: { foldError: true } };
      }
    }
    case "headJournal":
      return { kind: "value", value: await awaited(callMethod(store, "head", [step.sessionId], "store.head")) };
    case "deleteStoreSession": {
      const lease = requireLease(leases, step.lease);
      await awaited(callMethod(store, "deleteSession", [step.sessionId, { token: lease.token }], "store.deleteSession"));
      deletedSessions.add(step.sessionId);
      return { kind: "none" };
    }
    default:
      throw new CaseFailure(`step ${step.action} is not a runtime request`);
  }
}

async function appendOperationTransition(
  store: object,
  scripts: CaseScripts,
  step: Extract<Step, { action: "appendOperationTransition" }>,
): Promise<void> {
  const events = await collectValues(callMethod(store, "scan", [{ sessionId: step.sessionId }], "store.scan"));
  const state = await foldJournal(step.sessionId, events);
  if (!isJsonObject(state) || !isJsonArray(state["operations"])) {
    throw new CaseFailure(`journal ${step.sessionId} has no operation list`);
  }
  for (const operation of state["operations"]) scripts.recordOperation(operation);
  const target = findOperationAlias(step.operation, step.sessionId, scripts);
  if (target === undefined) throw new CaseFailure(`no operation matches the alias ${step.operation}`);
  const operation = state["operations"].find(
    (candidate) => isJsonObject(candidate) && candidate["operationId"] === target.operationId,
  );
  if (!isJsonObject(operation)) throw new CaseFailure(`operation ${step.operation} is not stored`);
  const currentStatus = operation["status"];
  const currentDelivery = operation["deliveryStatus"];
  const valid =
    ((step.status === "approved" || step.status === "rejected") && currentStatus === "pending") ||
    (step.status === "running" && currentStatus === "approved") ||
    (step.status === "delivering" && currentStatus === "rejected" && currentDelivery === "pending");
  if (!valid) {
    throw new CaseFailure(
      `operation ${step.operation} cannot enter ${step.status} from ${JSON.stringify(currentStatus)}/${JSON.stringify(currentDelivery)}`,
    );
  }
  const updatedAt = operation["updatedAt"];
  if (!isNumber(updatedAt)) throw new CaseFailure(`operation ${step.operation} has no numeric updatedAt`);
  const event: JsonObject = {
    version: 1,
    type: step.status === "approved"
      ? "operation.approved"
      : step.status === "running"
        ? "operation.execution.started"
        : step.status === "rejected"
          ? "operation.rejected"
          : "operation.delivery.claimed",
    sessionId: step.sessionId,
    agent: operation["agent"] ?? null,
    instance: operation["instance"] ?? null,
    turnId: operation["turnId"] ?? null,
    executionId: operation["executionId"] ?? null,
    operationId: target.operationId,
    data: { updatedAt: updatedAt + 1 },
  };
  if (isString(operation["parentExecutionId"])) event["parentExecutionId"] = operation["parentExecutionId"];
  const lease = await awaited(callMethod(store, "acquireLease", [step.sessionId, `fixture-${step.status}`], "store.acquireLease"));
  if (lease === null || typeof lease !== "object") throw new CaseFailure(`cannot acquire the ${step.sessionId} fixture lease`);
  const token = member(lease, "token");
  if (!isNumber(token)) throw new CaseFailure("fixture lease has no numeric token");
  try {
    const head = await awaited(callMethod(store, "head", [step.sessionId], "store.head"));
    if (!isNumber(head)) throw new CaseFailure("store.head did not return a number");
    await awaited(callMethod(store, "append", [[event], {
      expected: head,
      token,
      writeId: `fixture-${target.operationId}-${step.status}`,
    }], "store.append"));
  } finally {
    await awaited(callMethod(lease, "release", [], "lease.release"));
  }
}

async function awaited(value: unknown): Promise<unknown> {
  return isPromiseLike(value) ? await value : value;
}

function requireLease(leases: ReadonlyMap<string, LeaseHandle>, alias: string): LeaseHandle {
  const lease = leases.get(alias);
  if (lease === undefined) throw new CaseFailure(`no acquired lease has the alias ${alias}`);
  return lease;
}

async function collectValues(source: unknown): Promise<Json[]> {
  const settled = await awaited(source);
  if (Array.isArray(settled)) return snapshot(settled);
  if ((typeof settled !== "object" || settled === null) && typeof settled !== "function") {
    throw new CaseFailure("store.scan did not return an iterable");
  }
  const factory: unknown = Reflect.get(Object(settled), Symbol.asyncIterator);
  if (!isFunction(factory)) throw new CaseFailure("store.scan did not return an async iterable");
  const iterator: unknown = Reflect.apply(factory, settled, []);
  const values: Json[] = [];
  while (true) {
    const next = snapshot(await awaited(callMethod(iterator, "next", [], "store.scan iterator")));
    if (!isJsonObject(next)) throw new CaseFailure("store.scan iterator returned an invalid result");
    if (next["done"] === true) return values;
    values.push(next["value"] ?? null);
  }
}

async function resolveOperation(
  operation: string,
  sessionId: string | undefined,
  scripts: CaseScripts,
  operations: unknown,
): Promise<{ operationId: string; sessionId: string }> {
  if (!operation.startsWith("<op:")) {
    if (sessionId === undefined) {
      throw new CaseFailure(`step needs sessionId when operation ${operation} is not an alias`);
    }
    return { operationId: operation, sessionId };
  }
  let found = findOperationAlias(operation, sessionId, scripts);
  if (found !== undefined) return found;
  const listed = snapshot(await awaited(callMethod(operations, "list", [], "operations.list")));
  if (isJsonArray(listed)) {
    for (const record of listed) scripts.recordOperation(record);
  }
  found = findOperationAlias(operation, sessionId, scripts);
  if (found !== undefined) return found;
  throw new CaseFailure(`no operation matches the alias ${operation}`);
}

function findOperationAlias(
  operation: string,
  sessionId: string | undefined,
  scripts: CaseScripts,
): { operationId: string; sessionId: string } | undefined {
  for (const [operationId, alias] of scripts.observations.operationAliases) {
    if (alias !== operation) continue;
    if (sessionId !== undefined) return { operationId, sessionId };
    const record = scripts.observations.operationRecords.get(operationId);
    const stored = isJsonObject(record) ? record["sessionId"] : undefined;
    if (!isString(stored)) throw new CaseFailure(`operation ${operation} has no stored sessionId`);
    return { operationId, sessionId: stored };
  }
  return undefined;
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
      if (!step.awaitResult) return snapshot(value);
      const result = snapshot(value);
      if (!isJsonObject(result)) return result;
      const projected: JsonObject = {};
      for (const key of ["turnId", "output", "outputs", "usage", "finishReason", "status", "runs"]) {
        if (Object.hasOwn(result, key)) projected[key] = result[key] ?? null;
      }
      checkUsageTotal(projected, failures);
      return projected;
    }
    case "awaitRun": {
      const result = snapshot(value);
      if (!isJsonObject(result)) return result;
      const projected: JsonObject = {};
      for (const key of ["turnId", "output", "outputs", "usage", "finishReason", "status", "runs"]) {
        if (Object.hasOwn(result, key)) projected[key] = result[key] ?? null;
      }
      checkUsageTotal(projected, failures);
      return projected;
    }
    case "decide":
      return projectOperation(snapshot(value));
    case "list": {
      const list = snapshot(value);
      return isJsonArray(list) ? list.map(projectOperation) : list;
    }
    case "abort":
      return snapshot(value);
    case "acquireLease":
    case "renewLease":
    case "headJournal":
    case "foldJournal":
      return snapshot(value);
    case "appendJournal":
    case "scanJournal": {
      const events = snapshot(value);
      return isJsonArray(events) ? events.map(projectEvent) : events;
    }
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
  if (error instanceof Error && (error.name === "StoreConflictError" || error.name === "StoreInputError")) {
    return { storeError: error.name };
  }
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
  store: object,
  effectiveConfig: Json,
  deletedSessions: ReadonlySet<string>,
  failures: string[],
): Promise<Map<ObservationSection, Json>> {
  const observations = scripts.observations;
  const sections = new Map<ObservationSection, Json>();
  // Every section is copied here: the runner still has to close its runtimes after this point
  // (fixtures/conformance/README.md "러너의 실행 순서" steps 6-7) and closing appends dispose
  // entries and aborted turn events that the case must not observe.
  sections.set("effectiveConfig", effectiveConfig);
  sections.set("events", snapshot(observations.events));
  const stored = await collectValues(callMethod(store, "scan", [{}], "store.scan"));
  const grouped = new Map<string, Json[]>();
  for (const event of stored) {
    if (!isJsonObject(event) || !isString(event["sessionId"])) continue;
    const events = grouped.get(event["sessionId"]) ?? [];
    const expectedSeq = events.length + 1;
    if (event["seq"] !== expectedSeq) {
      failures.push(`journal ${event["sessionId"]} expected seq ${String(expectedSeq)} but got ${JSON.stringify(event["seq"])}`);
    }
    if (!isNumber(event["at"])) failures.push(`stored event ${event["sessionId"]}:${String(expectedSeq)} has no numeric at`);
    events.push(event);
    grouped.set(event["sessionId"], events);
  }
  sections.set("journalEvents", stored.map(projectEvent));
  const states: JsonObject = {};
  for (const [sessionId, events] of grouped) states[sessionId] = await foldJournal(sessionId, events);
  sections.set("journalStates", states);
  sections.set("modelInputs", snapshot(fromMap(observations.modelInputs)));
  sections.set("modelContexts", snapshot(fromMap(observations.modelContexts)));
  sections.set("toolCalls", snapshot(observations.toolCalls));
  sections.set("toolContexts", snapshot(observations.toolContexts));
  sections.set("functionCalls", snapshot(observations.functionCalls));
  sections.set("functionContexts", snapshot(observations.functionContexts));
  sections.set("hookCalls", snapshot(observations.hookCalls));
  sections.set("hookContexts", snapshot(observations.hookContexts));
  sections.set("extensionLog", snapshot(observations.extensionLog));

  const conversations: JsonObject = {};
  const operations: Json[] = [];
  for (const [sessionId, state] of Object.entries(states)) {
    if (!isJsonObject(state)) continue;
    const foldedConversations = state["conversations"];
    if (isJsonArray(foldedConversations)) {
      for (const conversation of foldedConversations) {
        if (!isJsonObject(conversation) || !isString(conversation["agent"]) || !isString(conversation["instance"])) continue;
        const stable = conversation["instance"] === `${sessionId}/${conversation["agent"]}`;
        const key = stable
          ? `${sessionId}/${conversation["agent"]}`
          : `${sessionId}/${conversation["agent"]}@${conversation["instance"]}`;
        conversations[key] = conversation["messages"] ?? [];
      }
    }
    const foldedOperations = state["operations"];
    if (isJsonArray(foldedOperations)) operations.push(...foldedOperations);
  }
  sections.set("conversations", conversations);
  operations.sort(compareOperations);
  checkStoredOperations(operations, failures);
  for (const operation of operations) scripts.recordOperation(operation);
  sections.set("operations", operations.map(projectOperation));
  sections.set("operationHistory", buildOperationHistory(stored, scripts));
  checkEvents(observations.rawEvents, stored, deletedSessions, failures);
  return sections;
}

function compareOperations(left: Json, right: Json): number {
  if (!isJsonObject(left) || !isJsonObject(right)) return 0;
  const leftAt = isNumber(left["createdAt"]) ? left["createdAt"] : 0;
  const rightAt = isNumber(right["createdAt"]) ? right["createdAt"] : 0;
  if (leftAt !== rightAt) return leftAt - rightAt;
  const leftSession = isString(left["sessionId"]) ? left["sessionId"] : "";
  const rightSession = isString(right["sessionId"]) ? right["sessionId"] : "";
  return compareCodePoints(leftSession, rightSession);
}

function buildOperationHistory(events: readonly Json[], scripts: CaseScripts): JsonObject {
  const status = new Map<string, { status: string; delivery: string; entries: string[] }>();
  for (const event of events) {
    if (!isJsonObject(event) || !isString(event["operationId"]) || !isString(event["type"])) continue;
    const id = event["operationId"];
    const current = status.get(id) ?? { status: "pending", delivery: "pending", entries: [] };
    switch (event["type"]) {
      case "operation.approved": current.status = "approved"; break;
      case "operation.rejected": current.status = "rejected"; break;
      case "operation.cancelled": current.status = "cancelled"; break;
      case "operation.execution.started": current.status = "running"; break;
      case "operation.completed": current.status = "completed"; break;
      case "operation.failed": current.status = "failed"; break;
      case "operation.delivery.claimed": current.delivery = "delivering"; break;
      case "operation.delivery.finished": {
        const data = event["data"];
        current.delivery = isJsonObject(data) && data["outcome"] === "delivered" ? "delivered" : "pending";
        break;
      }
      default: break;
    }
    const entry = `${current.status}/${current.delivery}`;
    if (current.entries[current.entries.length - 1] !== entry) current.entries.push(entry);
    status.set(id, current);
  }
  const result: JsonObject = {};
  for (const [id, current] of status) result[scripts.observations.operationAliases.get(id) ?? id] = current.entries;
  return result;
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

function checkEvents(
  events: readonly Json[],
  stored: readonly Json[],
  deletedSessions: ReadonlySet<string>,
  failures: string[],
): void {
  const storedBySequence = new Map<string, Json>();
  for (const event of stored) {
    if (!isJsonObject(event) || !isString(event["sessionId"]) || !isNumber(event["seq"])) continue;
    storedBySequence.set(`${event["sessionId"]}:${String(event["seq"])}`, projectEvent(event));
  }
  for (const event of events) {
    if (!isJsonObject(event)) continue;
    const issues = executionEventIssues(event);
    if (issues.length > 0) failures.push(`event ${JSON.stringify(event["type"])} does not satisfy executionEvent: ${JSON.stringify(issues)}`);
    if (!isNumber(event["at"])) failures.push(`event ${JSON.stringify(event["type"])} has no numeric at`);
    if (event["observational"] === true) {
      if (Object.hasOwn(event, "seq")) failures.push(`observational event ${JSON.stringify(event["type"])} has seq`);
      continue;
    }
    if (!isNumber(event["seq"]) || !isString(event["sessionId"])) {
      failures.push(`journal event ${JSON.stringify(event["type"])} has no sessionId and seq`);
      continue;
    }
    const key = `${event["sessionId"]}:${String(event["seq"])}`;
    const storedEvent = storedBySequence.get(key);
    if (storedEvent === undefined || diffJson(projectEvent(event), storedEvent, "").length > 0) {
      if (deletedSessions.has(event["sessionId"])) continue;
      failures.push(`execution event ${key} does not match the stored journal event`);
    }
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
      const restricted = restrictShape(result, expected.value);
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

function restrictShape(actual: Json, expected: Json): Json {
  if (isJsonArray(actual) && isJsonArray(expected)) {
    return actual.map((item, index) => {
      const wanted = expected[index];
      return wanted === undefined ? item : restrictShape(item, wanted);
    });
  }
  if (isJsonObject(actual) && isJsonObject(expected)) {
    const restricted: JsonObject = {};
    for (const [key, wanted] of Object.entries(expected)) {
      if (wanted !== undefined && Object.hasOwn(actual, key)) restricted[key] = restrictShape(actual[key] ?? null, wanted);
    }
    return restricted;
  }
  return actual;
}

function restrictKeys(actual: JsonObject, keys: readonly string[]): JsonObject {
  const restricted: JsonObject = {};
  for (const key of keys) {
    if (Object.hasOwn(actual, key)) restricted[key] = actual[key] ?? null;
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
    case "store": {
      const name = object["storeError"];
      if (name !== expected.name) failures.push(`${pointer}/storeError: expected ${expected.name}, got ${JSON.stringify(name)}`);
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
