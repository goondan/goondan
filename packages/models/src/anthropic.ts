import type { Block, DraftMessage, Json, Message, Model, ModelInput, ModelResponse, ModelResult, Part, ToolDefinition, Usage } from "@goondan/core";
import { ModelError, invalidRequest, invalidResponse, streamError, unsupportedContent } from "./errors.ts";
import { cloneJson, isJsonObject, jsonEqual, mergeObjects, own, setKey, toJson, type JsonObject } from "./json.ts";
import {
  PDF_TYPE,
  isBlank,
  isImageType,
  messageText,
  objectSchema,
  partText,
  repairToolPairs,
  resolveMediaPart,
  splitLeadingSystem,
  systemReminder,
  type MediaPart,
} from "./normalize.ts";
import {
  DEFAULT_MAX_RETRIES,
  checkOptionalBoolean,
  checkOptionalChoice,
  envValue,
  mergeHeaders,
  mergeModelOptions,
  processEnv,
  providerOverrides,
  readPortableOptions,
  resolveEndpoint,
  validateHttpConfig,
  type HttpModelConfig,
  type MediaResolver,
} from "./options.ts";
import { abortReason, parseEventData, streamModel, type StreamAssembler } from "./transport.ts";

export { ModelError, isModelError, type ModelErrorCode, type ModelErrorDetails, type ModelProvider } from "./errors.ts";
export type { FetchFunction, HttpModelConfig, MediaReference, MediaResolver, ModelEnv, ResolvedMedia } from "./options.ts";

const PROVIDER = "anthropic";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 64_000;
const RESERVED_FIELDS = ["messages", "tools", "stream", "system"];
const LENGTH_STOP_REASONS: ReadonlySet<string> = new Set(["max_tokens", "model_context_window_exceeded"]);
const INVALID_TOOL_ID_CHARACTERS = /[^A-Za-z0-9_-]/gu;
const BASE64_DATA_URL = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/su;
const HTTP_URL = /^https?:\/\//iu;

/** Anthropic Messages API settings. See spec/model-adapters.md, Anthropic Messages API. */
export interface AnthropicModelConfig extends HttpModelConfig {
  /** Bearer token used when there is no API key. Defaults to `ANTHROPIC_AUTH_TOKEN`. */
  authToken?: string;
  /** Top-level automatic caching. Defaults to true on the official URL and false elsewhere. */
  autoCache?: boolean;
  /** Lifetime of the cache breakpoints. */
  cacheTtl?: "5m" | "1h";
  /** How mid-conversation system messages are sent. Defaults to `user`. */
  midConversationSystem?: "user" | "system";
}

interface AnthropicSettings {
  model: string;
  options: Record<string, Json> | undefined;
  autoCache: boolean;
  cacheTtl: "5m" | "1h" | undefined;
  midConversationSystem: "user" | "system";
  resolveMedia: MediaResolver | undefined;
}

function validateAnthropicConfig(config: AnthropicModelConfig): void {
  validateHttpConfig(PROVIDER, config);
  if (config.authToken !== undefined && typeof config.authToken !== "string") throw invalidRequest(PROVIDER, "config.authToken must be a string");
  checkOptionalBoolean(PROVIDER, "autoCache", config.autoCache);
  checkOptionalChoice(PROVIDER, "cacheTtl", config.cacheTtl, ["5m", "1h"]);
  checkOptionalChoice(PROVIDER, "midConversationSystem", config.midConversationSystem, ["user", "system"]);
}

function settingsFor(config: AnthropicModelConfig, official: boolean): AnthropicSettings {
  return {
    model: config.model,
    options: config.options,
    autoCache: config.autoCache ?? official,
    cacheTtl: config.cacheTtl,
    midConversationSystem: config.midConversationSystem ?? "user",
    resolveMedia: config.resolveMedia,
  };
}

