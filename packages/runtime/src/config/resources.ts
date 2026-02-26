import type {
  KnownKind,
  RuntimeResource,
  ValidationError,
} from "../types.js";
import { isJsonObject, isKnownKind } from "../types.js";
import { extractNormalizedObjectRef, normalizeObjectRef } from "./object-ref.js";

const SUPPORTED_API_VERSION = "goondan.ai/v1";
export const LOCAL_PACKAGE_SCOPE = "__local__";

interface RefCandidate {
  value: unknown;
  path: string;
}

function resourcePackageScope(resource: RuntimeResource): string {
  return resource.__package ?? LOCAL_PACKAGE_SCOPE;
}

export function toScopedResourceIdentity(packageName: string, kind: string, name: string): string {
  return `${packageName}|${kind}/${name}`;
}

export function validateResources(resources: RuntimeResource[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenNames = new Set<string>();

  resources.forEach((resource) => {
    const resourcePath = `${resource.__file}#${resource.__docIndex}`;
    const packageScope = resourcePackageScope(resource);

    if (resource.apiVersion !== SUPPORTED_API_VERSION) {
      errors.push({
        code: "E_CONFIG_UNSUPPORTED_API_VERSION",
        message: `Unsupported apiVersion '${resource.apiVersion}'.`,
        path: `${resourcePath}.apiVersion`,
        suggestion: "apiVersion을 goondan.ai/v1로 수정하세요.",
      });
    }

    if (!isKnownKind(resource.kind)) {
      errors.push({
        code: "E_CONFIG_UNKNOWN_KIND",
        message: `Unsupported kind '${resource.kind}'.`,
        path: `${resourcePath}.kind`,
        suggestion: "지원되는 kind(8종)인지 확인하세요.",
      });
    }

    if (resource.metadata.name.trim().length === 0) {
      errors.push({
        code: "E_CONFIG_INVALID_NAME",
        message: "metadata.name must not be empty.",
        path: `${resourcePath}.metadata.name`,
      });
    }

    const identity = toScopedResourceIdentity(packageScope, resource.kind, resource.metadata.name);
    if (seenNames.has(identity)) {
      errors.push({
        code: "E_CONFIG_DUPLICATE_NAME",
        message: `Duplicate resource identity '${resource.kind}/${resource.metadata.name}' in package '${packageScope}'.`,
        path: `${resourcePath}.metadata.name`,
        suggestion: "동일 kind 내 name 고유성을 보장하세요.",
      });
    }
    seenNames.add(identity);
  });

  errors.push(...validatePackageDocumentPlacement(resources));

  const existing = new Set(
    resources.map((resource) =>
      toScopedResourceIdentity(resourcePackageScope(resource), resource.kind, resource.metadata.name),
    ),
  );

  resources.forEach((resource) => {
    const rootPath = `${resource.__file}#${resource.__docIndex}.spec`;
    const refs = collectObjectRefCandidates(resource.spec, rootPath);
    const fallbackPackage = resourcePackageScope(resource);

    refs.forEach((candidate) => {
      const normalized = extractNormalizedObjectRef(candidate.value);
      if (!normalized) {
        let message = "Invalid ObjectRef";
        if (typeof candidate.value === "string") {
          try {
            normalizeObjectRef(candidate.value);
          } catch (error) {
            message = error instanceof Error ? error.message : "Invalid ObjectRef";
          }
        }
        errors.push({
          code: "E_CONFIG_INVALID_REF",
          message,
          path: candidate.path,
          suggestion: "ObjectRef는 Kind/name 또는 { kind, name } 형식이어야 합니다.",
        });
        return;
      }

      const targetPackage = normalized.package ?? fallbackPackage;
      const identity = toScopedResourceIdentity(targetPackage, normalized.kind, normalized.name);
      if (!existing.has(identity)) {
        errors.push({
          code: "E_CONFIG_REF_NOT_FOUND",
          message: `${normalized.kind}/${normalized.name} 참조를 찾을 수 없습니다. (package=${targetPackage})`,
          path: candidate.path,
          suggestion: "kind/name 또는 package 범위를 확인하세요.",
        });
      }
    });

    errors.push(...validateKindMinimal(resource));
  });

  return errors;
}

function validateKindMinimal(resource: RuntimeResource): ValidationError[] {
  const errors: ValidationError[] = [];
  const pathPrefix = `${resource.__file}#${resource.__docIndex}.spec`;

  if (resource.kind === "Tool") {
    if (!isJsonObject(resource.spec) || typeof resource.spec.entry !== "string") {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Tool.spec.entry is required.",
        path: `${pathPrefix}.entry`,
      });
    }

    if (resource.metadata.name.includes("__")) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Tool metadata.name must not contain '__'.",
        path: `${resource.__file}#${resource.__docIndex}.metadata.name`,
      });
    }

    if (!isJsonObject(resource.spec) || !Array.isArray(resource.spec.exports) || resource.spec.exports.length === 0) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Tool.spec.exports must have at least one item.",
        path: `${pathPrefix}.exports`,
      });
    } else {
      const seenExportNames = new Set<string>();
      resource.spec.exports.forEach((value, index) => {
        if (!isJsonObject(value)) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: "Tool.spec.exports[] must be an object.",
            path: `${pathPrefix}.exports[${index}]`,
          });
          return;
        }

        const exportName = value.name;
        if (typeof exportName !== "string" || exportName.trim().length === 0) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: "Tool.spec.exports[].name is required.",
            path: `${pathPrefix}.exports[${index}].name`,
          });
          return;
        }

        if (exportName.includes("__")) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: "Tool export name must not contain '__'.",
            path: `${pathPrefix}.exports[${index}].name`,
          });
        }

        if (seenExportNames.has(exportName)) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: `Duplicate Tool export name '${exportName}'.`,
            path: `${pathPrefix}.exports[${index}].name`,
          });
        }
        seenExportNames.add(exportName);

        if (typeof value.description !== "string" || value.description.trim().length === 0) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: "Tool.spec.exports[].description is required.",
            path: `${pathPrefix}.exports[${index}].description`,
          });
        }

        if (!isJsonObject(value.parameters)) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: "Tool.spec.exports[].parameters must be an object schema.",
            path: `${pathPrefix}.exports[${index}].parameters`,
          });
        }
      });
    }
  }

  if (resource.kind === "Agent") {
    if (!isJsonObject(resource.spec)) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Agent.spec must be an object.",
        path: pathPrefix,
      });
      return errors;
    }

    const modelConfig = resource.spec.modelConfig;
    if (!isJsonObject(modelConfig) || !hasObjectRefLike(modelConfig.modelRef)) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Agent.spec.modelConfig.modelRef is required.",
        path: `${pathPrefix}.modelConfig.modelRef`,
      });
    }

    const prompt = resource.spec.prompt;
    if (prompt !== undefined && !isJsonObject(prompt)) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Agent.spec.prompt must be an object when provided.",
        path: `${pathPrefix}.prompt`,
      });
    }
    if (isJsonObject(prompt)) {
      const hasSystem = Object.prototype.hasOwnProperty.call(prompt, "system")
        && prompt.system !== undefined;
      const hasSystemRef = Object.prototype.hasOwnProperty.call(prompt, "systemRef")
        && prompt.systemRef !== undefined;

      if (hasSystem && typeof prompt.system !== "string") {
        errors.push({
          code: "E_CONFIG_SCHEMA_INVALID",
          message: "Agent.spec.prompt.system must be a string when provided.",
          path: `${pathPrefix}.prompt.system`,
        });
      }
      if (hasSystemRef && typeof prompt.systemRef !== "string") {
        errors.push({
          code: "E_CONFIG_SCHEMA_INVALID",
          message: "Agent.spec.prompt.systemRef must be a string when provided.",
          path: `${pathPrefix}.prompt.systemRef`,
        });
      }
      if (hasSystem && hasSystemRef) {
        errors.push({
          code: "E_CONFIG_SCHEMA_INVALID",
          message: "Agent.spec.prompt.system and Agent.spec.prompt.systemRef cannot be used together.",
          path: `${pathPrefix}.prompt`,
          suggestion: "system 또는 systemRef 중 하나만 선언하세요.",
        });
      }
    }

  }

  if (resource.kind === "Swarm") {
    if (!isJsonObject(resource.spec)) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Swarm.spec must be an object.",
        path: pathPrefix,
      });
      return errors;
    }

    if (!hasObjectRefLike(resource.spec.entryAgent)) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Swarm.spec.entryAgent is required.",
        path: `${pathPrefix}.entryAgent`,
      });
    }

    if ("instanceKey" in resource.spec && resource.spec.instanceKey !== undefined) {
      const instanceKeyValue = resource.spec.instanceKey;
      if (typeof instanceKeyValue !== "string" || instanceKeyValue.trim().length === 0) {
        errors.push({
          code: "E_CONFIG_SCHEMA_INVALID",
          message: "Swarm.spec.instanceKey must be a non-empty string when provided.",
          path: `${pathPrefix}.instanceKey`,
        });
      }
    }

    if (!Array.isArray(resource.spec.agents) || resource.spec.agents.length === 0) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Swarm.spec.agents must have at least one item.",
        path: `${pathPrefix}.agents`,
      });
      return errors;
    }

    const entryAgentRef = extractNormalizedObjectRef(resource.spec.entryAgent);
    const agentRefs = resource.spec.agents.map((value, index) => ({
      ref: extractNormalizedObjectRef(value),
      path: `${pathPrefix}.agents[${index}]`,
    }));

    agentRefs.forEach((value) => {
      if (!value.ref) {
        errors.push({
          code: "E_CONFIG_SCHEMA_INVALID",
          message: "Swarm.spec.agents[] must be an ObjectRef-like value.",
          path: value.path,
        });
      }
    });

    if (entryAgentRef?.kind === "Agent") {
      const included = agentRefs.some((value) =>
        value.ref ? isSameAgentRef(entryAgentRef, value.ref) : false,
      );
      if (!included) {
        errors.push({
          code: "E_CONFIG_SCHEMA_INVALID",
          message: "Swarm.spec.entryAgent must be included in Swarm.spec.agents.",
          path: `${pathPrefix}.entryAgent`,
        });
      }
    }
  }

  if (resource.kind === "Extension") {
    if (!isJsonObject(resource.spec) || typeof resource.spec.entry !== "string") {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Extension.spec.entry is required.",
        path: `${pathPrefix}.entry`,
      });
    }
  }

  if (resource.kind === "Connector") {
    if (!isJsonObject(resource.spec) || typeof resource.spec.entry !== "string") {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Connector.spec.entry is required.",
        path: `${pathPrefix}.entry`,
      });
    }

    if (!isJsonObject(resource.spec) || !Array.isArray(resource.spec.events) || resource.spec.events.length === 0) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Connector.spec.events must have at least one item.",
        path: `${pathPrefix}.events`,
      });
    } else {
      const seenEventNames = new Set<string>();
      resource.spec.events.forEach((value, index) => {
        if (!isJsonObject(value) || typeof value.name !== "string" || value.name.trim().length === 0) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: "Connector.spec.events[].name is required.",
            path: `${pathPrefix}.events[${index}].name`,
          });
          return;
        }

        if (seenEventNames.has(value.name)) {
          errors.push({
            code: "E_CONFIG_SCHEMA_INVALID",
            message: `Duplicate Connector event name '${value.name}'.`,
            path: `${pathPrefix}.events[${index}].name`,
          });
        }
        seenEventNames.add(value.name);
      });
    }
  }

  if (resource.kind === "Connection") {
    if (!isJsonObject(resource.spec) || !hasObjectRefLike(resource.spec.connectorRef)) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Connection.spec.connectorRef is required.",
        path: `${pathPrefix}.connectorRef`,
      });
    }
  }

  return errors;
}

