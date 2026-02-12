import type {
  PackageAccess,
  RegistryConfigFile,
  RegistryPackageMetadata,
  RegistryPublishAttachment,
  RegistryPublishPayload,
  RegistryVersionMetadata,
} from "./types.js";

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPackageAccess(value: unknown): value is PackageAccess {
  return value === "public" || value === "restricted";
}

export function parseString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseStringRecord(value: unknown): Record<string, string> | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const parsed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return null;
    }

    parsed[key] = entry;
  }

  return parsed;
}

export function parsePublishPayload(value: unknown): RegistryPublishPayload | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const payload: RegistryPublishPayload = {};

  if ("name" in value) {
    const name = parseString(value.name);
    if (name === null) {
      return null;
    }

    payload.name = name;
  }

  if ("version" in value) {
    const version = parseString(value.version);
    if (version === null) {
      return null;
    }

    payload.version = version;
  }

  if ("description" in value) {
    const description = parseString(value.description);
    if (description === null) {
      return null;
    }

    payload.description = description;
  }

  if ("access" in value) {
    if (!isPackageAccess(value.access)) {
      return null;
    }

    payload.access = value.access;
  }

  if ("dependencies" in value) {
    const dependencies = parseStringRecord(value.dependencies);
    if (dependencies === null) {
      return null;
    }

    payload.dependencies = dependencies;
  }

  if ("deprecated" in value) {
    const deprecated = parseString(value.deprecated);
    if (deprecated === null) {
      return null;
    }

    payload.deprecated = deprecated;
  }

  if ("dist-tags" in value) {
    const distTags = parseStringRecord(value["dist-tags"]);
    if (distTags === null) {
      return null;
    }

    payload["dist-tags"] = distTags;
  }

  if ("_attachments" in value) {
    const attachments = parseAttachments(value._attachments);
    if (attachments === null) {
      return null;
    }

    payload._attachments = attachments;
  }

  return payload;
}

function parseAttachments(value: unknown): Record<string, RegistryPublishAttachment> | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const parsed: Record<string, RegistryPublishAttachment> = {};

  for (const [key, attachmentValue] of Object.entries(value)) {
    if (!isObjectRecord(attachmentValue)) {
      return null;
    }

    const data = parseString(attachmentValue.data);
    if (data === null) {
      return null;
    }

    const attachment: RegistryPublishAttachment = { data };

    if ("contentType" in attachmentValue) {
      const contentType = parseString(attachmentValue.contentType);
      if (contentType === null) {
        return null;
      }

      attachment.contentType = contentType;
    }

    if ("length" in attachmentValue) {
      if (typeof attachmentValue.length !== "number") {
        return null;
      }

      attachment.length = attachmentValue.length;
    }

    parsed[key] = attachment;
  }

  return parsed;
}

export function parseDeprecationPayload(value: unknown): string | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const message = parseString(value.message);
  if (message === null) {
    return null;
  }

  return message;
}

export function isRegistryVersionMetadata(value: unknown): value is RegistryVersionMetadata {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (typeof value.version !== "string") {
    return false;
  }

  if (!isObjectRecord(value.dist)) {
    return false;
  }

  if (typeof value.dist.tarball !== "string") {
    return false;
  }

  if (typeof value.dist.shasum !== "string") {
    return false;
  }

  if (typeof value.dist.integrity !== "string") {
    return false;
  }

  if (typeof value.deprecated !== "string") {
    return false;
  }

  if (!isPackageAccess(value.access)) {
    return false;
  }

  const dependencies = parseStringRecord(value.dependencies);
  return dependencies !== null;
}

export function isRegistryPackageMetadata(value: unknown): value is RegistryPackageMetadata {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (typeof value.name !== "string") {
    return false;
  }

  if (typeof value.description !== "string") {
    return false;
  }

  if (!isPackageAccess(value.access)) {
    return false;
  }

  if (!isObjectRecord(value.versions)) {
    return false;
  }

  for (const versionMetadata of Object.values(value.versions)) {
    if (!isRegistryVersionMetadata(versionMetadata)) {
      return false;
    }
  }

  const distTags = parseStringRecord(value["dist-tags"]);
  return distTags !== null;
}

export function parseRegistryConfigFile(value: unknown): RegistryConfigFile | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const parsed: RegistryConfigFile = {};

  if ("registry" in value) {
    const registry = parseString(value.registry);
    if (registry === null) {
      return null;
    }

    parsed.registry = registry;
  }

  if ("registries" in value) {
    const registries = parseRegistriesConfig(value.registries);
    if (registries === null) {
      return null;
    }

    parsed.registries = registries;
  }

  if ("scopedRegistries" in value) {
    const scopedRegistries = parseStringRecord(value.scopedRegistries);
    if (scopedRegistries === null) {
      return null;
    }

    parsed.scopedRegistries = scopedRegistries;
  }

  return parsed;
}

function parseRegistriesConfig(value: unknown): Record<string, { token?: string }> | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const parsed: Record<string, { token?: string }> = {};

  for (const [registryUrl, entry] of Object.entries(value)) {
    if (!isObjectRecord(entry)) {
      return null;
    }

    const registryEntry: { token?: string } = {};

    if ("token" in entry) {
      const token = parseString(entry.token);
      if (token === null) {
        return null;
      }

      registryEntry.token = token;
    }

    parsed[registryUrl] = registryEntry;
  }

  return parsed;
}
