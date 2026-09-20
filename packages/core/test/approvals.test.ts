import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createGoondan, defineExtension, MemoryConversationStore, MemoryOperationStore,
  type ApprovalRequest, type Json, type Message, type Model, type ModelResult,
  type OperationCompletion, type PendingOperation, type RuntimeEvent, type RuntimeHost, type Tool,
} from "../src/index.ts";

/** The execution error a refused request throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[]; message: string } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes, message: detail.message } : undefined;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => { resolve = () => { settle(); }; });
  return { promise, resolve };
}

function assistant(text: string, id = "a"): Message {
  return { id, role: "assistant", source: "model", content: [{ type: "text", text }] };
}

function callMessage(callId: string, name: string, args: Json = null): Message {
  return { id: `m-${callId}`, role: "assistant", source: "model", content: [{ type: "tool.call", callId, name, args }] };
}

/** A model that answers with the next scripted reply; every further call repeats the last one. */
function scripted(replies: ModelResult[]): Model & { count: number } {
  const model = {
    count: 0,
    async generate(): Promise<ModelResult> {
      const reply = replies[model.count] ?? replies[replies.length - 1];
      model.count += 1;
      if (!reply) throw new Error("no scripted reply");
      return reply;
    },
  };
  return model;
}

function tool(name: string, run: (input: Json) => Json = () => "done"): Tool {
  return {
    name, description: name, input: { type: "object" },
    execute: (input, ctx) => ({ callId: ctx.toolCall.id, name: ctx.toolCall.name, args: input, content: [{ type: "json", value: run(input) }] }),
  };
}

const requesting = { agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }] } } };

/** A runtime whose first model answer asks for an approved tool and whose later answers are plain. */
function approvalRuntime(options: { host?: RuntimeHost; operationStore?: MemoryOperationStore; act?: Tool; args?: Json } = {}): ReturnType<typeof createGoondan> {
  const model = scripted([
    { message: callMessage("c1", "act", options.args ?? { target: { id: 1, env: "prod" }, tags: ["a"], note: "x" }), finishReason: "tool" },
    { message: assistant("waiting"), finishReason: "stop" },
  ]);
  const bindings = {
    directory: ".", models: { m: model }, tools: { act: options.act ?? tool("act") },
    operationStore: options.operationStore ?? new MemoryOperationStore(),
    host: options.host,
  };
  return createGoondan(requesting, bindings);
}

async function only(runtime: ReturnType<typeof createGoondan>, sessionId = "c"): Promise<PendingOperation> {
  const [operation] = await runtime.listOperations(sessionId);
  if (!operation) throw new Error("expected one operation");
  return operation;
}

