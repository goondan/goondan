import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

export interface WorkspacePathsOptions {
  stateRoot?: string;
  projectRoot: string;
}

export class WorkspacePaths {
  readonly goondanHome: string;
  readonly projectRoot: string;
  readonly workspaceId: string;

  constructor(options: WorkspacePathsOptions) {
    this.goondanHome = this.resolveGoondanHome(options.stateRoot);
    this.projectRoot = path.resolve(options.projectRoot);
    this.workspaceId = this.generateWorkspaceId(this.projectRoot);
  }

  get configFile(): string {
    return path.join(this.goondanHome, "config.json");
  }

  get packagesDir(): string {
    return path.join(this.goondanHome, "packages");
  }

  get workspaceRoot(): string {
    return path.join(this.goondanHome, "workspaces", this.workspaceId);
  }

  get instancesRoot(): string {
    return path.join(this.workspaceRoot, "instances");
  }

  packagePath(name: string, version: string): string {
    return path.join(this.packagesDir, `${name}@${version}`);
  }

  instancePath(instanceKey: string): string {
    const safeKey = sanitizeInstanceKey(instanceKey);
    return path.join(this.instancesRoot, safeKey);
  }

  instanceMetadataPath(instanceKey: string): string {
    return path.join(this.instancePath(instanceKey), "metadata.json");
  }

  instanceMessageBasePath(instanceKey: string): string {
    return path.join(this.instancePath(instanceKey), "messages", "base.jsonl");
  }

  instanceMessageEventsPath(instanceKey: string): string {
    return path.join(this.instancePath(instanceKey), "messages", "events.jsonl");
  }

  instanceExtensionStatePath(instanceKey: string, extensionName: string): string {
    return path.join(this.instancePath(instanceKey), "extensions", `${extensionName}.json`);
  }

  projectPath(...segments: string[]): string {
    return path.join(this.projectRoot, ...segments);
  }

  get projectConfigFile(): string {
    return this.projectPath("goondan.yaml");
  }

  private resolveGoondanHome(stateRoot?: string): string {
    if (stateRoot !== undefined && stateRoot.length > 0) {
      return path.resolve(stateRoot);
    }

    const envStateRoot = process.env.GOONDAN_STATE_ROOT;
    if (typeof envStateRoot === "string" && envStateRoot.length > 0) {
      return path.resolve(envStateRoot);
    }

    return path.join(os.homedir(), ".goondan");
  }

  private generateWorkspaceId(projectRoot: string): string {
    const hash = crypto.createHash("sha256").update(projectRoot).digest("hex");
    return hash.slice(0, 12);
  }
}

export function sanitizeInstanceKey(instanceKey: string): string {
  return instanceKey.replace(/[^a-zA-Z0-9_:-]/g, "-").slice(0, 128);
}
