import { describe, expect, it } from "vitest";

import { parseScopedPackageName } from "../src/router.js";
import { parseAuthTokens, toMetadataKey, toTarballKey } from "../src/worker.js";

describe("worker utility functions", () => {
  it("토큰 문자열을 파싱한다", () => {
    expect(parseAuthTokens(undefined)).toEqual([]);
    expect(parseAuthTokens(" ")).toEqual([]);
    expect(parseAuthTokens("alpha,beta, gamma ")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("KV/R2 키를 생성한다", () => {
    const parsed = parseScopedPackageName("@goondan/base");
    if (parsed === null) {
      throw new Error("failed to parse package name");
    }

    const metadataKey = toMetadataKey(parsed);
    const tarballKey = toTarballKey(parsed, "1.2.3");

    expect(metadataKey).toBe("packages/%40goondan/base/metadata.json");
    expect(tarballKey).toBe("packages/%40goondan/base/tarballs/1.2.3.tgz");
  });
});
