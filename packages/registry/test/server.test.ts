import { describe, it, expect } from "vitest";

import { isObjectRecord, isRegistryPackageMetadata, isRegistryVersionMetadata } from "../src/validators.js";
import { startTestRegistryServer } from "./utils.js";

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

describe("registry server", () => {
  it("라우팅 + publish/get/unpublish/deprecate 라이프사이클을 지원한다", async () => {
    const server = await startTestRegistryServer();

    try {
      const tarball = Buffer.from("registry test tarball", "utf8");
      const publishResponse = await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("1.0.0", tarball)),
      });
      expect(publishResponse.status).toBe(201);

      const metadataResponse = await fetch(`${server.url}/@goondan/base`);
      expect(metadataResponse.status).toBe(200);
      const metadataValue = await metadataResponse.json();
      expect(isRegistryPackageMetadata(metadataValue)).toBe(true);
      if (!isRegistryPackageMetadata(metadataValue)) {
        throw new Error("invalid metadata response");
      }
      const metadata = metadataValue;
      expect(metadata["dist-tags"].latest).toBe("1.0.0");
      const publishedVersion = metadata.versions["1.0.0"];
      expect(publishedVersion).toBeDefined();
      if (publishedVersion === undefined) {
        throw new Error("missing published version metadata");
      }
      expect(publishedVersion.dist.integrity.startsWith("sha512-")).toBe(true);

      const versionResponse = await fetch(`${server.url}/@goondan/base/1.0.0`);
      expect(versionResponse.status).toBe(200);
      const versionValue = await versionResponse.json();
      expect(isRegistryVersionMetadata(versionValue)).toBe(true);
      if (!isRegistryVersionMetadata(versionValue)) {
        throw new Error("invalid version response");
      }
      const versionMetadata = versionValue;
      expect(versionMetadata.version).toBe("1.0.0");

      const tarballResponse = await fetch(`${server.url}/@goondan/base/-/base-1.0.0.tgz`);
      expect(tarballResponse.status).toBe(200);
      const downloadedTarball = Buffer.from(await tarballResponse.arrayBuffer());
      expect(downloadedTarball.equals(tarball)).toBe(true);

      const deprecateResponse = await fetch(`${server.url}/@goondan/base/1.0.0/deprecate`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Use 2.0.0 instead" }),
      });
      expect(deprecateResponse.status).toBe(200);

      const deprecatedVersionResponse = await fetch(`${server.url}/@goondan/base/1.0.0`);
      const deprecatedVersionValue = await deprecatedVersionResponse.json();
      expect(isRegistryVersionMetadata(deprecatedVersionValue)).toBe(true);
      if (!isRegistryVersionMetadata(deprecatedVersionValue)) {
        throw new Error("invalid deprecated version response");
      }
      const deprecatedVersion = deprecatedVersionValue;
      expect(deprecatedVersion.deprecated).toBe("Use 2.0.0 instead");

      const unpublishResponse = await fetch(`${server.url}/@goondan/base/1.0.0`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${server.token}`,
        },
      });
      expect(unpublishResponse.status).toBe(200);

      const missingVersionResponse = await fetch(`${server.url}/@goondan/base/1.0.0`);
      expect(missingVersionResponse.status).toBe(404);

      const unknownRouteResponse = await fetch(`${server.url}/unknown`);
      expect(unknownRouteResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("인증 없는 publish 요청을 거부한다", async () => {
    const server = await startTestRegistryServer();

    try {
      const tarball = Buffer.from("auth-test", "utf8");
      const response = await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("1.1.0", tarball)),
      });

      expect(response.status).toBe(401);

      const invalidTokenResponse = await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: "Bearer invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("1.1.1", tarball)),
      });

      expect(invalidTokenResponse.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("동일 버전 중복 publish를 거부한다", async () => {
    const server = await startTestRegistryServer();

    try {
      const tarball = Buffer.from("duplicate-test", "utf8");
      const firstResponse = await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("5.0.0", tarball)),
      });
      expect(firstResponse.status).toBe(201);

      const secondResponse = await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("5.0.0", tarball)),
      });
      expect(secondResponse.status).toBe(409);
      const errorBody: unknown = await secondResponse.json();
      expect(isObjectRecord(errorBody) && errorBody.error).toBe("PKG_VERSION_EXISTS");
    } finally {
      await server.close();
    }
  });

  it("전체 패키지를 삭제한다", async () => {
    const server = await startTestRegistryServer();

    try {
      const tarball = Buffer.from("delete-test", "utf8");
      await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("6.0.0", tarball)),
      });

      const deleteResponse = await fetch(`${server.url}/@goondan/base`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${server.token}`,
        },
      });
      expect(deleteResponse.status).toBe(200);

      const metadataResponse = await fetch(`${server.url}/@goondan/base`);
      expect(metadataResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("deprecate 해제 (빈 message)를 지원한다", async () => {
    const server = await startTestRegistryServer();

    try {
      const tarball = Buffer.from("deprecate-unset-test", "utf8");
      await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("7.0.0", tarball)),
      });

      await fetch(`${server.url}/@goondan/base/7.0.0/deprecate`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Deprecated" }),
      });

      const deprecatedResponse = await fetch(`${server.url}/@goondan/base/7.0.0`);
      const deprecatedData: unknown = await deprecatedResponse.json();
      expect(isRegistryVersionMetadata(deprecatedData) && deprecatedData.deprecated).toBe("Deprecated");

      await fetch(`${server.url}/@goondan/base/7.0.0/deprecate`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "" }),
      });

      const undeprecatedResponse = await fetch(`${server.url}/@goondan/base/7.0.0`);
      const undeprecatedData: unknown = await undeprecatedResponse.json();
      expect(isRegistryVersionMetadata(undeprecatedData) && undeprecatedData.deprecated).toBe("");
    } finally {
      await server.close();
    }
  });

  it("restricted 패키지는 인증 없이 조회할 수 없다", async () => {
    const server = await startTestRegistryServer();

    try {
      const tarball = Buffer.from("restricted-package", "utf8");
      const publishResponse = await fetch(`${server.url}/@goondan/base`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(createPublishPayload("2.0.0", tarball, "restricted")),
      });
      expect(publishResponse.status).toBe(201);

      const metadataWithoutAuth = await fetch(`${server.url}/@goondan/base`);
      expect(metadataWithoutAuth.status).toBe(401);

      const metadataWithAuth = await fetch(`${server.url}/@goondan/base`, {
        headers: {
          authorization: `Bearer ${server.token}`,
        },
      });
      expect(metadataWithAuth.status).toBe(200);

      const tarballWithoutAuth = await fetch(`${server.url}/@goondan/base/-/base-2.0.0.tgz`);
      expect(tarballWithoutAuth.status).toBe(401);

      const tarballWithAuth = await fetch(`${server.url}/@goondan/base/-/base-2.0.0.tgz`, {
        headers: {
          authorization: `Bearer ${server.token}`,
        },
      });
      expect(tarballWithAuth.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