function cacheControl(ttl: "5m" | "1h" | undefined): JsonObject {
  return ttl === undefined ? { type: "ephemeral" } : { type: "ephemeral", ttl };
}

function toolUseId(callId: string): string {
  const sanitized = callId.replace(INVALID_TOOL_ID_CHARACTERS, "_");
  return sanitized === "" ? "_" : sanitized;
}

function isNonBlankBlock(block: Json): boolean {
  if (!isJsonObject(block) || own(block, "type") !== "text") return true;
  const text = own(block, "text");
  return typeof text !== "string" || !isBlank(text);
}

/** Converts response blocks into parts: `text` blocks become text parts and `tool_use` blocks become tool calls. */
function partsFromBlocks(blocks: readonly Json[]): Part[] {
  const parts: Part[] = [];
  for (const block of blocks) {
    if (!isJsonObject(block)) continue;
    const type = own(block, "type");
    if (type === "text") {
      const text = own(block, "text");
      if (typeof text === "string") parts.push({ type: "text", text });
    } else if (type === "tool_use") {
      const id = own(block, "id");
      const name = own(block, "name");
      if (typeof id === "string" && typeof name === "string") parts.push({ type: "tool.call", callId: id, name, args: own(block, "input") ?? null });
    }
  }
  return parts;
}

function textBlock(text: string): JsonObject {
  return { type: "text", text };
}

function imageBlock(part: Extract<Part, { type: "image" }>): JsonObject {
  const match = BASE64_DATA_URL.exec(part.url);
  if (match !== null) {
    const mediaType = part.mediaType || match[1] || "";
    return { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] ?? "" } };
  }
  if (HTTP_URL.test(part.url)) return { type: "image", source: { type: "url", url: part.url } };
  throw unsupportedContent(PROVIDER, `an image URL that is neither a base64 data URL nor http(s): ${part.url.slice(0, 32)}`);
}

async function mediaBlock(part: MediaPart, settings: AnthropicSettings, signal: AbortSignal): Promise<JsonObject> {
  const media = await resolveMediaPart(PROVIDER, part, settings.resolveMedia, signal);
  const source: JsonObject = media.kind === "data"
    ? { type: "base64", media_type: media.mediaType, data: media.data }
    : { type: "url", url: media.url };
  if (isImageType(media.mediaType)) return { type: "image", source };
  if (media.mediaType === PDF_TYPE) return { type: "document", source };
  throw unsupportedContent(PROVIDER, `media of type ${media.mediaType}`);
}

async function toolResultContent(parts: readonly Part[], settings: AnthropicSettings, signal: AbortSignal): Promise<JsonObject[]> {
  const blocks: JsonObject[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
      case "json": {
        const text = partText(part);
        if (!isBlank(text)) blocks.push(textBlock(text));
        break;
      }
      case "image":
        blocks.push(imageBlock(part));
        break;
      case "media":
        blocks.push(await mediaBlock(part, settings, signal));
        break;
      default:
        throw unsupportedContent(PROVIDER, `${part.type} parts inside a tool result`);
    }
  }
  return blocks;
}

async function userBlocks(message: Message, settings: AnthropicSettings, signal: AbortSignal): Promise<JsonObject[]> {
  const blocks: JsonObject[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case "text":
      case "json": {
        const text = partText(part);
        if (!isBlank(text)) blocks.push(textBlock(text));
        break;
      }
      case "image":
        blocks.push(imageBlock(part));
        break;
      case "media":
        blocks.push(await mediaBlock(part, settings, signal));
        break;
      case "tool.result": {
        const content = await toolResultContent(part.content, settings, signal);
        const block: JsonObject = { type: "tool_result", tool_use_id: toolUseId(part.callId) };
        if (content.length > 0) block.content = content;
        if (part.isError === true) block.is_error = true;
        blocks.push(block);
        break;
      }
      case "tool.call":
        throw unsupportedContent(PROVIDER, `tool.call parts in ${message.role} messages`);
    }
  }
  return blocks;
}

