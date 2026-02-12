import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { RegistryClient, resolveRegistryConfig } from "../src/index.js";
import { startTestRegistryServer } from "./utils.js";

describe("registry client", () => {
  it("클라이언트로 publish/metadata/version 조회를 수행한다", async () => {
    const server = await startTestRegistryServer();

    try {
      const client = await RegistryClient.create({
        registry: server.url,
        token: server.token,
      });

      const tarball = Buffer.from("client publish tarball", "utf8");
      await client.publish({
        name: "@goondan/base",
        version: "3.0.0",
        tarball,
        description: "Client publish",
      });

      const metadata = await client.getMetadata("@goondan/base");
      expect(metadata.name).toBe("@goondan/base");
      expect(metadata["dist-tags"].latest).toBe("3.0.0");

      const version = await client.getVersion("@goondan/base", "3.0.0");
      expect(version.dist.integrity.startsWith("sha512-")).toBe(true);
      expect(version.deprecated).toBe("");
    } finally {
      await server.close();
    }
  });

  it("registry 설정 우선순위(옵션 > env > config > default)를 따른다", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "goondan-registry-config-"));
    const configPath = path.join(tempDir, "config.json");

    try {
      await writeFile(
        configPath,
        JSON.stringify(
          {
            registry: "https://registry.from-config.example.com",
            registries: {
              "https://registry.from-config.example.com": {
                token: "${GOONDAN_REGISTRY_TOKEN}",
              },
              "https://scope.registry.example.com": {
                token: "scope-token",
              },
            },
            scopedRegistries: {
              "@goondan": "https://scope.registry.example.com",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const configOnly = await resolveRegistryConfig({
        packageName: "@goondan/base",
        configPath,
        env: {},
      });
      expect(configOnly.registryUrl).toBe("https://scope.registry.example.com");
      expect(configOnly.token).toBe("scope-token");

      const envOverride = await resolveRegistryConfig({
        packageName: "@goondan/base",
        configPath,
        env: {
          GOONDAN_REGISTRY: "https://registry.from-env.example.com",
          GOONDAN_REGISTRY_TOKEN: "env-token",
        },
      });
      expect(envOverride.registryUrl).toBe("https://registry.from-env.example.com");
      expect(envOverride.token).toBe("env-token");

      const optionOverride = await resolveRegistryConfig({
        packageName: "@goondan/base",
        configPath,
        registry: "https://registry.from-option.example.com",
        token: "option-token",
        env: {
          GOONDAN_REGISTRY: "https://registry.from-env.example.com",
          GOONDAN_REGISTRY_TOKEN: "env-token",
        },
      });
      expect(optionOverride.registryUrl).toBe("https://registry.from-option.example.com");
      expect(optionOverride.token).toBe("option-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