describe("creating an approval operation", () => {
  it("stores only the fields the record declares, with millisecond timestamps", async () => {
    const before = Date.now();
    const runtime = approvalRuntime();

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    expect(Object.keys(operation)).toEqual([
      "operationId", "deliveryId", "agent", "sessionId", "turnId", "toolCall",
      "reasons", "status", "deliveryStatus", "createdAt", "updatedAt",
    ]);
    expect(operation.deliveryId).toBe(`operation:${operation.operationId}:completion`);
    expect(operation.reasons).toEqual(["Tool act requires approval"]);
    expect(operation.status).toBe("pending");
    expect(operation.deliveryStatus).toBe("pending");
    expect(operation.createdAt).toBeGreaterThanOrEqual(before);
    expect(operation.createdAt).toBeLessThanOrEqual(Date.now());
    expect(operation.updatedAt).toBe(operation.createdAt);
    await runtime.close();
  });

  it("gives every call its own operation even when the model reuses a call identifier", async () => {
    const model = scripted([
      { message: { id: "a", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "same", name: "act", args: null }, { type: "tool.call", callId: "same", name: "act", args: null }] }, finishReason: "tool" },
      { message: assistant("waiting"), finishReason: "stop" },
    ]);
    const runtime = createGoondan(requesting, { directory: ".", models: { m: model }, tools: { act: tool("act") } });

    await runtime.run("go", { sessionId: "c" });
    const operations = await runtime.listOperations("c");

    expect(operations).toHaveLength(2);
    expect(operations[0]?.operationId).not.toBe(operations[1]?.operationId);
    await runtime.close();
  });

  it("stores the pending tool result without running the toolResult stage", async () => {
    const store = new MemoryConversationStore();
    const calls: Json[] = [];
    const watcher = defineExtension({ name: "watch", hooks: ["toolResult"], create: () => ({ hooks: { toolResult: (value) => { calls.push(value); return value; } } }) });
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("waiting"), finishReason: "stop" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], extensions: { watch: {} }, hooks: { toolResult: [{ extension: "watch" }] } } },
    }, { directory: ".", models: { m: model }, tools: { act: tool("act") }, extensions: { watch: watcher }, conversationStore: store });

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    expect(calls).toEqual([]);
    const stored = await store.load("c", "main");
    const placeholder = stored.find((message) => message.role === "tool");
    expect(placeholder?.content).toEqual([{ type: "tool.result", callId: "c1", content: [{ type: "json", value: { status: "pending", operationId: operation.operationId } }] }]);
    expect(placeholder?.meta).toEqual({ status: "pending", operationId: operation.operationId });
    expect(Object.keys(placeholder?.meta ?? {})).toEqual(["status", "operationId"]);
    await runtime.close();
  });

  it("announces the operation and asks the host to decide it", async () => {
    const requests: ApprovalRequest[] = [];
    const events: RuntimeEvent[] = [];
    const runtime = approvalRuntime({ host: { requestApproval: (request) => { requests.push(request); }, emit: (event) => { events.push(event); } } });

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    expect(requests).toEqual([{
      operationId: operation.operationId, sessionId: "c", turnId: operation.turnId,
      agent: "main", toolCall: operation.toolCall, reasons: ["Tool act requires approval"],
    }]);
    const created = events.find((event) => event.name === "humanApproval.created");
    expect(created?.data).toEqual({ operationId: operation.operationId, tool: "act", callId: "c1", reasons: ["Tool act requires approval"] });
    await runtime.close();
  });

  it("keeps the context the host captured", async () => {
    const runtime = approvalRuntime({ host: { captureOperationContext: (request) => ({ caller: request.agent }) } });

    await runtime.run("go", { sessionId: "c" });

    expect((await only(runtime)).context).toEqual({ caller: "main" });
    await runtime.close();
  });

  it("stores nothing when the context capture fails", async () => {
    const store = new MemoryConversationStore();
    const runtime = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]) },
      tools: { act: tool("act") }, conversationStore: store,
      host: { captureOperationContext: () => { throw new Error("no context"); } },
    });

    const error: unknown = await runtime.run("go", { sessionId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)).toMatchObject({ where: "tool", codes: ["runtime_error"], message: "no context" });
    expect(await runtime.listOperations("c")).toEqual([]);
    expect((await store.load("c", "main")).some((message) => message.role === "tool")).toBe(false);
    await runtime.close();
  });

  it("treats a captured context that is not a JSON object as a failed capture", async () => {
    const runtime = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]) },
      tools: { act: tool("act") },
      host: { captureOperationContext: () => { const value: Record<string, Json> = JSON.parse('"text"'); return value; } },
    });

    const error: unknown = await runtime.run("go", { sessionId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.codes).toEqual(["runtime_error"]);
    expect(await runtime.listOperations("c")).toEqual([]);
    await runtime.close();
  });

  it("leaves the operation pending when the approval request fails", async () => {
    const store = new MemoryConversationStore();
    const runtime = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }]) },
      tools: { act: tool("act") }, conversationStore: store,
      host: { requestApproval: () => { throw new Error("no channel"); } },
    });

    const error: unknown = await runtime.run("go", { sessionId: "c" }).catch((thrown: unknown) => thrown);

    expect(failure(error)).toMatchObject({ where: "tool", codes: ["runtime_error"], message: "no channel" });
    expect((await only(runtime)).status).toBe("pending");
    expect((await store.load("c", "main")).some((message) => message.role === "tool")).toBe(true);
    await runtime.close();
  });
});