function validatePackageDocumentPlacement(resources: RuntimeResource[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const grouped = new Map<string, RuntimeResource[]>();

  resources
    .filter((resource) => resource.kind === "Package")
    .forEach((resource) => {
      const scopeKey = resourcePackageScope(resource);
      const groupKey = `${scopeKey}::${resource.__file}`;
      const list = grouped.get(groupKey) ?? [];
      list.push(resource);
      grouped.set(groupKey, list);
    });

  grouped.forEach((group) => {
    if (group.length > 1) {
      group.forEach((resource) => {
        errors.push({
          code: "E_CONFIG_PACKAGE_DOC_DUPLICATED",
          message: "Package document must appear at most once per file.",
          path: `${resource.__file}#${resource.__docIndex}.kind`,
          suggestion: "kind: Package 문서를 하나만 유지하세요.",
        });
      });
    }

    group.forEach((resource) => {
      if (resource.__docIndex !== 0) {
        errors.push({
          code: "E_CONFIG_PACKAGE_DOC_POSITION",
          message: "Package document must be the first YAML document in goondan.yaml.",
          path: `${resource.__file}#${resource.__docIndex}.kind`,
          suggestion: "kind: Package 문서를 첫 번째 문서로 이동하세요.",
        });
      }
    });
  });

  return errors;
}

function hasObjectRefLike(value: unknown): boolean {
  return extractNormalizedObjectRef(value) !== null;
}

function isSameAgentRef(
  left: { kind: string; name: string; package?: string },
  right: { kind: string; name: string; package?: string },
): boolean {
  if (left.kind !== "Agent" || right.kind !== "Agent") {
    return false;
  }

  if (left.name !== right.name) {
    return false;
  }

  if (left.package && right.package) {
    return left.package === right.package;
  }

  return true;
}

function collectObjectRefCandidates(value: unknown, path: string, parentKey = ""): RefCandidate[] {
  const refs: RefCandidate[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (parentKey === "tools" || parentKey === "extensions" || parentKey === "agents") {
        if (extractNormalizedObjectRef(item)) {
          refs.push({ value: item, path: itemPath });
          return;
        }
      }

      refs.push(...collectObjectRefCandidates(item, itemPath, parentKey));
    });
    return refs;
  }

  if (!isJsonObject(value)) {
    return refs;
  }

  const record: Record<string, unknown> = value;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;

    if (key === "ref") {
      if (extractNormalizedObjectRef(child)) {
        refs.push({ value: child, path: childPath });
      }
      continue;
    }

    if (key.endsWith("Ref")) {
      if (extractNormalizedObjectRef(child)) {
        refs.push({ value: child, path: childPath });
      }
      continue;
    }

    refs.push(...collectObjectRefCandidates(child, childPath, key));
  }

  return refs;
}

