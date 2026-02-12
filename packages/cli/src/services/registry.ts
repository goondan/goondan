import { authError, networkError } from '../errors.js';
import type {
  RegistryClient,
  RegistryPackageMetadata,
  RegistryPublishPayload,
  RegistryPublishResult,
} from '../types.js';
import { isObjectRecord } from '../utils.js';

interface PackageRefInfo {
  name: string;
  version?: string;
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
    return `@${encodeURIComponent(name.slice(1))}`;
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

export class HttpRegistryClient implements RegistryClient {
  async resolvePackage(ref: string, registryUrl: string, token?: string): Promise<RegistryPackageMetadata> {
    const parsed = parsePackageRef(ref);
    if (parsed.version) {
      return {
        name: parsed.name,
        latestVersion: parsed.version,
      };
    }

    const normalized = normalizeRegistryUrl(registryUrl);
    const endpoint = `${normalized}/${encodedPackageName(parsed.name)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (token && token.length > 0) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
    });

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

  async publishPackage(
    payload: RegistryPublishPayload,
    registryUrl: string,
    token?: string,
  ): Promise<RegistryPublishResult> {
    const normalized = normalizeRegistryUrl(registryUrl);
    const endpoint = `${normalized}/${encodedPackageName(payload.packageName)}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token && token.length > 0) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });

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
