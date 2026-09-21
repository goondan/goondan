/**
 * Normalization of an observed case document.
 *
 * The runner builds one document from every step projection and every
 * observation section, then applies the five normalization steps of
 * fixtures/conformance/README.md ("정규화") before comparing.
 */

import { type ObservationSection, OBSERVATION_SECTIONS } from "./conformance-case.ts";
import { type Json, type JsonObject, isJsonArray, isJsonObject, isString, joinPointer } from "./conformance-json.ts";

export interface ResultDocument {
  steps: Json[];
  observations: Map<ObservationSection, Json>;
}

/** Applies `replace` to every string, both object keys and values. */
export function replaceStrings(value: Json, replace: (text: string) => string): Json {
  if (isString(value)) return replace(value);
  if (isJsonArray(value)) return value.map((item) => replaceStrings(item, replace));
  if (isJsonObject(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      result[replace(key)] = replaceStrings(item, replace);
    }
    return result;
  }
  return value;
}

function isMessage(value: JsonObject): boolean {
  return Object.hasOwn(value, "role") && Object.hasOwn(value, "content");
}

/** Removes the `id` key from every message object. */
export function stripMessageIds(value: Json): Json {
  if (isJsonArray(value)) return value.map(stripMessageIds);
  if (!isJsonObject(value)) return value;
  const result: JsonObject = {};
  const message = isMessage(value);
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (message && key === "id") continue;
    result[key] = stripMessageIds(item);
  }
  return result;
}

/** Pointers of message objects without a non-empty string `id`. */
export function messagesWithoutId(value: Json, pointer = ""): string[] {
  if (isJsonArray(value)) {
    return value.flatMap((item, index) => messagesWithoutId(item, joinPointer(pointer, index)));
  }
  if (!isJsonObject(value)) return [];
  const found: string[] = [];
  if (isMessage(value)) {
    const id = value["id"];
    if (!isString(id) || id === "") found.push(pointer === "" ? "(root)" : pointer);
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    found.push(...messagesWithoutId(item, joinPointer(pointer, key)));
  }
  return found;
}

/** `turnId` 키에 저장된 모든 문자열 값입니다. */
export function collectTurnIds(value: Json, into = new Set<string>()): Set<string> {
  if (isJsonArray(value)) {
    for (const item of value) collectTurnIds(item, into);
    return into;
  }
  if (!isJsonObject(value)) return into;
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (key === "turnId" && isString(item) && item !== "") into.add(item);
    collectTurnIds(item, into);
  }
  return into;
}

export function collectExecutionIds(value: Json, into = new Set<string>()): Set<string> {
  if (isJsonArray(value)) {
    for (const item of value) collectExecutionIds(item, into);
    return into;
  }
  if (!isJsonObject(value)) return into;
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if ((key === "executionId" || key === "parentExecutionId") && isString(item) && item !== "") into.add(item);
    collectExecutionIds(item, into);
  }
  return into;
}

export function collectInputIds(value: Json, into = new Set<string>()): Set<string> {
  if (isJsonArray(value)) {
    for (const item of value) collectInputIds(item, into);
    return into;
  }
  if (!isJsonObject(value)) return into;
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (key === "inputId" && isString(item) && item !== "") into.add(item);
    collectInputIds(item, into);
  }
  return into;
}

/** Visits every string of the document in the order the README defines. */
export function traverseStrings(document: ResultDocument, visit: (text: string) => void): void {
  visitValue(document.steps, visit);
  for (const section of OBSERVATION_SECTIONS) {
    const value = document.observations.get(section);
    if (value === undefined) continue;
    visitValue(value, visit);
  }
}

function visitValue(value: Json, visit: (text: string) => void): void {
  if (isString(value)) {
    visit(value);
    return;
  }
  if (isJsonArray(value)) {
    for (const item of value) visitValue(item, visit);
    return;
  }
  if (!isJsonObject(value)) return;
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    const item = value[key];
    if (item === undefined) continue;
    visit(key);
    visitValue(item, visit);
  }
}

export function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const a = leftPoints[index];
    const b = rightPoints[index];
    if (a === undefined || b === undefined) break;
    const codeA = a.codePointAt(0) ?? 0;
    const codeB = b.codePointAt(0) ?? 0;
    if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  }
  if (leftPoints.length === rightPoints.length) return 0;
  return leftPoints.length < rightPoints.length ? -1 : 1;
}

/** Identifiers found in `text`, left to right, without overlaps. */
export function scanIdentifiers(text: string, identifiers: readonly string[]): string[] {
  const matches: Array<{ index: number; value: string }> = [];
  for (const identifier of identifiers) {
    if (identifier === "") continue;
    let from = 0;
    for (;;) {
      const index = text.indexOf(identifier, from);
      if (index < 0) break;
      matches.push({ index, value: identifier });
      from = index + 1;
    }
  }
  matches.sort((left, right) => (left.index !== right.index ? left.index - right.index : right.value.length - left.value.length));
  const found: string[] = [];
  let taken = -1;
  for (const match of matches) {
    if (match.index < taken) continue;
    found.push(match.value);
    taken = match.index + match.value.length;
  }
  return found;
}

/** Assigns `<turn:N>` labels in document traversal order. */
export function numberTurnIds(document: ResultDocument, turnIds: ReadonlySet<string>): Map<string, string> {
  const identifiers = [...turnIds].sort((left, right) => right.length - left.length);
  const labels = new Map<string, string>();
  traverseStrings(document, (text) => {
    for (const identifier of scanIdentifiers(text, identifiers)) {
      if (labels.has(identifier)) continue;
      labels.set(identifier, `<turn:${String(labels.size + 1)}>`);
    }
  });
  for (const identifier of identifiers) {
    if (!labels.has(identifier)) labels.set(identifier, `<turn:${String(labels.size + 1)}>`);
  }
  return labels;
}