describe("deciding an operation", () => {
  it("refuses an unknown operation and a decision value it cannot read", async () => {
    const runtime = approvalRuntime();
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    const unknown: unknown = await runtime.decideOperation("c", "missing", { decision: "approved" }).catch((error: unknown) => error);
    const bad: unknown = await runtime.decideOperation("c", operation.operationId, JSON.parse('{"decision":"maybe"}')).catch((error: unknown) => error);

    expect(failure(unknown)?.where).toBe("runtime");
    expect(failure(unknown)?.codes).toEqual(["operation_invalid"]);
    expect(failure(bad)?.codes).toEqual(["operation_invalid"]);
    expect((await only(runtime)).status).toBe("pending");
    await runtime.close();
  });

  it("returns the stored operation unchanged when it is no longer pending", async () => {
    const runtime = approvalRuntime();
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    await runtime.cancelOperation("c", operation.operationId);
    const again = await runtime.decideOperation("c", operation.operationId, { decision: "approved" });

    expect(again.status).toBe("cancelled");
    await runtime.close();
  });

  it("merges an input patch into the arguments the way values merge", async () => {
    const seen: Json[] = [];
    const act = tool("act", (input) => { seen.push(input); return "done"; });
    const runtime = approvalRuntime({ act, host: { validateOperationInputPatch: () => true } });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    const decided = await runtime.decideOperation("c", operation.operationId, { decision: "approved", inputPatch: { target: { env: "staging" }, tags: ["b"] } });
    await runtime.idle();

    expect(decided.inputPatch).toEqual({ target: { env: "staging" }, tags: ["b"] });
    expect(decided.resolvedToolCall).toEqual({ id: "c1", name: "act", args: { target: { id: 1, env: "staging" }, tags: ["b"], note: "x" } });
    expect(seen).toEqual([{ target: { id: 1, env: "staging" }, tags: ["b"], note: "x" }]);
    await runtime.close();
  });

  it("refuses an input patch the host cannot allow", async () => {
    const runtime = approvalRuntime();
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    const error: unknown = await runtime.decideOperation("c", operation.operationId, { decision: "approved", inputPatch: { note: "y" } }).catch((thrown: unknown) => thrown);

    expect(failure(error)?.codes).toEqual(["operation_invalid"]);
    expect((await only(runtime)).status).toBe("pending");
    await runtime.close();
  });

  it("refuses an input patch on a rejection and one the validation refuses", async () => {
    const runtime = approvalRuntime({ host: { validateOperationInputPatch: () => false } });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    const rejected: unknown = await runtime.decideOperation("c", operation.operationId, { decision: "rejected", inputPatch: { note: "y" } }).catch((error: unknown) => error);
    const refused: unknown = await runtime.decideOperation("c", operation.operationId, { decision: "approved", inputPatch: { note: "y" } }).catch((error: unknown) => error);

    expect(failure(rejected)?.codes).toEqual(["operation_invalid"]);
    expect(failure(refused)?.codes).toEqual(["operation_invalid"]);
    await runtime.close();
  });

  it("returns as soon as the decision is recorded", async () => {
    const reached = deferred();
    const release = deferred();
    const slow: Tool = {
      name: "act", description: "act", input: {},
      execute: async (_input, ctx) => { reached.resolve(); await release.promise; return { callId: ctx.toolCall.id, name: "act", args: null, content: [] }; },
    };
    const runtime = approvalRuntime({ act: slow });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    const decided = await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await reached.promise;

    expect(decided.status).toBe("approved");
    expect((await only(runtime)).status).toBe("running");
    release.resolve();
    await runtime.idle();
    await runtime.close();
  });
});

describe("cancelling an operation", () => {
  it("cancels a pending operation and delivers the completion", async () => {
    const completions: OperationCompletion[] = [];
    const runtime = approvalRuntime({ host: { deliverOperationCompletion: (completion) => { completions.push(completion); } } });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    const cancelled = await runtime.cancelOperation("c", operation.operationId);
    await runtime.idle();

    expect(cancelled.status).toBe("cancelled");
    expect(Object.keys(completions[0] ?? {})).toEqual(["type", "deliveryId", "operationId", "sessionId", "agent", "status", "toolCall"]);
    expect((await only(runtime)).deliveryStatus).toBe("delivered");
    await runtime.close();
  });

  it("leaves a running operation alone", async () => {
    const reached = deferred();
    const release = deferred();
    const slow: Tool = {
      name: "act", description: "act", input: {},
      execute: async (_input, ctx) => { reached.resolve(); await release.promise; return { callId: ctx.toolCall.id, name: "act", args: null, content: [] }; },
    };
    const runtime = approvalRuntime({ act: slow });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await reached.promise;

    const attempt = await runtime.cancelOperation("c", operation.operationId);

    expect(attempt.status).toBe("running");
    release.resolve();
    await runtime.idle();
    expect((await only(runtime)).status).toBe("completed");
    await runtime.close();
  });

  it("refuses an operation it cannot find", async () => {
    const runtime = approvalRuntime();
    const error: unknown = await runtime.cancelOperation("c", "missing").catch((thrown: unknown) => thrown);
    expect(failure(error)?.codes).toEqual(["operation_invalid"]);
    await runtime.close();
  });
});

