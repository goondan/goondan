import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRegistryClient, parsePackageRef } from "../src/services/registry.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("registry client", () => {
  it("scoped package ref를 파싱한다", () => {
    expect(parsePackageRef("@goondan/base")).toEqual({
      name: "@goondan/base",
    });

    expect(parsePackageRef("@goondan/base@1.2.3")).toEqual({
      name: "@goondan/base",
      version: "1.2.3",
    });
  });

  it("패키지 버전 메타데이터를 조회한다", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          version: "0.1.0",
          dependencies: {
            "@goondan/types": "^0.1.0",
          },
          deprecated: "",
          access: "public",
          dist: {
            tarball: "https://registry.example.com/@goondan/base/-/base-0.1.0.tgz",
            shasum: "abc",
            integrity: "sha512-abc",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    globalThis.fetch = fetchMock;

    const client = new HttpRegistryClient();
    const metadata = await client.getPackageVersion("@goondan/base", "0.1.0", "https://registry.example.com");

    expect(metadata.version).toBe("0.1.0");
    expect(metadata.dist.tarball).toContain("base-0.1.0.tgz");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("레지스트리 fetch 예외를 NETWORK_ERROR로 변환한다", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = fetchMock;

    const client = new HttpRegistryClient();

    await expect(client.resolvePackage("@goondan/base", "https://registry.example.com")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
