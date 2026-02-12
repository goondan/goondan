import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { buildScopedPackagePath, parseScopedPackageName, type ParsedPackageName } from "./package-name.js";
import { compareSemver, isValidSemver } from "./semver.js";
import { FileRegistryStore } from "./storage.js";
import type {
  RegistryPackageMetadata,
  RegistryPublishPayload,
  RegistryServerOptions,
  RegistryVersionMetadata,
} from "./types.js";
import { parseDeprecationPayload, parsePublishPayload } from "./validators.js";

interface PackageRoute {
  type: "package";
  packageName: ParsedPackageName;
}

interface VersionRoute {
  type: "version";
  packageName: ParsedPackageName;
  version: string;
}

interface TarballRoute {
  type: "tarball";
  packageName: ParsedPackageName;
  version: string;
}

interface DeprecateRoute {
  type: "deprecate";
  packageName: ParsedPackageName;
  version: string;
}

type ParsedRoute = PackageRoute | VersionRoute | TarballRoute | DeprecateRoute;

export function createRegistryRequestHandler(
  options: RegistryServerOptions,
): (request: Request) => Promise<Response> {
  const store = new FileRegistryStore(options.storageRoot);
  const initialization = store.initialize();
  const validTokens = options.authTokens ?? [];

  return async (request: Request): Promise<Response> => {
    await initialization;

    const url = new URL(request.url);
    const route = parseRegistryRoute(url.pathname);
    if (route === null) {
      return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package route not found" });
    }

    const isAuthorized = hasValidBearerToken(request, validTokens);

    if (route.type === "package") {
      if (request.method === "GET") {
        return getPackageMetadata(store, route, isAuthorized);
      }

      if (request.method === "PUT") {
        if (!isAuthorized) {
          return createUnauthorizedResponse();
        }

        return publishPackage(store, route, request, options.baseUrl ?? url.origin);
      }

      if (request.method === "DELETE") {
        if (!isAuthorized) {
          return createUnauthorizedResponse();
        }

        return deletePackage(store, route);
      }

      return createMethodNotAllowedResponse();
    }

    if (route.type === "version") {
      if (request.method === "GET") {
        return getPackageVersion(store, route, isAuthorized);
      }

      if (request.method === "DELETE") {
        if (!isAuthorized) {
          return createUnauthorizedResponse();
        }

        return unpublishVersion(store, route);
      }

      return createMethodNotAllowedResponse();
    }

    if (route.type === "tarball") {
      if (request.method !== "GET") {
        return createMethodNotAllowedResponse();
      }

      return getPackageTarball(store, route, isAuthorized);
    }

    if (request.method !== "PUT") {
      return createMethodNotAllowedResponse();
    }

    if (!isAuthorized) {
      return createUnauthorizedResponse();
    }

    return deprecateVersion(store, route, request);
  };
}

export function createRegistryNodeServer(options: RegistryServerOptions): Server {
  const handler = createRegistryRequestHandler(options);

  return createServer(async (request, response) => {
    const webRequest = await toWebRequest(request);
    const webResponse = await handler(webRequest);
    await sendWebResponse(response, webResponse);
  });
}

function parseRegistryRoute(pathname: string): ParsedRoute | null {
  const parts = pathname.split("/");
  const segments: string[] = [];

  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }

    try {
      segments.push(decodeURIComponent(part));
    } catch {
      return null;
    }
  }

  if (segments.length < 2) {
    return null;
  }

  const scope = segments[0];
  const name = segments[1];

  if (scope === undefined || name === undefined) {
    return null;
  }

  const packageName = parseScopedPackageName(`${scope}/${name}`);
  if (packageName === null) {
    return null;
  }

  if (segments.length === 2) {
    return {
      type: "package",
      packageName,
    };
  }

  const third = segments[2];
  if (third === undefined) {
    return null;
  }

  if (segments.length === 3) {
    return {
      type: "version",
      packageName,
      version: third,
    };
  }

  const fourth = segments[3];
  if (fourth === undefined) {
    return null;
  }

  if (segments.length === 4 && third === "-") {
    const parsedVersion = extractVersionFromTarballName(name, fourth);
    if (parsedVersion === null) {
      return null;
    }

    return {
      type: "tarball",
      packageName,
      version: parsedVersion,
    };
  }

  if (segments.length === 4 && fourth === "deprecate") {
    return {
      type: "deprecate",
      packageName,
      version: third,
    };
  }

  return null;
}

