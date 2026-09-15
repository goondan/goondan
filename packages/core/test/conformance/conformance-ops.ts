/**
 * The closed operation library used by scripted functions, extension hooks,
 * option validators and host callbacks.
 *
 * See fixtures/conformance/README.md ("연산").
 */

import type { AppendMessageScript, Op } from "./conformance-case.ts";
import type { GateRegistry } from "./conformance-gates.ts";
import {
  type Json,
  type JsonObject,
  isJsonArray,
  isJsonObject,
  isString,
  jsonEquals,
  mergeJson,
  pointerGet,
  pointerSet,
  snapshot,
} from "./conformance-json.ts";

/** An error a case script raised on purpose. */
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptError";
  }
}

export interface MessageExtraScript {
  key?: string;
  keep?: boolean;
  meta?: JsonObject;
}

/** The hook-context members the extension hook operations use. */
export interface HookOpBridge {
  messageUser(text: string, extra: MessageExtraScript | undefined): unknown;
  messageSystem(text: string, extra: MessageExtraScript | undefined): unknown;
  append(messages: unknown[]): unknown;
  runAgent(name: string, input: unknown): Promise<unknown>;
  runModel(messages: unknown): Promise<unknown>;
  render(template: string, variables: JsonObject): Promise<string>;
  complete(message: unknown): void;
}

export interface OpContext {
  gates: GateRegistry;
  /** Case-wide call counts, keyed by the site of a `sequence` operation. */
  counters: Map<string, number>;
  owner: unknown;
  signal?: AbortSignal;
  hook?: HookOpBridge;
}

function textOf(value: Json): string {
  if (isString(value)) return value;
  if (isJsonObject(value)) {
    const content = value["content"];
    if (isJsonArray(content)) {
      return content
        .map((part) => {
          if (!isJsonObject(part) || part["type"] !== "text") return "";
          const text = part["text"];
          return isString(text) ? text : "";
        })
        .join("");
    }
  }
  throw new ScriptError("text operation needs a string or a value with a content array");
}

function extrasOf(message: AppendMessageScript): MessageExtraScript | undefined {
  const extra: MessageExtraScript = {};
  let used = false;
  if (message.key !== undefined) {
    extra.key = message.key;
    used = true;
  }
  if (message.keep !== undefined) {
    extra.keep = message.keep;
    used = true;
  }
  if (message.meta !== undefined) {
    extra.meta = message.meta;
    used = true;
  }
  return used ? extra : undefined;
}

function requireHook(ctx: OpContext, op: string): HookOpBridge {
  const hook = ctx.hook;
  if (!hook) throw new ScriptError(`operation ${op} needs a hook context`);
  return hook;
}

export async function runOp(op: Op, received: unknown, ctx: OpContext): Promise<unknown> {
  const value = snapshot(received);
  switch (op.op) {
    case "identity":
      return value;
    case "constant":
      return op.value;
    case "get": {
      const found = pointerGet(value, op.path);
      return found.found ? found.value : null;
    }
    case "set":
      return pointerSet(value, op.path, op.value);
    case "merge": {
      if (!isJsonObject(value)) throw new ScriptError("merge operation needs an object");
      return mergeJson(value, op.value);
    }
    case "wrap": {
      const wrapped: JsonObject = { [op.key]: value };
      if (op.with) for (const [key, extra] of Object.entries(op.with)) wrapped[key] = extra;
      return wrapped;
    }
    case "equals": {
      if (op.path === undefined) return jsonEquals(value, op.value);
      const found = pointerGet(value, op.path);
      return jsonEquals(found.found ? found.value : null, op.value);
    }
    case "text":
      return textOf(value);
    case "textSuffix":
      return textOf(value) + op.suffix;
    case "result": {
      if (!isJsonObject(value)) throw new ScriptError("result operation needs a tool call");
      const id = value["id"];
      const name = value["name"];
      if (!isString(id) || !isString(name)) throw new ScriptError("result operation needs a tool call with id and name");
      const result: JsonObject = { callId: id, name, args: value["args"] ?? null, content: op.content };
      if (op.isError !== undefined) result["isError"] = op.isError;
      return { result };
    }
    case "sequence": {
      const count = ctx.counters.get(op.site) ?? 0;
      ctx.counters.set(op.site, count + 1);
      const item = op.items[Math.min(count, op.items.length - 1)];
      if (item === undefined) throw new ScriptError("sequence operation has no items");
      return runOp(item, received, ctx);
    }
    case "chain": {
      let current: unknown = received;
      for (const step of op.ops) current = await runOp(step, current, ctx);
      return current;
    }
    case "throw":
      throw new ScriptError(op.message);
    case "await": {
      await ctx.gates.wait(op.gate, { owner: ctx.owner, signal: ctx.signal });
      return op.then ? runOp(op.then, received, ctx) : value;
    }
    case "nonJson":
      return Number.NaN;
    case "append": {
      const hook = requireHook(ctx, "append");
      const messages = op.messages.map((message) =>
        message.role === "user"
          ? hook.messageUser(message.text, extrasOf(message))
          : hook.messageSystem(message.text, extrasOf(message)),
      );
      return hook.append(messages);
    }
    case "runAgent": {
      const hook = requireHook(ctx, "runAgent");
      await hook.runAgent(op.name, op.input === undefined ? received : op.input);
      return null;
    }
    case "runModel": {
      const hook = requireHook(ctx, "runModel");
      await hook.runModel(op.messages);
      return null;
    }
    case "render": {
      const hook = requireHook(ctx, "render");
      return hook.render(op.template, op.variables);
    }
    case "complete": {
      const hook = requireHook(ctx, "complete");
      if (op.tool !== undefined) {
        const name = isJsonObject(value) ? value["name"] : undefined;
        if (name !== op.tool) return null;
      }
      let message: JsonObject = op.message;
      if (op.useResultContent) {
        const content = isJsonObject(value) ? value["content"] : undefined;
        message = { ...op.message, content: content ?? null };
      }
      hook.complete(message);
      return null;
    }
    default:
      throw new ScriptError("unknown operation");
  }
}
