import * as os from "node:os";
import * as path from "node:path";
import { adjectives, animals, colors, names, uniqueNamesGenerator } from "unique-names-generator";

const WORKSPACE_ID_DICTIONARIES = [adjectives, colors, animals, names];

export interface WorkspacePathsOptions {
  stateRoot?: string;
  projectRoot: string;
  packageName?: string;
}

export class WorkspacePaths {
  readonly goondanHome: string;
  readonly projectRoot: string;
  readonly packageName?: string;
  readonly workspaceId: string;

  constructor(options: WorkspacePathsOptions) {
    this.goondanHome = this.resolveGoondanHome(options.stateRoot);
    this.projectRoot = path.resolve(options.projectRoot);
    this.packageName = options.packageName;
    this.workspaceId = this.generateWorkspaceId(this.projectRoot, this.packageName);
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

  private generateWorkspaceId(projectRoot: string, packageName: string | undefined): string {
    const normalizedRoot = projectRoot.replaceAll("\\", "/");
    const normalizedPackage = normalizePackageName(packageName);
    const hashInput = `${normalizedRoot}\n${normalizedPackage}`;
    const raw = uniqueNamesGenerator({
      dictionaries: WORKSPACE_ID_DICTIONARIES,
      separator: "-",
      style: "lowerCase",
      seed: hashInput,
    });
    return normalizeWorkspaceSlug(raw);
  }
}

function normalizePackageName(packageName: string | undefined): string {
  if (typeof packageName !== "string") {
    return "no-package";
  }

  const trimmed = packageName.trim();
  if (trimmed.length === 0) {
    return "no-package";
  }

  return trimmed;
}

function normalizeWorkspaceSlug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const tokens = cleaned.split("-").filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return "stable-stable-stable-stable";
  }

  while (tokens.length < 4) {
    tokens.push("stable");
  }
  if (tokens.length > 4) {
    return tokens.slice(0, 4).join("-");
  }
  return tokens.join("-");
}

export function sanitizeInstanceKey(instanceKey: string): string {
  return instanceKey.replace(/[^a-zA-Z0-9_:-]/g, "-").slice(0, 128);
}