function extractVersionFromTarballName(packageName: string, fileName: string): string | null {
  if (!fileName.endsWith(".tgz")) {
    return null;
  }

  const prefix = `${packageName}-`;
  if (!fileName.startsWith(prefix)) {
    return null;
  }

  const version = fileName.slice(prefix.length, fileName.length - ".tgz".length);
  if (version.length === 0) {
    return null;
  }

  return version;
}

function hasValidBearerToken(request: Request, validTokens: string[]): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return false;
  }

  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return false;
  }

  const token = authorization.slice(prefix.length).trim();
  if (token.length === 0) {
    return false;
  }

  return validTokens.includes(token);
}

async function getPackageMetadata(
  store: FileRegistryStore,
  route: PackageRoute,
  isAuthorized: boolean,
): Promise<Response> {
  const metadata = await store.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package not found" });
  }

  if (metadata.access === "restricted" && !isAuthorized) {
    return createUnauthorizedResponse();
  }

  return createJsonResponse(200, metadata);
}

async function getPackageVersion(
  store: FileRegistryStore,
  route: VersionRoute,
  isAuthorized: boolean,
): Promise<Response> {
  const metadata = await store.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package not found" });
  }

  const versionMetadata = metadata.versions[route.version];
  if (versionMetadata === undefined) {
    return createJsonResponse(404, { error: "PKG_VERSION_NOT_FOUND", message: "Version not found" });
  }

  if ((metadata.access === "restricted" || versionMetadata.access === "restricted") && !isAuthorized) {
    return createUnauthorizedResponse();
  }

  return createJsonResponse(200, versionMetadata);
}

async function getPackageTarball(
  store: FileRegistryStore,
  route: TarballRoute,
  isAuthorized: boolean,
): Promise<Response> {
  const metadata = await store.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package not found" });
  }

  const versionMetadata = metadata.versions[route.version];
  if (versionMetadata === undefined) {
    return createJsonResponse(404, { error: "PKG_VERSION_NOT_FOUND", message: "Version not found" });
  }

  if ((metadata.access === "restricted" || versionMetadata.access === "restricted") && !isAuthorized) {
    return createUnauthorizedResponse();
  }

  const tarball = await store.readTarball(route.packageName, route.version);
  if (tarball === null) {
    return createJsonResponse(404, { error: "PKG_TARBALL_NOT_FOUND", message: "Tarball not found" });
  }

  return new Response(tarball, {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}

async function publishPackage(
  store: FileRegistryStore,
  route: PackageRoute,
  request: Request,
  baseUrl: string,
): Promise<Response> {
  const payloadResult = await parseJsonRequest(request);
  if (!payloadResult.ok) {
    return payloadResult.response;
  }

  const payload = parsePublishPayload(payloadResult.value);
  if (payload === null) {
    return createJsonResponse(400, { error: "PKG_INVALID_PUBLISH_PAYLOAD", message: "Invalid publish payload" });
  }

  const version = payload.version;
  if (typeof version !== "string" || !isValidSemver(version)) {
    return createJsonResponse(400, { error: "PKG_INVALID_VERSION", message: "Version must be valid semver" });
  }

  if (typeof payload.name === "string" && payload.name !== route.packageName.fullName) {
    return createJsonResponse(400, {
      error: "PKG_NAME_MISMATCH",
      message: `Payload name must match route (${route.packageName.fullName})`,
    });
  }

  const tarball = extractTarballFromPayload(payload);
  if (tarball === null) {
    return createJsonResponse(400, {
      error: "PKG_INVALID_ATTACHMENT",
      message: "Publish payload must include one base64 tarball in _attachments",
    });
  }

  await store.saveTarball(route.packageName, version, tarball);

  const existingMetadata = await store.getMetadata(route.packageName);
  const metadata = buildUpdatedMetadata(existingMetadata, route.packageName, payload, version, tarball, baseUrl);

  await store.saveMetadata(route.packageName, metadata);

  return createJsonResponse(201, {
    ok: true,
    id: route.packageName.fullName,
    version,
  });
}

async function unpublishVersion(store: FileRegistryStore, route: VersionRoute): Promise<Response> {
  const metadata = await store.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package not found" });
  }

  if (metadata.versions[route.version] === undefined) {
    return createJsonResponse(404, { error: "PKG_VERSION_NOT_FOUND", message: "Version not found" });
  }

  delete metadata.versions[route.version];
  await store.removeVersion(route.packageName, route.version);

  for (const [tag, tagVersion] of Object.entries(metadata["dist-tags"])) {
    if (tagVersion === route.version) {
      delete metadata["dist-tags"][tag];
    }
  }

  const remainingVersions = Object.keys(metadata.versions);
  if (remainingVersions.length === 0) {
    await store.removePackage(route.packageName);
    return createJsonResponse(200, {
      ok: true,
      removed: route.version,
    });
  }

  if (metadata["dist-tags"].latest === undefined) {
    const latestVersion = resolveLatestVersion(metadata.versions);
    if (latestVersion !== null) {
      metadata["dist-tags"].latest = latestVersion;
    }
  }

  await store.saveMetadata(route.packageName, metadata);

  return createJsonResponse(200, {
    ok: true,
    removed: route.version,
  });
}

