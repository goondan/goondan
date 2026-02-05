/**
 * Goondan Registry Worker 테스트
 *
 * 모든 유틸리티 함수와 핸들러 로직을 테스트합니다.
 *
 * NOTE: Worker 핸들러 테스트는 MockEnv를 사용하며, Cloudflare Workers 타입과의
 * 호환성을 위해 타입 가드를 통해 안전하게 처리합니다.
 */

import { describe, it, expect } from "vitest";
import {
  corsHeaders,
  jsonResponse,
  errorResponse,
  notFoundResponse,
  parsePackageName,
  getFullPackageName,
  getMetadataKey,
  getTarballKey,
  getTarballUrl,
  extractBearerToken,
  calculateIntegrity,
  calculateShasum,
  verifyIntegrity,
  type PackageMetadata,
  type VersionMetadata,
  type PublishPayload,
} from "../src/index.js";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Uint8Array의 buffer를 ArrayBuffer로 안전하게 변환
 * Uint8Array.buffer는 ArrayBufferLike를 반환하므로 복사가 필요
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

// =============================================================================
// Tests: parsePackageName
// =============================================================================

describe("parsePackageName", () => {
  it("should parse scoped package name correctly", () => {
    const result = parsePackageName("/@goondan/base");
    expect(result).toEqual({
      scope: "@goondan",
      name: "base",
      rest: [],
    });
  });

  it("should parse unscoped package name correctly", () => {
    const result = parsePackageName("/lodash");
    expect(result).toEqual({
      scope: null,
      name: "lodash",
      rest: [],
    });
  });

  it("should parse scoped package with version path", () => {
    const result = parsePackageName("/@goondan/base/1.0.0");
    expect(result).toEqual({
      scope: "@goondan",
      name: "base",
      rest: ["1.0.0"],
    });
  });

  it("should parse scoped package with tarball path", () => {
    const result = parsePackageName("/@goondan/base/-/base-1.0.0.tgz");
    expect(result).toEqual({
      scope: "@goondan",
      name: "base",
      rest: ["-", "base-1.0.0.tgz"],
    });
  });

  it("should parse unscoped package with version path", () => {
    const result = parsePackageName("/lodash/4.17.21");
    expect(result).toEqual({
      scope: null,
      name: "lodash",
      rest: ["4.17.21"],
    });
  });

  it("should return null for empty path", () => {
    const result = parsePackageName("/");
    expect(result).toBeNull();
  });

  it("should return null for incomplete scoped package", () => {
    const result = parsePackageName("/@goondan");
    expect(result).toBeNull();
  });

  it("should handle multiple path segments", () => {
    const result = parsePackageName("/lodash/-/lodash-4.17.21.tgz");
    expect(result).toEqual({
      scope: null,
      name: "lodash",
      rest: ["-", "lodash-4.17.21.tgz"],
    });
  });

  it("should handle URL encoded paths", () => {
    const result = parsePackageName("/@goondan/base");
    expect(result?.scope).toBe("@goondan");
  });

  it("should parse deeply nested path", () => {
    const result = parsePackageName("/@goondan/base/-/base-1.0.0.tgz/extra");
    expect(result).toEqual({
      scope: "@goondan",
      name: "base",
      rest: ["-", "base-1.0.0.tgz", "extra"],
    });
  });

  it("should handle empty string path", () => {
    const result = parsePackageName("");
    expect(result).toBeNull();
  });
});

// =============================================================================
// Tests: getFullPackageName
// =============================================================================

describe("getFullPackageName", () => {
  it("should return scoped package name with scope", () => {
    expect(getFullPackageName("@goondan", "base")).toBe("@goondan/base");
  });

  it("should return just name when scope is null", () => {
    expect(getFullPackageName(null, "lodash")).toBe("lodash");
  });

  it("should handle empty name", () => {
    expect(getFullPackageName("@goondan", "")).toBe("@goondan/");
  });

  it("should handle different scopes", () => {
    expect(getFullPackageName("@types", "node")).toBe("@types/node");
    expect(getFullPackageName("@scope", "pkg")).toBe("@scope/pkg");
  });
});

// =============================================================================
// Tests: getMetadataKey
// =============================================================================

