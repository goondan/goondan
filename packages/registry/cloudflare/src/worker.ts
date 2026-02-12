import { createRegistryRouter } from "./router.js";
import type {
  ParsedPackageName,
  RegistryPackageMetadata,
  RegistryStorage,
  RegistryWorkerEnv,
} from "./types.js";
import { isRegistryPackageMetadata } from "./types.js";

class WorkerRegistryStorage implements RegistryStorage {
  private readonly env: RegistryWorkerEnv;

  constructor(env: RegistryWorkerEnv) {
    this.env = env;
  }

  async getMetadata(packageName: ParsedPackageName): Promise<RegistryPackageMetadata | null> {
    const raw = await this.env.REGISTRY_KV.get(toMetadataKey(packageName));
    if (raw === null) {
      return null;
    }

    const parsed = parseJson(raw);
    if (parsed === null || !isRegistryPackageMetadata(parsed)) {
      throw new Error(`Corrupted metadata for package ${packageName.fullName}`);
    }

    return parsed;
  }

  async putMetadata(packageName: ParsedPackageName, metadata: RegistryPackageMetadata): Promise<void> {
    await this.env.REGISTRY_KV.put(toMetadataKey(packageName), JSON.stringify(metadata));
  }

  async deleteMetadata(packageName: ParsedPackageName): Promise<void> {
    await this.env.REGISTRY_KV.delete(toMetadataKey(packageName));
  }

  async getTarball(packageName: ParsedPackageName, version: string): Promise<Uint8Array | null> {
    const object = await this.env.REGISTRY_R2.get(toTarballKey(packageName, version));
    if (object === null) {
      return null;
    }

    const buffer = await object.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async putTarball(packageName: ParsedPackageName, version: string, tarball: Uint8Array): Promise<void> {
    await this.env.REGISTRY_R2.put(toTarballKey(packageName, version), tarball, {
      httpMetadata: {
        contentType: "application/gzip",
      },
    });
  }

  async deleteTarball(packageName: ParsedPackageName, version: string): Promise<void> {
    await this.env.REGISTRY_R2.delete(toTarballKey(packageName, version));
  }
}

export function createWorkerRegistryStorage(env: RegistryWorkerEnv): RegistryStorage {
  return new WorkerRegistryStorage(env);
}

export function parseAuthTokens(raw: string | undefined): string[] {
  if (typeof raw !== "string") {
    return [];
  }

  const tokens: string[] = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (trimmed.length > 0) {
      tokens.push(trimmed);
    }
  }

  return tokens;
}

export function toMetadataKey(packageName: ParsedPackageName): string {
  return `packages/${encodeURIComponent(packageName.scope)}/${encodeURIComponent(packageName.name)}/metadata.json`;
}

export function toTarballKey(packageName: ParsedPackageName, version: string): string {
  return `packages/${encodeURIComponent(packageName.scope)}/${encodeURIComponent(packageName.name)}/tarballs/${encodeURIComponent(version)}.tgz`;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const worker = {
  async fetch(request: Request, env: RegistryWorkerEnv): Promise<Response> {
    const handler = createRegistryRouter({
      storage: createWorkerRegistryStorage(env),
      authTokens: parseAuthTokens(env.REGISTRY_AUTH_TOKENS),
      baseUrl: env.PUBLIC_REGISTRY_URL,
    });

    return handler(request);
  },
};

export default worker;
