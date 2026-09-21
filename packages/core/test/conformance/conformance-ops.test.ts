import { describe, expect, it } from "vitest";
import { parseOp, type Op } from "./conformance-case.ts";
import { GateRegistry } from "./conformance-gates.ts";
import { type Json, isJsonObject, snapshot } from "./conformance-json.ts";
import { type OpContext, ScriptError, runOp } from "./conformance-ops.ts";

function context(overrides: Partial<OpContext> = {}): OpContext {
  return { gates: new GateRegistry(), counters: new Map(), owner: {}, ...overrides };
}

async function run(raw: Json, value: unknown, ctx = context()): Promise<unknown> {
  return runOp(parseOp(raw, "/op", ctx.hook ? "hook" : "value", "site"), value, ctx);
}

describe("value operations", () => {
  it("identity and constant", async () => {
    await expect(run({ op: "identity" }, { a: 1 })).resolves.toEqual({ a: 1 });
    await expect(run({ op: "constant", value: null }, { a: 1 })).resolves.toBeNull();
  });

  it("get returns null for a missing path", async () => {
    await expect(run({ op: "get", path: "/a/0" }, { a: [7] })).resolves.toBe(7);
    await expect(run({ op: "get", path: "/b" }, { a: 1 })).resolves.toBeNull();
  });

  it("set copies the value", async () => {
    await expect(run({ op: "set", path: "/a", value: 2 }, { a: 1 })).resolves.toEqual({ a: 2 });
    await expect(run({ op: "set", path: "/b/c", value: 2 }, { a: 1 })).rejects.toThrow("no parent");
  });

  it("merge needs an object", async () => {
    await expect(run({ op: "merge", value: { b: 2 } }, { a: 1 })).resolves.toEqual({ a: 1, b: 2 });
    await expect(run({ op: "merge", value: { b: 2 } }, "text")).rejects.toThrow(ScriptError);
  });

  it("wrap puts the received value under key first", async () => {
    const wrapped = snapshot(await run({ op: "wrap", key: "input", with: { extra: 1 } }, "hi"));
    expect(wrapped).toEqual({ input: "hi", extra: 1 });
    expect(isJsonObject(wrapped) ? Object.keys(wrapped) : []).toEqual(["input", "extra"]);
  });

  it("equals compares JSON values and treats a missing path as null", async () => {
    await expect(run({ op: "equals", value: 1 }, 1.0)).resolves.toBe(true);
    await expect(run({ op: "equals", value: 1 }, true)).resolves.toBe(false);
    await expect(run({ op: "equals", path: "/a", value: null }, {})).resolves.toBe(true);
  });

  it("text joins text parts and textSuffix appends", async () => {
    const message = { role: "assistant", content: [{ type: "text", text: "a" }, { type: "json", value: 1 }, { type: "text", text: "b" }] };
    await expect(run({ op: "text" }, message)).resolves.toBe("ab");
    await expect(run({ op: "textSuffix", suffix: "!" }, "a")).resolves.toBe("a!");
    await expect(run({ op: "text" }, 1)).rejects.toThrow(ScriptError);
  });

  it("result builds a runtime-normalizable control result", async () => {
    const value = await run({ op: "result", content: [{ type: "text", text: "x" }], isError: true }, { id: "c1", name: "lookup", args: { q: 1 } });
    expect(value).toEqual({
      result: { content: [{ type: "text", text: "x" }], isError: true },
    });
    await expect(run({ op: "result", content: [] }, { id: "c1" })).resolves.toEqual({ result: { content: [] } });
  });

  it("sequence counts calls per site and repeats the last item", async () => {
    const ctx = context();
    const op: Op = parseOp({ op: "sequence", items: [{ op: "constant", value: 1 }, { op: "constant", value: 2 }] }, "/op", "value", "site");
    const results = [await runOp(op, null, ctx), await runOp(op, null, ctx), await runOp(op, null, ctx)];
    expect(results).toEqual([1, 2, 2]);
  });

  it("chain feeds each result into the next operation", async () => {
    await expect(
      run({ op: "chain", ops: [{ op: "get", path: "/a" }, { op: "textSuffix", suffix: "!" }] }, { a: "hi" }),
    ).resolves.toBe("hi!");
  });

  it("throw raises a script error", async () => {
    await expect(run({ op: "throw", message: "boom" }, null)).rejects.toThrow("boom");
  });

  it("nonJson returns a value JSON cannot hold", async () => {
    await expect(run({ op: "nonJson" }, null)).resolves.toBeNaN();
  });

  it("await waits for the gate and then applies then", async () => {
    const ctx = context();
    const pending = run({ op: "await", gate: "g", then: { op: "constant", value: "done" } }, null, ctx);
    await ctx.gates.reach("g");
    ctx.gates.release("g");
    await expect(pending).resolves.toBe("done");
  });
});