function recordedBlocks(message: Message): Json[] | undefined {
  const meta = message.meta;
  if (meta === undefined) return undefined;
  const anthropic = Object.hasOwn(meta, PROVIDER) ? meta[PROVIDER] : undefined;
  if (!isJsonObject(anthropic)) return undefined;
  const content = own(anthropic, "content");
  return Array.isArray(content) ? content : undefined;
}

function assistantBlocks(message: Message): Json[] {
  const recorded = recordedBlocks(message);
  if (recorded !== undefined && jsonEqual(toJson(partsFromBlocks(recorded)), toJson(message.content))) {
    return recorded.filter(isNonBlankBlock);
  }
  const blocks: JsonObject[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case "text":
      case "json": {
        const text = partText(part);
        if (!isBlank(text)) blocks.push(textBlock(text));
        break;
      }
      case "tool.call": {
        if (part.args !== null && !isJsonObject(part.args)) throw invalidRequest(PROVIDER, `tool call ${part.callId} args must be an object or null`);
        blocks.push({ type: "tool_use", id: toolUseId(part.callId), name: part.name, input: part.args ?? {} });
        break;
      }
      default:
        throw unsupportedContent(PROVIDER, `${part.type} parts in assistant messages`);
    }
  }
  return blocks;
}

type Unit =
  | { kind: "user"; blocks: Json[] }
  | { kind: "assistant"; blocks: Json[] }
  | { kind: "system"; text: string };

type RequestMessage =
  | { role: "user"; content: Json[] }
  | { role: "assistant"; content: Json[] }
  | { role: "system"; content: string };

async function messageUnits(messages: readonly Message[], settings: AnthropicSettings, signal: AbortSignal): Promise<Unit[]> {
  const units: Unit[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = messageText(message);
      if (!isBlank(text)) units.push({ kind: "system", text });
      continue;
    }
    const blocks = message.role === "assistant" ? assistantBlocks(message) : await userBlocks(message, settings, signal);
    if (blocks.length === 0) continue;
    units.push(message.role === "assistant" ? { kind: "assistant", blocks } : { kind: "user", blocks });
  }
  return units;
}

function isToolResultBlock(block: Json): boolean {
  return isJsonObject(block) && own(block, "type") === "tool_result";
}

function placeMessages(units: readonly Unit[], settings: AnthropicSettings): RequestMessage[] {
  const placed: RequestMessage[] = [];
  const append = (role: "user" | "assistant", blocks: Json[]): void => {
    const last = placed.at(-1);
    if (last !== undefined && last.role === role) last.content.push(...blocks);
    else placed.push(role === "user" ? { role, content: [...blocks] } : { role, content: [...blocks] });
  };
  units.forEach((unit, index) => {
    if (unit.kind !== "system") {
      append(unit.kind, unit.blocks);
      return;
    }
    const next = units[index + 1];
    const nativeSystem = settings.midConversationSystem === "system"
      && placed.at(-1)?.role === "user"
      && (next === undefined || next.kind === "assistant");
    if (nativeSystem) placed.push({ role: "system", content: unit.text });
    else append("user", [textBlock(systemReminder(unit.text))]);
  });
  for (const message of placed) {
    if (message.role !== "user") continue;
    message.content = [...message.content.filter(isToolResultBlock), ...message.content.filter((block) => !isToolResultBlock(block))];
  }
  return placed;
}

function systemBlocks(system: readonly Block[], instructions: readonly string[], settings: AnthropicSettings): JsonObject[] {
  const blocks = system.filter((block) => !isBlank(block.text));
  const flagged = blocks.flatMap((block, index) => (block.cache === true ? [index] : []));
  const marked = new Set(flagged.slice(-(settings.autoCache ? 3 : 4)));
  return [
    ...blocks.map((block, index) => (marked.has(index)
      ? { type: "text", text: block.text, cache_control: cacheControl(settings.cacheTtl) }
      : textBlock(block.text))),
    ...instructions.map(textBlock),
  ];
}

