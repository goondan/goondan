import { describe, expect, it } from "vitest";
import { executionError } from "./execution-error.ts";
import {
  createRuntime, isGoondanConfigError, MemoryConversationStore, validateConfig,
  type ConfigIssue, type GoondanFunction, type Json, type Message, type Model, type ModelResult,
} from "../src/index.ts";

/** The execution error a failed turn throws, read without depending on the exception class. */
function failure(error: unknown): { where: string; codes: readonly string[] } | undefined {
  const detail = executionError(error);
  return detail ? { where: detail.where, codes: detail.codes } : undefined;
}

function issuesOf(action: () => unknown): ConfigIssue[] {
  try { action(); } catch (error) { if (isGoondanConfigError(error)) return [...error.issues]; throw error; }
  throw new Error("the configuration was accepted");
}

function codes(issues: readonly ConfigIssue[]): string[] {
  return issues.map((issue) => `${issue.path}:${issue.code}`);
}

function assistant(text: string, id = "a"): Message {
  return { id, role: "assistant", source: "model", content: [{ type: "text", text }] };
}

/** A model that answers with the text of the last user message wrapped in the agent name. */
function echo(name: string, order: string[]): Model {
  return {
    async generate(input): Promise<ModelResult> {
      order.push(name);
      const last = input.messages[input.messages.length - 1];
      const part = last?.content[0];
      const text = part && part.type === "text" ? part.text : "";
      return { message: assistant(`${name}(${text})`), finishReason: "stop" };
    },
  };
}

describe("the flow structure checks", () => {
  it("reports an in agent that no route continues", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { model: "m" }, b: { model: "m" } },
      flow: { in: "a", routes: [{ from: "b", to: "out" }] },
    })))).toEqual(["/flow/in:flow.no_route"]);
  });

  it("reports a route target that no route continues", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { model: "m" }, b: { model: "m" } },
      flow: { in: "a", routes: [{ from: "a", to: "b" }] },
    })))).toEqual(["/flow/routes/0/to:flow.no_route"]);
  });

  it("reports every route of a cycle made of routes without a condition", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { model: "m" }, b: { model: "m" } },
      flow: { in: "a", routes: [{ from: "a", to: "b" }, { from: "b", to: "a" }] },
    })))).toEqual(["/flow/routes/0:flow.cycle", "/flow/routes/1:flow.cycle"]);
  });

  it("reports a route that points at its own from", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { model: "m" } },
      flow: { in: "a", routes: [{ from: "a", to: "a" }] },
    })))).toEqual(["/flow/routes/0:flow.cycle"]);
  });

  it("accepts a cycle that contains a route with a condition", () => {
    const config = validateConfig({
      agents: { a: { model: "m" }, b: { model: "m" } },
      flow: { in: "a", routes: [{ from: "a", to: "b" }, { from: "b", to: "a", when: { fn: "again" } }, { from: "b", to: "out" }] },
    });
    expect(config.flow.routes).toHaveLength(3);
  });

  it("reports a route that carries a conversation to or from a config agent", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { model: "m" }, wrap: { config: "./inner" } },
      flow: {
        in: "a",
        routes: [
          { from: "a", to: "wrap", carry: { conversation: "asis" } },
          { from: "wrap", to: "out", carry: { conversation: "asis" } },
        ],
      },
    })))).toEqual(["/flow/routes/0/carry/conversation:flow.carry_conversation"]);
  });

  it("accepts a config agent route that carries no conversation", () => {
    const config = validateConfig({
      agents: { a: { model: "m" }, wrap: { config: "./inner" } },
      flow: { in: "a", routes: [{ from: "a", to: "wrap", carry: { conversation: "none" } }, { from: "wrap", to: "out" }] },
    });
    expect(config.flow.routes).toHaveLength(2);
  });

  it("leaves a route with an unknown endpoint out of the structure checks", () => {
    expect(codes(issuesOf(() => validateConfig({
      agents: { a: { model: "m" } },
      flow: { in: "a", routes: [{ from: "a", to: "ghost", carry: { conversation: "asis" } }] },
    })))).toEqual(["/flow/routes/0/to:reference.agent"]);
  });
});

