import type { Json, Message, Model, ModelInput, ModelResult, Part, ToolDefinition } from "@goondan/core";
import { ModelError, invalidRequest, invalidResponse, streamError, unsupportedContent } from "./errors.ts";
import { newMessageId, randomHex } from "./ids.ts";
import { cloneJson, isJsonObject, mergeObjects, own, setKey, toJson, type JsonObject } from "./json.ts";
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

const PROVIDER = "openai";
const RESERVED_FIELDS = ["messages", "tools", "stream"];
const IMAGE_PLACEHOLDER = "(image output attached in the next user message)";

/** OpenAI Chat Completions settings, also used for compatible gateways and local servers. */
export interface OpenAIChatModelConfig extends HttpModelConfig {
  /** Request field for `maxTokens`. Defaults to `max_completion_tokens` on the official URL and `max_tokens` elsewhere. */
  maxTokensField?: string;
  /** Requests the usage chunk at the end of the stream. Defaults to true. */
  streamUsage?: boolean;
  /** Role of the system instruction message. Defaults to `system`. */
  systemRole?: "system" | "developer";
  /** How mid-conversation system messages are sent. Defaults to `system`. */
  midConversationSystem?: "system" | "user";
}

interface OpenAISettings {
  model: string;
  options: Record<string, Json> | undefined;
  maxTokensField: string;
  streamUsage: boolean;
  systemRole: "system" | "developer";
  midConversationSystem: "system" | "user";
  resolveMedia: MediaResolver | undefined;
}

function validateOpenAIConfig(config: OpenAIChatModelConfig): void {
  validateHttpConfig(PROVIDER, config);
  if (config.maxTokensField !== undefined && (typeof config.maxTokensField !== "string" || config.maxTokensField === "")) {
    throw invalidRequest(PROVIDER, "config.maxTokensField must be a non-empty string");
  }
  checkOptionalBoolean(PROVIDER, "streamUsage", config.streamUsage);
  checkOptionalChoice(PROVIDER, "systemRole", config.systemRole, ["system", "developer"]);
  checkOptionalChoice(PROVIDER, "midConversationSystem", config.midConversationSystem, ["system", "user"]);
}

function settingsFor(config: OpenAIChatModelConfig, official: boolean): OpenAISettings {
  return {
    model: config.model,
    options: config.options,
    maxTokensField: config.maxTokensField ?? (official ? "max_completion_tokens" : "max_tokens"),
    streamUsage: config.streamUsage ?? true,
    systemRole: config.systemRole ?? "system",
    midConversationSystem: config.midConversationSystem ?? "system",
    resolveMedia: config.resolveMedia,
  };
}

function imageUrlItem(url: string): JsonObject {
  return { type: "image_url", image_url: { url } };
}

type MediaItem = { kind: "image"; item: JsonObject } | { kind: "pdf"; item: JsonObject };

async function mediaItem(part: MediaPart, settings: OpenAISettings, signal: AbortSignal): Promise<MediaItem> {
  const media = await resolveMediaPart(PROVIDER, part, settings.resolveMedia, signal);
  if (isImageType(media.mediaType)) {
    return { kind: "image", item: imageUrlItem(media.kind === "data" ? `data:${media.mediaType};base64,${media.data}` : media.url) };
  }
  if (media.mediaType === PDF_TYPE && media.kind === "data") {
    return { kind: "pdf", item: { type: "file", file: { file_data: `data:${PDF_TYPE};base64,${media.data}` } } };
  }
  throw unsupportedContent(PROVIDER, media.kind === "url" ? `media of type ${media.mediaType} given as a URL` : `media of type ${media.mediaType}`);
}

async function userContent(message: Message, settings: OpenAISettings, signal: AbortSignal): Promise<Json | undefined> {
  const items: JsonObject[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case "text":
      case "json": {
        const text = partText(part);
        if (!isBlank(text)) items.push({ type: "text", text });
        break;
      }
      case "image":
        items.push(imageUrlItem(part.url));
        break;
      case "media":
        items.push((await mediaItem(part, settings, signal)).item);
        break;
      default:
        throw unsupportedContent(PROVIDER, `${part.type} parts in user messages`);
    }
  }
  const [first] = items;
  if (first === undefined) return undefined;
  if (items.length === 1 && own(first, "type") === "text") {
    const text = own(first, "text");
    if (typeof text === "string") return text;
  }
  return items;
}