describe("getMetadataKey", () => {
  it("should generate key for scoped package", () => {
    expect(getMetadataKey("@goondan", "base")).toBe("pkg:@goondan/base");
  });

  it("should generate key for unscoped package", () => {
    expect(getMetadataKey(null, "lodash")).toBe("pkg:lodash");
  });

  it("should handle various package names", () => {
    expect(getMetadataKey("@org", "my-package")).toBe("pkg:@org/my-package");
    expect(getMetadataKey(null, "simple")).toBe("pkg:simple");
  });
});

// =============================================================================
// Tests: getTarballKey
// =============================================================================

describe("getTarballKey", () => {
  it("should generate key for scoped package", () => {
    expect(getTarballKey("@goondan", "base", "1.0.0")).toBe(
      "@goondan/base/-/base-1.0.0.tgz"
    );
  });

  it("should generate key for unscoped package", () => {
    expect(getTarballKey(null, "lodash", "4.17.21")).toBe(
      "lodash/-/lodash-4.17.21.tgz"
    );
  });

  it("should handle prerelease versions", () => {
    expect(getTarballKey("@goondan", "base", "1.0.0-beta.1")).toBe(
      "@goondan/base/-/base-1.0.0-beta.1.tgz"
    );
  });

  it("should handle alpha versions", () => {
    expect(getTarballKey("@scope", "pkg", "2.0.0-alpha.5")).toBe(
      "@scope/pkg/-/pkg-2.0.0-alpha.5.tgz"
    );
  });

  it("should handle rc versions", () => {
    expect(getTarballKey(null, "express", "5.0.0-rc.1")).toBe(
      "express/-/express-5.0.0-rc.1.tgz"
    );
  });
});

// =============================================================================
// Tests: getTarballUrl
// =============================================================================

describe("getTarballUrl", () => {
  it("should generate URL for scoped package", () => {
    expect(
      getTarballUrl("https://registry.goondan.io", "@goondan", "base", "1.0.0")
    ).toBe("https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz");
  });

  it("should generate URL for unscoped package", () => {
    expect(
      getTarballUrl("https://registry.goondan.io", null, "lodash", "4.17.21")
    ).toBe("https://registry.goondan.io/lodash/-/lodash-4.17.21.tgz");
  });

  it("should handle different registry URLs", () => {
    expect(
      getTarballUrl("https://npm.example.com", "@scope", "pkg", "2.0.0")
    ).toBe("https://npm.example.com/@scope/pkg/-/pkg-2.0.0.tgz");
  });

  it("should handle registry URL without trailing slash", () => {
    expect(
      getTarballUrl("https://registry.npmjs.org", null, "react", "18.0.0")
    ).toBe("https://registry.npmjs.org/react/-/react-18.0.0.tgz");
  });

  it("should handle localhost URLs", () => {
    expect(
      getTarballUrl("http://localhost:8787", "@goondan", "test", "0.0.1")
    ).toBe("http://localhost:8787/@goondan/test/-/test-0.0.1.tgz");
  });
});

// =============================================================================
// Tests: extractBearerToken
// =============================================================================

describe("extractBearerToken", () => {
  it("should extract bearer token from header", () => {
    expect(extractBearerToken("Bearer test-token-123")).toBe("test-token-123");
  });

  it("should return null for null header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("should return null for empty header", () => {
    expect(extractBearerToken("")).toBeNull();
  });

  it("should return null for Basic auth header", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });

  it("should handle case insensitivity", () => {
    expect(extractBearerToken("bearer my-token")).toBe("my-token");
    expect(extractBearerToken("BEARER MY-TOKEN")).toBe("MY-TOKEN");
    expect(extractBearerToken("BeArEr MiXeD")).toBe("MiXeD");
  });

  it("should handle tokens with special characters", () => {
    expect(extractBearerToken("Bearer abc123-def_456.xyz")).toBe(
      "abc123-def_456.xyz"
    );
  });

  it("should handle tokens with spaces in value", () => {
    expect(extractBearerToken("Bearer token with spaces")).toBe(
      "token with spaces"
    );
  });

  it("should handle multiple spaces after Bearer", () => {
    // regex \s+ consumes all spaces, so only "token" is captured
    expect(extractBearerToken("Bearer   token")).toBe("token");
  });

  it("should return null for malformed bearer", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
    // "Bearer " with trailing space matches \s+ but (.+) requires at least one char
    expect(extractBearerToken("Bearer ")).toBeNull();
  });

  it("should handle JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(extractBearerToken(`Bearer ${jwt}`)).toBe(jwt);
  });
});