describe("route progression", () => {
  it("runs the branches of one output depth first and keeps that order in outputs", async () => {
    const order: string[] = [];
    const runtime = createRuntime({
      agents: { split: { model: "s" }, a: { model: "a" }, b: { model: "b" }, c: { model: "c" } },
      flow: {
        in: "split",
        routes: [
          { from: "split", to: "a" }, { from: "split", to: "b" },
          { from: "a", to: "c" }, { from: "c", to: "out" }, { from: "b", to: "out" },
        ],
      },
    }, {
      directory: ".",
      models: { s: echo("split", order), a: echo("a", order), b: echo("b", order), c: echo("c", order) },
    });

    const result = await runtime.runTurn("x", { conversationId: "c" });

    expect(order).toEqual(["split", "a", "c", "b"]);
    expect(result.outputs.map((message) => message.content)).toEqual([
      [{ type: "text", text: "c(a(split(x)))" }],
      [{ type: "text", text: "b(split(x))" }],
    ]);
    await runtime.close();
  });

  it("joins several outputs into a representative message the conversations do not hold", async () => {
    const order: string[] = [];
    const store = new MemoryConversationStore();
    const runtime = createRuntime({
      agents: { split: { model: "s" }, a: { model: "a" }, b: { model: "b" } },
      flow: { in: "split", routes: [{ from: "split", to: "a" }, { from: "split", to: "b" }, { from: "a", to: "out" }, { from: "b", to: "out" }] },
    }, { directory: ".", models: { s: echo("split", order), a: echo("a", order), b: echo("b", order) }, conversationStore: store });

    const result = await runtime.runTurn("x", { conversationId: "c" });

    expect(result.output.role).toBe("assistant");
    expect(result.output.source).toBe("flow");
    expect(result.output.content).toEqual([{ type: "text", text: "a(split(x))\n\nb(split(x))" }]);
    expect(result.output.id).not.toBe(result.outputs[0]?.id);
    // The representative message carries no optional field and no conversation holds it.
    expect(Object.keys(result.output).sort()).toEqual(["content", "id", "role", "source"]);
    for (const agent of ["split", "a", "b"]) expect((await store.load("c", agent)).some((message) => message.id === result.output.id)).toBe(false);
    await runtime.close();
  });

  it("fails the turn when a route condition does not answer with a boolean", async () => {
    const order: string[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" } },
      flow: { in: "a", routes: [{ from: "a", to: "out", when: { fn: "maybe" } }] },
    }, { directory: ".", models: { a: echo("a", order) }, functions: { maybe: () => "yes" } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    await runtime.close();
  });

  it("fails the turn when a route condition throws", async () => {
    const order: string[] = [];
    const broken: GoondanFunction = () => { throw new Error("no"); };
    const runtime = createRuntime({
      agents: { a: { model: "a" } },
      flow: { in: "a", routes: [{ from: "a", to: "out", when: { fn: "broken" } }] },
    }, { directory: ".", models: { a: echo("a", order) }, functions: { broken } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    await runtime.close();
  });

  it("fails the turn when no route matches", async () => {
    const order: string[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" } },
      flow: { in: "a", routes: [{ from: "a", to: "out", when: { fn: "never" } }] },
    }, { directory: ".", models: { a: echo("a", order) }, functions: { never: () => false } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    await runtime.close();
  });

  it("checks every candidate condition in declaration order and stops at the first bad answer", async () => {
    const order: string[] = [];
    const asked: string[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: {
        in: "a",
        routes: [
          { from: "a", to: "out", when: { fn: "first" } },
          { from: "a", to: "b", when: { fn: "second" } },
          { from: "a", to: "out", when: { fn: "third" } },
          { from: "b", to: "out" },
        ],
      },
    }, {
      directory: ".",
      models: { a: echo("a", order), b: echo("b", order) },
      functions: {
        first: () => { asked.push("first"); return false; },
        second: () => { asked.push("second"); return 1; },
        third: () => { asked.push("third"); return true; },
      },
    });

    await runtime.runTurn("x", { conversationId: "c" }).catch(() => undefined);

    expect(asked).toEqual(["first", "second"]);
    await runtime.close();
  });
});

describe("route functions and carry", () => {
  it("hands the output text, the input of the previous agent and its conversation to carry", async () => {
    const order: string[] = [];
    const seen: Json[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: { in: "a", routes: [{ from: "a", to: "b", carry: { message: { fn: "shape" } } }, { from: "b", to: "out" }] },
    }, {
      directory: ".",
      models: { a: echo("a", order), b: echo("b", order) },
      functions: { shape: (value) => { seen.push(value); return "carried"; } },
    });

    const result = await runtime.runTurn("x", { conversationId: "c" });

    const [received] = seen;
    expect(received).toMatchObject({ output: "a(x)", input: "x" });
    const conversation: unknown = typeof received === "object" && received !== null && !Array.isArray(received) ? received.conversation : undefined;
    expect(Array.isArray(conversation) ? conversation.length : 0).toBe(2);
    expect(result.output.content).toEqual([{ type: "text", text: "b(carried)" }]);
    await runtime.close();
  });

  it("replaces the stored conversation of the next agent before its input stage and keeps it on failure", async () => {
    const order: string[] = [];
    const store = new MemoryConversationStore();
    await store.replace("c", "b", [assistant("old", "old")]);
    const broken: Model = { async generate(): Promise<ModelResult> { throw new Error("down"); } };
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: { in: "a", routes: [{ from: "a", to: "b", carry: { conversation: "asis" } }, { from: "b", to: "out" }] },
    }, { directory: ".", models: { a: echo("a", order), b: broken }, conversationStore: store });

    await runtime.runTurn("x", { conversationId: "c" }).catch(() => undefined);

    // The conversation of `a` replaced the one `b` had stored, and the failure did not undo it.
    const stored = await store.load("c", "b");
    expect(stored.map((message) => message.source)).toEqual(["a", "model", "b"]);
    expect(stored.some((message) => message.id === "old")).toBe(false);
    await runtime.close();
  });

  it("fails the turn when a carry conversation function does not return messages", async () => {
    const order: string[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: { in: "a", routes: [{ from: "a", to: "b", carry: { conversation: { fn: "shape" } } }, { from: "b", to: "out" }] },
    }, { directory: ".", models: { a: echo("a", order), b: echo("b", order) }, functions: { shape: () => [{ id: "x" }] } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    expect(order).toEqual(["a"]);
    await runtime.close();
  });

  it("fails the turn when a carried message has no source and runs the next agent when it has one", async () => {
    const without: Json = [{ id: "s1", role: "user", content: [{ type: "text", text: "carried" }] }];
    const complete: Json = [{ id: "s1", role: "user", source: "seed", content: [{ type: "text", text: "carried" }] }];
    const config = {
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: { in: "a", routes: [{ from: "a", to: "b", carry: { conversation: { fn: "seed" } } }, { from: "b", to: "out" }] },
    };
    const partial: string[] = [];
    const missing = createRuntime(config, {
      directory: ".", models: { a: echo("a", partial), b: echo("b", partial) }, functions: { seed: () => without },
    });

    const error: unknown = await missing.runTurn("x", { conversationId: "c" }).catch((issue: unknown) => issue);

    // A carried message is the message of the conversation stage, so `source` is as required as `id`.
    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    expect(partial).toEqual(["a"]);
    await missing.close();

    const order: string[] = [];
    const runtime = createRuntime(config, {
      directory: ".", models: { a: echo("a", order), b: echo("b", order) }, functions: { seed: () => complete },
    });

    const result = await runtime.runTurn("x", { conversationId: "c" });

    expect(order).toEqual(["a", "b"]);
    expect(result.output.content).toEqual([{ type: "text", text: "b(a(x))" }]);
    await runtime.close();
  });

  it("fails the turn when a carry message function throws", async () => {
    const order: string[] = [];
    const broken: GoondanFunction = () => { throw new Error("no"); };
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: { in: "a", routes: [{ from: "a", to: "b", carry: { message: { fn: "broken" } } }, { from: "b", to: "out" }] },
    }, { directory: ".", models: { a: echo("a", order), b: echo("b", order) }, functions: { broken } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    await runtime.close();
  });
});

describe("the output text", () => {
  it("joins text parts and the JSON text of json parts without a separator", async () => {
    const order: string[] = [];
    const rich: Model = {
      async generate(): Promise<ModelResult> {
        return {
          message: { id: "a", role: "assistant", source: "model", content: [{ type: "text", text: "T" }, { type: "json", value: { k: 1 } }, { type: "image", url: "u", mediaType: "image/png" }] },
          finishReason: "stop",
        };
      },
    };
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: ["a", "b"],
    }, { directory: ".", models: { a: rich, b: echo("b", order) } });

    const result = await runtime.runTurn("x", { conversationId: "c" });

    expect(result.output.content).toEqual([{ type: "text", text: 'b(T{"k":1})' }]);
    await runtime.close();
  });
});