export function numberIdentifiers(
  document: ResultDocument,
  identifiers: ReadonlySet<string>,
  label: "execution" | "input",
): Map<string, string> {
  const candidates = [...identifiers].sort((left, right) => right.length - left.length);
  const labels = new Map<string, string>();
  traverseStrings(document, (text) => {
    for (const identifier of scanIdentifiers(text, candidates)) {
      if (!labels.has(identifier)) labels.set(identifier, `<${label}:${String(labels.size + 1)}>`);
    }
  });
  return labels;
}

function statelessAgents(document: ResultDocument): Set<string> {
  const found = new Set<string>();
  const config = document.observations.get("effectiveConfig");
  if (!isJsonObject(config) || !isJsonObject(config["agents"])) return found;
  for (const [name, agent] of Object.entries(config["agents"])) {
    if (isJsonObject(agent) && agent["stateful"] === false) found.add(name);
  }
  return found;
}

function collectStatelessInstances(value: Json, agents: ReadonlySet<string>, into: Set<string>): void {
  if (isJsonArray(value)) {
    for (const item of value) collectStatelessInstances(item, agents, into);
    return;
  }
  if (!isJsonObject(value)) return;
  const instance = value["instance"];
  const agent = value["agent"];
  const from = value["from"];
  if (isString(instance)) {
    const suffixAgent = [...agents].find((name) => instance.endsWith(`#${name}`));
    if ((isString(agent) && agents.has(agent)) || (isString(from) && agents.has(from)) || suffixAgent !== undefined) {
      into.add(instance);
    }
  }
  for (const item of Object.values(value)) {
    if (item !== undefined) collectStatelessInstances(item, agents, into);
  }
}

/** 문서에 처음 나타난 순서대로 stateless 인스턴스 식별자를 치환합니다. */
export function numberStatelessInstances(document: ResultDocument): Map<string, string> {
  const agents = statelessAgents(document);
  const candidates = new Set<string>();
  collectStatelessInstances(document.steps, agents, candidates);
  for (const value of document.observations.values()) collectStatelessInstances(value, agents, candidates);
  const identifiers = [...candidates].sort((left, right) => right.length - left.length);
  const labels = new Map<string, string>();
  traverseStrings(document, (text) => {
    for (const identifier of scanIdentifiers(text, identifiers)) {
      if (!labels.has(identifier)) labels.set(identifier, `<instance:${String(labels.size + 1)}>`);
    }
  });
  return labels;
}

function replaceAll(text: string, replacements: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [from, to] of replacements) {
    if (from === "") continue;
    result = result.split(from).join(to);
  }
  return result;
}

export interface NormalizeOptions {
  /** Absolute paths of the case directory that become `<case>`. */
  casePaths: readonly string[];
  /** Operation identifier to alias, from the operation store order. */
  operationAliases: ReadonlyMap<string, string>;
}

export interface NormalizeResult {
  document: ResultDocument;
  instanceLabels: Map<string, string>;
  turnLabels: Map<string, string>;
  executionLabels: Map<string, string>;
  inputLabels: Map<string, string>;
}

export function normalizeDocument(document: ResultDocument, options: NormalizeOptions): NormalizeResult {
  const casePaths = [...options.casePaths].filter((path) => path !== "").sort((left, right) => right.length - left.length);
  const caseReplacements = new Map(casePaths.map((path) => [path, "<case>"]));
  const withCase = mapDocument(document, (value) => replaceStrings(value, (text) => replaceAll(text, caseReplacements)));
  const withoutIds = mapDocument(withCase, stripMessageIds);
  const operationReplacements = new Map(
    [...options.operationAliases].sort((left, right) => right[0].length - left[0].length),
  );
  const withAliases = mapDocument(withoutIds, (value) =>
    replaceStrings(value, (text) => replaceAll(text, operationReplacements)),
  );
  const instanceLabels = numberStatelessInstances(withAliases);
  const withInstances = mapDocument(withAliases, (value) =>
    replaceStrings(value, (text) => replaceAll(text, instanceLabels)),
  );
  const turnIds = new Set<string>();
  collectTurnIds(withInstances.steps, turnIds);
  for (const value of withInstances.observations.values()) collectTurnIds(value, turnIds);
  const turnLabels = numberTurnIds(withInstances, turnIds);
  const withTurns = mapDocument(withInstances, (value) => replaceStrings(value, (text) => replaceAll(text, turnLabels)));
  const executionIds = new Set<string>();
  collectExecutionIds(withTurns.steps, executionIds);
  for (const value of withTurns.observations.values()) collectExecutionIds(value, executionIds);
  const executionLabels = numberIdentifiers(withTurns, executionIds, "execution");
  const withExecutions = mapDocument(withTurns, (value) =>
    replaceStrings(value, (text) => replaceAll(text, executionLabels)),
  );
  const inputIds = new Set<string>();
  collectInputIds(withExecutions.steps, inputIds);
  for (const value of withExecutions.observations.values()) collectInputIds(value, inputIds);
  const inputLabels = numberIdentifiers(withExecutions, inputIds, "input");
  const withInputs = mapDocument(withExecutions, (value) => replaceStrings(value, (text) => replaceAll(text, inputLabels)));
  return { document: withInputs, instanceLabels, turnLabels, executionLabels, inputLabels };
}

function mapDocument(document: ResultDocument, map: (value: Json) => Json): ResultDocument {
  const steps = map(document.steps);
  const observations = new Map<ObservationSection, Json>();
  for (const [section, value] of document.observations) observations.set(section, map(value));
  return { steps: isJsonArray(steps) ? steps : [], observations };
}