describe("hook operations", () => {
  it("are rejected without a hook context", async () => {
    const op = parseOp({ op: "runModel", messages: [] }, "/op", "hook", "site");
    await expect(runOp(op, null, context())).rejects.toThrow("needs a hook context");
  });

  it("append builds messages through the hook context", async () => {
    const calls: unknown[] = [];
    const ctx = context({
      hook: {
        messageUser: (text, extra) => ({ role: "user", text, extra }),
        messageSystem: (text) => ({ role: "system", text }),
        append: (messages) => ({ append: messages }),
        runAgent: async (name, input) => {
          calls.push({ name, input });
          return null;
        },
        runModel: async () => null,
        render: async () => "rendered",
        complete: (message) => calls.push(message),
      },
    });
    await expect(
      run({ op: "append", messages: [{ role: "user", text: "a", keep: true }, { role: "system", text: "b" }] }, null, ctx),
    ).resolves.toEqual({
      append: [
        { role: "user", text: "a", extra: { keep: true } },
        { role: "system", text: "b" },
      ],
    });
    await expect(run({ op: "runAgent", name: "worker" }, { a: 1 }, ctx)).resolves.toBeNull();
    expect(calls[0]).toEqual({ name: "worker", input: { a: 1 } });
    await expect(run({ op: "render", template: "t.md" }, null, ctx)).resolves.toBe("rendered");
  });

  it("complete only fires for the named tool and can reuse the result content", async () => {
    const completed: unknown[] = [];
    const ctx = context({
      hook: {
        messageUser: (text) => text,
        messageSystem: (text) => text,
        append: (messages) => messages,
        runAgent: async () => null,
        runModel: async () => null,
        render: async () => "",
        complete: (message) => completed.push(message),
      },
    });
    const message = { id: "m1", role: "assistant", source: "hook", content: [] };
    await run({ op: "complete", message, tool: "other" }, { name: "lookup", content: [{ type: "text", text: "x" }] }, ctx);
    expect(completed).toEqual([]);
    await run(
      { op: "complete", message, tool: "lookup", useResultContent: true },
      { name: "lookup", content: [{ type: "text", text: "x" }] },
      ctx,
    );
    expect(completed).toEqual([{ id: "m1", role: "assistant", source: "hook", content: [{ type: "text", text: "x" }] }]);
  });
});

describe("gates", () => {
  it("does not wait on an already open gate", async () => {
    const gates = new GateRegistry();
    gates.release("g");
    await expect(gates.wait("g")).resolves.toBeUndefined();
  });

  it("refuses to release the reserved gate", () => {
    expect(() => new GateRegistry().release("never")).toThrow("never");
  });

  it("cancels the waits of one owner", async () => {
    const gates = new GateRegistry();
    const owner = {};
    const pending = gates.wait("g", { owner });
    gates.cancelOwner(owner);
    await expect(pending).rejects.toThrow("runtime closed");
  });

  it("cancels a wait through an abort signal", async () => {
    const gates = new GateRegistry();
    const controller = new AbortController();
    const pending = gates.wait("g", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