function toolEntries(tools: readonly ToolDefinition[]): JsonObject[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: objectSchema(tool.input) }));
}

async function anthropicBody(input: ModelInput, settings: AnthropicSettings, signal: AbortSignal): Promise<JsonObject> {
  const options = mergeModelOptions(settings.options, input.options);
  const portable = readPortableOptions(PROVIDER, options);
  const overrides = providerOverrides(PROVIDER, options, RESERVED_FIELDS);
  const { instructions, rest } = splitLeadingSystem(repairToolPairs(input.messages));
  const system = systemBlocks(input.system, instructions, settings);
  const messages = placeMessages(await messageUnits(rest, settings, signal), settings);
  const body: JsonObject = { model: settings.model, max_tokens: portable.maxTokens ?? DEFAULT_MAX_TOKENS, stream: true };
  if (system.length > 0) body.system = system;
  body.messages = messages;
  if (input.tools.length > 0) body.tools = toolEntries(input.tools);
  if (settings.autoCache) body.cache_control = cacheControl(settings.cacheTtl);
  if (portable.temperature !== undefined) body.temperature = portable.temperature;
  if (portable.topP !== undefined) body.top_p = portable.topP;
  if (portable.stop !== undefined) body.stop_sequences = portable.stop;
  const choice = portable.toolChoice;
  if (choice !== undefined) {
    if (choice === "auto" || choice === "none") body.tool_choice = { type: choice };
    else if (choice === "required") body.tool_choice = { type: "any" };
    else body.tool_choice = { type: "tool", name: choice.name };
  }
  return cloneJson(overrides === undefined ? body : mergeObjects(body, overrides));
}

/**
 * Builds the Anthropic Messages request body that `generate` would send for this input.
 * It sends no HTTP request. The optional signal is passed to `resolveMedia`.
 */
export async function buildAnthropicRequest(input: ModelInput, config: AnthropicModelConfig, signal?: AbortSignal): Promise<Record<string, Json>> {
  validateAnthropicConfig(config);
  const endpoint = resolveEndpoint(PROVIDER, config, config.env ?? processEnv());
  return anthropicBody(input, settingsFor(config, endpoint.official), signal ?? new AbortController().signal);
}

type BlockState = { block: JsonObject; args: string };

function appendText(block: JsonObject, key: string, piece: string): void {
  const current = own(block, key);
  setKey(block, key, (typeof current === "string" ? current : "") + piece);
}

function hasCitations(block: JsonObject): boolean {
  const citations = own(block, "citations");
  return Array.isArray(citations) && citations.length > 0;
}

function anthropicFinishReason(stopReason: string | undefined): ModelResult["finishReason"] {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "stop";
  if (stopReason === "tool_use") return "tool";
  if (stopReason !== undefined && LENGTH_STOP_REASONS.has(stopReason)) return "length";
  return "other";
}

const USAGE_FIELDS: ReadonlyArray<[string, keyof Usage]> = [
  ["input_tokens", "input"],
  ["output_tokens", "output"],
  ["cache_read_input_tokens", "cacheRead"],
  ["cache_creation_input_tokens", "cacheWrite"],
];

class AnthropicStreamAssembler implements StreamAssembler {
  readonly #emit: (delta: string) => void;
  readonly #requestId: string | undefined;
  readonly #blocks = new Map<number, BlockState>();
  readonly #usage: Partial<Usage> = {};
  #id: string | undefined;
  #model: string | undefined;
  #stopReason: string | undefined;
  #stopDetails: Json | undefined;
  #stopped = false;

  constructor(emit: (delta: string) => void, requestId: string | undefined) {
    this.#emit = emit;
    this.#requestId = requestId;
  }

