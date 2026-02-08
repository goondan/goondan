/**
 * connector-runner 테스트
 * - detectConnections 반환 타입 변경 (warnings 포함)
 * - swarmRef에서 swarmName 추출
 * - Connector 미발견 시 경고
 */

import { describe, it, expect } from "vitest";
import { detectConnections } from "../connector-runner.js";
import type { BundleLoadResult } from "@goondan/core";
import type { Resource } from "@goondan/core";

/**
 * 테스트용 BundleLoadResult mock 생성
 */
function createMockBundleLoadResult(
  resources: Resource[],
): BundleLoadResult {
  const resourceIndex = new Map<string, Resource>();
  for (const r of resources) {
    resourceIndex.set(`${r.kind}/${r.metadata.name}`, r);
  }

  return {
    resources,
    errors: [],
    sources: ["test.yaml"],
    isValid: () => true,
    getResourcesByKind: (kind: string) =>
      resources.filter((r) => r.kind === kind),
    getResource: (kind: string, name: string) =>
      resourceIndex.get(`${kind}/${name}`),
  };
}

const mockConnector: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connector",
  metadata: { name: "cli" },
  spec: {
    runtime: "node",
    entry: "./connectors/cli/index.js",
    triggers: [{ type: "cli" }],
  },
};

const mockConnectionWithSwarmRef: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connection",
  metadata: { name: "cli-to-default" },
  spec: {
    connectorRef: { kind: "Connector", name: "cli" },
    swarmRef: { kind: "Swarm", name: "my-swarm" },
  },
};

const mockConnectionWithoutSwarmRef: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connection",
  metadata: { name: "cli-to-all" },
  spec: {
    connectorRef: { kind: "Connector", name: "cli" },
  },
};

const mockConnectionWithMissingConnector: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connection",
  metadata: { name: "missing-connector-conn" },
  spec: {
    connectorRef: { kind: "Connector", name: "nonexistent" },
  },
};

/** Connector: triggers[0].type으로 connectorType 판별 */
const mockConnectorV1: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connector",
  metadata: { name: "telegram" },
  spec: {
    runtime: "node",
    entry: "./connectors/telegram/index.js",
    triggers: [{ type: "custom" }, { type: "http" }],
    events: [{ name: "telegram.message" }],
  },
};

const mockConnectionToTelegram: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connection",
  metadata: { name: "telegram-to-swarm" },
  spec: {
    connectorRef: { kind: "Connector", name: "telegram" },
    swarmRef: { kind: "Swarm", name: "my-swarm" },
  },
};

const mockConnectionWithStringSwarmRef: Resource = {
  apiVersion: "agents.example.io/v1alpha1",
  kind: "Connection",
  metadata: { name: "cli-to-string-ref" },
  spec: {
    connectorRef: { kind: "Connector", name: "cli" },
    swarmRef: "Swarm/other-swarm",
  },
};

describe("detectConnections", () => {
  it("returns connections and empty warnings when all connectors found", () => {
    const bundle = createMockBundleLoadResult([
      mockConnector,
      mockConnectionWithSwarmRef,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.connections[0]?.connectorName).toBe("cli");
    expect(result.connections[0]?.connectorType).toBe("cli");
  });

  it("extracts swarmName from swarmRef object", () => {
    const bundle = createMockBundleLoadResult([
      mockConnector,
      mockConnectionWithSwarmRef,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections[0]?.swarmName).toBe("my-swarm");
  });

  it("extracts swarmName from string swarmRef (Kind/name format)", () => {
    const bundle = createMockBundleLoadResult([
      mockConnector,
      mockConnectionWithStringSwarmRef,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections[0]?.swarmName).toBe("other-swarm");
  });

  it("sets swarmName to undefined when swarmRef is absent", () => {
    const bundle = createMockBundleLoadResult([
      mockConnector,
      mockConnectionWithoutSwarmRef,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections[0]?.swarmName).toBeUndefined();
  });

  it("adds warning when referenced Connector is not found in bundle", () => {
    const bundle = createMockBundleLoadResult([
      mockConnectionWithMissingConnector,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("missing-connector-conn");
    expect(result.warnings[0]).toContain("nonexistent");
    expect(result.warnings[0]).toContain("not found in bundle");
  });

  it("processes multiple connections with mixed results", () => {
    const bundle = createMockBundleLoadResult([
      mockConnector,
      mockConnectionWithSwarmRef,
      mockConnectionWithMissingConnector,
      mockConnectionWithoutSwarmRef,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.connections[0]?.swarmName).toBe("my-swarm");
    expect(result.connections[1]?.swarmName).toBeUndefined();
  });

  it("returns empty connections and warnings when no Connection resources exist", () => {
    const bundle = createMockBundleLoadResult([mockConnector]);

    const result = detectConnections(bundle);

    expect(result.connections).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("resolves connectorType from triggers[0].type", () => {
    const bundle = createMockBundleLoadResult([
      mockConnectorV1,
      mockConnectionToTelegram,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.connectorName).toBe("telegram");
    expect(result.connections[0]?.connectorType).toBe("custom");
  });

  it("adds warning when Connector has no triggers defined", () => {
    const noTriggersConnector: Resource = {
      apiVersion: "agents.example.io/v1alpha1",
      kind: "Connector",
      metadata: { name: "cli" },
      spec: {
        runtime: "node",
        entry: "./connectors/cli/index.js",
      },
    };
    const bundle = createMockBundleLoadResult([
      noTriggersConnector,
      mockConnectionWithSwarmRef,
    ]);

    const result = detectConnections(bundle);

    expect(result.connections).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no triggers defined");
  });
});
