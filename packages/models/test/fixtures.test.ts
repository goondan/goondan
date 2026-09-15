import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Block, Json, Message, Model, ModelInput, ModelResult, Part, Role, ToolDefinition } from "@goondan/core";
import { describe, expect, it } from "vitest";
import {
  buildAnthropicRequest,
  buildOpenAIChatRequest,
  createAnthropicModel,
  createOpenAIChatModel,
  isModelError,
  type AnthropicModelConfig,
  type OpenAIChatModelConfig,
} from "../src/index.ts";
import { isJsonObject, toJson, type JsonObject } from "../src/json.ts";
import type { FetchFunction } from "../src/options.ts";
import { bytesStream } from "./helpers.ts";

// Runs every shared case in fixtures/models with the steps defined in spec/model-adapters.md (공통 사례).
const ROOT = resolve(import.meta.dirname, "../../../fixtures/models");
type Provider = "anthropic" | "openai";
const PROVIDERS: readonly Provider[] = ["anthropic", "openai"];
const EMPTY_INPUT: ModelInput = { system: [], messages: [], tools: [], options: {} };

type FixtureConfig = AnthropicModelConfig & OpenAIChatModelConfig;

function fail(message: string): never {
  throw new Error(`fixture: ${message}`);
}

function readJsonFile(path: string): JsonObject {
  const value = toJson(JSON.parse(readFileSync(path, "utf8")));
  return isJsonObject(value) ? value : fail(`${path} must hold an object`);
}

function text(value: Json | undefined, name: string): string {
  return typeof value === "string" ? value : fail(`${name} must be a string`);
}

function flag(value: Json | undefined, name: string): boolean {
  return typeof value === "boolean" ? value : fail(`${name} must be a boolean`);
}

function integer(value: Json | undefined, name: string): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fail(`${name} must be an integer`);
}

function object(value: Json | undefined, name: string): JsonObject {
  return isJsonObject(value) ? value : fail(`${name} must be an object`);
}

function list(value: Json | undefined, name: string): Json[] {
  return Array.isArray(value) ? value : fail(`${name} must be an array`);
}

function stringMap(value: Json | undefined, name: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object(value, name))) result[key] = text(item, `${name}.${key}`);
  return result;
}

function readConfig(value: Json | undefined): FixtureConfig {
  const raw = object(value, "config");
  const config: FixtureConfig = { model: text(raw.model, "config.model"), env: {}, maxRetries: 0 };
  for (const [key, item] of Object.entries(raw)) {
    switch (key) {
      case "model":
        break;
      case "apiKey":
        config.apiKey = text(item, key);
        break;
      case "authToken":
        config.authToken = text(item, key);
        break;
      case "baseUrl":
        config.baseUrl = text(item, key);
        break;
      case "maxTokensField":
        config.maxTokensField = text(item, key);
        break;
      case "headers":
        config.headers = stringMap(item, key);
        break;
      case "env":
        config.env = stringMap(item, key);
        break;
      case "options":
        config.options = object(item, key);
        break;
      case "autoCache":
        config.autoCache = flag(item, key);
        break;
      case "streamUsage":
        config.streamUsage = flag(item, key);
        break;
      case "maxRetries":
        config.maxRetries = integer(item, key);
        break;
      case "idleTimeoutMs":
        config.idleTimeoutMs = integer(item, key);
        break;
      case "cacheTtl":
        if (item !== "5m" && item !== "1h") fail("config.cacheTtl must be 5m or 1h");
        config.cacheTtl = item;
        break;
      case "midConversationSystem":
        if (item !== "user" && item !== "system") fail("config.midConversationSystem must be user or system");
        config.midConversationSystem = item;
        break;
      case "systemRole":
        if (item !== "system" && item !== "developer") fail("config.systemRole must be system or developer");
        config.systemRole = item;
        break;
      default:
        fail(`unknown config field ${key}`);
    }
  }
  return config;
}

function readPart(value: Json): Part {
  const raw = object(value, "part");
  switch (raw.type) {
    case "text":
      return { type: "text", text: text(raw.text, "text") };
    case "json":
      return { type: "json", value: raw.value === undefined ? fail("json part needs a value") : raw.value };
    case "image":
      return { type: "image", url: text(raw.url, "url"), mediaType: text(raw.mediaType, "mediaType") };
    case "media":
      return { type: "media", ref: text(raw.ref, "ref"), mediaType: text(raw.mediaType, "mediaType") };
    case "tool.call":
      return { type: "tool.call", callId: text(raw.callId, "callId"), name: text(raw.name, "name"), args: raw.args === undefined ? fail("tool.call needs args") : raw.args };
    case "tool.result": {
      const part: Extract<Part, { type: "tool.result" }> = { type: "tool.result", callId: text(raw.callId, "callId"), content: list(raw.content, "content").map(readPart) };
      if (raw.isError !== undefined) part.isError = flag(raw.isError, "isError");
      return part;
    }
    default:
      return fail(`unknown part type ${String(raw.type)}`);
  }
}

