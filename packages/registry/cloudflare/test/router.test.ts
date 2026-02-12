import { describe, expect, it } from "vitest";

import { createRegistryRouter, parseRegistryRoute } from "../src/router.js";
import type {
  ParsedPackageName,
  RegistryPackageMetadata,
  RegistryStorage,
} from "../src/types.js";
import { isRegistryPackageMetadata } from "../src/types.js";

class MemoryRegistryStorage implements RegistryStorage {
  private readonly metadata = new Map<string, RegistryPackageMetadata>();

  private readonly tarballs = new Map<string, Uint8Array>();

  async getMetadata(packageName: ParsedPackageName): Promise<RegistryPackageMetadata | null> {
    const entry = this.metadata.get(this.metadataKey(packageName));
    return entry ?? null;
  }

  async putMetadata(packageName: ParsedPackageName, metadata: RegistryPackageMetadata): Promise<void> {
    this.metadata.set(this.metadataKey(packageName), metadata);
  }

  async deleteMetadata(packageName: ParsedPackageName): Promise<void> {
    this.metadata.delete(this.metadataKey(packageName));
  }

  async getTarball(packageName: ParsedPackageName, version: string): Promise<Uint8Array | null> {
    const entry = this.tarballs.get(this.tarballKey(packageName, version));
    return entry ?? null;
  }

  async putTarball(packageName: ParsedPackageName, version: string, tarball: Uint8Array): Promise<void> {
    this.tarballs.set(this.tarballKey(packageName, version), tarball);
  }

  async deleteTarball(packageName: ParsedPackageName, version: string): Promise<void> {
    this.tarballs.delete(this.tarballKey(packageName, version));
  }

  private metadataKey(packageName: ParsedPackageName): string {
    return `${packageName.scope}/${packageName.name}`;
  }

  private tarballKey(packageName: ParsedPackageName, version: string): string {
    return `${packageName.scope}/${packageName.name}/${version}`;
  }
}

function createPublishPayload(version: string, tarball: Buffer, access: "public" | "restricted" = "public") {
  return {
    name: "@goondan/base",
    version,
    description: "Goondan base package",
    access,
    dependencies: {
      "@goondan/core-utils": "^0.5.0",
    },
    "dist-tags": {
      latest: version,
    },
    _attachments: {
      [`base-${version}.tgz`]: {
        data: tarball.toString("base64"),
        contentType: "application/gzip",
        length: tarball.length,
      },
    },
  };
}

async function parseJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  return JSON.parse(raw);
}

describe("registry router", () => {
  it("라우팅 + publish/get/unpublish/deprecate 라이프사이클을 지원한다", async () => {
    const storage = new MemoryRegistryStorage();
    const handler = createRegistryRouter({
      storage,
      authTokens: ["test-token"],
      baseUrl: "https://registry.example.com",
    });

    const tarball = Buffer.from("registry test tarball", "utf8");

    const publishResponse = await handler(
      new Request("https://registry.example.com/@goondan/base", {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("1.0.0", tarball)),
      }),
    );
    expect(publishResponse.status).toBe(201);

    const metadataResponse = await handler(new Request("https://registry.example.com/@goondan/base"));
    expect(metadataResponse.status).toBe(200);
    const metadataValue = await parseJson(metadataResponse);
    expect(isRegistryPackageMetadata(metadataValue)).toBe(true);
    if (!isRegistryPackageMetadata(metadataValue)) {
      throw new Error("metadata shape is invalid");
    }
    expect(metadataValue["dist-tags"].latest).toBe("1.0.0");
    expect(metadataValue.versions["1.0.0"]?.dist.integrity.startsWith("sha512-")).toBe(true);

    const versionResponse = await handler(new Request("https://registry.example.com/@goondan/base/1.0.0"));
    expect(versionResponse.status).toBe(200);

    const tarballResponse = await handler(new Request("https://registry.example.com/@goondan/base/-/base-1.0.0.tgz"));
    expect(tarballResponse.status).toBe(200);
    const downloadedTarball = Buffer.from(await tarballResponse.arrayBuffer());
    expect(downloadedTarball.equals(tarball)).toBe(true);

    const deprecateResponse = await handler(
      new Request("https://registry.example.com/@goondan/base/1.0.0/deprecate", {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Use 2.0.0 instead" }),
      }),
    );
    expect(deprecateResponse.status).toBe(200);

    const deprecatedVersionResponse = await handler(new Request("https://registry.example.com/@goondan/base/1.0.0"));
    const deprecatedVersion = await parseJson(deprecatedVersionResponse);
    if (typeof deprecatedVersion !== "object" || deprecatedVersion === null || Array.isArray(deprecatedVersion)) {
      throw new Error("deprecated response must be object");
    }
    expect(deprecatedVersion).toMatchObject({
      deprecated: "Use 2.0.0 instead",
    });

    const unpublishResponse = await handler(
      new Request("https://registry.example.com/@goondan/base/1.0.0", {
        method: "DELETE",
        headers: {
          authorization: "Bearer test-token",
        },
      }),
    );
    expect(unpublishResponse.status).toBe(200);

    const missingVersionResponse = await handler(new Request("https://registry.example.com/@goondan/base/1.0.0"));
    expect(missingVersionResponse.status).toBe(404);
  });

  it("인증 없는 publish 요청을 거부한다", async () => {
    const storage = new MemoryRegistryStorage();
    const handler = createRegistryRouter({
      storage,
      authTokens: ["test-token"],
      baseUrl: "https://registry.example.com",
    });

    const tarball = Buffer.from("auth-test", "utf8");

    const response = await handler(
      new Request("https://registry.example.com/@goondan/base", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("1.1.0", tarball)),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("restricted 패키지는 인증 없이 조회할 수 없다", async () => {
    const storage = new MemoryRegistryStorage();
    const handler = createRegistryRouter({
      storage,
      authTokens: ["test-token"],
      baseUrl: "https://registry.example.com",
    });

    const tarball = Buffer.from("restricted-package", "utf8");

    const publishResponse = await handler(
      new Request("https://registry.example.com/@goondan/base", {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("2.0.0", tarball, "restricted")),
      }),
    );
    expect(publishResponse.status).toBe(201);

    const metadataWithoutAuth = await handler(new Request("https://registry.example.com/@goondan/base"));
    expect(metadataWithoutAuth.status).toBe(401);

    const metadataWithAuth = await handler(
      new Request("https://registry.example.com/@goondan/base", {
        headers: {
          authorization: "Bearer test-token",
        },
      }),
    );
    expect(metadataWithAuth.status).toBe(200);

    const tarballWithoutAuth = await handler(new Request("https://registry.example.com/@goondan/base/-/base-2.0.0.tgz"));
    expect(tarballWithoutAuth.status).toBe(401);
  });

  it("경로 파서를 검증한다", () => {
    const packageRoute = parseRegistryRoute("/@goondan/base");
    const versionRoute = parseRegistryRoute("/@goondan/base/1.2.3");
    const tarballRoute = parseRegistryRoute("/@goondan/base/-/base-1.2.3.tgz");
    const deprecateRoute = parseRegistryRoute("/@goondan/base/1.2.3/deprecate");

    expect(packageRoute?.type).toBe("package");
    expect(versionRoute?.type).toBe("version");
    expect(tarballRoute?.type).toBe("tarball");
    expect(deprecateRoute?.type).toBe("deprecate");

    expect(parseRegistryRoute("/invalid")).toBeNull();
  });
});
