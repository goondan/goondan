export interface ResourceMeta {
  name: string;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

export interface Resource {
  apiVersion?: string;
  kind: string;
  metadata: ResourceMeta;
  spec?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RegistryOptions {
  baseDir?: string;
}

export class ConfigRegistry {
  baseDir: string;
  private _resourcesByKind: Map<string, Map<string, Resource>>;
  private _resources: Resource[];

  constructor(resources: Resource[] = [], options: RegistryOptions = {}) {
    this.baseDir = options.baseDir || process.cwd();
    this._resourcesByKind = new Map();
    this._resources = [];
    resources.forEach((resource) => this.add(resource));
  }

  add(resource: Resource): void {
    if (!resource || typeof resource !== 'object') {
      throw new Error('리소스는 객체여야 합니다.');
    }
    const { kind, metadata } = resource;
    if (!kind || !metadata || !metadata.name) {
      throw new Error(`리소스에 kind/metadata.name이 필요합니다: ${JSON.stringify(resource)}`);
    }
    if (!metadata.labels) metadata.labels = {};
    if (!this._resourcesByKind.has(kind)) {
      this._resourcesByKind.set(kind, new Map());
    }
    const kindMap = this._resourcesByKind.get(kind);
    kindMap?.set(metadata.name, resource);
    this._resources.push(resource);
  }

  get(kind: string, name: string): Resource | null {
    const kindMap = this._resourcesByKind.get(kind);
    if (!kindMap) return null;
    return kindMap.get(name) || null;
  }

  require(kind: string, name: string): Resource {
    const found = this.get(kind, name);
    if (!found) {
      throw new Error(`${kind}/${name} 리소스를 찾을 수 없습니다.`);
    }
    return found;
  }

  list(kind?: string): Resource[] {
    if (!kind) return [...this._resources];
    const kindMap = this._resourcesByKind.get(kind);
    if (!kindMap) return [];
    return [...kindMap.values()];
  }

  findByLabels(kind: string, matchLabels: Record<string, string> = {}): Resource[] {
    return this.list(kind).filter((resource) => {
      const labels = resource.metadata?.labels || {};
      return Object.entries(matchLabels).every(([key, value]) => labels[key] === value);
    });
  }
}
