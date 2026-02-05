/**
 * Goondan Package Registry - Cloudflare Workers
 *
 * npm-compatible 패키지 레지스트리 API 구현
 * - R2: tarball 저장
 * - KV: 패키지 메타데이터 저장
 */

// =============================================================================
// Types (exported for testing)
// =============================================================================

export interface Env {
  PACKAGES: R2Bucket;
  METADATA: KVNamespace;
  ADMIN_TOKEN: string;
  REGISTRY_URL: string;
}

/** 패키지 배포 정보 */
export interface PackageDist {
  tarball: string;
  shasum: string;
  integrity: string;
}

/** 번들 정보 (Goondan 전용) */
export interface BundleInfo {
  include?: string[];
  runtime?: string;
}

/** 버전별 메타데이터 */
export interface VersionMetadata {
  name: string;
  version: string;
  description?: string;
  dependencies?: Record<string, string>;
  dist: PackageDist;
  bundle?: BundleInfo;
  publishedAt?: string;
}

/** 패키지 전체 메타데이터 */
export interface PackageMetadata {
  name: string;
  description?: string;
  versions: Record<string, VersionMetadata>;
  "dist-tags": Record<string, string>;
  time?: Record<string, string>;
}

/** 퍼블리시 요청 본문 */
export interface PublishPayload {
  name: string;
  description?: string;
  "dist-tags"?: Record<string, string>;
  versions: Record<string, VersionMetadata>;
  _attachments: Record<
    string,
    {
      content_type: string;
      data: string;
      length: number;
    }
  >;
}

// =============================================================================
// Utils (exported for testing)
// =============================================================================

/**
 * CORS 헤더 생성
 */
export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * JSON 응답 생성
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...headers,
    },
  });
}

/**
 * 에러 응답 생성
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * 404 응답 생성
 */
export function notFoundResponse(message: string): Response {
  return jsonResponse({ error: message }, 404);
}

/**
 * URL에서 scope와 name 파싱
 * 예: /@goondan/base -> { scope: "@goondan", name: "base" }
 * 예: /base -> { scope: null, name: "base" }
 */
export function parsePackageName(pathname: string): {
  scope: string | null;
  name: string;
  rest: string[];
} | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  // @scope/name 형식
  if (parts[0]?.startsWith("@")) {
    if (parts.length < 2) return null;
    return {
      scope: parts[0],
      name: parts[1] ?? "",
      rest: parts.slice(2),
    };
  }

  // name 형식 (scope 없음)
  return {
    scope: null,
    name: parts[0] ?? "",
    rest: parts.slice(1),
  };
}

/**
 * 전체 패키지명 생성
 */
export function getFullPackageName(scope: string | null, name: string): string {
  return scope ? `${scope}/${name}` : name;
}

/**
 * KV 키 생성 (패키지 메타데이터용)
 */
export function getMetadataKey(scope: string | null, name: string): string {
  return `pkg:${getFullPackageName(scope, name)}`;
}

/**
 * R2 키 생성 (tarball용)
 */
export function getTarballKey(
  scope: string | null,
  name: string,
  version: string
): string {
  const fullName = getFullPackageName(scope, name);
  return `${fullName}/-/${name}-${version}.tgz`;
}

/**
 * tarball URL 생성
 */
export function getTarballUrl(
  registryUrl: string,
  scope: string | null,
  name: string,
  version: string
): string {
  const fullName = getFullPackageName(scope, name);
  return `${registryUrl}/${fullName}/-/${name}-${version}.tgz`;
}

/**
 * Bearer 토큰 추출
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] ?? null;
}

/**
 * SHA-512 integrity hash 계산
 */
export async function calculateIntegrity(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  const hashArray = new Uint8Array(hashBuffer);
  const base64 = btoa(String.fromCharCode(...hashArray));
  return `sha512-${base64}`;
}

/**
 * SHA-1 shasum 계산
 */
