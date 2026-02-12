import { describe, expect, it } from "vitest";

import { isSecretRefPath, resolveValueSource } from "../src/index.js";

describe("ValueSource resolver", () => {
  it("returns inline value", () => {
    const result = resolveValueSource({ value: "direct" });
    expect(result).toBe("direct");
  });

  it("resolves value from env", () => {
    const result = resolveValueSource(
      {
        valueFrom: {
          env: "API_KEY",
        },
      },
      {
        env: {
          API_KEY: "secret-api-key",
        },
      },
    );

    expect(result).toBe("secret-api-key");
  });

  it("resolves value from secretRef", () => {
    const result = resolveValueSource(
      {
        valueFrom: {
          secretRef: {
            ref: "Secret/telegram",
            key: "token",
          },
        },
      },
      {
        resolveSecretRef(secretRef) {
          if (secretRef.ref === "Secret/telegram" && secretRef.key === "token") {
            return "bot-token";
          }

          return undefined;
        },
      },
    );

    expect(result).toBe("bot-token");
  });

  it("throws for missing required env", () => {
    expect(() =>
      resolveValueSource({ valueFrom: { env: "MISSING_ENV" } }, { env: {} }),
    ).toThrowError("Missing required environment variable: MISSING_ENV");
  });

  it("returns undefined for missing optional env", () => {
    const result = resolveValueSource(
      { valueFrom: { env: "MISSING_OPTIONAL_ENV" } },
      { env: {}, required: false },
    );

    expect(result).toBeUndefined();
  });

  it("validates SecretRef path shape", () => {
    expect(isSecretRefPath("Secret/my-secret")).toBe(true);
    expect(isSecretRefPath("Tool/bash")).toBe(false);
    expect(isSecretRefPath("Secret/my/secret")).toBe(false);
  });
});
