import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { createGoondan, defineExtension, MemoryStore, type ModelResponse } from "../src/index.ts";

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function answer(): ModelResponse {
  return { message: { role: "assistant", content: [{ type: "text", text: "done" }] }, finishReason: "stop" };
}

describe("PR #2 regressions", () => {
  it("reserves a route function before an asynchronous event receiver yields", async () => {
    const started = deferred(); const release = deferred();
    let settled = false;
    const runtime = createGoondan({ agents: { main: { model: "m" } }, routes: [
      { from: "$input", to: "main" }, { from: "main", to: { fn: "pass" } }, { from: { fn: "pass" }, to: "$output" },
    ] }, { models: { m: { generate: async () => answer() } }, functions: { pass: (value) => value }, host: {
      emit: async (event) => { if (event.type === "route.function.start") { started.resolve(); await release.promise; } },
    } });
    try {
      const run = await runtime.run("hi");
      void run.result.then(() => { settled = true; });
      await started.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      release.resolve();
      expect((await run.result).output).toBe("done");
    } finally { release.resolve(); await runtime.close(); }
  });

  it.each([false, true])("keeps stateless extensions until their hooks settle (close=%s)", async (close) => {
    const started = deferred(); const release = deferred(); const log: string[] = [];
    const ext = defineExtension({ name: "ext", hooks: ["onOutput"], create: () => ({
      hooks: { onOutput: async (_value, ctx) => {
        started.resolve();
        try {
          await new Promise<void>((resolve) => {
            void release.promise.then(resolve);
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        } finally { log.push("hook finished"); }
      } }, dispose: () => { log.push("disposed"); },
    }) });
    const runtime = createGoondan({ agents: { main: { model: "m", stateful: false, extensions: { ext: {} }, hooks: { onOutput: [{ extension: "ext", mode: "async" }] } } } }, {
      models: { m: { generate: async () => answer() } }, extensions: { ext },
    });
    await (await runtime.run("hi")).result;
    await started.promise;
    expect(log).toEqual([]);
    if (close) await runtime.close();
    else { release.resolve(); await runtime.idle(); await runtime.close(); }
    expect(log).toEqual(["hook finished", "disposed"]);
  });

  it("preserves extensions when another writer prevents deletion", async () => {
    const store = new MemoryStore(); let created = 0; let disposed = 0;
    const ext = defineExtension({ name: "ext", create: () => { created += 1; return { dispose: () => { disposed += 1; } }; } });
    const runtime = createGoondan({ agents: { main: { model: "m", extensions: { ext: {} } } } }, { store, extensions: { ext }, models: { m: { generate: async () => answer() } } });
    try {
      await (await runtime.run("hi", { sessionId: "s" })).result;
      await runtime.idle();
      const lease = await store.acquireLease("s", "other");
      expect(lease).not.toBeNull();
      await expect(runtime.sessions.delete("s")).rejects.toMatchObject({ codes: ["runtime_error"] });
      expect(disposed).toBe(0);
      await lease?.release();
      await (await runtime.run("again", { sessionId: "s" })).result;
      expect(created).toBe(1);
    } finally { await runtime.close(); }
  });

  it("removes watch abort listeners on every append wake-up", async () => {
    const store = new MemoryStore(); const controller = new AbortController();
    const watcher = store.watch({ sessionId: "s", signal: controller.signal })[Symbol.asyncIterator]();
    for (let i = 0; i < 20; i += 1) {
      const next = watcher.next();
      await store.append([{ version: 1, type: "turn.start", sessionId: "s", turnId: `t${i}`, data: {} }]);
      await next;
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    }
    const pending = watcher.next();
    controller.abort();
    expect((await pending).done).toBe(true);
  });
});