export async function calculateShasum(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Integrity hash 검증
 */
export async function verifyIntegrity(
  data: ArrayBuffer,
  expectedIntegrity: string
): Promise<boolean> {
  const actualIntegrity = await calculateIntegrity(data);
  return actualIntegrity === expectedIntegrity;
}

// =============================================================================
// Handlers (exported for testing)
// =============================================================================

/**
 * 패키지 메타데이터 조회 (GET /<scope>/<name>)
 */
export async function handleGetPackage(
  env: Env,
  scope: string | null,
  name: string
): Promise<Response> {
  const key = getMetadataKey(scope, name);
  const metadata = await env.METADATA.get<PackageMetadata>(key, "json");

  if (!metadata) {
    return notFoundResponse(
      `Package not found: ${getFullPackageName(scope, name)}`
    );
  }

  return jsonResponse(metadata);
}

/**
 * 특정 버전 메타데이터 조회 (GET /<scope>/<name>/<version>)
 */
export async function handleGetVersion(
  env: Env,
  scope: string | null,
  name: string,
  version: string
): Promise<Response> {
  const key = getMetadataKey(scope, name);
  const metadata = await env.METADATA.get<PackageMetadata>(key, "json");

  if (!metadata) {
    return notFoundResponse(
      `Package not found: ${getFullPackageName(scope, name)}`
    );
  }

  // dist-tag인 경우 해당 버전으로 변환
  const resolvedVersion = metadata["dist-tags"][version] ?? version;
  const versionData = metadata.versions[resolvedVersion];

  if (!versionData) {
    return notFoundResponse(
      `Version not found: ${getFullPackageName(scope, name)}@${version}`
    );
  }

  return jsonResponse(versionData);
}

/**
 * Tarball 다운로드 (GET /<scope>/<name>/-/<name>-<version>.tgz)
 */
export async function handleGetTarball(
  env: Env,
  scope: string | null,
  name: string,
  version: string
): Promise<Response> {
  const tarballKey = getTarballKey(scope, name, version);
  const object = await env.PACKAGES.get(tarballKey);

  if (!object) {
    return notFoundResponse(
      `Tarball not found: ${getFullPackageName(scope, name)}@${version}`
    );
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name}-${version}.tgz"`,
      ...corsHeaders(),
    },
  });
}

/**
 * 패키지 퍼블리시 (PUT /<scope>/<name>)
 */