describe("running an approved operation", () => {
  it("uses a fresh extension instance for a stateless operation execution", async () => {
    let created = 0; let disposed = 0;
    const probe = defineExtension({ name: "probe", create: () => {
      created += 1;
      return { dispose: () => { disposed += 1; } };
    } });
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("waiting"), finishReason: "stop" }]);
    const runtime = createGoondan({ agents: {
      main: { model: "m", stateful: false, tools: [{ tool: "act", approval: "required" }], extensions: { probe: {} } },
    } }, {
      models: { m: model }, tools: { act: tool("act") }, extensions: { probe },
      host: { deliverOperationCompletion: () => undefined },
    });

    await runtime.run("go", { sessionId: "c" });
    expect({ created, disposed }).toEqual({ created: 1, disposed: 1 });
    const operation = await only(runtime);
    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    expect({ created, disposed }).toEqual({ created: 2, disposed: 2 });
    await runtime.close();
  });

  it("fails the validation of a call the agent no longer exposes, before any tool event", async () => {
    const operations = new MemoryOperationStore();
    const events: RuntimeEvent[] = [];
    const first = approvalRuntime({ operationStore: operations });
    await first.run("go", { sessionId: "c" });
    const operation = await only(first);
    await first.close();

    const later = createGoondan({ agents: { main: { model: "m" } } }, {
      directory: ".", models: { m: scripted([{ message: assistant("hi"), finishReason: "stop" }]) },
      operationStore: operations, host: { emit: (event) => { events.push(event); } },
    });
    await later.decideOperation("c", operation.operationId, { decision: "approved" });
    await later.idle();

    const failed = await only(later);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("validation_failed");
    expect(failed.error).toBe("Tool act is not available to main");
    expect(events.filter((event) => event.name.startsWith("tool."))).toEqual([]);
    await later.close();
  });

  it("fails the validation when the host refuses the operation or its validation throws", async () => {
    const refusing = approvalRuntime({ host: { validateOperation: () => false } });
    await refusing.run("go", { sessionId: "c" });
    const refused = await only(refusing);
    await refusing.decideOperation("c", refused.operationId, { decision: "approved" });
    await refusing.idle();
    expect(await only(refusing)).toMatchObject({ status: "failed", errorCode: "validation_failed", error: "Operation validation failed" });
    await refusing.close();

    const throwing = approvalRuntime({ host: { validateOperation: () => { throw new Error("policy says no"); } } });
    await throwing.run("go", { sessionId: "c" });
    const thrown = await only(throwing);
    await throwing.decideOperation("c", thrown.operationId, { decision: "approved" });
    await throwing.idle();
    expect(await only(throwing)).toMatchObject({ status: "failed", errorCode: "validation_failed", error: "policy says no" });
    await throwing.close();
  });

  it("gives the tool the operation input, turn and execution, and announces the patched call", async () => {
    const seen: { input: Json; turnId: string; execution: Record<string, Json>; conversation: number }[] = [];
    const act: Tool = {
      name: "act", description: "act", input: {},
      execute: (_input, ctx) => {
        seen.push({ input: ctx.input, turnId: ctx.turnId, execution: ctx.execution, conversation: ctx.conversation.length });
        return { callId: ctx.toolCall.id, name: "act", args: ctx.toolCall.args, content: [{ type: "text", text: "ran" }] };
      },
    };
    const events: RuntimeEvent[] = [];
    const attach = defineExtension({
      name: "attach", hooks: ["toolCall"],
      create: () => ({ hooks: { toolCall: (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? { call: value, execution: { ticket: "T-1" } } : value) } }),
    });
    const model = scripted([
      { message: callMessage("c1", "act", { note: "x" }), finishReason: "tool" },
      { message: assistant("waiting"), finishReason: "stop" },
    ]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], extensions: { attach: {} }, hooks: { toolCall: [{ extension: "attach" }] } } },
    }, {
      directory: ".", models: { m: model }, tools: { act }, extensions: { attach },
      host: { emit: (event) => { events.push(event); }, validateOperationInputPatch: () => true, deliverOperationCompletion: () => undefined },
    });

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.decideOperation("c", operation.operationId, { decision: "approved", inputPatch: { note: "patched" } });
    await runtime.idle();

    // The conversation is the agent's stored one: the input, the call, the pending result and the answer.
    expect(seen).toEqual([{ input: { type: "operation_execution", operationId: operation.operationId }, turnId: operation.turnId, execution: { ticket: "T-1" }, conversation: 4 }]);
    const started = events.filter((event) => event.name === "tool.start").at(-1);
    expect(started?.data).toMatchObject({ tool: "act", callId: "c1", args: { note: "patched" }, operationId: operation.operationId });
    expect(events.filter((event) => event.name.startsWith("turn.")).map((event) => event.name)).toEqual(["turn.start", "turn.done"]);
    await runtime.close();
  });

  it("applies the toolResult stage and records the result of a completed operation", async () => {
    const shout = defineExtension({
      name: "shout", hooks: ["toolResult"],
      create: () => ({ hooks: { toolResult: (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, content: [{ type: "text", text: "LOUD" }] } : value) } }),
    });
    const model = scripted([{ message: callMessage("c1", "act"), finishReason: "tool" }, { message: assistant("waiting"), finishReason: "stop" }]);
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], extensions: { shout: {} }, hooks: { toolResult: [{ extension: "shout" }] } } },
    }, { directory: ".", models: { m: model }, tools: { act: tool("act") }, extensions: { shout }, host: { deliverOperationCompletion: () => undefined } });

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    const settled = await only(runtime);
    expect(settled.status).toBe("completed");
    expect(settled.result?.content).toEqual([{ type: "text", text: "LOUD" }]);
    await runtime.close();
  });

  it("records a failing tool as an execution failure", async () => {
    const broken: Tool = { name: "act", description: "act", input: {}, execute: () => { throw new Error("tool broke"); } };
    const events: RuntimeEvent[] = [];
    const runtime = approvalRuntime({ act: broken, host: { deliverOperationCompletion: () => undefined, emit: (event) => { events.push(event); } } });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    expect(await only(runtime)).toMatchObject({ status: "failed", errorCode: "execution_failed", error: "tool broke" });
    expect(events.filter((event) => event.name === "tool.error").at(-1)?.data).toMatchObject({ operationId: operation.operationId, codes: ["tool_error"] });
    await runtime.close();
  });
});

