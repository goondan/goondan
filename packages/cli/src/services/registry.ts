import { authError, networkError } from '../errors.js';
import type {
  RegistryClient,
  RegistryPackageMetadata,
  RegistryPackageVersionMetadata,
  RegistryPublishPayload,
  RegistryPublishResult,
} from '../types.js';
import { isObjectRecord } from '../utils.js';

interface PackageRefInfo {
  name: string;
  version?: string;
}

function isExactSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

export function parsePackageRef(ref: string): PackageRefInfo {
  if (ref.length === 0) {
    throw networkError('빈 package ref는 해석할 수 없습니다.');
  }

  if (ref.startsWith('@')) {
    const slash = ref.indexOf('/');
    if (slash <= 1) {
      throw networkError(`잘못된 scoped package ref 입니다: ${ref}`);
    }

    const versionDelimiter = ref.indexOf('@', slash + 1);
    if (versionDelimiter < 0) {
      return { name: ref };
    }

    const version = ref.slice(versionDelimiter + 1);
    return {
      name: ref.slice(0, versionDelimiter),
      version,
    };
  }

  const atIndex = ref.lastIndexOf('@');
  if (atIndex > 0) {
    return {
      name: ref.slice(0, atIndex),
      version: ref.slice(atIndex + 1),
    };
  }

  return { name: ref };
}

function normalizeRegistryUrl(registryUrl: string): string {
  return registryUrl.endsWith('/') ? registryUrl.slice(0, -1) : registryUrl;
}

function encodedPackageName(name: string): string {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash > 1 && slash < name.length - 1) {
      const scope = name.slice(0, slash);
      const pkg = name.slice(slash + 1);
      return `${encodeURIComponent(scope)}/${encodeURIComponent(pkg)}`;
    }
  }

  return encodeURIComponent(name);
}

function parseLatestVersion(metadata: unknown): string | undefined {
  if (!isObjectRecord(metadata)) {
    return undefined;
  }

  const distTags = metadata['dist-tags'];
  if (isObjectRecord(distTags)) {
    const latest = distTags['latest'];
    if (typeof latest === 'string') {
      return latest;
    }
  }

  const version = metadata['version'];
  if (typeof version === 'string') {
    return version;
  }

  return undefined;
}

function createRegistryHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (token && token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    result[key] = entry;
  }

  return result;
}

function parsePackageVersionMetadata(value: unknown): RegistryPackageVersionMetadata | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const version = value['version'];
  if (typeof version !== 'string') {
    return undefined;
  }

  const access = value['access'];
  if (access !== 'public' && access !== 'restricted') {
    return undefined;
  }

  const deprecatedRaw = value['deprecated'];
  if (typeof deprecatedRaw !== 'string') {
    return undefined;
  }

  const dependencies = parseStringRecord(value['dependencies']);
  if (!dependencies) {
    return undefined;
  }

  const dist = value['dist'];
  if (!isObjectRecord(dist)) {
    return undefined;
  }

  const tarball = dist['tarball'];
  const shasum = dist['shasum'];
  const integrity = dist['integrity'];

  if (typeof tarball !== 'string' || typeof shasum !== 'string' || typeof integrity !== 'string') {
    return undefined;
  }

  return {
    version,
    dependencies,
    deprecated: deprecatedRaw,
    access,
    dist: {
      tarball,
      shasum,
      integrity,
    },
  };
}

function readFetchFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

async function requestRegistry(endpoint: string, init: RequestInit, action: string): Promise<Response> {
  try {
    return await fetch(endpoint, init);
  } catch (error) {
    const detail = readFetchFailureMessage(error);
    throw networkError(
      `${action} 네트워크 요청에 실패했습니다: ${endpoint}`,
      `--registry 또는 GOONDAN_REGISTRY를 확인하세요. 원인: ${detail}`,
    );
  }
}

export class HttpRegistryClient implements RegistryClient {
  async resolvePackage(ref: string, registryUrl: string, token?: string): Promise<RegistryPackageMetadata> {
    const parsed = parsePackageRef(ref);
    if (parsed.version && isExactSemver(parsed.version)) {
      return {
        name: parsed.name,
        latestVersion: parsed.version,
      };
    }

    const normalized = normalizeRegistryUrl(registryUrl);
    const endpoint = `${normalized}/${encodedPackageName(parsed.name)}`;
    const headers = createRegistryHeaders(token);

    const response = await requestRegistry(
      endpoint,
      {
        method: 'GET',
        headers,
      },
      '패키지 메타데이터 조회',
    );

    if (response.status === 401 || response.status === 403) {
      throw authError('레지스트리 인증이 필요합니다.', 'GOONDAN_REGISTRY_TOKEN 또는 config.json token 설정을 확인하세요.');
    }

    if (!response.ok) {
      throw networkError(`패키지 메타데이터 조회 실패: ${response.status} ${response.statusText}`);
    }

    const json: unknown = await response.json();
    const latest = parseLatestVersion(json);
    if (!latest) {
      throw networkError('레지스트리 응답에서 최신 버전을 확인할 수 없습니다.');
    }

    return {
      name: parsed.name,
      latestVersion: latest,
    };
  }

  async getPackageVersion(
    packageName: string,
    version: string,
    registryUrl: string,
    token?: string,
  ): Promise<RegistryPackageVersionMetadata> {
    const normalized = normalizeRegistryUrl(registryUrl);
    const endpoint = `${normalized}/${encodedPackageName(packageName)}/${encodeURIComponent(version)}`;
    const headers = createRegistryHeaders(token);

    const response = await requestRegistry(
      endpoint,
      {
        method: 'GET',
        headers,
      },
      '패키지 버전 조회',
    );

    if (response.status === 401 || response.status === 403) {
      throw authError('레지스트리 인증이 필요합니다.', 'GOONDAN_REGISTRY_TOKEN 또는 config.json token 설정을 확인하세요.');
    }

    if (!response.ok) {
      throw networkError(`패키지 버전 조회 실패: ${response.status} ${response.statusText}`);
    }

    const json: unknown = await response.json();
    const parsed = parsePackageVersionMetadata(json);
    if (!parsed) {
      throw networkError('레지스트리 응답에서 패키지 버전 메타데이터를 확인할 수 없습니다.');
    }

    return parsed;
  }

  async publishPackage(
    payload: RegistryPublishPayload,
    registryUrl: string,
    token?: string,
  ): Promise<RegistryPublishResult> {
    const normalized = normalizeRegistryUrl(registryUrl);
    const endpoint = `${normalized}/${encodedPackageName(payload.name)}`;

    const headers = createRegistryHeaders(token);
    headers['Content-Type'] = 'application/json';

    const response = await requestRegistry(
      endpoint,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      },
      '패키지 publish',
    );

    if (response.status === 401 || response.status === 403) {
      throw authError('패키지 publish 인증에 실패했습니다.', '레지스트리 토큰 권한을 확인하세요.');
    }

    if (!response.ok) {
      throw networkError(`패키지 publish 실패: ${response.status} ${response.statusText}`);
    }

    return {
      ok: true,
      registryUrl: normalized,
    };
  }
}