function assistantMessage(message: Message): JsonObject | undefined {
  const texts: string[] = [];
  const calls: JsonObject[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case "text":
      case "json": {
        const text = partText(part);
        if (!isBlank(text)) texts.push(text);
        break;
      }
      case "tool.call":
        calls.push({ id: part.callId, type: "function", function: { name: part.name, arguments: part.args === null ? "{}" : JSON.stringify(part.args) } });
        break;
      default:
        throw unsupportedContent(PROVIDER, `${part.type} parts in assistant messages`);
    }
  }
  const content = texts.join("\n");
  if (content === "" && calls.length === 0) return undefined;
  const result: JsonObject = { role: "assistant", content: content === "" ? null : content };
  if (calls.length > 0) result.tool_calls = calls;
  return result;
}

type ToolImage = { callId: string; item: JsonObject };

async function toolMessages(message: Message, settings: OpenAISettings, signal: AbortSignal, images: ToolImage[]): Promise<JsonObject[]> {
  const messages: JsonObject[] = [];
  for (const part of message.content) {
    if (part.type !== "tool.result") throw unsupportedContent(PROVIDER, `${part.type} parts in tool messages`);
    const lines: string[] = [];
    let imageCount = 0;
    for (const item of part.content) {
      switch (item.type) {
        case "text":
        case "json":
          lines.push(partText(item));
          break;
        case "image":
          images.push({ callId: part.callId, item: imageUrlItem(item.url) });
          imageCount += 1;
          break;
        case "media": {
          const media = await mediaItem(item, settings, signal);
          if (media.kind !== "image") throw unsupportedContent(PROVIDER, "a PDF inside a tool result");
          images.push({ callId: part.callId, item: media.item });
          imageCount += 1;
          break;
        }
        default:
          throw unsupportedContent(PROVIDER, `${item.type} parts inside a tool result`);
      }
    }
    const text = lines.join("\n");
    messages.push({ role: "tool", tool_call_id: part.callId, content: text === "" && imageCount > 0 ? IMAGE_PLACEHOLDER : text });
  }
  return messages;
}

function toolEntries(tools: readonly ToolDefinition[]): JsonObject[] {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: objectSchema(tool.input) } }));
}

async function openAIBody(input: ModelInput, settings: OpenAISettings, signal: AbortSignal): Promise<JsonObject> {
  const options = mergeModelOptions(settings.options, input.options);
  const portable = readPortableOptions(PROVIDER, options);
  const overrides = providerOverrides(PROVIDER, options, RESERVED_FIELDS);
  const { instructions, rest } = splitLeadingSystem(repairToolPairs(input.messages));
  const systemText = [...input.system.filter((block) => !isBlank(block.text)).map((block) => block.text), ...instructions].join("\n\n");
  const messages: JsonObject[] = [];
  if (systemText !== "") messages.push({ role: settings.systemRole, content: systemText });
  let images: ToolImage[] = [];
  const flushImages = (): void => {
    if (images.length === 0) return;
    const callIds = [...new Set(images.map((image) => image.callId))].join(", ");
    messages.push({ role: "user", content: [{ type: "text", text: `Images returned by tool calls: ${callIds}` }, ...images.map((image) => image.item)] });
    images = [];
  };
  for (const message of rest) {
    if (message.role !== "tool") flushImages();
    switch (message.role) {
      case "system": {
        const text = messageText(message);
        if (isBlank(text)) break;
        messages.push(settings.midConversationSystem === "user" ? { role: "user", content: systemReminder(text) } : { role: settings.systemRole, content: text });
        break;
      }
      case "user": {
        const content = await userContent(message, settings, signal);
        if (content !== undefined) messages.push({ role: "user", content });
        break;
      }
      case "assistant": {
        const assistant = assistantMessage(message);
        if (assistant !== undefined) messages.push(assistant);
        break;
      }
      case "tool":
        messages.push(...await toolMessages(message, settings, signal, images));
        break;
    }
  }
  flushImages();
  const body: JsonObject = { model: settings.model, messages, stream: true };
  if (settings.streamUsage) body.stream_options = { include_usage: true };
  if (input.tools.length > 0) body.tools = toolEntries(input.tools);
  if (portable.maxTokens !== undefined) setKey(body, settings.maxTokensField, portable.maxTokens);
  if (portable.temperature !== undefined) body.temperature = portable.temperature;
  if (portable.topP !== undefined) body.top_p = portable.topP;
  if (portable.stop !== undefined) body.stop = portable.stop;
  const choice = portable.toolChoice;
  if (choice !== undefined) body.tool_choice = typeof choice === "string" ? choice : { type: "function", function: { name: choice.name } };
  return cloneJson(overrides === undefined ? body : mergeObjects(body, overrides));
}