describe("delivering a completion", () => {
  it("gives the host the completion input of a completed operation", async () => {
    const completions: OperationCompletion[] = [];
    const runtime = approvalRuntime({ host: { deliverOperationCompletion: (completion) => { completions.push(completion); } } });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    const [completion] = completions;
    expect(Object.keys(completion ?? {})).toEqual(["type", "deliveryId", "operationId", "sessionId", "agent", "status", "toolCall", "result"]);
    expect(completion?.deliveryId).toBe(operation.deliveryId);
    expect(completion?.status).toBe("completed");
    expect((await only(runtime)).deliveryStatus).toBe("delivered");
    expect((await only(runtime)).deliveredAt).toBeGreaterThan(0);
    await runtime.close();
  });

  it("runs the operation's agent once when the host delivers no completion", async () => {
    const inputs: Message[] = [];
    let call = 0;
    const model: Model = {
      async generate(input): Promise<ModelResult> {
        call += 1;
        const last = input.messages.at(-1);
        if (last) inputs.push(last);
        if (call === 1) return { message: callMessage("c1", "act"), finishReason: "tool" };
        return { message: assistant("acknowledged"), finishReason: "stop" };
      },
    };
    const runtime = createGoondan(requesting, { directory: ".", models: { m: model }, tools: { act: tool("act") } });

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    const delivered = inputs.at(-1);
    const text = delivered?.content[0];
    expect(delivered?.role).toBe("user");
    expect(text?.type === "text" && text.text.startsWith(`{"type":"operation_completion","deliveryId":"${operation.deliveryId}"`)).toBe(true);
    expect((await only(runtime)).deliveryStatus).toBe("delivered");
    await runtime.close();
  });

  it("builds the user message of a delivered turn with the agent's own input rule", async () => {
    const inputs: Message[] = [];
    let call = 0;
    const model: Model = {
      async generate(input): Promise<ModelResult> {
        call += 1;
        const last = input.messages.at(-1);
        if (last) inputs.push(last);
        if (call === 1) return { message: callMessage("c1", "act"), finishReason: "tool" };
        return { message: assistant("acknowledged"), finishReason: "stop" };
      },
    };
    const label = (value: Json): string =>
      typeof value === "object" && value !== null && !Array.isArray(value) ? `finished as ${String(value.status)}` : "?";
    const runtime = createGoondan({
      agents: { main: { model: "m", tools: [{ tool: "act", approval: "required" }], input: { fn: "label" } } },
    }, { directory: ".", models: { m: model }, tools: { act: tool("act") }, functions: { label } });

    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.cancelOperation("c", operation.operationId);
    await runtime.idle();

    const delivered = inputs.at(-1)?.content[0];
    expect(delivered?.type === "text" ? delivered.text : "").toBe("finished as cancelled");
    expect((await only(runtime)).deliveryStatus).toBe("delivered");
    await runtime.close();
  });

  it("puts a failed delivery back to pending without touching the outcome", async () => {
    let attempts = 0;
    const runtime = approvalRuntime({
      host: {
        deliverOperationCompletion: () => { attempts += 1; if (attempts === 1) throw new Error("channel down"); },
      },
    });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);

    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await runtime.idle();

    const stalled = await only(runtime);
    expect(stalled.status).toBe("completed");
    expect(stalled.deliveryStatus).toBe("pending");
    expect(stalled.error).toBeUndefined();

    // Only recovery tries the delivery again.
    await runtime.recoverOperations("c");
    await runtime.idle();
    expect((await only(runtime)).deliveryStatus).toBe("delivered");
    expect(attempts).toBe(2);
    await runtime.close();
  });
});