export function toRuntimeResource(input: {
  value: unknown;
  file: string;
  docIndex: number;
  packageName?: string;
  rootDir?: string;
}): RuntimeResource | null {
  const maybeObject = input.value;
  if (!isJsonObject(maybeObject)) {
    return null;
  }

  const apiVersion = maybeObject.apiVersion;
  const kind = maybeObject.kind;
  const metadata = maybeObject.metadata;
  const spec = maybeObject.spec;

  if (typeof kind !== "string") {
    return null;
  }

  if (!isJsonObject(metadata) || typeof metadata.name !== "string") {
    return null;
  }

  const labels = metadata.labels;
  const annotations = metadata.annotations;

  if (labels !== undefined && !isStringRecord(labels)) {
    return null;
  }

  if (annotations !== undefined && !isStringRecord(annotations)) {
    return null;
  }

  if (typeof apiVersion !== "string") {
    return {
      apiVersion: "",
      kind: isKnownKind(kind) ? kind : "Model",
      metadata: {
        name: metadata.name,
      },
      spec,
      __file: input.file,
      __docIndex: input.docIndex,
      __package: input.packageName,
      __rootDir: input.rootDir,
    };
  }

  if (!isKnownKind(kind)) {
    return {
      apiVersion,
      kind: "Model",
      metadata: {
        name: metadata.name,
      },
      spec,
      __file: input.file,
      __docIndex: input.docIndex,
      __package: input.packageName,
      __rootDir: input.rootDir,
    };
  }

  return {
    apiVersion,
    kind,
    metadata: {
      name: metadata.name,
      labels,
      annotations,
    },
    spec,
    __file: input.file,
    __docIndex: input.docIndex,
    __package: input.packageName,
    __rootDir: input.rootDir,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isJsonObject(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

export interface ResourceIndex {
  byIdentity: Map<string, RuntimeResource>;
  byScopedIdentity: Map<string, RuntimeResource>;
  byKind: Map<KnownKind, RuntimeResource[]>;
}

export function buildResourceIndex(resources: RuntimeResource[]): ResourceIndex {
  const byIdentity = new Map<string, RuntimeResource>();
  const byScopedIdentity = new Map<string, RuntimeResource>();
  const byKind = new Map<KnownKind, RuntimeResource[]>();

  resources.forEach((resource) => {
    const identity = `${resource.kind}/${resource.metadata.name}`;
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, resource);
    }

    const scopedIdentity = toScopedResourceIdentity(resourcePackageScope(resource), resource.kind, resource.metadata.name);
    byScopedIdentity.set(scopedIdentity, resource);

    const list = byKind.get(resource.kind) ?? [];
    list.push(resource);
    byKind.set(resource.kind, list);
  });

  return {
    byIdentity,
    byScopedIdentity,
    byKind,
  };
}
