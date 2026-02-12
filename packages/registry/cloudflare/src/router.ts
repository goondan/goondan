import { createDistIntegrity, decodeBase64 } from "./crypto.js";
import type {
  DeprecateRoute,
  PackageRoute,
  ParsedPackageName,
  RegistryPackageMetadata,
  RegistryPublishPayload,
  RegistryRoute,
  RegistryRouterOptions,
  RegistryVersionMetadata,
  TarballRoute,
  VersionRoute,
} from "./types.js";
import { parseDeprecationPayload, parsePublishPayload } from "./types.js";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-.]+)?$/;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface JsonParseSuccess {
  ok: true;
  value: unknown;
}

interface JsonParseFailure {
  ok: false;
  response: Response;
}

type JsonParseResult = JsonParseSuccess | JsonParseFailure;

export function createRegistryRouter(options: RegistryRouterOptions): (request: Request) => Promise<Response> {
  const validTokens = options.authTokens ?? [];

  return async (request: Request): Promise<Response> => {
    const route = parseRegistryRoute(new URL(request.url).pathname);
    if (route === null) {
      return createJsonResponse(404, {
        error: "PKG_NOT_FOUND",
        message: "Package route not found",
      });
    }

    const isAuthorized = hasValidBearerToken(request, validTokens);

    if (route.type === "package") {
      if (request.method === "GET") {
        return getPackageMetadata(options, route, isAuthorized);
      }

      if (request.method === "PUT") {
        if (!isAuthorized) {
          return createUnauthorizedResponse();
        }

        const baseUrl = options.baseUrl ?? new URL(request.url).origin;
        return publishPackage(options, route, request, baseUrl);
      }

      if (request.method === "DELETE") {
        if (!isAuthorized) {
          return createUnauthorizedResponse();
        }

        return deletePackage(options, route);
      }

      return createMethodNotAllowedResponse();
    }

    if (route.type === "version") {
      if (request.method === "GET") {
        return getPackageVersion(options, route, isAuthorized);
      }

      if (request.method === "DELETE") {
        if (!isAuthorized) {
          return createUnauthorizedResponse();
        }

        return unpublishVersion(options, route);
      }

      return createMethodNotAllowedResponse();
    }

    if (route.type === "tarball") {
      if (request.method !== "GET") {
        return createMethodNotAllowedResponse();
      }

      return getPackageTarball(options, route, isAuthorized);
    }

    if (request.method !== "PUT") {
      return createMethodNotAllowedResponse();
    }

    if (!isAuthorized) {
      return createUnauthorizedResponse();
    }

    return deprecateVersion(options, route, request);
  };
}

async function getPackageMetadata(
  options: RegistryRouterOptions,
  route: PackageRoute,
  isAuthorized: boolean,
): Promise<Response> {
  const metadata = await options.storage.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, {
      error: "PKG_NOT_FOUND",
      message: "Package not found",
    });
  }

  if (metadata.access === "restricted" && !isAuthorized) {
    return createUnauthorizedResponse();
  }

  return createJsonResponse(200, metadata);
}

async function getPackageVersion(
  options: RegistryRouterOptions,
  route: VersionRoute,
  isAuthorized: boolean,
): Promise<Response> {
  const metadata = await options.storage.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, {
      error: "PKG_NOT_FOUND",
      message: "Package not found",
    });
  }

  const versionMetadata = metadata.versions[route.version];
  if (versionMetadata === undefined) {
    return createJsonResponse(404, {
      error: "PKG_VERSION_NOT_FOUND",
      message: "Version not found",
    });
  }

  if ((metadata.access === "restricted" || versionMetadata.access === "restricted") && !isAuthorized) {
    return createUnauthorizedResponse();
  }

  return createJsonResponse(200, versionMetadata);
}

