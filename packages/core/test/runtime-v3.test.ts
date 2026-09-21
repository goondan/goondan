import { describe, expect, it } from "vitest";
import {
  createGoondan, defineExtension, fold, MemoryStore,
  type HookContext, type JournalEvent, type Message, type Model, type ModelResponse,
  type RunHandle, type RuntimeEvent, type StoreLease, type Tool, type TurnResult,
} from "../src/index.ts";

async function runResult(run: Promise<RunHandle>): Promise<TurnResult> {
  return (await run).result;
}

function response(text: string): ModelResponse {
  return { message: { role: "assistant", content: [{ type: "text", text }] }, finishReason: "stop" };
}

function text(message: Message | undefined): string | undefined {
  return message?.content.map((part) => part.type === "text" ? part.text : "").join("");
}

async function journal(store: MemoryStore, sessionId: string): Promise<JournalEvent[]> {
  const events: JournalEvent[] = [];
  for await (const event of store.scan({ sessionId })) events.push(event);
  return events;
}

class ExpiringStore extends MemoryStore {
  readonly ttl: number;
  rejectRenewal = false;
  #renewalWaiters: Array<() => void> = [];

  constructor(ttl: number) {
    super();
    this.ttl = ttl;
  }

  nextRenewal(): Promise<void> {
    return new Promise<void>((resolve) => { this.#renewalWaiters.push(resolve); });
  }

  override async acquireLease(sessionId: string, owner: string): Promise<StoreLease | null> {
    const underlying = await super.acquireLease(sessionId, owner);
    if (!underlying) return null;
    const lease: StoreLease = {
      token: underlying.token,
      expiresAt: Date.now() + this.ttl,
      renew: async () => {
        const waiter = this.#renewalWaiters.shift();
        waiter?.();
        if (this.rejectRenewal || !await underlying.renew()) return false;
        lease.expiresAt = Date.now() + this.ttl;
        return true;
      },
      release: () => underlying.release(),
    };
    return lease;
  }
}

describe("v3 runtime", () => {
  it("returns a non-thenable handle whose result can be awaited repeatedly", async () => {
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => response("done") } },
    });

    const handle = await runtime.run("hi");
    expect(Reflect.get(handle, "then")).toBeUndefined();
    expect(handle.sessionId).not.toBe("");
    expect(handle.turnId).not.toBe("");
    expect(handle.inputId).not.toBe("");
    const [first, second] = await Promise.all([handle.result, handle.result]);
    expect(second).toBe(first);
    expect(first.turnId).toBe(handle.turnId);
    await runtime.close();
  });

  it("rejects a non-JSON input before it creates a journal entry", async () => {
    const store = new MemoryStore();
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => response("unused") } }, store,
    });

    await expect(Reflect.apply(runtime.run, runtime, [new Date(), { sessionId: "unused" }])).rejects.toMatchObject({
      where: "runtime",
      codes: ["input_invalid"],
    });
    expect(await store.head("unused")).toBe(0);
    await runtime.close();
  });

  it("fills runtime-owned model message fields and emits stored envelopes unchanged", async () => {
    const store = new MemoryStore();
    const events: RuntimeEvent[] = [];
    let context: Parameters<Model["generate"]>[1] | undefined;
    const model: Model = { generate: async (_input, received) => { context = received; return response("hello"); } };
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: model }, store, host: { emit: (event) => { events.push(event); } },
    });

    const result = await runResult(runtime.run("hi", { sessionId: "s" }));
    const stored = await journal(store, "s");

    expect(result.output).toBe("hello");
    expect(result.outputs[0]).toMatchObject({ role: "assistant", source: "model" });
    expect(result.outputs[0]?.id).toEqual(expect.any(String));
    expect(context).toMatchObject({ agent: "main", sessionId: "s", turnId: result.turnId, instance: "s/main", executionId: result.runs[0]?.executionId });
    expect(events.filter((event) => !("observational" in event))).toEqual(stored);
    expect(stored.map((event) => event.type)).toContain("agent.done");
    await runtime.close();
  });

  it("succeeds with no output when no route reaches $output", async () => {
    const runtime = createGoondan({
      agents: { main: { model: "m" } },
      routes: [{ from: "$input", to: "main" }],
    }, { models: { m: { generate: async () => response("branch end") } } });

    const result = await runResult(runtime.run("hi", { sessionId: "s" }));

    expect(result.outputs).toEqual([]);
    expect(result).not.toHaveProperty("output");
    expect(result).not.toHaveProperty("finishReason");
    await runtime.close();
  });

  it("uses the implicit single-agent output route for startAgent", async () => {
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => response("implicit") } },
    });

    const result = await runResult(runtime.run("hi", { sessionId: "implicit", startAgent: "main" }));

    expect(result.output).toBe("implicit");
    expect(result.outputs).toHaveLength(1);
    await runtime.close();
  });

  it("repairs unmatched tool parts with only the affected message events", async () => {
    const store = new MemoryStore();
    const events: RuntimeEvent[] = [];
    let calls = 0;
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => {
        calls += 1;
        if (calls === 1) return {
          message: { role: "assistant", content: [{ type: "tool.call", callId: "missing", name: "missing", args: {} }] },
          finishReason: "tool",
        };
        return response("recovered");
      } } },
      maxRetries: 0,
      store,
      host: { emit: (event) => { events.push(event); } },
    });

    await expect(runResult(runtime.run("first", { sessionId: "repair" }))).rejects.toMatchObject({ where: "tool", codes: ["tool_unavailable"] });
    const result = await runResult(runtime.run("second", { sessionId: "repair" }));
    const removed = (await journal(store, "repair")).filter((event) => event.type === "conversation.message.removed");

    expect(result.output).toBe("recovered");
    expect(removed).toHaveLength(1);
    expect(events.filter((event) => event.type.startsWith("tool."))).toEqual([]);
    await runtime.close();
  });

  it("fans route inputs into one stateful execution in declaration order", async () => {
    let received: Message[] = [];
    let joinedCalls = 0;
    const runtime = createGoondan({
      agents: { a: { model: "a" }, b: { model: "b" }, joined: { model: "joined" } },
      routes: [
        { from: "$input", to: "a" },
        { from: "$input", to: "b" },
        { from: "a", to: "joined" },
        { from: "b", to: "joined" },
        { from: "joined", to: "$output" },
      ],
    }, { models: {
      a: { generate: async () => response("A") },
      b: { generate: async () => response("B") },
      joined: { generate: async (input) => { joinedCalls += 1; received = input.messages; return response("joined"); } },
    } });

    const result = await runResult(runtime.run("go", { sessionId: "s" }));

    expect(joinedCalls).toBe(1);
    expect(received.slice(-2).map(text)).toEqual(["A", "B"]);
    expect(received.slice(-2).map((message) => message.meta?.from)).toEqual(["a", "b"]);
    expect(result.output).toBe("joined");
    expect(result.runs.map((run) => run.agent)).toEqual(["a", "b", "joined"]);
    await runtime.close();
  });

  it("starts each stateless route input without waiting for fan-in peers", async () => {
    let releaseSlow = (): void => undefined;
    let workerStarted = (): void => undefined;
    const slowReleased = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const firstWorker = new Promise<void>((resolve) => { workerStarted = resolve; });
    const store = new MemoryStore();
    let workerCalls = 0;
    const runtime = createGoondan({
      agents: {
        fast: { model: "fast" },
        slow: { model: "slow" },
        worker: { model: "worker", stateful: false },
      },
      routes: [
        { from: "$input", to: "fast" },
        { from: "$input", to: "slow" },
        { from: "fast", to: "worker" },
        { from: "slow", to: "worker" },
        { from: "worker", to: "$output" },
      ],
    }, {
      models: {
        fast: { generate: async () => response("fast") },
        slow: { generate: async () => { await slowReleased; return response("slow"); } },
        worker: { generate: async () => {
          workerCalls += 1;
          if (workerCalls === 1) workerStarted();
          return response(`worker-${workerCalls}`);
        } },
      },
      store,
    });

    const waiting = runResult(runtime.run("go", { sessionId: "stateless-route" }));
    await firstWorker;
    expect(workerCalls).toBe(1);
    releaseSlow();
    const result = await waiting;

    expect(workerCalls).toBe(2);
    expect(result.outputs).toHaveLength(2);
    const executions = fold("stateless-route", await journal(store, "stateless-route")).executions.filter((item) => item.agent === "worker");
    expect(executions).toHaveLength(2);
    expect(new Set(executions.map((item) => item.instance)).size).toBe(2);
    await runtime.close();
  });

  it("applies queued input as steer at the next safe point and joins both callers", async () => {
    let releaseTool = (): void => undefined;
    let toolStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseTool = resolve; });
    let generation = 0;
    const inputKinds: string[] = [];
    const promptKinds: string[] = [];
    const extension = defineExtension({
      name: "observe",
      hooks: ["onInput", "onPrompt"],
      create: () => ({ hooks: {
        onInput: (value, context: HookContext) => { inputKinds.push(context.inputKind ?? "missing"); return value; },
        onPrompt: (value, context: HookContext) => { promptKinds.push(context.inputKind ?? "missing"); return value; },
      } }),
    });
    const model: Model = { generate: async () => {
      generation += 1;
      if (generation === 1) return {
        message: { role: "assistant", content: [{ type: "tool.call", callId: "c1", name: "wait", args: {} }] },
        finishReason: "tool",
      };
      return response("done");
    } };
    const wait: Tool = {
      name: "wait", description: "wait", input: { type: "object" },
      execute: async () => { toolStarted(); await released; return []; },
    };
    const runtime = createGoondan({ agents: { main: {
      model: "m", tools: ["wait"], extensions: { observe: {} },
      hooks: { onInput: [{ extension: "observe" }], onPrompt: [{ extension: "observe" }] },
    } } }, { models: { m: model }, tools: { wait }, extensions: { observe: extension } });

    const first = runResult(runtime.run("first", { sessionId: "s" }));
    await started;
    const second = runResult(runtime.run("second", { sessionId: "s" }));
    releaseTool();
    const [left, right] = await Promise.all([first, second]);

    expect(left).toEqual(right);
    expect(left.runs).toHaveLength(1);
    expect(inputKinds).toEqual(["start", "steer"]);
    expect(promptKinds).toEqual(["start", "steer"]);
    await runtime.close();
  });

  it("stores repeated host inputs as distinct accepted messages", async () => {
    const received: Message[][] = [];
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async (input) => { received.push(input.messages); return response("same answer"); } } },
    });

    await runResult(runtime.run("same input", { sessionId: "repeated-input" }));
    await runResult(runtime.run("same input", { sessionId: "repeated-input" }));

    expect(received[1]?.filter((message) => text(message) === "same input")).toHaveLength(2);
    await runtime.close();
  });

  it("records function routes and preserves each function output at $output", async () => {
    const store = new MemoryStore();
    const one: Message = { id: "one", role: "assistant", source: "fn", content: [{ type: "text", text: "one" }] };
    const two: Message = { id: "two", role: "assistant", source: "fn", content: [{ type: "text", text: "two" }] };
    const runtime = createGoondan({
      agents: { unused: { model: "m" } },
      routes: [{ from: "$input", to: { fn: "split" } }, { from: { fn: "split" }, to: "$output" }],
    }, {
      models: { m: { generate: async () => response("unused") } },
      functions: { split: () => [one, two] },
      store,
    });

    const result = await runResult(runtime.run("go", { sessionId: "s" }));
    const state = fold("s", await journal(store, "s"));

    expect(result.outputs).toEqual([one, two]);
    expect(result.output).toBe("one\n\ntwo");
    expect(state.head).toBeGreaterThan(0);
    expect((await journal(store, "s")).filter((event) => event.type === "route.function")).toHaveLength(1);
    await runtime.close();
  });

  it("passes null output for $input conditions and start input for agent conditions", async () => {
    let inputCondition: unknown;
    let agentCondition: unknown;
    const runtime = createGoondan({
      agents: { main: { model: "m" } },
      routes: [
        { from: "$input", to: "main", when: { fn: "inputCondition" } },
        { from: "main", to: "$output", when: { fn: "agentCondition" } },
      ],
    }, {
      models: { m: { generate: async () => response("answer") } },
      functions: {
        inputCondition: (value) => { inputCondition = value; return true; },
        agentCondition: (value) => { agentCondition = value; return true; },
      },
    });

    const result = await runResult(runtime.run({ route: "go" }, { sessionId: "route-conditions" }));

    expect(result.output).toBe("answer");
    expect(inputCondition).toMatchObject({ output: null, text: "{\"route\":\"go\"}" });
    expect(agentCondition).toMatchObject({ output: expect.objectContaining({ role: "assistant" }), text: "answer" });
    expect(agentCondition).toMatchObject({ input: [expect.objectContaining({ content: [{ type: "text", text: "{\"route\":\"go\"}" }] })] });
    await runtime.close();
  });

  it("executes an approved operation, normalizes its result and delivers completion through a new turn", async () => {
    const store = new MemoryStore();
    let generation = 0;
    let executionInput: unknown;
    let executionOperationId: string | undefined;
    const model: Model = { generate: async () => {
      generation += 1;
      if (generation === 1) return {
        message: { role: "assistant", content: [{ type: "tool.call", callId: "c1", name: "write", args: { value: 1 } }] },
        finishReason: "tool",
      };
      return response(generation === 2 ? "approval pending" : "completion received");
    } };
    const write: Tool = {
      name: "write", description: "write", input: {
        type: "object", required: ["value"], properties: { value: { type: "number" } }, additionalProperties: false,
      },
      execute: async (input, context) => {
        executionInput = input;
        executionOperationId = context.operationId;
        expect(context.input).toMatchObject({ type: "operation_execution" });
        expect(context.conversation.length).toBeGreaterThan(0);
        return { saved: input };
      },
    };
    const runtime = createGoondan({ agents: { main: {
      model: "m", tools: [{ tool: "write", approval: "required" }],
    } } }, { models: { m: model }, tools: { write }, store });

    await runResult(runtime.run("start", { sessionId: "s" }));
    const pending = await runtime.operations.list("s");
    expect(pending).toHaveLength(1);
    const operation = pending[0];
    if (!operation) throw new Error("승인 작업이 생성되지 않았습니다.");
    const decided = await runtime.operations.decide("s", operation.operationId, { decision: "approved", inputPatch: { value: 2 } });
    expect(decided.status).toBe("approved");
    await runtime.idle();

    const completed = (await runtime.operations.list("s"))[0];
    expect(completed).toMatchObject({ status: "completed", deliveryStatus: "delivered" });
    expect(completed?.result).toMatchObject({ callId: "c1", name: "write", args: { value: 2 }, content: [{ type: "json" }] });
    expect(executionInput).toEqual({ value: 2 });
    expect(executionOperationId).toBe(operation.operationId);
    const state = fold("s", await journal(store, "s"));
    expect(state.turns).toHaveLength(2);
    expect(state.turns[1]?.inputs[0]?.operationId).toBe(operation.operationId);
    await runtime.close();
  });

  it("leaves a running operation for replay recovery when the runtime closes", async () => {
    const store = new MemoryStore();
    let started = (): void => undefined;
    const toolStarted = new Promise<void>((resolve) => { started = resolve; });
    let cancelled = false;
    const runtime = createGoondan({ agents: { main: { model: "m", tools: [{ tool: "slow", approval: "required" }] } } }, {
      models: { m: { generate: async (input) => input.messages.some((message) => message.content.some((part) => part.type === "tool.result"))
        ? response("approval pending")
        : { message: { role: "assistant", content: [{ type: "tool.call", callId: "slow-call", name: "slow", args: {} }] }, finishReason: "tool" } } },
      tools: { slow: {
        name: "slow", description: "slow", input: { type: "object" },
        execute: async (_input, context) => {
          started();
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener("abort", () => { cancelled = true; reject(new Error("cancelled")); }, { once: true });
          });
          return [];
        },
      } },
      store,
    });

    await runResult(runtime.run("start", { sessionId: "operation-close" }));
    const operation = (await runtime.operations.list("operation-close"))[0];
    if (!operation) throw new Error("승인 작업이 생성되지 않았습니다.");
    await runtime.operations.decide("operation-close", operation.operationId, { decision: "approved" });
    await toolStarted;
    const concurrent = await runResult(runtime.run("while operation runs", { sessionId: "operation-close" }));
    expect(concurrent.output).toBe("approval pending");
    await expect(runtime.sessions.delete("operation-close")).rejects.toMatchObject({ where: "runtime", codes: ["runtime_error"] });
    expect(cancelled).toBe(false);
    await runtime.close();

    expect(cancelled).toBe(true);
    expect((await runtime.operations.list("operation-close"))[0]?.status).toBe("running");
    expect((await journal(store, "operation-close")).some((event) => event.type === "operation.completed" || event.type === "operation.failed")).toBe(false);
  });

  it("ends only the accepted run caller's wait when its signal is cancelled", async () => {
    let started = (): void => undefined;
    let finish = (): void => undefined;
    const modelStarted = new Promise<void>((resolve) => { started = resolve; });
    const modelFinished = new Promise<void>((resolve) => { finish = resolve; });
    const store = new MemoryStore();
    const controller = new AbortController();
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => { started(); await modelFinished; return response("finished"); } } },
      store,
    });

    const waiting = runResult(runtime.run("go", { sessionId: "s", signal: controller.signal }));
    await modelStarted;
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ codes: ["aborted"] });
    finish();
    await runtime.idle();

    expect(fold("s", await journal(store, "s")).turns[0]?.status).toBe("completed");
    await runtime.close();
  });

  it("does not accept an input cancelled while waiting for the session lease", async () => {
    const store = new MemoryStore();
    const blocker = await store.acquireLease("lease-wait", "blocker");
    if (!blocker) throw new Error("시험용 임대를 획득하지 못했습니다.");
    const controller = new AbortController();
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => response("unused") } },
      store,
    });

    const waiting = runResult(runtime.run("cancel me", { sessionId: "lease-wait", signal: controller.signal }));
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ codes: ["aborted"] });
    expect(await store.head("lease-wait")).toBe(0);

    await blocker.release();
    await runtime.close();
  });

  it("applies a completed stateful asynchronous hook at the next execution", async () => {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const seen: string[][] = [];
    const runtime = createGoondan({ agents: { main: {
      model: "m",
      hooks: { onOutput: [{ fn: "later", mode: "async", role: "system" }] },
    } } }, {
      models: { m: { generate: async (input) => {
        seen.push(input.messages.map((message) => text(message) ?? ""));
        return response("answer");
      } } },
      functions: { later: async () => { await released; return "async context"; } },
    });

    await runResult(runtime.run("first", { sessionId: "s" }));
    release();
    await runtime.idle();
    await runResult(runtime.run("second", { sessionId: "s" }));

    expect(seen[1]).toContain("async context");
    await runtime.close();
  });

  it("adds hook helpers to the function context used by hook fn", async () => {
    let receivedHookContext = false;
    const runtime = createGoondan({ agents: { main: {
      model: "m",
      hooks: { onPrompt: [{ fn: "inspect" }] },
    } } }, {
      models: { m: { generate: async () => response("answer") } },
      functions: { inspect: (value, context) => {
        if (context && "location" in context) {
          receivedHookContext = context.location === "onPrompt"
            && context.inputKind === "start"
            && context.retryCount === 0
            && typeof context.agents?.run === "function"
            && typeof context.model?.run === "function"
            && typeof context.render === "function"
            && typeof context.message?.user === "function";
        }
        return value;
      } },
    });

    await runResult(runtime.run("first", { sessionId: "hook-function-context" }));

    expect(receivedHookContext).toBe(true);
    await runtime.close();
  });

  it("continues after an optional onModelResult retry exceeds the retry limit", async () => {
    let afterRetry = 0;
    const runtime = createGoondan({ agents: { main: {
      model: "m",
      hooks: { onModelResult: [{ fn: "retry", optional: true }, { fn: "after" }] },
    } } }, {
      models: { m: { generate: async () => response("answer") } },
      functions: {
        retry: () => ({ retry: true, target: "model" }),
        after: (value) => { afterRetry += 1; return value; },
      },
      maxRetries: 0,
    });

    const result = await runResult(runtime.run("first", { sessionId: "optional-retry" }));

    expect(result.output).toBe("answer");
    expect(afterRetry).toBe(1);
    await runtime.close();
  });

  it("cancels asynchronous hooks before deleting their session stream", async () => {
    let started = (): void => undefined;
    const hookStarted = new Promise<void>((resolve) => { started = resolve; });
    let cancelled = false;
    const store = new MemoryStore();
    const runtime = createGoondan({ agents: { main: {
      model: "m",
      hooks: { onOutput: [{ fn: "pending", mode: "async" }] },
    } } }, {
      models: { m: { generate: async () => response("answer") } },
      functions: { pending: async (_value, context) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          if (!context) { reject(new Error("함수 컨텍스트가 없습니다.")); return; }
          context.signal.addEventListener("abort", () => { cancelled = true; reject(new Error("cancelled")); }, { once: true });
        });
      } },
      store,
    });

    await runResult(runtime.run("first", { sessionId: "delete-me" }));
    await hookStarted;
    await runtime.sessions.delete("delete-me");

    expect(cancelled).toBe(true);
    expect(await store.head("delete-me")).toBe(0);
    expect(await journal(store, "delete-me")).toEqual([]);
    await runtime.close();
  });

  it("tracks a stateless asynchronous hook until session deletion cancels it", async () => {
    let started = (): void => undefined;
    const hookStarted = new Promise<void>((resolve) => { started = resolve; });
    let cancelled = false;
    const store = new MemoryStore();
    const runtime = createGoondan({ agents: { main: {
      model: "m", stateful: false,
      hooks: { onOutput: [{ fn: "pending", mode: "async" }] },
    } } }, {
      models: { m: { generate: async () => response("answer") } },
      functions: { pending: async (_value, context) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          if (!context) { reject(new Error("함수 컨텍스트가 없습니다.")); return; }
          context.signal.addEventListener("abort", () => { cancelled = true; reject(new Error("cancelled")); }, { once: true });
        });
      } },
      store,
    });

    await runResult(runtime.run("first", { sessionId: "delete-stateless" }));
    await hookStarted;
    await runtime.sessions.delete("delete-stateless");

    expect(cancelled).toBe(true);
    expect(await store.head("delete-stateless")).toBe(0);
    await runtime.close();
  });

  it("rejects a synchronous self-wait before inserting the child input", async () => {
    const model: Model = { generate: async () => ({
      message: { role: "assistant", content: [{ type: "tool.call", callId: "c", name: "self", args: {} }] },
      finishReason: "tool",
    }) };
    const self: Tool = {
      name: "self", description: "self", input: { type: "object" },
      execute: async (_input, context) => context.agents.run("main", "again"),
    };
    const runtime = createGoondan({ agents: { main: { model: "m", tools: ["self"] } } }, {
      models: { m: model }, tools: { self }, maxRetries: 0,
    });

    await expect(runResult(runtime.run("go", { sessionId: "s" }))).rejects.toMatchObject({ where: "tool", codes: ["tool_error"] });
    await runtime.close();
  });

  it("shares a stateful queue between a detached hook child and a later host turn", async () => {
    let helperStarted = (): void => undefined;
    let releaseHelper = (): void => undefined;
    const started = new Promise<void>((resolve) => { helperStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseHelper = resolve; });
    let helperCalls = 0;
    const extension = defineExtension({
      name: "followup",
      hooks: ["onOutput"],
      create: () => ({ hooks: {
        onOutput: async (_value, context: HookContext) => context.agents.run("helper", "from hook"),
      } }),
    });
    const runtime = createGoondan({ agents: {
      main: { model: "main", extensions: { followup: {} }, hooks: { onOutput: [{ extension: "followup", mode: "async" }] } },
      helper: { model: "helper" },
    } }, { models: {
      main: { generate: async () => response("main done") },
      helper: { generate: async () => {
        helperCalls += 1;
        if (helperCalls === 1) { helperStarted(); await released; }
        return response(`helper ${helperCalls}`);
      } },
    }, extensions: { followup: extension } });

    const first = await runResult(runtime.run("first", { sessionId: "shared-queue", agent: "main" }));
    await started;
    const secondWaiting = runResult(runtime.run("from host", { sessionId: "shared-queue", agent: "helper" }));
    releaseHelper();
    const second = await secondWaiting;
    await runtime.idle();

    expect(first.turnId).not.toBe(second.turnId);
    expect(second.output).toBe("helper 2");
    expect(helperCalls).toBe(2);
    await runtime.close();
  });

  it("renews an expiring session lease while a model call is waiting", async () => {
    const store = new ExpiringStore(80);
    let modelStarted = (): void => undefined;
    let releaseModel = (): void => undefined;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseModel = resolve; });
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async () => { modelStarted(); await released; return response("done"); } } },
      store,
    });

    const waiting = runResult(runtime.run("hold", { sessionId: "renew-success" }));
    await started;
    const renewed = store.nextRenewal();
    await renewed;
    releaseModel();

    await expect(waiting).resolves.toMatchObject({ output: "done", status: "done" });
    await runtime.close();
  });

  it("fails the turn and cancels its model call when lease renewal is rejected", async () => {
    const store = new ExpiringStore(80);
    let modelStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    let cancelled = false;
    const runtime = createGoondan({ agents: { main: { model: "m" } } }, {
      models: { m: { generate: async (_input, context) => {
        modelStarted();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => { cancelled = true; reject(new Error("cancelled")); }, { once: true });
        });
        return response("unreachable");
      } } },
      store,
    });

    const waiting = runResult(runtime.run("hold", { sessionId: "renew-failure" }));
    await started;
    store.rejectRenewal = true;

    await expect(waiting).rejects.toMatchObject({ where: "runtime", codes: ["runtime_error"] });
    expect(cancelled).toBe(true);
    await runtime.close();
  });
});
