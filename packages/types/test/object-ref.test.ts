import { describe, expect, it } from "vitest";

import { formatObjectRef, parseObjectRef } from "../src/index.js";

describe("ObjectRef parser and formatter", () => {
  it("parses Kind/name string format", () => {
    const parsed = parseObjectRef("Model/claude");

    expect(parsed.kind).toBe("Model");
    expect(parsed.name).toBe("claude");
    expect(parsed.package).toBeUndefined();
  });

  it("formats object and string ref to Kind/name", () => {
    const formattedFromObject = formatObjectRef({
      kind: "Tool",
      name: "bash",
      package: "@goondan/base",
    });
    const formattedFromString = formatObjectRef("Swarm/default");

    expect(formattedFromObject).toBe("Tool/bash");
    expect(formattedFromString).toBe("Swarm/default");
  });

  it("throws when ref string is invalid", () => {
    expect(() => parseObjectRef("Model")).toThrowError("Invalid ObjectRef string: Model");
    expect(() => parseObjectRef("Model/claude/v2")).toThrowError(
      "Invalid ObjectRef string (multiple slashes): Model/claude/v2",
    );
  });
});
