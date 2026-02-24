import { describe, expect, it } from "vitest";

import { validateResources } from "../src/config/resources.js";
import type { RuntimeResource } from "../src/types.js";

function createResource(
  input: Pick<RuntimeResource, "kind" | "metadata" | "spec"> & {
    file?: string;
    docIndex?: number;
    packageName?: string;
  },
): RuntimeResource {
  return {
    apiVersion: "goondan.ai/v1",
    kind: input.kind,
    metadata: input.metadata,
    spec: input.spec,
    __file: input.file ?? "goondan.yaml",
    __docIndex: input.docIndex ?? 0,
    __package: input.packageName,
  };
}

describe("validateResources", () => {
  it("Swarm.entryAgent가 agents 배열에 없으면 오류를 반환한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Model",
        metadata: { name: "claude" },
        spec: { provider: "anthropic", model: "claude-3-5-sonnet" },
        docIndex: 0,
      }),
      createResource({
        kind: "Agent",
        metadata: { name: "coder" },
        spec: {
          modelConfig: { modelRef: "Model/claude" },
          prompt: { system: "You are coder." },
        },
        docIndex: 1,
      }),
      createResource({
        kind: "Agent",
        metadata: { name: "reviewer" },
        spec: {
          modelConfig: { modelRef: "Model/claude" },
          prompt: { system: "You are reviewer." },
        },
        docIndex: 2,
      }),
      createResource({
        kind: "Swarm",
        metadata: { name: "default" },
        spec: {
          entryAgent: "Agent/reviewer",
          agents: ["Agent/coder"],
        },
        docIndex: 3,
      }),
    ];

    const errors = validateResources(resources);
    expect(
      errors.some(
        (error) =>
          error.code === "E_CONFIG_SCHEMA_INVALID" &&
          error.path.endsWith(".spec.entryAgent") &&
          error.message.includes("must be included"),
      ),
    ).toBe(true);
  });

  it("Package 문서는 첫 번째 YAML 문서에 있어야 한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Model",
        metadata: { name: "claude" },
        spec: { provider: "anthropic", model: "claude-3-5-sonnet" },
        docIndex: 0,
      }),
      createResource({
        kind: "Package",
        metadata: { name: "sample" },
        spec: { version: "0.1.0" },
        docIndex: 1,
      }),
    ];

    const errors = validateResources(resources);
    expect(errors.some((error) => error.code === "E_CONFIG_PACKAGE_DOC_POSITION")).toBe(true);
  });

  it("같은 파일에 Package 문서가 2개 이상이면 오류를 반환한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Package",
        metadata: { name: "sample" },
        spec: { version: "0.1.0" },
        docIndex: 0,
      }),
      createResource({
        kind: "Package",
        metadata: { name: "sample-2" },
        spec: { version: "0.1.0" },
        docIndex: 2,
      }),
    ];

    const errors = validateResources(resources);
    expect(errors.some((error) => error.code === "E_CONFIG_PACKAGE_DOC_DUPLICATED")).toBe(true);
  });

  it("Agent.prompt에 system/systemRef가 없어도 허용한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Model",
        metadata: { name: "claude" },
        spec: { provider: "anthropic", model: "claude-3-5-sonnet" },
        docIndex: 0,
      }),
      createResource({
        kind: "Agent",
        metadata: { name: "coder" },
        spec: {
          modelConfig: { modelRef: "Model/claude" },
          prompt: {},
        },
        docIndex: 1,
      }),
      createResource({
        kind: "Swarm",
        metadata: { name: "default" },
        spec: {
          entryAgent: "Agent/coder",
          agents: ["Agent/coder"],
        },
        docIndex: 2,
      }),
    ];

    const errors = validateResources(resources);
    expect(errors.some((error) => error.path.endsWith(".spec.prompt"))).toBe(false);
  });

  it("Agent.prompt에 system과 systemRef를 동시에 선언하면 오류를 반환한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Model",
        metadata: { name: "claude" },
        spec: { provider: "anthropic", model: "claude-3-5-sonnet" },
        docIndex: 0,
      }),
      createResource({
        kind: "Agent",
        metadata: { name: "coder" },
        spec: {
          modelConfig: { modelRef: "Model/claude" },
          prompt: {
            system: "inline",
            systemRef: "./prompts/coder.system.md",
          },
        },
        docIndex: 1,
      }),
      createResource({
        kind: "Swarm",
        metadata: { name: "default" },
        spec: {
          entryAgent: "Agent/coder",
          agents: ["Agent/coder"],
        },
        docIndex: 2,
      }),
    ];

    const errors = validateResources(resources);
    expect(
      errors.some(
        (error) =>
          error.code === "E_CONFIG_SCHEMA_INVALID"
          && error.path.endsWith(".spec.prompt")
          && error.message.includes("cannot be used together"),
      ),
    ).toBe(true);
  });

  it("Agent.spec.prompt 필드가 없어도 허용한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Model",
        metadata: { name: "claude" },
        spec: { provider: "anthropic", model: "claude-3-5-sonnet" },
        docIndex: 0,
      }),
      createResource({
        kind: "Agent",
        metadata: { name: "coder" },
        spec: {
          modelConfig: { modelRef: "Model/claude" },
        },
        docIndex: 1,
      }),
      createResource({
        kind: "Swarm",
        metadata: { name: "default" },
        spec: {
          entryAgent: "Agent/coder",
          agents: ["Agent/coder"],
        },
        docIndex: 2,
      }),
    ];

    const errors = validateResources(resources);
    expect(errors.some((error) => error.path.endsWith(".spec.prompt"))).toBe(false);
  });


  it("Swarm.instanceKey 형식이 잘못되면 오류를 반환한다", () => {
    const resources: RuntimeResource[] = [
      createResource({
        kind: "Model",
        metadata: { name: "claude" },
        spec: { provider: "anthropic", model: "claude-3-5-sonnet" },
        docIndex: 0,
      }),
      createResource({
        kind: "Agent",
        metadata: { name: "coder" },
        spec: {
          modelConfig: { modelRef: "Model/claude" },
          prompt: { system: "You are coder." },
        },
        docIndex: 1,
      }),
      createResource({
        kind: "Swarm",
        metadata: { name: "default" },
        spec: {
          entryAgent: "Agent/coder",
          agents: ["Agent/coder"],
          instanceKey: "",
        },
        docIndex: 2,
      }),
    ];

    const errors = validateResources(resources);
    expect(
      errors.some(
        (error) =>
          error.code === "E_CONFIG_SCHEMA_INVALID" &&
          error.path.endsWith(".spec.instanceKey"),
      ),
    ).toBe(true);
  });
});
