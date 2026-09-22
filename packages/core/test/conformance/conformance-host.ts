import { FixtureStore } from "./conformance-store.ts";
/**
 * Adapter between the runner and the TypeScript host API.
 *
 * The runner never reaches into the core directly: every entry point is looked
 * up here and a missing one fails the case with
 * `unsupported by TypeScript runner: <feature>` instead of a crash. See
 * fixtures/conformance/README.md ("지원하지 않는 기능").
 */

import * as coreExports from "../../src/index.ts";
import { validateDefinition } from "../../src/schema.ts";
import { type Json, type JsonObject, isFunction, isJsonArray, isPromiseLike, snapshot } from "./conformance-json.ts";

export class UnsupportedError extends Error {
  constructor(feature: string) {
    super(`unsupported by TypeScript runner: ${feature}`);
    this.name = "UnsupportedError";
  }
}

const core: unknown = coreExports;

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function member(owner: unknown, name: string): unknown {
  if (!isObjectLike(owner) && typeof owner !== "function") return undefined;
  return Reflect.get(Object(owner), name);
}

function requireFunction(owner: unknown, name: string, feature: string): (...args: unknown[]) => unknown {
  const value = member(owner, name);
  if (!isFunction(value)) throw new UnsupportedError(feature);
  return value;
}

export function callMethod(owner: unknown, name: string, args: unknown[], feature: string): unknown {
  const method = requireFunction(owner, name, feature);
  return Reflect.apply(method, owner, args);
}

export async function callMethodAsync(owner: unknown, name: string, args: unknown[], feature: string): Promise<unknown> {
  const result = callMethod(owner, name, args, feature);
  return isPromiseLike(result) ? await result : result;
}

export async function loadConfig(path: string): Promise<unknown> {
  const load = requireFunction(core, "loadConfig", "loadConfig");
  const result = Reflect.apply(load, undefined, [path]);
  return isPromiseLike(result) ? await result : result;
}

export async function validateConfig(document: JsonObject): Promise<unknown> {
  const validate = requireFunction(core, "validateConfig", "validateConfig");
  const result = Reflect.apply(validate, undefined, [document]);
  return isPromiseLike(result) ? await result : result;
}

export async function createGoondan(config: unknown, bindings: unknown): Promise<unknown> {
  const create = requireFunction(core, "createGoondan", "createGoondan");
  const result = Reflect.apply(create, undefined, [config, bindings]);
  return isPromiseLike(result) ? await result : result;
}

export function newStore(): object {
  return new FixtureStore();
}

export async function foldJournal(sessionId: string, events: Json[]): Promise<Json> {
  const fold = requireFunction(core, "fold", "fold");
  const result = Reflect.apply(fold, undefined, [sessionId, events]);
  return snapshot(isPromiseLike(result) ? await result : result);
}

export function executionEventIssues(event: Json): Json[] {
  return snapshot(validateDefinition("executionEvent", event, []));
}

/** The effective config carried by a `loadConfig` result. */
export function effectiveConfigOf(loaded: unknown): Json {
  const config = member(loaded, "config");
  return snapshot(config === undefined ? loaded : config);
}

export interface ConfigErrorInfo {
  issues: Json[];
  message: string;
}

export function asConfigError(error: unknown): ConfigErrorInfo | undefined {
  if (!isObjectLike(error)) return undefined;
  const issues = snapshot(member(error, "issues"));
  if (!isJsonArray(issues)) return undefined;
  const configErrorClass = member(core, "GoondanConfigError");
  const name = member(error, "name");
  const byClass = isFunction(configErrorClass) && error instanceof configErrorClass;
  if (!byClass && name !== "GoondanConfigError") return undefined;
  const message = member(error, "message");
  return { issues, message: typeof message === "string" ? message : "" };
}

export interface ExecutionErrorInfo {
  where: Json;
  codes: Json;
  attempt: Json;
  message: string;
  toolCall?: Json;
}

export function asExecutionError(error: unknown): ExecutionErrorInfo | undefined {
  if (!isObjectLike(error)) return undefined;
  const where = member(error, "where");
  const codes = member(error, "codes");
  const attempt = member(error, "attempt");
  if (typeof where !== "string" || !Array.isArray(codes)) return undefined;
  const message = member(error, "message");
  const info: ExecutionErrorInfo = {
    where,
    codes: snapshot(codes),
    attempt: snapshot(attempt),
    message: typeof message === "string" ? message : "",
  };
  const toolCall = member(error, "toolCall");
  if (toolCall !== undefined) info.toolCall = snapshot(toolCall);
  return info;
}

export function isTypeError(error: unknown): boolean {
  return error instanceof TypeError;
}
