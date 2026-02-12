import { describe, expect, it } from "vitest";

import {
  createBaseConnectorManifests,
  createBaseExtensionManifests,
  createBaseToolManifests,
} from "../src/manifests/base.js";

describe("base manifests", () => {
  it("기본 tool/extension/connector 매니페스트를 생성한다", () => {
    const tools = createBaseToolManifests();
    const extensions = createBaseExtensionManifests();
    const connectors = createBaseConnectorManifests();

    expect(tools.some((item) => item.metadata.name === "bash")).toBe(true);
    expect(extensions.some((item) => item.metadata.name === "logging")).toBe(true);
    expect(connectors.some((item) => item.metadata.name === "telegram-polling")).toBe(true);
  });
});