describe("recovering operations", () => {
  it("asks for a pending decision again without capturing the context again", async () => {
    const operations = new MemoryOperationStore();
    const first = approvalRuntime({ operationStore: operations, host: { captureOperationContext: () => ({ round: 1 }) } });
    await first.run("go", { sessionId: "c" });
    const operation = await only(first);
    await first.close();

    const requests: ApprovalRequest[] = [];
    let captures = 0;
    const later = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: assistant("hi"), finishReason: "stop" }]) }, tools: { act: tool("act") },
      operationStore: operations,
      host: { requestApproval: (request) => { requests.push(request); }, captureOperationContext: () => { captures += 1; return {}; } },
    });

    await later.recoverOperations("c");

    expect(requests.map((request) => request.operationId)).toEqual([operation.operationId]);
    expect(captures).toBe(0);
    expect((await only(later)).context).toEqual({ round: 1 });
    await later.close();
  });

  it("marks an interrupted execution as failed and delivers it", async () => {
    const operations = new MemoryOperationStore();
    const release = deferred();
    const reached = deferred();
    const slow: Tool = {
      name: "act", description: "act", input: {},
      execute: async (_input, ctx) => { reached.resolve(); await release.promise; return { callId: ctx.toolCall.id, name: "act", args: null, content: [] }; },
    };
    const first = approvalRuntime({ operationStore: operations, act: slow });
    await first.run("go", { sessionId: "c" });
    const operation = await only(first);
    await first.decideOperation("c", operation.operationId, { decision: "approved" });
    await reached.promise;
    await first.close();
    release.resolve();

    const completions: OperationCompletion[] = [];
    const later = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: assistant("hi"), finishReason: "stop" }]) }, tools: { act: tool("act") },
      operationStore: operations, host: { deliverOperationCompletion: (completion) => { completions.push(completion); } },
    });
    await later.recoverOperations();
    await later.idle();

    expect(await only(later)).toMatchObject({
      status: "failed", errorCode: "execution_interrupted",
      error: "Operation execution outcome is unknown because the runtime stopped", deliveryStatus: "delivered",
    });
    expect(completions[0]?.errorCode).toBe("execution_interrupted");
    await later.close();
  });

  it("takes back a delivery that was left in flight and skips one that finished", async () => {
    const operations = new MemoryOperationStore();
    const now = Date.now();
    const base: PendingOperation = {
      operationId: "op-1", deliveryId: "operation:op-1:completion", agent: "main", sessionId: "c", turnId: "t",
      toolCall: { id: "c1", name: "act", args: null }, reasons: ["Tool act requires approval"],
      status: "completed", deliveryStatus: "delivering", createdAt: now, updatedAt: now,
    };
    await operations.save(base);
    await operations.save({ ...base, operationId: "op-2", deliveryId: "operation:op-2:completion", deliveryStatus: "delivered", deliveredAt: now });

    const completions: OperationCompletion[] = [];
    const runtime = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: assistant("hi"), finishReason: "stop" }]) }, tools: { act: tool("act") },
      operationStore: operations, host: { deliverOperationCompletion: (completion) => { completions.push(completion); } },
    });

    await runtime.recoverOperations();
    await runtime.idle();

    expect(completions.map((completion) => completion.operationId)).toEqual(["op-1"]);
    await runtime.close();
  });

  it("processes every operation and then reports the first failed approval request", async () => {
    const operations = new MemoryOperationStore();
    const now = Date.now();
    const pending: PendingOperation = {
      operationId: "op-1", deliveryId: "operation:op-1:completion", agent: "main", sessionId: "c", turnId: "t",
      toolCall: { id: "c1", name: "act", args: null }, reasons: ["Tool act requires approval"],
      status: "pending", deliveryStatus: "pending", createdAt: now, updatedAt: now,
    };
    await operations.save(pending);
    await operations.save({ ...pending, operationId: "op-2", deliveryId: "operation:op-2:completion", status: "completed" });

    const completions: OperationCompletion[] = [];
    const runtime = createGoondan(requesting, {
      directory: ".", models: { m: scripted([{ message: assistant("hi"), finishReason: "stop" }]) }, tools: { act: tool("act") },
      operationStore: operations,
      host: {
        requestApproval: () => { throw new Error("no channel"); },
        deliverOperationCompletion: (completion) => { completions.push(completion); },
      },
    });

    const error: unknown = await runtime.recoverOperations().catch((thrown: unknown) => thrown);
    await runtime.idle();

    expect(error).toBeInstanceOf(Error);
    expect(completions.map((completion) => completion.operationId)).toEqual(["op-2"]);
    await runtime.close();
  });
});

