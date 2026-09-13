import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { createRuntime, defineExtension, loadConfig, MemoryConversationStore, MemoryOperationStore, validateConfig, type Json, type LoadedConfig, type Message, type ModelInput, type ModelResult, type OperationCompletion, type ToolResult } from "../src/index.ts";

function text(message: Message): string { return message.content.map((part) => part.type === "text" ? part.text : "").join(""); }

describe("Goondan runtime", () => {
  it("resolves ordered resources into a reloadable config", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "goondan-config-"));
    await mkdir(resolve(root, "base/templates"), { recursive: true });
    await writeFile(resolve(root, "base/templates/system.md"), "fragment template");
    await writeFile(resolve(root, "base/goondan.yaml"), "version: 1\nname: base\nagents:\n  main:\n    model: base\n    systemMessage: {template: templates/system.md}\n    tools: [base]\nflow: {in: main}\n");
    await writeFile(resolve(root, "override.yaml"), "agents:\n  main:\n    model: override\n    tools: [override]\n");
    await writeFile(resolve(root, "goondan.yaml"), "resources: [base, override.yaml]\nversion: 1\nname: resolved\nagents:\n  main:\n    params: {root: true}\n    extensions:\n      data:\n        options: {template: literal, config: literal, extends: literal, resources: [literal]}\nflow: {in: main}\n");
    const loaded = await loadConfig(root);
    expect(loaded.config.agents.main?.extensions?.data?.options).toEqual({ template: "literal", config: "literal", extends: "literal", resources: ["literal"] });
    expect(loaded.config.agents.main).toMatchObject({ model: "override", tools: ["override"], params: { root: true } });
    expect(loaded.config.agents.main?.systemMessage).toEqual({ template: await realpath(resolve(root, "base/templates/system.md")) });
    const resolvedPath = resolve(root, "resolved.yaml");
    await writeFile(resolvedPath, stringify(loaded.config));
    expect((await loadConfig(resolvedPath)).config).toEqual(loaded.config);
  });

  it("rejects duplicate and circular resource graphs", async () => {
    const duplicateRoot = await mkdtemp(resolve(tmpdir(), "goondan-duplicate-"));
    await writeFile(resolve(duplicateRoot, "shared.yaml"), "version: 1\nname: shared\nagents: {main: {model: fixture}}\nflow: {in: main}\n");
    await writeFile(resolve(duplicateRoot, "goondan.yaml"), "resources: [shared.yaml, shared.yaml]\n");
    await expect(loadConfig(duplicateRoot)).rejects.toThrow("Duplicate config resource");

    const circularRoot = await mkdtemp(resolve(tmpdir(), "goondan-circular-"));
    await writeFile(resolve(circularRoot, "goondan.yaml"), "resources: [child.yaml]\n");
    await writeFile(resolve(circularRoot, "child.yaml"), "resources: [goondan.yaml]\n");
    await expect(loadConfig(circularRoot)).rejects.toThrow("Circular config resource");
  });

  it("uses the extension map key as the host registration name", () => {
    const base = { version: 1, name: "extension-key", agents: { main: { model: "fixture", extensions: { memory: { extension: "team-memory" } } } }, flow: { in: "main" } };
    expect(validateConfig({ version: 1, name: "extension-key", agents: { main: { model: "fixture", extensions: { memory: { options: { scope: "team" } } } } }, flow: { in: "main" } }).agents.main?.extensions?.memory?.options).toEqual({ scope: "team" });
    expect(() => validateConfig(base)).toThrow("redundant");
  });
  it("starts a routed flow at a surface agent and carries conversation across every route", async () => {
    const config: LoadedConfig = { directory: ".", templates: new Map<string, string>(), config: { version: 1, name: "routes", agents: { slack: { model: "slack", input: "asis" }, api: { model: "api", input: "asis" }, finish: { model: "finish", input: "asis" } }, flow: { in: "slack", routes: [{ from: "api", to: "finish", when: { fn: "hasOutput" }, carry: { message: "output", conversation: "asis" } }, { from: "finish", to: "out" }] } } };
    const seen: Record<string, ModelInput> = {};
    const model = (name: string, output: string) => ({ async generate(input: ModelInput): Promise<ModelResult> { seen[name] = input; return { message: { id: name, role: "assistant", source: "model", content: [{ type: "text", text: output }] }, finishReason: "stop" }; } });
    const runtime = createRuntime(config, { models: { slack: model("slack", "unused"), api: model("api", "handoff"), finish: model("finish", "done") }, functions: { hasOutput(value) { expect(value).toMatchObject({ output: "handoff", input: "request" }); return true; } } });

    const result = await runtime.runTurn("request", { conversationId: "surface", startAgent: "api" });

    expect(text(result.output)).toBe("done");
    expect(seen.slack).toBeUndefined();
    expect(seen.finish?.messages.map((message) => text(message))).toEqual(["request", "handoff", "handoff"]);
  });

  it("matches the shared basic fixture", async () => {
    const fixture = resolve(import.meta.dirname, "../../../fixtures/conformance/basic");
    const config = await loadConfig(fixture);
    const expected: unknown = JSON.parse(await readFile(resolve(fixture, "expected.json"), "utf8"));
    const modelInputs: ModelInput[] = [];
    const store = new MemoryConversationStore();
    let number = 0;
    const runtime = createRuntime(config, {
      models: { fixture: { async generate(input): Promise<ModelResult> { modelInputs.push(input); return { message: { id: "model-1", role: "assistant", source: "model", content: [{ type: "text", text: "완료" }] }, finishReason: "stop" }; } } },
      functions: {
        normalizeInput(value) { return value; },
        polishOutput(value) { if (typeof value !== "object" || value === null || Array.isArray(value)) return "!"; const content = value.content; if (!Array.isArray(content)) return "!"; const first = content[0]; return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? `${first.text}!` : "!"; },
      }, conversationStore: store, host: { id: () => `id-${String(++number)}`, now: () => 1 },
    });
    const result = await runtime.runTurn({ text: "테스트", requestId: "req-1" }, { conversationId: "conversation-1" });
    const captured = modelInputs[0]; if (!captured) throw new Error("model was not called");
    const stored = await store.load("conversation-1", "main");
    const normalized = {
      system: captured.system,
      messages: captured.messages.map((message) => ({ role: message.role, source: message.source, text: text(message) })),
      output: { role: result.output.role, source: result.output.source, text: text(result.output) },
      storedMessageSources: stored.map((message) => message.source),
    };
    expect(normalized).toEqual(expected);
  });

  it("returns a pending result and continues model work without executing the guarded tool", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures/tool-config");
    const config = await loadConfig(fixture);
    const calls: Json[] = [];
    let generation = 0;
    const runtime = createRuntime(config, {
      models: { fixture: { async generate(input): Promise<ModelResult> { generation += 1; if (generation === 1) return { message: { id: "model-1", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "call-1", name: "finish", args: { ok: true } }] }, finishReason: "tool" }; const pending = input.messages.flatMap((message) => message.content).find((part) => part.type === "tool.result"); expect(pending).toMatchObject({ type: "tool.result", callId: "call-1", content: [{ type: "json", value: { status: "pending" } }] }); return { message: { id: "model-2", role: "assistant", source: "model", content: [{ type: "text", text: "다른 일을 계속함" }] }, finishReason: "stop" }; } } },
      tools: { finish: { name: "finish", description: "finish", input: { type: "object" }, execute(input): ToolResult { calls.push(input); return { callId: "call-1", name: "finish", args: input, content: [{ type: "text", text: "도구 완료" }] }; } } },
      extensions: { guard: defineExtension({ name: "guard", hooks: { toolCall: {} }, create: () => ({ hooks: { toolCall: (value) => ({ approval: { reason: typeof value === "object" ? "확인" : "오류" } }) } }) }) },
    });
    const result = await runtime.runTurn("실행", { conversationId: "tools" });
    expect(calls).toEqual([]);
    expect(text(result.output)).toBe("다른 일을 계속함");
    expect(generation).toBe(2);
    expect(await runtime.listOperations("tools")).toMatchObject([{ status: "pending", toolCall: { name: "finish", args: { ok: true } } }]);
  });

  it("requires approval before executing an agent exposed as a tool", async () => {
    const config = validateConfig({ agents: {
      main: { model: "main", tools: [{ agent: "worker", approval: "required" }] },
      worker: { model: "worker" },
    } });
    let workerGenerations = 0;
    let mainGenerations = 0;
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, { models: {
      main: { async generate(): Promise<ModelResult> { mainGenerations += 1; return mainGenerations === 1
        ? { message: { id: "main", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "worker-call", name: "worker", args: { task: "inspect" } }] }, finishReason: "tool" }
        : { message: { id: "continued", role: "assistant", source: "model", content: [{ type: "text", text: "continued" }] }, finishReason: "stop" }; } },
      worker: { async generate(): Promise<ModelResult> { workerGenerations += 1; return { message: { id: "worker", role: "assistant", source: "model", content: [{ type: "text", text: "done" }] }, finishReason: "stop" }; } },
    } });

    await runtime.runTurn("start", { conversationId: "agent-approval" });

    expect(workerGenerations).toBe(0);
    expect(await runtime.listOperations("agent-approval")).toMatchObject([{ status: "pending", toolCall: { name: "worker" } }]);
  });

  it("retries only the failed tool in the same turn", async () => {
    const config = validateConfig({ agents: { main: { model: "fixture", tools: ["first", "flaky", "last"], hooks: { error: [{ fn: "retryTool" }] } } } });
    let generations = 0;
    const calls: string[] = [];
    let flakyAttempts = 0;
    const tool = (name: string) => ({ name, description: name, input: {}, execute(input: Json, context: { toolCall: { id: string } }): ToolResult {
      calls.push(name);
      if (name === "flaky" && ++flakyAttempts === 1) throw new Error("retry me");
      return { callId: context.toolCall.id, name, args: input, content: [{ type: "text", text: "done" }] };
    } });
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, {
      models: { fixture: { async generate(): Promise<ModelResult> { generations += 1; return generations === 1
        ? { message: { id: "calls", role: "assistant", source: "model", content: ["first", "flaky", "last"].map((name) => ({ type: "tool.call" as const, callId: name, name, args: {} })) }, finishReason: "tool" }
        : { message: { id: "done", role: "assistant", source: "model", content: [{ type: "text", text: "complete" }] }, finishReason: "stop" }; } } },
      tools: { first: tool("first"), flaky: tool("flaky"), last: tool("last") },
      functions: { retryTool: () => ({ retry: true, target: "tool" }) },
    });

    const result = await runtime.runTurn("start", { conversationId: "tool-retry" });

    expect(text(result.output)).toBe("complete");
    expect(calls).toEqual(["first", "flaky", "flaky", "last"]);
    expect(generations).toBe(2);
  });

  it("retries a failed model without appending the turn input again", async () => {
    const config = validateConfig({ agents: { main: { model: "fixture", hooks: { error: [{ fn: "retryModel" }] } } } });
    const observedUserCounts: number[] = [];
    let generations = 0;
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, {
      models: { fixture: { async generate(input): Promise<ModelResult> {
        generations += 1;
        observedUserCounts.push(input.messages.filter((message) => message.role === "user").length);
        if (generations === 1) throw new Error("retry model");
        return { message: { id: "done", role: "assistant", source: "model", content: [{ type: "text", text: "complete" }] }, finishReason: "stop" };
      } } },
      functions: { retryModel: () => ({ retry: true, target: "model" }) },
    });

    await runtime.runTurn("start", { conversationId: "model-retry" });

    expect(observedUserCounts).toEqual([1, 1]);
  });

  it("returns terminal finish reason and usage aggregated across a routed flow", async () => {
    const config = validateConfig({ agents: { first: { model: "first" }, final: { model: "final" } }, flow: ["first", "final"] });
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, { models: {
      first: { async generate(): Promise<ModelResult> { return { message: { id: "first", role: "assistant", source: "model", content: [{ type: "text", text: "carry" }] }, usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, finishReason: "stop" }; } },
      final: { async generate(): Promise<ModelResult> { return { message: { id: "final", role: "assistant", source: "model", content: [{ type: "text", text: "truncated" }] }, usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 }, finishReason: "length" }; } },
    } });

    const result = await runtime.runTurn("start", { conversationId: "flow-metadata" });

    expect(result.finishReason).toBe("length");
    expect(result.usage).toEqual({ input: 6, output: 8, cacheRead: 10, cacheWrite: 12 });
  });

  it("executes an approved operation once and delivers a separate completion once after restart", async () => {
    const loaded = await loadConfig(resolve(import.meta.dirname, "fixtures/tool-config"));
    const config = structuredClone({ ...loaded, templates: loaded.templates });
    const main = config.config.agents.main;
    if (!main) throw new Error("main agent is missing");
    main.extensions = undefined;
    main.hooks = undefined;
    main.tools = [{ tool: "lookup" }, { tool: "finish", approval: "required" }];
    const conversationStore = new MemoryConversationStore();
    const operationStore = new MemoryOperationStore();
    const calls: string[] = [];
    const executedInputs: Json[] = [];
    const approvalRequests: string[] = [];
    let generations = 0;
    const bindings = {
      conversationStore,
      operationStore,
      models: { fixture: { async generate(): Promise<ModelResult> { generations += 1; if (generations === 1) return { message: { id: "model-restart", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "lookup-1", name: "lookup", args: {} }, { type: "tool.call", callId: "finish-1", name: "finish", args: {} }] }, finishReason: "tool" }; return { message: { id: `model-${String(generations)}`, role: "assistant", source: "model", content: [{ type: "text", text: "continued" }] }, finishReason: "stop" }; } } },
      tools: Object.fromEntries(["lookup", "finish"].map((name) => [name, { name, description: name, input: {}, execute(input: Json, context: { toolCall: { id: string } }): ToolResult { calls.push(name); executedInputs.push(input); return { callId: context.toolCall.id, name, args: input, content: [{ type: "text", text: name }] }; } }])),
    };
    const first = createRuntime(config, { ...bindings, host: { requestApproval(request) { approvalRequests.push(request.operationId); } } });
    await first.runTurn("실행", { conversationId: "restart" });
    const pending = (await first.listOperations("restart")).find((item) => item.status === "pending"); if (!pending) throw new Error("operation was not persisted");
    const recoveredPending = createRuntime(config, { ...bindings, host: { requestApproval(request) { approvalRequests.push(request.operationId); } } });
    await recoveredPending.recoverOperations("restart");
    expect(approvalRequests).toEqual([pending.operationId, pending.operationId]);
    const completions: OperationCompletion[] = [];
    const restarted = createRuntime(config, { ...bindings, host: { validateOperationInputPatch: (_operation, patch) => patch.choice === "yes", validateOperation: () => true, deliverOperationCompletion(completion) { completions.push(completion); } } });
    await Promise.all([restarted.decideOperation("restart", pending.operationId, { decision: "approved", inputPatch: { choice: "yes" } }), restarted.decideOperation("restart", pending.operationId, { decision: "approved", inputPatch: { choice: "yes" } })]);
    for (let attempt = 0; completions.length === 0 && attempt < 20; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    await restarted.recoverOperations("restart");

    expect(calls).toEqual(["lookup", "finish"]);
    expect(executedInputs).toEqual([{}, { choice: "yes" }]);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ type: "operation_completion", operationId: pending.operationId, status: "completed", toolCall: { id: "finish-1" } });
    const completed = (await restarted.listOperations("restart")).find((item) => item.operationId === pending.operationId); expect(completed).toMatchObject({ status: "completed", deliveryStatus: "delivered" });
    if (!completed) throw new Error("completed operation is missing");
    await operationStore.save({ ...completed, deliveryStatus: "delivering", deliveredAt: undefined });
    const recoveredCompletions: OperationCompletion[] = [];
    const recovered = createRuntime(config, { ...bindings, host: { deliverOperationCompletion(completion) { recoveredCompletions.push(completion); } } });
    await recovered.recoverOperations("restart");
    expect(recoveredCompletions.map((item) => item.deliveryId)).toEqual([completed.deliveryId]);
    expect(calls).toEqual(["lookup", "finish"]);
  });

  it("marks fallback completion delivered only after the same agent accepts it", async () => {
    const config = validateConfig({ agents: { main: { model: "fixture", tools: [{ tool: "work", approval: "required" }] } } });
    const conversationStore = new MemoryConversationStore();
    const operationStore = new MemoryOperationStore();
    let generation = 0;
    let releaseActive: (() => void) | undefined;
    const activeGate = new Promise<void>((resolveGate) => { releaseActive = resolveGate; });
    const runtime = createRuntime({ config, directory: ".", templates: new Map() }, {
      conversationStore,
      operationStore,
      models: { fixture: { async generate(input): Promise<ModelResult> {
        generation += 1;
        if (generation === 1) return { message: { id: "approval", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "work", name: "work", args: {} }] }, finishReason: "tool" };
        if (generation === 2) return { message: { id: "continued", role: "assistant", source: "model", content: [{ type: "text", text: "continued" }] }, finishReason: "stop" };
        if (generation === 3) await activeGate;
        const hasCompletion = input.messages.some((message) => text(message).includes("operation_completion"));
        return { message: { id: `response-${String(generation)}`, role: "assistant", source: "model", content: [{ type: "text", text: hasCompletion ? "accepted completion" : "independent" }] }, finishReason: "stop" };
      } } },
      tools: { work: { name: "work", description: "work", input: {}, execute(input, context): ToolResult { return { callId: context.toolCall.id, name: "work", args: input, content: [{ type: "text", text: "done" }] }; } } },
    });
    await runtime.runTurn("request approval", { conversationId: "fallback-delivery" });
    const operation = (await runtime.listOperations("fallback-delivery"))[0]; if (!operation) throw new Error("operation is missing");
    const active = runtime.runTurn("independent work", { conversationId: "fallback-delivery" });
    await Promise.resolve();
    await runtime.decideOperation("fallback-delivery", operation.operationId, { decision: "approved" });
    releaseActive?.();
    await active;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await operationStore.get("fallback-delivery", operation.operationId);
      if (current?.deliveryStatus === "delivered") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    }

    const completed = await operationStore.get("fallback-delivery", operation.operationId);
    const stored = await conversationStore.load("fallback-delivery", "main");
    expect(completed?.deliveryStatus).toBe("delivered");
    expect(stored.some((message) => text(message).includes(operation.operationId))).toBe(true);
    expect(stored.some((message) => text(message) === "accepted completion")).toBe(true);
  });

  it("matches the shared tool-loop fixture", async () => {
    const fixture = resolve(import.meta.dirname, "../../../fixtures/conformance/tool-loop"); const config = await loadConfig(fixture);
    const expected: unknown = JSON.parse(await readFile(resolve(fixture, "expected.json"), "utf8")); const store = new MemoryConversationStore();
    let generation = 0; const called: string[] = [];
    const runtime = createRuntime(config, { extensions: { completion: defineExtension({ name: "completion", create: () => ({ hooks: { toolResult(value, ctx) { if (value && typeof value === "object" && "name" in value && value.name === "finish") ctx.execution.complete({ id: "complete", role: "assistant", source: "tool", content: [{ type: "text", text: "최종 결과" }] }); return value; } } }) }) }, conversationStore: store, functions: { addExecution: (value) => value, markResult: (value) => value },
      models: { fixture: { async generate(): Promise<ModelResult> { generation += 1; const last = generation === 1 ? { callId: "call-1", name: "lookup", args: { query: "군단" } } : { callId: "call-2", name: "finish", args: { summary: "찾음" } }; return { message: { id: `model-${String(generation)}`, role: "assistant", source: "model", content: [{ type: "tool.call", ...last }] }, finishReason: "tool" }; } } },
      tools: Object.fromEntries(["lookup", "finish"].map((name) => [name, { name, description: name, input: { type: "object" }, execute(input: Json, context: { toolCall: { id: string } }): ToolResult { called.push(name); return { callId: context.toolCall.id, name, args: input, content: [{ type: "text", text: name === "lookup" ? "검색 결과" : "최종 결과" }] }; } }])),
    });
    const result = await runtime.runTurn("찾아 주세요", { conversationId: "tool-loop" }); const stored = await store.load("tool-loop", "main");
    expect({ modelCallCount: generation, toolCalls: called, output: { role: result.output.role, source: result.output.source, text: text(result.output) }, storedRoles: stored.map((message) => message.role) }).toEqual(expected);
  });

  it("matches the shared variant fixture", async () => {
    const fixture = resolve(import.meta.dirname, "../../../fixtures/conformance/variant"); const config = await loadConfig(fixture, { variants: ["changed"] }); let systemText = "";
    const runtime = createRuntime(config, { models: { fixture: { async generate(input): Promise<ModelResult> { systemText = input.system.map((block) => block.text).join(""); return { message: { id: "model", role: "assistant", source: "model", content: [{ type: "text", text: "응답" }] }, finishReason: "stop" }; } } } });
    const result = await runtime.runTurn("요청", { conversationId: "variant" }); const expected: unknown = JSON.parse(await readFile(resolve(fixture, "expected.json"), "utf8"));
    expect({ systemText, outputText: text(result.output) }).toEqual(expected);
  });

  it("classifies thrown tool failures and emits observable tool error data", async () => {
    const config = await loadConfig(resolve(import.meta.dirname, "fixtures/tool-config"));
    const main = config.config.agents.main; if (!main) throw new Error("main agent is missing");
    main.extensions = undefined; main.tools = [{ tool: "finish" }];
    let captured: Json | undefined;
    main.hooks = { error: [{ fn: "captureError" }] };
    const events: Array<{ name: string; data: Record<string, Json> }> = [];
    const runtime = createRuntime(config, {
      models: { fixture: { async generate(): Promise<ModelResult> { return { message: { id: "model-error", role: "assistant", source: "model", content: [{ type: "tool.call", callId: "call-error", name: "finish", args: { value: 1 } }] }, finishReason: "tool" }; } } },
      tools: { finish: { name: "finish", description: "finish", input: {}, execute() { throw new Error("tool exploded"); } } },
      functions: { captureError(value) { captured = value; return value; } },
    });
    runtime.events.on((event) => { events.push({ name: event.name, data: event.data }); });

    await expect(runtime.runTurn("실행", { conversationId: "tool-error" })).rejects.toThrow("tool exploded");

    expect(captured).toMatchObject({ where: "tool", codes: ["tool_error"], toolCall: { id: "call-error", name: "finish", args: { value: 1 } } });
    expect(events.filter((event) => event.name.startsWith("tool.")).map((event) => event.name)).toEqual(["tool.start", "tool.error"]);
    expect(events.find((event) => event.name === "tool.start")?.data).toMatchObject({ callId: "call-error", args: { value: 1 } });
    expect(events.find((event) => event.name === "tool.error")?.data).toMatchObject({ error: "tool exploded", codes: ["tool_error"] });
  });
});