function readRole(value: Json | undefined): Role {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") return value;
  return fail(`unknown role ${String(value)}`);
}

function readMessage(value: Json): Message {
  const raw = object(value, "message");
  const message: Message = { id: text(raw.id, "id"), role: readRole(raw.role), source: text(raw.source, "source"), content: list(raw.content, "content").map(readPart) };
  if (raw.meta !== undefined) message.meta = object(raw.meta, "meta");
  if (raw.key !== undefined) message.key = text(raw.key, "key");
  if (raw.keep !== undefined) message.keep = flag(raw.keep, "keep");
  return message;
}

function readBlock(value: Json): Block {
  const raw = object(value, "system block");
  const block: Block = { text: text(raw.text, "text"), source: text(raw.source, "source") };
  if (raw.cache !== undefined) block.cache = flag(raw.cache, "cache");
  return block;
}

function readTool(value: Json): ToolDefinition {
  const raw = object(value, "tool");
  return { name: text(raw.name, "name"), description: text(raw.description, "description"), input: object(raw.input, "input") };
}

function readInput(value: Json): ModelInput {
  const raw = object(value, "input");
  return {
    system: list(raw.system, "system").map(readBlock),
    messages: list(raw.messages, "messages").map(readMessage),
    tools: list(raw.tools, "tools").map(readTool),
    options: object(raw.options, "options"),
  };
}

function resultWithoutMessageId(result: ModelResult): Json {
  const message = toJson(result.message);
  if (isJsonObject(message)) delete message.id;
  return toJson({ ...result, message });
}

function streamFetch(stream: string, chunkSize: number): FetchFunction {
  return async () => new Response(bytesStream(stream, chunkSize), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function create(provider: Provider, config: FixtureConfig): Model {
  return provider === "anthropic" ? createAnthropicModel(config) : createOpenAIChatModel(config);
}

function build(provider: Provider, input: ModelInput, config: FixtureConfig): Promise<Record<string, Json>> {
  return provider === "anthropic" ? buildAnthropicRequest(input, config) : buildOpenAIChatRequest(input, config);
}

const EXPECTED_FIELDS = new Set(["request", "result", "deltas", "error"]);
const CASE_FIELDS = new Set(["config", "input", "stream", "chunkSize"]);

async function runCase(provider: Provider, directory: string): Promise<void> {
  const fixture = readJsonFile(join(directory, "case.json"));
  const expected = readJsonFile(join(directory, "expected.json"));
  for (const key of Object.keys(fixture)) if (!CASE_FIELDS.has(key)) fail(`unknown case.json field ${key}`);
  for (const key of Object.keys(expected)) if (!EXPECTED_FIELDS.has(key)) fail(`unknown expected.json field ${key}`);
  const config = readConfig(fixture.config);
  const input = fixture.input === undefined ? undefined : readInput(fixture.input);
  const stream = fixture.stream === undefined ? undefined : text(fixture.stream, "stream");
  const chunkSize = fixture.chunkSize === undefined ? 7 : integer(fixture.chunkSize, "chunkSize");
  const expectedCode = expected.error === undefined ? undefined : text(object(expected.error, "error").code, "error.code");
  let failed = false;
  const compareFailure = (error: unknown): void => {
    if (expectedCode === undefined || !isModelError(error)) throw error;
    expect(error.code).toBe(expectedCode);
    failed = true;
  };

  let model: Model;
  try {
    model = create(provider, { ...config, fetch: streamFetch(stream ?? "", chunkSize) });
  } catch (error) {
    compareFailure(error);
    return;
  }

  if (input !== undefined) {
    try {
      const request = toJson(await build(provider, input, config));
      if (expected.request !== undefined) expect(request).toStrictEqual(expected.request);
    } catch (error) {
      if (stream !== undefined) throw error;
      compareFailure(error);
    }
  }

  if (stream !== undefined) {
    const deltas: string[] = [];
    const ctx = { agent: "main", conversationId: "fixture", turnId: "turn", step: 1, signal: new AbortController().signal, onTextDelta: (delta: string) => deltas.push(delta) };
    try {
      const result = await model.generate(input ?? EMPTY_INPUT, ctx);
      if (expected.result !== undefined) expect(resultWithoutMessageId(result)).toStrictEqual(expected.result);
      if (expected.deltas !== undefined) expect(deltas).toStrictEqual(expected.deltas);
    } catch (error) {
      compareFailure(error);
    }
  }

  if (expectedCode !== undefined) expect(failed, `expected error ${expectedCode}`).toBe(true);
}

for (const provider of PROVIDERS) {
  const providerRoot = join(ROOT, provider);
  const cases = readdirSync(providerRoot).filter((name) => statSync(join(providerRoot, name)).isDirectory()).sort();
  describe(`fixtures/models/${provider}`, () => {
    it("has cases", () => {
      expect(cases.length).toBeGreaterThan(0);
    });
    for (const name of cases) {
      it(name, async () => {
        await runCase(provider, join(providerRoot, name));
      });
    }
  });
}