async function getPackageTarball(
  options: RegistryRouterOptions,
  route: TarballRoute,
  isAuthorized: boolean,
): Promise<Response> {
  const metadata = await options.storage.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, {
      error: "PKG_NOT_FOUND",
      message: "Package not found",
    });
  }

  const versionMetadata = metadata.versions[route.version];
  if (versionMetadata === undefined) {
    return createJsonResponse(404, {
      error: "PKG_VERSION_NOT_FOUND",
      message: "Version not found",
    });
  }

  if ((metadata.access === "restricted" || versionMetadata.access === "restricted") && !isAuthorized) {
    return createUnauthorizedResponse();
  }

  const tarball = await options.storage.getTarball(route.packageName, route.version);
  if (tarball === null) {
    return createJsonResponse(404, {
      error: "PKG_TARBALL_NOT_FOUND",
      message: "Tarball not found",
    });
  }

  const bodyBuffer = new ArrayBuffer(tarball.byteLength);
  new Uint8Array(bodyBuffer).set(tarball);

  return new Response(bodyBuffer, {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}

async function publishPackage(
  options: RegistryRouterOptions,
  route: PackageRoute,
  request: Request,
  baseUrl: string,
): Promise<Response> {
  const parsedRequest = await parseJsonRequest(request);
  if (!parsedRequest.ok) {
    return parsedRequest.response;
  }

  const payload = parsePublishPayload(parsedRequest.value);
  if (payload === null) {
    return createJsonResponse(400, {
      error: "PKG_INVALID_PUBLISH_PAYLOAD",
      message: "Invalid publish payload",
    });
  }

  const version = payload.version;
  if (typeof version !== "string" || !isValidSemver(version)) {
    return createJsonResponse(400, {
      error: "PKG_INVALID_VERSION",
      message: "Version must be valid semver",
    });
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

  await options.storage.putTarball(route.packageName, version, tarball);

  const existingMetadata = await options.storage.getMetadata(route.packageName);
  const metadata = await buildUpdatedMetadata(existingMetadata, route.packageName, payload, version, tarball, baseUrl);
  await options.storage.putMetadata(route.packageName, metadata);

  return createJsonResponse(201, {
    ok: true,
    id: route.packageName.fullName,
    version,
  });
}

async function unpublishVersion(options: RegistryRouterOptions, route: VersionRoute): Promise<Response> {
  const metadata = await options.storage.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, {
      error: "PKG_NOT_FOUND",
      message: "Package not found",
    });
  }

  if (metadata.versions[route.version] === undefined) {
    return createJsonResponse(404, {
      error: "PKG_VERSION_NOT_FOUND",
      message: "Version not found",
    });
  }

  delete metadata.versions[route.version];
  await options.storage.deleteTarball(route.packageName, route.version);

  for (const [tag, taggedVersion] of Object.entries(metadata["dist-tags"])) {
    if (taggedVersion === route.version) {
      delete metadata["dist-tags"][tag];
    }
  }

  const remainingVersions = Object.keys(metadata.versions);
  if (remainingVersions.length === 0) {
    await options.storage.deleteMetadata(route.packageName);
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

  await options.storage.putMetadata(route.packageName, metadata);

  return createJsonResponse(200, {
    ok: true,
    removed: route.version,
  });
}

async function deletePackage(options: RegistryRouterOptions, route: PackageRoute): Promise<Response> {
  const metadata = await options.storage.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, {
      error: "PKG_NOT_FOUND",
      message: "Package not found",
    });
  }

  for (const version of Object.keys(metadata.versions)) {
    await options.storage.deleteTarball(route.packageName, version);
  }

  await options.storage.deleteMetadata(route.packageName);

  return createJsonResponse(200, {
    ok: true,
    id: route.packageName.fullName,
  });
}