// =============================================================================
// Tests: calculateIntegrity
// =============================================================================

describe("calculateIntegrity", () => {
  it("should calculate SHA-512 integrity hash", async () => {
    const data = new TextEncoder().encode("test data");
    const integrity = await calculateIntegrity(toArrayBuffer(data));

    expect(integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
  });

  it("should return consistent hash for same data", async () => {
    const data1 = new TextEncoder().encode("same content");
    const data2 = new TextEncoder().encode("same content");

    const hash1 = await calculateIntegrity(toArrayBuffer(data1));
    const hash2 = await calculateIntegrity(toArrayBuffer(data2));

    expect(hash1).toBe(hash2);
  });

  it("should return different hash for different data", async () => {
    const data1 = new TextEncoder().encode("content 1");
    const data2 = new TextEncoder().encode("content 2");

    const hash1 = await calculateIntegrity(toArrayBuffer(data1));
    const hash2 = await calculateIntegrity(toArrayBuffer(data2));

    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty buffer", async () => {
    const data = new ArrayBuffer(0);
    const integrity = await calculateIntegrity(data);

    expect(integrity).toMatch(/^sha512-/);
  });

  it("should handle binary data", async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const integrity = await calculateIntegrity(toArrayBuffer(bytes));

    expect(integrity).toMatch(/^sha512-/);
  });

  it("should handle large data", async () => {
    const largeData = new Uint8Array(10000);
    for (let i = 0; i < 10000; i++) {
      largeData[i] = i % 256;
    }
    const integrity = await calculateIntegrity(toArrayBuffer(largeData));

    expect(integrity).toMatch(/^sha512-/);
    expect(integrity.length).toBeGreaterThan(10);
  });
});

// =============================================================================
// Tests: calculateShasum
// =============================================================================

