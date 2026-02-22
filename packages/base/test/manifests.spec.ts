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
    expect(tools.some((item) => item.metadata.name === "telegram")).toBe(true);
    expect(tools.some((item) => item.metadata.name === "slack")).toBe(true);
    expect(tools.some((item) => item.metadata.name === "self-restart")).toBe(true);
    expect(tools.some((item) => item.metadata.name === "wait")).toBe(true);
    expect(extensions.some((item) => item.metadata.name === "logging")).toBe(true);
    expect(extensions.some((item) => item.metadata.name === "inter-agent-response-format")).toBe(true);
    expect(connectors.some((item) => item.metadata.name === "telegram-polling")).toBe(true);

    const telegram = tools.find((item) => item.metadata.name === "telegram");
    const slack = tools.find((item) => item.metadata.name === "slack");
    const agents = tools.find((item) => item.metadata.name === "agents");
    expect(telegram?.spec.exports.some((entry) => entry.name === "read")).toBe(false);
    expect(telegram?.spec.exports.some((entry) => entry.name === "downloadFile")).toBe(true);
    expect(slack?.spec.exports.some((entry) => entry.name === "read")).toBe(true);
    expect(slack?.spec.exports.some((entry) => entry.name === "downloadFile")).toBe(true);

    const requestExport = agents?.spec.exports.find((entry) => entry.name === "request");
    const requestParams = requestExport?.parameters;
    expect(requestParams && typeof requestParams === "object").toBeTruthy();
    if (requestParams && typeof requestParams === "object" && "properties" in requestParams) {
      const properties = requestParams.properties;
      expect(properties && typeof properties === "object" && "async" in properties).toBe(true);
    }
  });
});