  accept(data: string): boolean {
    const event = toJson(parseEventData(PROVIDER, data));
    if (!isJsonObject(event)) throw invalidResponse(PROVIDER, "stream event is not an object");
    const type = own(event, "type");
    if (typeof type !== "string") throw invalidResponse(PROVIDER, "stream event has no type");
    switch (type) {
      case "message_start":
        this.#messageStart(own(event, "message"));
        break;
      case "content_block_start":
        this.#blockStart(event);
        break;
      case "content_block_delta":
        this.#blockDelta(event);
        break;
      case "message_delta":
        this.#messageDelta(event);
        break;
      case "message_stop":
        this.#stopped = true;
        return true;
      case "error":
        throw streamError(PROVIDER, own(event, "error"), this.#requestId ?? stringOf(own(event, "request_id")));
      default:
        break;
    }
    return false;
  }

  #readUsage(value: Json | undefined): void {
    if (!isJsonObject(value)) return;
    for (const [from, to] of USAGE_FIELDS) {
      const count = own(value, from);
      if (typeof count === "number") this.#usage[to] = count;
    }
  }

  #messageStart(message: Json | undefined): void {
    if (!isJsonObject(message)) throw invalidResponse(PROVIDER, "message_start has no message");
    const id = own(message, "id");
    const model = own(message, "model");
    if (typeof id === "string") this.#id = id;
    if (typeof model === "string") this.#model = model;
    this.#readUsage(own(message, "usage"));
  }

  #index(event: JsonObject): number {
    const index = own(event, "index");
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw invalidResponse(PROVIDER, `${String(own(event, "type"))} has an invalid index`);
    return index;
  }

  #blockStart(event: JsonObject): void {
    const index = this.#index(event);
    const block = own(event, "content_block");
    if (!isJsonObject(block)) throw invalidResponse(PROVIDER, "content_block_start has no content_block");
    this.#blocks.set(index, { block: cloneJson(block), args: "" });
  }

  #blockDelta(event: JsonObject): void {
    const state = this.#blocks.get(this.#index(event));
    if (state === undefined) throw invalidResponse(PROVIDER, "content_block_delta for a block that was not started");
    const delta = own(event, "delta");
    if (!isJsonObject(delta)) throw invalidResponse(PROVIDER, "content_block_delta has no delta");
    switch (own(delta, "type")) {
      case "text_delta": {
        const text = requireString(own(delta, "text"), "text_delta.text");
        appendText(state.block, "text", text);
        if (text !== "") this.#emit(text);
        break;
      }
      case "input_json_delta":
        state.args += requireString(own(delta, "partial_json"), "input_json_delta.partial_json");
        break;
      case "thinking_delta":
        appendText(state.block, "thinking", requireString(own(delta, "thinking"), "thinking_delta.thinking"));
        break;
      case "signature_delta":
        appendText(state.block, "signature", requireString(own(delta, "signature"), "signature_delta.signature"));
        break;
      case "citations_delta": {
        const citations = own(state.block, "citations");
        const citation = own(delta, "citation") ?? null;
        setKey(state.block, "citations", Array.isArray(citations) ? [...citations, citation] : [citation]);
        break;
      }
      default:
        break;
    }
  }

  #messageDelta(event: JsonObject): void {
    const delta = own(event, "delta");
    if (isJsonObject(delta)) {
      const stopReason = own(delta, "stop_reason");
      if (typeof stopReason === "string") this.#stopReason = stopReason;
      const stopDetails = own(delta, "stop_details");
      if (stopDetails !== undefined && stopDetails !== null) this.#stopDetails = stopDetails;
    }
    this.#readUsage(own(event, "usage"));
  }

  result(): ModelResponse {
    if (!this.#stopped) throw new ModelError("Anthropic stream ended before message_stop", { provider: PROVIDER, code: "network" });
    const blocks: JsonObject[] = [];
    for (const [, state] of [...this.#blocks.entries()].sort(([left], [right]) => left - right)) {
      const { block } = state;
      const type = own(block, "type");
      if (type === "tool_use" || type === "server_tool_use") {
        if (state.args !== "") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(state.args);
          } catch (error) {
            if (this.#stopReason !== undefined && LENGTH_STOP_REASONS.has(this.#stopReason)) continue;
            throw invalidResponse(PROVIDER, `tool input for ${String(own(block, "name"))} is not JSON`, error);
          }
          setKey(block, "input", toJson(parsed));
        } else if (own(block, "input") === undefined) {
          setKey(block, "input", {});
        }
      }
      blocks.push(block);
    }
    const needsBlocks = blocks.some((block) => {
      const type = own(block, "type");
      return (type !== "text" && type !== "tool_use") || (type === "text" && hasCitations(block));
    });
    const meta: JsonObject = { id: this.#id ?? null, model: this.#model ?? null, stopReason: this.#stopReason ?? null };
    if (this.#stopDetails !== undefined) meta.stopDetails = this.#stopDetails;
    if (needsBlocks) meta.content = blocks;
    const message: DraftMessage = { role: "assistant", content: partsFromBlocks(blocks), meta: { [PROVIDER]: meta } };
    const usage = this.#usage;
    const reported = Object.keys(usage).length > 0;
    const result: ModelResponse = { message, finishReason: anthropicFinishReason(this.#stopReason) };
    if (reported) result.usage = { input: usage.input ?? 0, output: usage.output ?? 0, cacheRead: usage.cacheRead ?? 0, cacheWrite: usage.cacheWrite ?? 0 };
    return result;
  }
}

function stringOf(value: Json | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function requireString(value: Json | undefined, field: string): string {
  if (typeof value !== "string") throw invalidResponse(PROVIDER, `${field} is not a string`);
  return value;
}

/**
 * Creates a model for the Anthropic Messages API. Credentials and the base URL are resolved once here;
 * the official URL without an API key or auth token is an `authentication` error.
 */
export function createAnthropicModel(config: AnthropicModelConfig): Model {
  validateAnthropicConfig(config);
  const env = config.env ?? processEnv();
  const endpoint = resolveEndpoint(PROVIDER, config, env);
  const tokenSetting = config.authToken ?? envValue(env, "ANTHROPIC_AUTH_TOKEN");
  const authToken = endpoint.apiKey === undefined && tokenSetting !== undefined && tokenSetting !== "" ? tokenSetting : undefined;
  if (endpoint.official && endpoint.apiKey === undefined && authToken === undefined) {
    throw new ModelError("Anthropic model needs apiKey, authToken, ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for the official API", { provider: PROVIDER, code: "authentication" });
  }
  const defaults: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (endpoint.apiKey !== undefined) defaults["x-api-key"] = endpoint.apiKey;
  else if (authToken !== undefined) defaults.authorization = `Bearer ${authToken}`;
  const headers = mergeHeaders(defaults, config.headers);
  const settings = settingsFor(config, endpoint.official);
  const url = `${endpoint.baseUrl}/v1/messages`;
  const fetchImpl = config.fetch ?? ((target: string, init: RequestInit) => globalThis.fetch(target, init));
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const idleTimeoutMs = config.idleTimeoutMs;
  return {
    provider: PROVIDER,
    async generate(input, ctx) {
      if (ctx.signal.aborted) throw abortReason(ctx.signal);
      let body: JsonObject;
      try {
        body = await anthropicBody(input, settings, ctx.signal);
      } catch (error) {
        if (ctx.signal.aborted) throw abortReason(ctx.signal);
        throw error;
      }
      return streamModel({
        provider: PROVIDER,
        url,
        headers,
        body,
        fetch: fetchImpl,
        maxRetries,
        idleTimeoutMs,
        ctx,
        createAssembler: (emit, requestId) => new AnthropicStreamAssembler(emit, requestId),
      });
    },
  };
}