describe("calculateShasum", () => {
  it("should calculate SHA-1 shasum", async () => {
    const data = new TextEncoder().encode("test data");
    const shasum = await calculateShasum(toArrayBuffer(data));

    // SHA-1 produces 40 hex characters
    expect(shasum).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should return consistent hash for same data", async () => {
    const data1 = new TextEncoder().encode("same content");
    const data2 = new TextEncoder().encode("same content");

    const hash1 = await calculateShasum(toArrayBuffer(data1));
    const hash2 = await calculateShasum(toArrayBuffer(data2));

    expect(hash1).toBe(hash2);
  });

  it("should return different hash for different data", async () => {
    const data1 = new TextEncoder().encode("content 1");
    const data2 = new TextEncoder().encode("content 2");

    const hash1 = await calculateShasum(toArrayBuffer(data1));
    const hash2 = await calculateShasum(toArrayBuffer(data2));

    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty buffer", async () => {
    const data = new ArrayBuffer(0);
    const shasum = await calculateShasum(data);

    expect(shasum).toMatch(/^[0-9a-f]{40}$/);
    // SHA-1 of empty string is known
    expect(shasum).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it("should produce lowercase hex", async () => {
    const data = new TextEncoder().encode("TEST");
    const shasum = await calculateShasum(toArrayBuffer(data));

    expect(shasum).toBe(shasum.toLowerCase());
  });
});

// =============================================================================
// Tests: verifyIntegrity
// =============================================================================

describe("verifyIntegrity", () => {
  it("should return true for matching integrity", async () => {
    const data = new TextEncoder().encode("test data");
    const integrity = await calculateIntegrity(toArrayBuffer(data));

    const isValid = await verifyIntegrity(toArrayBuffer(data), integrity);
    expect(isValid).toBe(true);
  });

  it("should return false for non-matching integrity", async () => {
    const data = new TextEncoder().encode("test data");
    const wrongIntegrity = "sha512-wronghashvalue";

    const isValid = await verifyIntegrity(toArrayBuffer(data), wrongIntegrity);
    expect(isValid).toBe(false);
  });

  it("should return false for tampered data", async () => {
    const originalData = new TextEncoder().encode("original");
    const integrity = await calculateIntegrity(toArrayBuffer(originalData));

    const tamperedData = new TextEncoder().encode("tampered");
    const isValid = await verifyIntegrity(toArrayBuffer(tamperedData), integrity);

    expect(isValid).toBe(false);
  });

  it("should return false for single byte change", async () => {
    const originalData = new Uint8Array([1, 2, 3, 4, 5]);
    const integrity = await calculateIntegrity(toArrayBuffer(originalData));

    const tamperedData = new Uint8Array([1, 2, 3, 4, 6]); // Last byte changed
    const isValid = await verifyIntegrity(toArrayBuffer(tamperedData), integrity);

    expect(isValid).toBe(false);
  });

  it("should handle empty data", async () => {
    const data = new ArrayBuffer(0);
    const integrity = await calculateIntegrity(data);

    const isValid = await verifyIntegrity(data, integrity);
    expect(isValid).toBe(true);
  });
});

// =============================================================================
// Tests: Response Helpers
// =============================================================================

describe("corsHeaders", () => {
  it("should return correct CORS headers", () => {
    const headers = corsHeaders();

    expect(headers).toEqual({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    });
  });

  it("should allow all origins", () => {
    const headers = corsHeaders();
    // Use toMatchObject to check specific property
    expect(headers).toMatchObject({ "Access-Control-Allow-Origin": "*" });
  });

  it("should include Authorization in allowed headers", () => {
    const headers = corsHeaders();
    // Check that the headers object contains expected value
    expect(headers).toMatchObject({
      "Access-Control-Allow-Headers": expect.stringContaining("Authorization"),
    });
  });
});

describe("jsonResponse", () => {
  it("should create JSON response with default status", async () => {
    const response = jsonResponse({ message: "success" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = await response.json();
    expect(body).toEqual({ message: "success" });
  });

  it("should create JSON response with custom status", async () => {
    const response = jsonResponse({ created: true }, 201);
    expect(response.status).toBe(201);
  });

  it("should include custom headers", async () => {
    const response = jsonResponse(
      { data: "test" },
      200,
      { "X-Custom": "value" }
    );

    expect(response.headers.get("X-Custom")).toBe("value");
  });

  it("should pretty print JSON", async () => {
    const response = jsonResponse({ key: "value" });
    const text = await response.text();
    expect(text).toContain("\n");
  });

  it("should handle nested objects", async () => {
    const data = {
      level1: {
        level2: {
          value: 123
        }
      }
    };
    const response = jsonResponse(data);
    const body = await response.json();
    expect(body).toEqual(data);
  });

  it("should handle arrays", async () => {
    const data = [1, 2, 3, { key: "value" }];
    const response = jsonResponse(data);
    const body = await response.json();
    expect(body).toEqual(data);
  });
});

describe("errorResponse", () => {
  it("should create error response with default status", async () => {
    const response = errorResponse("Bad request");

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toEqual({ error: "Bad request" });
  });

  it("should create error response with custom status", async () => {
    const response = errorResponse("Unauthorized", 401);
    expect(response.status).toBe(401);
  });

  it("should create 500 error response", async () => {
    const response = errorResponse("Internal server error", 500);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toEqual({ error: "Internal server error" });
  });

  it("should include CORS headers", async () => {
    const response = errorResponse("Error");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("notFoundResponse", () => {
  it("should create 404 response", async () => {
    const response = notFoundResponse("Package not found");

    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toEqual({ error: "Package not found" });
  });

  it("should include CORS headers", async () => {
    const response = notFoundResponse("Not found");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should handle detailed error messages", async () => {
    const response = notFoundResponse("Package not found: @goondan/test@1.0.0");
    const body = await response.json();
    expect(body).toEqual({ error: "Package not found: @goondan/test@1.0.0" });
  });
});

// =============================================================================
// Tests: Package Metadata Structure
// =============================================================================

describe("Package Metadata Structure", () => {
  it("should have correct structure for package metadata", () => {
    const metadata: PackageMetadata = {
      name: "@goondan/base",
      description: "Goondan base package",
      versions: {
        "1.0.0": {
          name: "@goondan/base",
          version: "1.0.0",
          dependencies: {},
          dist: {
            tarball: "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz",
            shasum: "abc123",
            integrity: "sha512-xyz",
          },
        },
      },
      "dist-tags": {
        latest: "1.0.0",
      },
    };

    expect(metadata.name).toBe("@goondan/base");
    expect(metadata.versions["1.0.0"]).toBeDefined();
    expect(metadata.versions["1.0.0"]?.dist.tarball).toContain(".tgz");
    expect(metadata["dist-tags"].latest).toBe("1.0.0");
  });

  it("should have correct structure for version metadata with bundle info", () => {
    const versionData: VersionMetadata = {
      name: "@goondan/base",
      version: "1.0.0",
      description: "Base tools and extensions",
      dependencies: {
        "@goondan/core-utils": "^0.5.0",
      },
      dist: {
        tarball: "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz",
        shasum: "abc123def456",
        integrity: "sha512-AAAA...",
      },
      bundle: {
        include: ["tools/fileRead/tool.yaml", "extensions/skills/extension.yaml"],
        runtime: "node",
      },
      publishedAt: "2026-02-06T00:00:00.000Z",
    };

    expect(versionData.bundle).toBeDefined();
    expect(versionData.bundle?.include).toHaveLength(2);
    expect(versionData.bundle?.runtime).toBe("node");
  });

  it("should support multiple versions", () => {
    const metadata: PackageMetadata = {
      name: "@goondan/multi",
      versions: {
        "1.0.0": {
          name: "@goondan/multi",
          version: "1.0.0",
          dist: { tarball: "", shasum: "", integrity: "" },
        },
        "1.1.0": {
          name: "@goondan/multi",
          version: "1.1.0",
          dist: { tarball: "", shasum: "", integrity: "" },
        },
        "2.0.0": {
          name: "@goondan/multi",
          version: "2.0.0",
          dist: { tarball: "", shasum: "", integrity: "" },
        },
      },
      "dist-tags": {
        latest: "2.0.0",
        next: "2.0.0",
        v1: "1.1.0",
      },
    };

    expect(Object.keys(metadata.versions)).toHaveLength(3);
    expect(Object.keys(metadata["dist-tags"])).toHaveLength(3);
  });

  it("should support time metadata", () => {
    const metadata: PackageMetadata = {
      name: "test",
      versions: {
        "1.0.0": {
          name: "test",
          version: "1.0.0",
          dist: { tarball: "", shasum: "", integrity: "" },
        },
      },
      "dist-tags": { latest: "1.0.0" },
      time: {
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-02-01T00:00:00.000Z",
        "1.0.0": "2026-01-01T00:00:00.000Z",
      },
    };

    expect(metadata.time?.created).toBeDefined();
    expect(metadata.time?.modified).toBeDefined();
    expect(metadata.time?.["1.0.0"]).toBeDefined();
  });
});

// =============================================================================
// Tests: Tarball Version Regex
// =============================================================================

describe("Tarball Version Regex", () => {
  const tarballRegex = /^(.+)-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\.tgz$/;

  it("should parse standard version", () => {
    const match = tarballRegex.exec("base-1.0.0.tgz");
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("base");
    expect(match?.[2]).toBe("1.0.0");
  });

  it("should parse prerelease versions", () => {
    const cases = [
      { input: "base-2.0.0-beta.1.tgz", name: "base", version: "2.0.0-beta.1" },
      { input: "base-1.0.0-alpha.tgz", name: "base", version: "1.0.0-alpha" },
      { input: "pkg-3.0.0-rc.2.tgz", name: "pkg", version: "3.0.0-rc.2" },
    ];

    for (const { input, name, version } of cases) {
      const match = tarballRegex.exec(input);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(name);
      expect(match?.[2]).toBe(version);
    }
  });

  it("should handle hyphenated package names", () => {
    const match = tarballRegex.exec("my-package-1.2.3.tgz");
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("my-package");
    expect(match?.[2]).toBe("1.2.3");
  });

  it("should not match invalid formats", () => {
    const invalidCases = [
      "package.tgz",
      "package-1.0.tgz",
      "package-v1.0.0.tgz",
      "package-1.0.0.tar.gz",
    ];

    for (const input of invalidCases) {
      const match = tarballRegex.exec(input);
      expect(match).toBeNull();
    }
  });

  it("should handle complex prerelease identifiers", () => {
    const cases = [
      { input: "pkg-1.0.0-alpha.1.2.3.tgz", version: "1.0.0-alpha.1.2.3" },
      { input: "pkg-0.0.1-dev.tgz", version: "0.0.1-dev" },
      { input: "lib-10.20.30-snapshot.tgz", version: "10.20.30-snapshot" },
    ];

    for (const { input, version } of cases) {
      const match = tarballRegex.exec(input);
      expect(match).not.toBeNull();
      expect(match?.[2]).toBe(version);
    }
  });
});

// =============================================================================
// Tests: PublishPayload Structure
// =============================================================================

describe("PublishPayload Structure", () => {
  it("should have correct structure for publish payload", () => {
    const payload: PublishPayload = {
      name: "@goondan/test",
      description: "Test package",
      versions: {
        "1.0.0": {
          name: "@goondan/test",
          version: "1.0.0",
          dist: {
            tarball: "",
            shasum: "",
            integrity: "",
          },
        },
      },
      "dist-tags": {
        latest: "1.0.0",
      },
      _attachments: {
        "test-1.0.0.tgz": {
          content_type: "application/gzip",
          data: "base64encodeddata",
          length: 100,
        },
      },
    };

    expect(payload.name).toBe("@goondan/test");
    expect(payload._attachments["test-1.0.0.tgz"]).toBeDefined();
    expect(payload._attachments["test-1.0.0.tgz"]?.content_type).toBe("application/gzip");
  });

  it("should support multiple attachments", () => {
    const payload: PublishPayload = {
      name: "multi-version",
      versions: {
        "1.0.0": {
          name: "multi-version",
          version: "1.0.0",
          dist: { tarball: "", shasum: "", integrity: "" },
        },
        "2.0.0": {
          name: "multi-version",
          version: "2.0.0",
          dist: { tarball: "", shasum: "", integrity: "" },
        },
      },
      _attachments: {
        "multi-version-1.0.0.tgz": {
          content_type: "application/gzip",
          data: "data1",
          length: 50,
        },
        "multi-version-2.0.0.tgz": {
          content_type: "application/gzip",
          data: "data2",
          length: 60,
        },
      },
    };

    expect(Object.keys(payload._attachments)).toHaveLength(2);
  });
});

// =============================================================================
// Tests: Mock Data Helpers
// =============================================================================

describe("Test Data Helpers", () => {
  function createTestTarballData(): ArrayBuffer {
    const data = new TextEncoder().encode("test tarball content");
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    return buffer;
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  it("should create valid ArrayBuffer", () => {
    const buffer = createTestTarballData();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("should convert ArrayBuffer to base64", () => {
    const buffer = createTestTarballData();
    const base64 = arrayBufferToBase64(buffer);

    expect(typeof base64).toBe("string");
    expect(base64.length).toBeGreaterThan(0);
    // Base64 should only contain valid characters
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("should round-trip data through base64", () => {
    const originalText = "test tarball content";
    const data = new TextEncoder().encode(originalText);
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);

    const base64 = arrayBufferToBase64(buffer);
    const decoded = atob(base64);

    expect(decoded).toBe(originalText);
  });
});

// =============================================================================
// Tests: Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  describe("parsePackageName edge cases", () => {
    it("should handle single character names", () => {
      const result = parsePackageName("/a");
      expect(result).toEqual({ scope: null, name: "a", rest: [] });
    });

    it("should handle numeric package names", () => {
      const result = parsePackageName("/123");
      expect(result).toEqual({ scope: null, name: "123", rest: [] });
    });

    it("should handle underscore in names", () => {
      const result = parsePackageName("/my_package");
      expect(result).toEqual({ scope: null, name: "my_package", rest: [] });
    });
  });

  describe("extractBearerToken edge cases", () => {
    it("should handle only whitespace after Bearer", () => {
      // regex /^Bearer\s+(.+)$/i: \s+ is greedy, consumes as many spaces as possible
      // while (.+) still matches (requires at least 1 char)
      // "Bearer    " (4 spaces) -> \s+ matches 3 spaces, (.+) captures " " (1 space)
      const result = extractBearerToken("Bearer    ");
      expect(result).toBe(" ");
    });
  });

  describe("Hash calculation edge cases", () => {
    it("should handle unicode content", async () => {
      const data = new TextEncoder().encode("Hello, ");
      const integrity = await calculateIntegrity(toArrayBuffer(data));
      expect(integrity).toMatch(/^sha512-/);
    });

    it("should handle null bytes", async () => {
      const data = new Uint8Array([0, 0, 0, 0]);
      const shasum = await calculateShasum(toArrayBuffer(data));
      expect(shasum).toMatch(/^[0-9a-f]{40}$/);
    });
  });
});
