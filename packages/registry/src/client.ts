import { buildScopedPackagePath, parseScopedPackageName } from "./package-name.js";
import { resolveRegistryConfig } from "./config.js";
import type {
  FetchLike,
  RegistryClientOptions,
  RegistryPackageMetadata,
  RegistryPublishInput,
  RegistryPublishPayload,
  RegistryVersionMetadata,
  ResolvedRegistryConfig,
} from "./types.js";
import { isRegistryPackageMetadata, isRegistryVersionMetadata } from "./validators.js";

interface RegistryClientContext {
  fetchImpl: FetchLike;
  registryUrl: string;
  token?: string;
}

export class RegistryClient {
  private readonly fetchImpl: FetchLike;
  private readonly registryUrl: string;
  private readonly token?: string;

  private constructor(context: RegistryClientContext) {
    this.fetchImpl = context.fetchImpl;
    this.registryUrl = context.registryUrl;
    this.token = context.token;
  }

  static async create(options: RegistryClientOptions = {}): Promise<RegistryClient> {
    const resolved = await resolveRegistryConfig(options);

    return new RegistryClient({
      fetchImpl: options.fetchImpl ?? fetch,
      registryUrl: resolved.registryUrl,
      token: resolved.token,
    });
  }

  getResolvedConfig(): ResolvedRegistryConfig {
    return {
      registryUrl: this.registryUrl,
      token: this.token,
    };
  }

  async getMetadata(packageName: string): Promise<RegistryPackageMetadata> {
    const packagePath = buildPackagePath(packageName);
    const response = await this.request("GET", packagePath);
    const payload = await readJsonResponse(response);

    if (!isRegistryPackageMetadata(payload)) {
      throw new Error("Registry metadata response is invalid");
    }

    return payload;
  }

  async getVersion(packageName: string, version: string): Promise<RegistryVersionMetadata> {
    const packagePath = buildPackagePath(packageName);
    const response = await this.request("GET", `${packagePath}/${encodeURIComponent(version)}`);
    const payload = await readJsonResponse(response);

    if (!isRegistryVersionMetadata(payload)) {
      throw new Error("Registry version response is invalid");
    }

    return payload;
  }

  async getTarball(packageName: string, version: string): Promise<Buffer> {
    const parsedName = parseScopedPackageName(packageName);
    if (parsedName === null) {
      throw new Error(`Invalid package name: ${packageName}`);
    }

    const packagePath = buildScopedPackagePath(parsedName.scope, parsedName.name);
    const tarballPath = `${packagePath}/-/${encodeURIComponent(parsedName.name)}-${encodeURIComponent(version)}.tgz`;
    const response = await this.request("GET", tarballPath);
    return Buffer.from(await response.arrayBuffer());
  }

  async publish(input: RegistryPublishInput): Promise<void> {
    const parsedName = parseScopedPackageName(input.name);
    if (parsedName === null) {
      throw new Error(`Invalid package name: ${input.name}`);
    }

    const packagePath = buildScopedPackagePath(parsedName.scope, parsedName.name);
    const tarballName = `${parsedName.name}-${input.version}.tgz`;

    const distTags: Record<string, string> = {
      ...(input.distTags ?? {}),
    };

    if (typeof input.tag === "string" && input.tag.length > 0) {
      distTags[input.tag] = input.version;
    }

    if (Object.keys(distTags).length === 0) {
      distTags.latest = input.version;
    }

    const payload: RegistryPublishPayload = {
      name: input.name,
      version: input.version,
      description: input.description,
      access: input.access,
      dependencies: input.dependencies,
      "dist-tags": distTags,
      _attachments: {
        [tarballName]: {
          data: input.tarball.toString("base64"),
          contentType: "application/gzip",
          length: input.tarball.length,
        },
      },
    };

    const token = input.token ?? this.token;
    const response = await this.request("PUT", packagePath, payload, token);
    await consumeJsonResponse(response);
  }

  async unpublish(packageName: string, version: string): Promise<void> {
    const packagePath = buildPackagePath(packageName);
    const response = await this.request("DELETE", `${packagePath}/${encodeURIComponent(version)}`);
    await consumeJsonResponse(response);
  }

  async deletePackage(packageName: string): Promise<void> {
    const packagePath = buildPackagePath(packageName);
    const response = await this.request("DELETE", packagePath);
    await consumeJsonResponse(response);
  }

  async deprecate(packageName: string, version: string, message: string): Promise<void> {
    const packagePath = buildPackagePath(packageName);
    const deprecatePath = `${packagePath}/${encodeURIComponent(version)}/deprecate`;
    const response = await this.request("PUT", deprecatePath, { message });
    await consumeJsonResponse(response);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    tokenOverride?: string,
  ): Promise<Response> {
    const targetUrl = `${this.registryUrl}${path}`;

    const headers = new Headers();
    headers.set("accept", "application/json");

    const token = tokenOverride ?? this.token;
    if (typeof token === "string" && token.length > 0) {
      headers.set("authorization", `Bearer ${token}`);
    }

    let requestBody: string | undefined;
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      requestBody = JSON.stringify(body);
    }

    const response = await this.fetchImpl(targetUrl, {
      method,
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorPayload = await consumeJsonResponse(response);
      throw new Error(`Registry request failed (${response.status}): ${JSON.stringify(errorPayload)}`);
    }

    return response;
  }
}

function buildPackagePath(packageName: string): string {
  const parsedName = parseScopedPackageName(packageName);
  if (parsedName === null) {
    throw new Error(`Invalid package name: ${packageName}`);
  }

  return buildScopedPackagePath(parsedName.scope, parsedName.name);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const payload = await consumeJsonResponse(response);
  return payload;
}

async function consumeJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType === null || !contentType.includes("application/json")) {
    return null;
  }

  const raw = await response.text();
  if (raw.length === 0) {
    return null;
  }

  return JSON.parse(raw);
}