async function deletePackage(store: FileRegistryStore, route: PackageRoute): Promise<Response> {
  const metadata = await store.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package not found" });
  }

  await store.removePackage(route.packageName);
  return createJsonResponse(200, {
    ok: true,
    id: route.packageName.fullName,
  });
}

async function deprecateVersion(
  store: FileRegistryStore,
  route: DeprecateRoute,
  request: Request,
): Promise<Response> {
  const payloadResult = await parseJsonRequest(request);
  if (!payloadResult.ok) {
    return payloadResult.response;
  }

  const message = parseDeprecationPayload(payloadResult.value);
  if (message === null) {
    return createJsonResponse(400, {
      error: "PKG_INVALID_DEPRECATE_PAYLOAD",
      message: "Deprecation payload must include message",
    });
  }

  const metadata = await store.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, { error: "PKG_NOT_FOUND", message: "Package not found" });
  }

  const versionMetadata = metadata.versions[route.version];
  if (versionMetadata === undefined) {
    return createJsonResponse(404, { error: "PKG_VERSION_NOT_FOUND", message: "Version not found" });
  }

  versionMetadata.deprecated = message;
  metadata.versions[route.version] = versionMetadata;
  await store.saveMetadata(route.packageName, metadata);

  return createJsonResponse(200, {
    ok: true,
    id: route.packageName.fullName,
    version: route.version,
    deprecated: message,
  });
}

