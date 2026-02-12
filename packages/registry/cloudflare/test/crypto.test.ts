import { describe, expect, it } from "vitest";
import { createDistIntegrity, decodeBase64 } from "../src/crypto.js";

describe("crypto helpers", () => {
  it("creates integrity values", async () => {
    const bytes = new TextEncoder().encode("hello");
    const integrity = await createDistIntegrity(bytes);

    expect(integrity.shasum).toHaveLength(40);
    expect(integrity.integrity.startsWith("sha512-")).toBe(true);
  });

  it("decodes valid base64 and rejects invalid value", () => {
    const decoded = decodeBase64("aGVsbG8=");
    expect(decoded).not.toBeNull();
    if (decoded !== null) {
      expect(new TextDecoder().decode(decoded)).toBe("hello");
    }

    const invalid = decodeBase64("@@@");
    expect(invalid).toBeNull();
  });
});
