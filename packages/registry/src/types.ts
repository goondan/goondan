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
  dist: RegistryDist;
  access: PackageAccess;
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

export interface RegistryServerOptions {
  storageRoot: string;
  baseUrl?: string;
  authTokens?: string[];
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RegistryClientOptions {
  registry?: string;
  token?: string;
  packageName?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

export interface RegistryPublishInput {
  name: string;
  version: string;
  tarball: Buffer;
  description?: string;
  access?: PackageAccess;
  dependencies?: Record<string, string>;
  tag?: string;
  distTags?: Record<string, string>;
  token?: string;
}

export interface RegistryConfigFile {
  registry?: string;
  registries?: Record<string, { token?: string }>;
  scopedRegistries?: Record<string, string>;
}

export interface ResolvedRegistryConfig {
  registryUrl: string;
  token?: string;
}

export interface ResolveRegistryConfigOptions {
  packageName?: string;
  registry?: string;
  token?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}