describe("a closed runtime", () => {
  it("refuses a decision, a cancellation and a recovery but still lists operations", async () => {
    const runtime = approvalRuntime();
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.close();

    const decided: unknown = await runtime.decideOperation("c", operation.operationId, { decision: "approved" }).catch((error: unknown) => error);
    const cancelled: unknown = await runtime.cancelOperation("c", operation.operationId).catch((error: unknown) => error);
    const recovered: unknown = await runtime.recoverOperations().catch((error: unknown) => error);

    for (const error of [decided, cancelled, recovered]) {
      expect(failure(error)?.where).toBe("runtime");
      expect(failure(error)?.codes).toEqual(["runtime_error"]);
    }
    expect(await runtime.listOperations("c")).toHaveLength(1);
  });

  it("leaves a running operation as it is when the runtime closes", async () => {
    const reached = deferred();
    const release = deferred();
    let aborted = false;
    const slow: Tool = {
      name: "act", description: "act", input: {},
      execute: async (_input, ctx) => {
        reached.resolve();
        await release.promise;
        aborted = ctx.signal.aborted;
        return { callId: ctx.toolCall.id, name: "act", args: null, content: [] };
      },
    };
    const operations = new MemoryOperationStore();
    const runtime = approvalRuntime({ act: slow, operationStore: operations });
    await runtime.run("go", { sessionId: "c" });
    const operation = await only(runtime);
    await runtime.decideOperation("c", operation.operationId, { decision: "approved" });
    await reached.promise;

    await runtime.close();
    release.resolve();
    await runtime.idle();

    // The tool was told to stop and nothing it produced afterwards reached the store.
    expect(aborted).toBe(true);
    expect((await operations.get("c", operation.operationId))?.status).toBe("running");
  });
});
