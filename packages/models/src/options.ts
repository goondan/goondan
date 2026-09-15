import type { Json } from "@goondan/core";
import { invalidRequest, type ModelProvider } from "./errors.ts";
import { isJsonObject, isRecord, mergeObjects, own, stripNulls, type JsonObject } from "./json.ts";

/** Media returned by a host resolver: base64 data without a `data:` prefix, or a URL. */
export type ResolvedMedia = { data: string; mediaType?: string } | { url: string; mediaType?: string };

export interface MediaReference {
  ref: string;
  mediaType: string;
}

/** Turns a `media` part into data or a URL the provider can receive. */
export type MediaResolver = (part: MediaReference, ctx: { signal: AbortSignal }) => ResolvedMedia | Promise<ResolvedMedia>;

/** The subset of `fetch` the adapters use. */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export type ModelEnv = Readonly<Record<string, string | undefined>>;

/** Settings shared by both adapters. See spec/model-adapters.md, 공통 설정. */
export interface HttpModelConfig {
  /** Provider model identifier. */
  model: string;
  /** API key. Defaults to the provider's API key environment variable. */
  apiKey?: string;
  /** Base URL. Defaults to the provider's base URL environment variable, then the official URL. */
  baseUrl?: string;
  /** Extra headers applied after the default headers; names compare case-insensitively. */
  headers?: Record<string, string>;
  /** Default model options applied to every call. */
  options?: Record<string, Json>;
  /** How many times one call may resend the request. Defaults to 2. */
  maxRetries?: number;
  /** Maximum milliseconds to wait for the response headers or the next body chunk. No limit by default. */
  idleTimeoutMs?: number;
  /** Resolves `media` parts. Without it, media parts are `unsupported_content`. */
  resolveMedia?: MediaResolver;
  /** Environment variables to read. Defaults to the process environment. */
  env?: ModelEnv;
  /** HTTP implementation. Defaults to the global `fetch`. */
  fetch?: FetchFunction;
}

export type ToolChoiceOption = "auto" | "none" | "required" | { name: string };

export interface PortableOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  toolChoice?: ToolChoiceOption;
}

export const OFFICIAL_BASE_URL: Readonly<Record<ModelProvider, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

