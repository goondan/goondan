export type PackageAccess = "public" | "restricted";

export interface RegistryDist {
  tarball: string;
  shasum: string;
  integrity: string;
}

export interface RegistryVersionMetadata {
  version: string;
  dependencies: Record<string, string>;
  deprecated: string;
  access: PackageAccess;
  dist: RegistryDist;
}

export interface RegistryPackageMetadata {
  name: string;
  description: string;
  access: PackageAccess;
  versions: Record<string, RegistryVersionMetadata>;
  "dist-tags": Record<string, string>;
}

export interface RegistryPublishAttachment {
  data: string;
  contentType?: string;
  length?: number;
}

export interface RegistryPublishPayload {
  name?: string;
  version?: string;
  description?: string;
  access?: PackageAccess;
  dependencies?: Record<string, string>;
  deprecated?: string;
  "dist-tags"?: Record<string, string>;
  _attachments?: Record<string, RegistryPublishAttachment>;
}

export interface ParsedPackageName {
  scope: string;
  name: string;
  fullName: string;
}

export interface PackageRoute {
  type: "package";
  packageName: ParsedPackageName;
}

export interface VersionRoute {
  type: "version";
  packageName: ParsedPackageName;
  version: string;
}

export interface TarballRoute {
  type: "tarball";
  packageName: ParsedPackageName;
  version: string;
}

export interface DeprecateRoute {
  type: "deprecate";
  packageName: ParsedPackageName;
  version: string;
}

export type RegistryRoute = PackageRoute | VersionRoute | TarballRoute | DeprecateRoute;

export interface RegistryStorage {
  getMetadata(packageName: ParsedPackageName): Promise<RegistryPackageMetadata | null>;
  putMetadata(packageName: ParsedPackageName, metadata: RegistryPackageMetadata): Promise<void>;
  deleteMetadata(packageName: ParsedPackageName): Promise<void>;
  getTarball(packageName: ParsedPackageName, version: string): Promise<Uint8Array | null>;
  putTarball(packageName: ParsedPackageName, version: string, tarball: Uint8Array): Promise<void>;
  deleteTarball(packageName: ParsedPackageName, version: string): Promise<void>;
}

export interface RegistryRouterOptions {
  storage: RegistryStorage;
  authTokens?: readonly string[];
  baseUrl?: string;
}

export interface RegistryKvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RegistryR2PutOptions {
  httpMetadata?: {
    contentType?: string;
  };
}

export interface RegistryR2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RegistryR2Bucket {
  get(key: string): Promise<RegistryR2Object | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView, options?: RegistryR2PutOptions): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface RegistryWorkerEnv {
  REGISTRY_KV: RegistryKvNamespace;
  REGISTRY_R2: RegistryR2Bucket;
  REGISTRY_AUTH_TOKENS?: string;
  PUBLIC_REGISTRY_URL?: string;
}

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
      if (typeof attachmentValue.length !== "number" || !Number.isFinite(attachmentValue.length)) {
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

  return parseString(value.message);
}

export function isRegistryVersionMetadata(value: unknown): value is RegistryVersionMetadata {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (typeof value.version !== "string") {
    return false;
  }

  if (typeof value.deprecated !== "string") {
    return false;
  }

  if (!isPackageAccess(value.access)) {
    return false;
  }

  const dependencies = parseStringRecord(value.dependencies);
  if (dependencies === null) {
    return false;
  }

  if (!isObjectRecord(value.dist)) {
    return false;
  }

  return (
    typeof value.dist.tarball === "string" &&
    typeof value.dist.shasum === "string" &&
    typeof value.dist.integrity === "string"
  );
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
