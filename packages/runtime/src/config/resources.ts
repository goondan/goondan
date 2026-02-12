import type {
  KnownKind,
  RuntimeResource,
  ValidationError,
} from "../types.js";
import { isJsonObject, isKnownKind } from "../types.js";
import { isObjectRefLikeString, normalizeObjectRef } from "./object-ref.js";

const SUPPORTED_API_VERSION = "goondan.ai/v1";

interface RefCandidate {
  value: string | { kind: string; name: string; package?: string };
  path: string;
}

export function validateResources(resources: RuntimeResource[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenNames = new Set<string>();

  resources.forEach((resource) => {
    const resourcePath = `${resource.__file}#${resource.__docIndex}`;

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

    const identity = `${resource.kind}/${resource.metadata.name}`;
    if (seenNames.has(identity)) {
      errors.push({
        code: "E_CONFIG_DUPLICATE_NAME",
        message: `Duplicate resource identity '${identity}'.`,
        path: `${resourcePath}.metadata.name`,
        suggestion: "동일 kind 내 name 고유성을 보장하세요.",
      });
    }
    seenNames.add(identity);
  });

  const existing = new Set(resources.map((resource) => `${resource.kind}/${resource.metadata.name}`));

  resources.forEach((resource) => {
    const rootPath = `${resource.__file}#${resource.__docIndex}.spec`;
    const refs = collectObjectRefCandidates(resource.spec, rootPath);

    refs.forEach((candidate) => {
      try {
        const normalized =
          typeof candidate.value === "string"
            ? normalizeObjectRef(candidate.value)
            : normalizeObjectRef(candidate.value);

        if (normalized.package !== undefined) {
          return;
        }

        const identity = `${normalized.kind}/${normalized.name}`;
        if (!existing.has(identity)) {
          errors.push({
            code: "E_CONFIG_REF_NOT_FOUND",
            message: `${identity} 참조를 찾을 수 없습니다.`,
            path: candidate.path,
            suggestion: "kind/name 또는 package 범위를 확인하세요.",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid ObjectRef";
        errors.push({
          code: "E_CONFIG_INVALID_REF",
          message,
          path: candidate.path,
          suggestion: "ObjectRef는 Kind/name 또는 { kind, name } 형식이어야 합니다.",
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

    if (!Array.isArray(resource.spec.agents) || resource.spec.agents.length === 0) {
      errors.push({
        code: "E_CONFIG_SCHEMA_INVALID",
        message: "Swarm.spec.agents must have at least one item.",
        path: `${pathPrefix}.agents`,
      });
    }
  }

  return errors;
}

function hasObjectRefLike(value: unknown): boolean {
  if (typeof value === "string") {
    return isObjectRefLikeString(value);
  }

  if (!isJsonObject(value)) {
    return false;
  }

  return typeof value.kind === "string" && typeof value.name === "string";
}

function collectObjectRefCandidates(value: unknown, path: string, parentKey = ""): RefCandidate[] {
  const refs: RefCandidate[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (parentKey === "tools" || parentKey === "extensions" || parentKey === "agents") {
        if (typeof item === "string" && isObjectRefLikeString(item)) {
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
      if (typeof child === "string" && isObjectRefLikeString(child)) {
        refs.push({ value: child, path: childPath });
      } else if (isJsonObject(child) && typeof child.kind === "string" && typeof child.name === "string") {
        const objectRef = {
          kind: child.kind,
          name: child.name,
          package: typeof child.package === "string" ? child.package : undefined,
        };
        refs.push({ value: objectRef, path: childPath });
      }
      continue;
    }

    if (key.endsWith("Ref")) {
      if (typeof child === "string" && isObjectRefLikeString(child)) {
        refs.push({ value: child, path: childPath });
      } else if (isJsonObject(child) && typeof child.kind === "string" && typeof child.name === "string") {
        const objectRef = {
          kind: child.kind,
          name: child.name,
          package: typeof child.package === "string" ? child.package : undefined,
        };
        refs.push({ value: objectRef, path: childPath });
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
  byKind: Map<KnownKind, RuntimeResource[]>;
}

export function buildResourceIndex(resources: RuntimeResource[]): ResourceIndex {
  const byIdentity = new Map<string, RuntimeResource>();
  const byKind = new Map<KnownKind, RuntimeResource[]>();

  resources.forEach((resource) => {
    byIdentity.set(`${resource.kind}/${resource.metadata.name}`, resource);

    const list = byKind.get(resource.kind) ?? [];
    list.push(resource);
    byKind.set(resource.kind, list);
  });

  return {
    byIdentity,
    byKind,
  };
}