export async function handlePublish(
  env: Env,
  request: Request,
  scope: string | null,
  name: string
): Promise<Response> {
  // 인증 확인
  const token = extractBearerToken(request.headers.get("Authorization"));
  if (!token || token !== env.ADMIN_TOKEN) {
    return errorResponse("Unauthorized: Invalid or missing token", 401);
  }

  // 요청 본문 파싱
  let payload: PublishPayload;
  try {
    payload = (await request.json()) as PublishPayload;
  } catch {
    return errorResponse("Invalid JSON payload", 400);
  }

  // 패키지명 검증
  const expectedName = getFullPackageName(scope, name);
  if (payload.name !== expectedName) {
    return errorResponse(
      `Package name mismatch: expected ${expectedName}, got ${payload.name}`,
      400
    );
  }

  // 기존 메타데이터 조회
  const key = getMetadataKey(scope, name);
  let metadata = await env.METADATA.get<PackageMetadata>(key, "json");

  // 새 패키지인 경우 초기화
  if (!metadata) {
    metadata = {
      name: expectedName,
      description: payload.description,
      versions: {},
      "dist-tags": {},
      time: {
        created: new Date().toISOString(),
      },
    };
  }

  // 각 버전 처리
  const now = new Date().toISOString();
  const versionEntries = Object.entries(payload.versions);

  for (const [version, versionData] of versionEntries) {
    // 이미 존재하는 버전인지 확인
    if (metadata.versions[version]) {
      return errorResponse(
        `Version already exists: ${expectedName}@${version}`,
        409
      );
    }

    // attachment 찾기
    const tarballFilename = `${name}-${version}.tgz`;
    const attachment = payload._attachments[tarballFilename];
    if (!attachment) {
      return errorResponse(`Missing attachment: ${tarballFilename}`, 400);
    }

    // base64 디코딩
    let tarballData: ArrayBuffer;
    try {
      const binary = atob(attachment.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      tarballData = bytes.buffer;
    } catch {
      return errorResponse("Failed to decode attachment data", 400);
    }

    // integrity 검증 (제공된 경우)
    if (versionData.dist?.integrity) {
      const isValid = await verifyIntegrity(
        tarballData,
        versionData.dist.integrity
      );
      if (!isValid) {
        return errorResponse(
          `Integrity check failed for ${expectedName}@${version}`,
          400
        );
      }
    }

    // hash 계산
    const [integrity, shasum] = await Promise.all([
      calculateIntegrity(tarballData),
      calculateShasum(tarballData),
    ]);

    // R2에 tarball 업로드
    const tarballKey = getTarballKey(scope, name, version);
    await env.PACKAGES.put(tarballKey, tarballData, {
      customMetadata: {
        version,
        integrity,
        shasum,
      },
    });

    // 버전 메타데이터 생성
    const newVersionData: VersionMetadata = {
      name: expectedName,
      version,
      description: versionData.description ?? payload.description,
      dependencies: versionData.dependencies ?? {},
      dist: {
        tarball: getTarballUrl(env.REGISTRY_URL, scope, name, version),
        shasum,
        integrity,
      },
      bundle: versionData.bundle,
      publishedAt: now,
    };

    metadata.versions[version] = newVersionData;

    // time 업데이트
    if (metadata.time) {
      metadata.time[version] = now;
      metadata.time["modified"] = now;
    }
  }

  // dist-tags 업데이트
  if (payload["dist-tags"]) {
    for (const [tag, version] of Object.entries(payload["dist-tags"])) {
      if (metadata.versions[version]) {
        metadata["dist-tags"][tag] = version;
      }
    }
  } else {
    // dist-tags가 없으면 첫 번째 버전을 latest로 설정
    const firstVersion = versionEntries[0];
    if (firstVersion && !metadata["dist-tags"]["latest"]) {
      metadata["dist-tags"]["latest"] = firstVersion[0];
    }
  }

  // KV에 메타데이터 저장
  await env.METADATA.put(key, JSON.stringify(metadata));

  return jsonResponse({
    ok: true,
    id: expectedName,
    versions: Object.keys(payload.versions),
  }, 201);
}

/**
 * 패키지 삭제 (관리자 전용)
 */
export async function handleUnpublish(
  env: Env,
  request: Request,
  scope: string | null,
  name: string,
  version?: string
): Promise<Response> {
  // 인증 확인
  const token = extractBearerToken(request.headers.get("Authorization"));
  if (!token || token !== env.ADMIN_TOKEN) {
    return errorResponse("Unauthorized: Invalid or missing token", 401);
  }

  const key = getMetadataKey(scope, name);
  const metadata = await env.METADATA.get<PackageMetadata>(key, "json");

  if (!metadata) {
    return notFoundResponse(
      `Package not found: ${getFullPackageName(scope, name)}`
    );
  }

  if (version) {
    // 특정 버전만 삭제
    if (!metadata.versions[version]) {
      return notFoundResponse(
        `Version not found: ${getFullPackageName(scope, name)}@${version}`
      );
    }

    // R2에서 tarball 삭제
    const tarballKey = getTarballKey(scope, name, version);
    await env.PACKAGES.delete(tarballKey);

    // 메타데이터에서 버전 제거
    delete metadata.versions[version];

    // dist-tags에서 해당 버전 참조 제거
    for (const [tag, tagVersion] of Object.entries(metadata["dist-tags"])) {
      if (tagVersion === version) {
        delete metadata["dist-tags"][tag];
      }
    }

    // 남은 버전이 있으면 업데이트, 없으면 패키지 전체 삭제
    if (Object.keys(metadata.versions).length > 0) {
      // latest가 삭제됐으면 가장 최신 버전으로 재설정
      if (!metadata["dist-tags"]["latest"]) {
        const versions = Object.keys(metadata.versions).sort();
        const latestVersion = versions[versions.length - 1];
        if (latestVersion) {
          metadata["dist-tags"]["latest"] = latestVersion;
        }
      }
      await env.METADATA.put(key, JSON.stringify(metadata));
    } else {
      await env.METADATA.delete(key);
    }

    return jsonResponse({
      ok: true,
      id: getFullPackageName(scope, name),
      version,
    });
  } else {
    // 패키지 전체 삭제
    // 모든 tarball 삭제
    for (const ver of Object.keys(metadata.versions)) {
      const tarballKey = getTarballKey(scope, name, ver);
      await env.PACKAGES.delete(tarballKey);
    }

    // 메타데이터 삭제
    await env.METADATA.delete(key);

    return jsonResponse({
      ok: true,
      id: getFullPackageName(scope, name),
    });
  }
}

// =============================================================================
// Router
// =============================================================================

/**
 * 요청 라우팅
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // 루트 경로
  if (pathname === "/" || pathname === "") {
    return jsonResponse({
      name: "Goondan Package Registry",
      version: "1.0.0",
      documentation: "https://goondan.io/docs/registry",
    });
  }

  // 패키지명 파싱
  const parsed = parsePackageName(pathname);
  if (!parsed) {
    return errorResponse("Invalid package name", 400);
  }

  const { scope, name, rest } = parsed;

  // GET 요청 처리
  if (request.method === "GET") {
    // Tarball 다운로드: /<scope>/<name>/-/<name>-<version>.tgz
    if (rest[0] === "-" && rest[1]) {
      const tarballMatch = /^(.+)-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\.tgz$/.exec(rest[1]);
      if (tarballMatch) {
        const version = tarballMatch[2];
        if (version) {
          return handleGetTarball(env, scope, name, version);
        }
      }
      return errorResponse("Invalid tarball path", 400);
    }

    // 특정 버전 조회: /<scope>/<name>/<version>
    if (rest[0]) {
      return handleGetVersion(env, scope, name, rest[0]);
    }

    // 패키지 메타데이터 조회: /<scope>/<name>
    return handleGetPackage(env, scope, name);
  }

  // PUT 요청 처리 (퍼블리시)
  if (request.method === "PUT") {
    return handlePublish(env, request, scope, name);
  }

  // DELETE 요청 처리 (언퍼블리시)
  if (request.method === "DELETE") {
    return handleUnpublish(env, request, scope, name, rest[0]);
  }

  return errorResponse("Method not allowed", 405);
}

// =============================================================================
// Export
// =============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Registry error:", error);
      const message = error instanceof Error ? error.message : "Internal server error";
      return errorResponse(message, 500);
    }
  },
};