describe("the start agent and a single agent run", () => {
  it("refuses a turn that declares both agent and startAgent", async () => {
    const order: string[] = [];
    const runtime = createRuntime({ agents: { a: { model: "a" } } }, { directory: ".", models: { a: echo("a", order) } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c", agent: "a", startAgent: "a" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    expect(order).toEqual([]);
    await runtime.close();
  });

  it("refuses an agent path the configuration does not declare", async () => {
    const order: string[] = [];
    const runtime = createRuntime({ agents: { a: { model: "a" } } }, { directory: ".", models: { a: echo("a", order) } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c", agent: "ghost" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    expect(order).toEqual([]);
    await runtime.close();
  });

  it("refuses a start agent no route continues and runs no agent", async () => {
    const order: string[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: { in: "a", routes: [{ from: "a", to: "out" }] },
    }, { directory: ".", models: { a: echo("a", order), b: echo("b", order) } });

    const error: unknown = await runtime.runTurn("x", { conversationId: "c", startAgent: "b" }).catch((issue: unknown) => issue);

    expect(failure(error)).toEqual({ where: "runtime", codes: ["flow_error"] });
    expect(order).toEqual([]);
    await runtime.close();
  });

  it("runs only the agent a turn names and follows no route", async () => {
    const order: string[] = [];
    const runtime = createRuntime({
      agents: { a: { model: "a" }, b: { model: "b" } },
      flow: ["a", "b"],
    }, { directory: ".", models: { a: echo("a", order), b: echo("b", order) } });

    const result = await runtime.runTurn("x", { conversationId: "c", agent: "a" });

    expect(order).toEqual(["a"]);
    expect(result.outputs).toHaveLength(1);
    await runtime.close();
  });
});