async function deprecateVersion(
  options: RegistryRouterOptions,
  route: DeprecateRoute,
  request: Request,
): Promise<Response> {
  const parsedRequest = await parseJsonRequest(request);
  if (!parsedRequest.ok) {
    return parsedRequest.response;
  }

  const message = parseDeprecationPayload(parsedRequest.value);
  if (message === null) {
    return createJsonResponse(400, {
      error: "PKG_INVALID_DEPRECATE_PAYLOAD",
      message: "Deprecation payload must include message",
    });
  }

  const metadata = await options.storage.getMetadata(route.packageName);
  if (metadata === null) {
    return createJsonResponse(404, {
      error: "PKG_NOT_FOUND",
      message: "Package not found",
    });
  }

  const versionMetadata = metadata.versions[route.version];
  if (versionMetadata === undefined) {
    return createJsonResponse(404, {
      error: "PKG_VERSION_NOT_FOUND",
      message: "Version not found",
    });
  }

  versionMetadata.deprecated = message;
  metadata.versions[route.version] = versionMetadata;
  await options.storage.putMetadata(route.packageName, metadata);

  return createJsonResponse(200, {
    ok: true,
    id: route.packageName.fullName,
    version: route.version,
    deprecated: message,
  });
}

export function parseRegistryRoute(pathname: string): RegistryRoute | null {
  const rawSegments = pathname.split("/");
  const segments: string[] = [];

  for (const part of rawSegments) {
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

export function parseScopedPackageName(value: string): ParsedPackageName | null {
  if (!value.startsWith("@")) {
    return null;
  }

  const parts = value.split("/");
  if (parts.length !== 2) {
    return null;
  }

  const scope = parts[0];
  const name = parts[1];
  if (scope === undefined || name === undefined) {
    return null;
  }

  if (scope.length <= 1 || name.length === 0) {
    return null;
  }

  return {
    scope,
    name,
    fullName: `${scope}/${name}`,
  };
}

export function buildScopedPackagePath(scope: string, name: string): string {
  return `/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`;
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

export function hasValidBearerToken(request: Request, validTokens: readonly string[]): boolean {
  if (validTokens.length === 0) {
    return false;
  }

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

async function buildUpdatedMetadata(
  existingMetadata: RegistryPackageMetadata | null,
  packageName: ParsedPackageName,
  payload: RegistryPublishPayload,
  version: string,
  tarball: Uint8Array,
  baseUrl: string,
): Promise<RegistryPackageMetadata> {
  const access = payload.access ?? existingMetadata?.access ?? "public";
  const description = payload.description ?? existingMetadata?.description ?? "";

  const versions = cloneVersions(existingMetadata?.versions ?? {});

  const packagePath = buildScopedPackagePath(packageName.scope, packageName.name);
  const tarballPath = `${packagePath}/-/${encodeURIComponent(packageName.name)}-${encodeURIComponent(version)}.tgz`;
  const tarballUrl = `${normalizeBaseUrl(baseUrl)}${tarballPath}`;

  const integrity = await createDistIntegrity(tarball);

  const versionMetadata: RegistryVersionMetadata = {
    version,
    dependencies: payload.dependencies ?? {},
    deprecated: payload.deprecated ?? "",
    access,
    dist: {
      tarball: tarballUrl,
      shasum: integrity.shasum,
      integrity: integrity.integrity,
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

export function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/")) {
    return baseUrl.slice(0, -1);
  }

  return baseUrl;
}

function extractTarballFromPayload(payload: RegistryPublishPayload): Uint8Array | null {
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

async function parseJsonRequest(request: Request): Promise<JsonParseResult> {
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

function isValidSemver(value: string): boolean {
  return parseSemver(value) !== null;
}

function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);

  if (parsedLeft === null || parsedRight === null) {
    return left.localeCompare(right);
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }

  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }

  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function parseSemver(value: string): ParsedSemver | null {
  const match = value.match(SEMVER_PATTERN);
  if (match === null) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prereleaseGroup = match[4];

  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }

  const prerelease =
    typeof prereleaseGroup === "string" && prereleaseGroup.length > 0 ? prereleaseGroup.split(".") : [];

  return {
    major,
    minor,
    patch,
    prerelease,
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue === undefined) {
      return -1;
    }

    if (rightValue === undefined) {
      return 1;
    }

    const compared = compareIdentifier(leftValue, rightValue);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }

  if (leftNumeric) {
    return -1;
  }

  if (rightNumeric) {
    return 1;
  }

  return left.localeCompare(right);
}