function buildUpdatedMetadata(
  existingMetadata: RegistryPackageMetadata | null,
  packageName: ParsedPackageName,
  payload: RegistryPublishPayload,
  version: string,
  tarball: Buffer,
  baseUrl: string,
): RegistryPackageMetadata {
  const access = payload.access ?? existingMetadata?.access ?? "public";
  const description = payload.description ?? existingMetadata?.description ?? "";

  const versions = cloneVersions(existingMetadata?.versions ?? {});

  const packagePath = buildScopedPackagePath(packageName.scope, packageName.name);
  const tarballPath = `${packagePath}/-/${encodeURIComponent(packageName.name)}-${encodeURIComponent(version)}.tgz`;
  const tarballUrl = `${normalizeBaseUrl(baseUrl)}${tarballPath}`;

  const shasum = createHash("sha1").update(tarball).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;

  const versionMetadata: RegistryVersionMetadata = {
    version,
    dependencies: payload.dependencies ?? {},
    deprecated: payload.deprecated ?? "",
    access,
    dist: {
      tarball: tarballUrl,
      shasum,
      integrity,
    },
  };

  versions[version] = versionMetadata;

  const distTags: Record<string, string> = {
    ...(existingMetadata?.["dist-tags"] ?? {}),
  };

  const requestDistTags = payload["dist-tags"] ?? {};
  if (Object.keys(requestDistTags).length === 0) {
    const currentLatest = distTags.latest;
    if (currentLatest === undefined || compareSemver(version, currentLatest) > 0) {
      distTags.latest = version;
    }
  } else {
    for (const [tag, taggedVersion] of Object.entries(requestDistTags)) {
      distTags[tag] = taggedVersion;
    }

    if (distTags.latest === undefined) {
      distTags.latest = version;
    }
  }

  return {
    name: packageName.fullName,
    description,
    access,
    versions,
    "dist-tags": distTags,
  };
}

function cloneVersions(
  versions: Record<string, RegistryVersionMetadata>,
): Record<string, RegistryVersionMetadata> {
  const cloned: Record<string, RegistryVersionMetadata> = {};

  for (const [version, metadata] of Object.entries(versions)) {
    cloned[version] = {
      version: metadata.version,
      dependencies: {
        ...metadata.dependencies,
      },
      deprecated: metadata.deprecated,
      access: metadata.access,
      dist: {
        tarball: metadata.dist.tarball,
        shasum: metadata.dist.shasum,
        integrity: metadata.dist.integrity,
      },
    };
  }

  return cloned;
}

function resolveLatestVersion(versions: Record<string, RegistryVersionMetadata>): string | null {
  const names = Object.keys(versions);
  if (names.length === 0) {
    return null;
  }

  names.sort((left, right) => compareSemver(left, right));
  return names[names.length - 1] ?? null;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/")) {
    return baseUrl.slice(0, -1);
  }

  return baseUrl;
}

function extractTarballFromPayload(payload: RegistryPublishPayload): Buffer | null {
  const attachments = payload._attachments;
  if (attachments === undefined) {
    return null;
  }

  for (const attachment of Object.values(attachments)) {
    const decoded = decodeBase64(attachment.data);
    if (decoded !== null) {
      return decoded;
    }
  }

  return null;
}

function decodeBase64(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

async function parseJsonRequest(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type");
  if (contentType !== null && !contentType.includes("application/json")) {
    return {
      ok: false,
      response: createJsonResponse(415, {
        error: "PKG_UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json",
      }),
    };
  }

  const raw = await request.text();
  if (raw.length === 0) {
    return {
      ok: false,
      response: createJsonResponse(400, {
        error: "PKG_EMPTY_REQUEST_BODY",
        message: "Request body must not be empty",
      }),
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(raw),
    };
  } catch {
    return {
      ok: false,
      response: createJsonResponse(400, {
        error: "PKG_INVALID_JSON",
        message: "Request body must be valid JSON",
      }),
    };
  }
}

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function createUnauthorizedResponse(): Response {
  return createJsonResponse(401, {
    error: "PKG_AUTH_REQUIRED",
    message: "Bearer token is required",
  });
}

function createMethodNotAllowedResponse(): Response {
  return createJsonResponse(405, {
    error: "PKG_METHOD_NOT_ALLOWED",
    message: "Method not allowed",
  });
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const method = request.method ?? "GET";
  const host = request.headers.host ?? "localhost";
  const path = request.url ?? "/";
  const url = new URL(path, `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    }
  }

  if (method === "GET" || method === "HEAD") {
    return new Request(url, {
      method,
      headers,
    });
  }

  const body = await readIncomingBody(request);
  return new Request(url, {
    method,
    headers,
    body,
  });
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function sendWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  response.statusCode = webResponse.status;

  for (const [key, value] of webResponse.headers.entries()) {
    response.setHeader(key, value);
  }

  const body = Buffer.from(await webResponse.arrayBuffer());
  response.end(body);
}
