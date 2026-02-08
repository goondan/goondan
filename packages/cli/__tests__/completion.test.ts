/**
 * gdn completion command tests
 */

import { describe, it, expect, vi } from "vitest";
import { createCompletionCommand } from "../src/commands/completion.js";

async function renderCompletionScript(shell: string): Promise<string> {
  const command = createCompletionCommand();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  try {
    await command.parseAsync([shell], { from: "user" });
    const output = logSpy.mock.calls[0]?.[0];
    return typeof output === "string" ? output : String(output ?? "");
  } finally {
    logSpy.mockRestore();
  }
}

describe("gdn completion command", () => {
  it("bash script should include newly added commands", async () => {
    const script = await renderCompletionScript("bash");

    expect(script).toContain(
      'local commands="init run validate package instance logs config completion doctor"',
    );
    expect(script).toContain(
      'local package_commands="install add remove update list publish unpublish deprecate login logout pack info cache"',
    );
    expect(script).toContain(
      'local instance_commands="list inspect pause delete resume terminate"',
    );
    expect(script).toContain("doctor)");
  });

  it("zsh script should include newly added commands", async () => {
    const script = await renderCompletionScript("zsh");

    expect(script).toContain(
      "'doctor:Check environment and diagnose common issues'",
    );
    expect(script).toContain("'unpublish:Unpublish package version'");
    expect(script).toContain("'deprecate:Set package deprecation notice'");
    expect(script).toContain("'pause:Pause an instance'");
    expect(script).toContain("'terminate:Terminate an instance'");
  });

  it("fish script should include newly added commands", async () => {
    const script = await renderCompletionScript("fish");

    expect(script).toContain('-a "doctor" -d "Check environment and diagnose issues"');
    expect(script).toContain('-a "unpublish" -d "Unpublish package"');
    expect(script).toContain('-a "deprecate" -d "Deprecate package"');
    expect(script).toContain('-a "pause" -d "Pause instance"');
    expect(script).toContain('-a "terminate" -d "Terminate instance"');
  });

  it("powershell script should include newly added commands", async () => {
    const script = await renderCompletionScript("powershell");

    expect(script).toContain("'completion', 'doctor'");
    expect(script).toContain("'publish', 'unpublish', 'deprecate'");
    expect(script).toContain("'inspect', 'pause', 'delete', 'resume', 'terminate'");
  });
});

