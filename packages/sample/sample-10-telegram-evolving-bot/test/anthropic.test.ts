import { describe, expect, it } from "vitest";

import { parseJsonObjectFromText } from "../src/anthropic.js";

describe("parseJsonObjectFromText", () => {
  it("parses fenced json", () => {
    const raw = "```json\n{\"summary\":\"ok\",\"updates\":[]}\n```";
    const parsed = parseJsonObjectFromText(raw);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.summary).toBe("ok");
    }
  });

  it("returns null for non-json text", () => {
    const parsed = parseJsonObjectFromText("hello world");
    expect(parsed).toBeNull();
  });
});