const ENV_NAMES: Readonly<Record<ModelProvider, { apiKey: string; baseUrl: string }>> = {
  anthropic: { apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" },
  openai: { apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
};

export const DEFAULT_MAX_RETRIES = 2;

export function processEnv(): ModelEnv {
  return typeof process === "undefined" ? {} : process.env;
}

/** Reads an environment variable; an empty string counts as unset. */
export function envValue(env: ModelEnv, name: string): string | undefined {
  const value = Object.hasOwn(env, name) ? env[name] : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function checkOptionalString(provider: ModelProvider, name: string, value: unknown, allowEmpty: boolean): void {
  if (value === undefined) return;
  if (typeof value !== "string" || (!allowEmpty && value === "")) {
    throw invalidRequest(provider, `config.${name} must be a${allowEmpty ? "" : " non-empty"} string`);
  }
}

export function checkOptionalBoolean(provider: ModelProvider, name: string, value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") throw invalidRequest(provider, `config.${name} must be a boolean`);
}

export function checkOptionalChoice(provider: ModelProvider, name: string, value: unknown, choices: readonly string[]): void {
  if (value !== undefined && (typeof value !== "string" || !choices.includes(value))) {
    throw invalidRequest(provider, `config.${name} must be one of ${choices.join(", ")}`);
  }
}

/** Validates the shared settings; a malformed value is an `invalid_request` error. */
export function validateHttpConfig(provider: ModelProvider, config: HttpModelConfig): void {
  if (!isRecord(config)) throw invalidRequest(provider, "config must be an object");
  if (typeof config.model !== "string" || config.model === "") throw invalidRequest(provider, "config.model must be a non-empty string");
  checkOptionalString(provider, "apiKey", config.apiKey, true);
  checkOptionalString(provider, "baseUrl", config.baseUrl, false);
  if (config.headers !== undefined && !isStringRecord(config.headers)) throw invalidRequest(provider, "config.headers must map header names to strings");
  if (config.options !== undefined && !isRecord(config.options)) throw invalidRequest(provider, "config.options must be an object");
  if (config.maxRetries !== undefined && !(Number.isInteger(config.maxRetries) && config.maxRetries >= 0)) {
    throw invalidRequest(provider, "config.maxRetries must be a non-negative integer");
  }
  if (config.idleTimeoutMs !== undefined && !(typeof config.idleTimeoutMs === "number" && Number.isFinite(config.idleTimeoutMs) && config.idleTimeoutMs > 0)) {
    throw invalidRequest(provider, "config.idleTimeoutMs must be a positive number");
  }
  if (config.resolveMedia !== undefined && typeof config.resolveMedia !== "function") throw invalidRequest(provider, "config.resolveMedia must be a function");
  if (config.env !== undefined && !isRecord(config.env)) throw invalidRequest(provider, "config.env must be an object");
  if (config.fetch !== undefined && typeof config.fetch !== "function") throw invalidRequest(provider, "config.fetch must be a function");
}

export interface Endpoint {
  baseUrl: string;
  official: boolean;
  apiKey: string | undefined;
}

/** Resolves the base URL and API key once: the setting first, then the environment, then the official URL. */
export function resolveEndpoint(provider: ModelProvider, config: HttpModelConfig, env: ModelEnv): Endpoint {
  const names = ENV_NAMES[provider];
  const baseUrl = (config.baseUrl ?? envValue(env, names.baseUrl) ?? OFFICIAL_BASE_URL[provider]).replace(/\/+$/, "");
  const apiKey = config.apiKey ?? envValue(env, names.apiKey);
  return { baseUrl, official: baseUrl === OFFICIAL_BASE_URL[provider], apiKey: apiKey === "" ? undefined : apiKey };
}

/** Applies extra headers after the defaults; a header with the same case-insensitive name replaces the default. */
export function mergeHeaders(defaults: Record<string, string>, extra: Record<string, string> | undefined): Record<string, string> {
  const entries = new Map<string, [string, string]>();
  for (const [name, value] of Object.entries(defaults)) entries.set(name.toLowerCase(), [name, value]);
  for (const [name, value] of Object.entries(extra ?? {})) entries.set(name.toLowerCase(), [name, value]);
  const headers: Record<string, string> = {};
  for (const [name, value] of entries.values()) headers[name] = value;
  return headers;
}

/** Merges the input options over the configured defaults and drops keys whose value is `null`. */
export function mergeModelOptions(defaults: Record<string, Json> | undefined, overlay: Record<string, Json>): JsonObject {
  return stripNulls(mergeObjects(defaults ?? {}, overlay));
}

/** Reads and validates the shared option keys. */
export function readPortableOptions(provider: ModelProvider, options: JsonObject): PortableOptions {
  const result: PortableOptions = {};
  const maxTokens = own(options, "maxTokens");
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens)) throw invalidRequest(provider, "options.maxTokens must be an integer");
    result.maxTokens = maxTokens;
  }
  const temperature = own(options, "temperature");
  if (temperature !== undefined) {
    if (typeof temperature !== "number") throw invalidRequest(provider, "options.temperature must be a number");
    result.temperature = temperature;
  }
  const topP = own(options, "topP");
  if (topP !== undefined) {
    if (typeof topP !== "number") throw invalidRequest(provider, "options.topP must be a number");
    result.topP = topP;
  }
  const stop = own(options, "stop");
  if (stop !== undefined) {
    if (!Array.isArray(stop)) throw invalidRequest(provider, "options.stop must be an array of strings");
    const sequences: string[] = [];
    for (const item of stop) {
      if (typeof item !== "string") throw invalidRequest(provider, "options.stop must be an array of strings");
      sequences.push(item);
    }
    result.stop = sequences;
  }
  const toolChoice = own(options, "toolChoice");
  if (toolChoice !== undefined) {
    if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
      result.toolChoice = toolChoice;
    } else if (isJsonObject(toolChoice) && typeof own(toolChoice, "name") === "string") {
      const name = own(toolChoice, "name");
      if (typeof name === "string") result.toolChoice = { name };
    } else {
      throw invalidRequest(provider, "options.toolChoice must be auto, none, required or {name}");
    }
  }
  return result;
}

/** Returns the provider-named option object that is merged into the request body last. */
export function providerOverrides(provider: ModelProvider, options: JsonObject, reserved: readonly string[]): JsonObject | undefined {
  const value = own(options, provider);
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw invalidRequest(provider, `options.${provider} must be an object`);
  for (const key of reserved) {
    if (Object.hasOwn(value, key)) throw invalidRequest(provider, `options.${provider}.${key} is managed by the adapter`);
  }
  return value;
}