/**
 * Builds the Chat Completions request body that `generate` would send for this input.
 * It sends no HTTP request. The optional signal is passed to `resolveMedia`.
 */
export async function buildOpenAIChatRequest(input: ModelInput, config: OpenAIChatModelConfig, signal?: AbortSignal): Promise<Record<string, Json>> {
  validateOpenAIConfig(config);
  const endpoint = resolveEndpoint(PROVIDER, config, config.env ?? processEnv());
  return openAIBody(input, settingsFor(config, endpoint.official), signal ?? new AbortController().signal);
}

type CallState = { key: number; id: string | undefined; name: string | undefined; args: string };

function nonEmptyString(value: Json | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function count(value: Json | undefined): number {
  return typeof value === "number" ? value : 0;
}

class OpenAIChatStreamAssembler implements StreamAssembler {
  readonly #emit: (delta: string) => void;
  readonly #requestId: string | undefined;
  readonly #calls: CallState[] = [];
  #text = "";
  #id: string | undefined;
  #model: string | null = null;
  #finishReason: string | undefined;
  #usage: JsonObject | undefined;
  #done = false;

  constructor(emit: (delta: string) => void, requestId: string | undefined) {
    this.#emit = emit;
    this.#requestId = requestId;
  }

  accept(data: string): boolean {
    if (data === "[DONE]") {
      this.#done = true;
      return true;
    }
    const chunk = toJson(parseEventData(PROVIDER, data));
    if (!isJsonObject(chunk)) throw invalidResponse(PROVIDER, "stream chunk is not an object");
    const error = own(chunk, "error");
    if (isJsonObject(error)) throw streamError(PROVIDER, error, this.#requestId ?? nonEmptyString(own(chunk, "request_id")));
    const id = own(chunk, "id");
    if (this.#id === undefined && typeof id === "string") {
      this.#id = id;
      const model = own(chunk, "model");
      this.#model = typeof model === "string" ? model : null;
    }
    const usage = own(chunk, "usage");
    if (isJsonObject(usage)) this.#usage = usage;
    const choices = own(chunk, "choices");
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        if (!isJsonObject(choice)) continue;
        const index = own(choice, "index") ?? 0;
        if (index === 0) this.#choice(choice);
      }
    }
    return false;
  }

  #choice(choice: JsonObject): void {
    const delta = own(choice, "delta");
    if (isJsonObject(delta)) {
      const content = own(delta, "content");
      if (typeof content === "string" && content !== "") {
        this.#text += content;
        this.#emit(content);
      }
      const toolCalls = own(delta, "tool_calls");
      if (Array.isArray(toolCalls)) {
        for (const item of toolCalls) {
          if (isJsonObject(item)) this.#toolCall(item);
        }
      }
    }
    const finishReason = own(choice, "finish_reason");
    if (typeof finishReason === "string") {
      this.#finishReason = finishReason;
      this.#done = true;
    }
  }

  #key(item: JsonObject): number {
    const index = own(item, "index");
    if (typeof index === "number") return index;
    const id = nonEmptyString(own(item, "id"));
    if (id !== undefined) return this.#calls.find((call) => call.id === id)?.key ?? this.#calls.length;
    return this.#calls.at(-1)?.key ?? 0;
  }

  #toolCall(item: JsonObject): void {
    const key = this.#key(item);
    let call = this.#calls.find((candidate) => candidate.key === key);
    if (call === undefined) {
      call = { key, id: undefined, name: undefined, args: "" };
      this.#calls.push(call);
    }
    call.id ??= nonEmptyString(own(item, "id"));
    const fn = own(item, "function");
    if (!isJsonObject(fn)) return;
    call.name ??= nonEmptyString(own(fn, "name"));
    const args = own(fn, "arguments");
    if (typeof args === "string") call.args += args;
    else if (isJsonObject(args)) call.args = JSON.stringify(args);
  }

  result(): ModelResult {
    if (!this.#done) throw new ModelError("OpenAI stream ended before [DONE] or a finish_reason", { provider: PROVIDER, code: "network" });
    const content: Part[] = this.#text === "" ? [] : [{ type: "text", text: this.#text }];
    for (const call of [...this.#calls].sort((left, right) => left.key - right.key)) {
      let args: Json;
      if (call.args === "") {
        args = {};
      } else {
        try {
          args = toJson(JSON.parse(call.args));
        } catch (error) {
          if (this.#finishReason === "length") continue;
          throw invalidResponse(PROVIDER, `tool arguments for ${call.name ?? "a tool call"} are not JSON`, error);
        }
      }
      content.push({ type: "tool.call", callId: call.id ?? `call_${call.key}_${randomHex(8)}`, name: call.name ?? "", args });
    }
    const hasCalls = content.some((part) => part.type === "tool.call");
    const finishReason: ModelResult["finishReason"] = this.#finishReason === "length"
      ? "length"
      : hasCalls ? "tool" : this.#finishReason === "stop" ? "stop" : "other";
    const meta: JsonObject = { id: this.#id ?? null, model: this.#model, finishReason: this.#finishReason ?? null };
    const message: Message = { id: newMessageId(), role: "assistant", source: "model", content, meta: { [PROVIDER]: meta } };
    const result: ModelResult = { message, finishReason };
    const usage = this.#usage;
    if (usage !== undefined) {
      const details = own(usage, "prompt_tokens_details");
      const cached = isJsonObject(details) ? count(own(details, "cached_tokens")) : 0;
      result.usage = { input: count(own(usage, "prompt_tokens")) - cached, output: count(own(usage, "completion_tokens")), cacheRead: cached, cacheWrite: 0 };
    }
    return result;
  }
}

/**
 * Creates a model for the OpenAI Chat Completions API or a compatible endpoint.
 * The official URL without an API key is an `authentication` error; other base URLs may be keyless.
 */
export function createOpenAIChatModel(config: OpenAIChatModelConfig): Model {
  validateOpenAIConfig(config);
  const endpoint = resolveEndpoint(PROVIDER, config, config.env ?? processEnv());
  if (endpoint.official && endpoint.apiKey === undefined) {
    throw new ModelError("OpenAI model needs apiKey or OPENAI_API_KEY for the official API", { provider: PROVIDER, code: "authentication" });
  }
  const defaults: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  if (endpoint.apiKey !== undefined) defaults.authorization = `Bearer ${endpoint.apiKey}`;
  const headers = mergeHeaders(defaults, config.headers);
  const settings = settingsFor(config, endpoint.official);
  const url = `${endpoint.baseUrl}/chat/completions`;
  const fetchImpl = config.fetch ?? ((target: string, init: RequestInit) => globalThis.fetch(target, init));
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const idleTimeoutMs = config.idleTimeoutMs;
  return {
    async generate(input, ctx) {
      if (ctx.signal.aborted) throw abortReason(ctx.signal);
      let body: JsonObject;
      try {
        body = await openAIBody(input, settings, ctx.signal);
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
        createAssembler: (emit, requestId) => new OpenAIChatStreamAssembler(emit, requestId),
      });
    },
  };
}
