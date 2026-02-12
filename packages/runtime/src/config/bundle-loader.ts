import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RuntimeResource, ValidationError } from "../types.js";
import { parseYamlDocuments } from "./simple-yaml.js";
import { toRuntimeResource, validateResources } from "./resources.js";

export interface BundleLoaderOptions {
  maxFileBytes?: number;
  maxDocumentsPerFile?: number;
  allowedBaseNames?: string[];
}

export interface BundleLoadResult {
  resources: RuntimeResource[];
  errors: ValidationError[];
  scannedFiles: string[];
}

const DEFAULT_ALLOWED_BASE_NAMES = [
  "goondan",
  "model",
  "models",
  "agent",
  "agents",
  "tool",
  "tools",
  "extension",
  "extensions",
  "connector",
  "connectors",
  "connection",
  "connections",
  "swarm",
  "swarms",
  "resources",
];

export class BundleLoader {
  private readonly maxFileBytes: number;
  private readonly maxDocumentsPerFile: number;
  private readonly allowedBaseNames: Set<string>;

  constructor(options: BundleLoaderOptions = {}) {
    this.maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
    this.maxDocumentsPerFile = options.maxDocumentsPerFile ?? 100;
    this.allowedBaseNames = new Set(options.allowedBaseNames ?? DEFAULT_ALLOWED_BASE_NAMES);
  }

  async load(bundleDir: string): Promise<BundleLoadResult> {
    const files = await this.collectBundleFiles(bundleDir);
    const resources: RuntimeResource[] = [];
    const errors: ValidationError[] = [];

    for (const file of files) {
      const relativePath = path.relative(bundleDir, file) || path.basename(file);

      try {
        const stat = await fs.stat(file);
        if (stat.size > this.maxFileBytes) {
          errors.push({
            code: "E_CONFIG_FILE_TOO_LARGE",
            message: `YAML file exceeds size limit (${this.maxFileBytes} bytes).`,
            path: relativePath,
            suggestion: "YAML 파일을 분할하거나 용량을 줄이세요.",
          });
          continue;
        }

        const content = await fs.readFile(file, "utf8");
        const docs = parseYamlDocuments(content);

        if (docs.length > this.maxDocumentsPerFile) {
          errors.push({
            code: "E_CONFIG_TOO_MANY_DOCUMENTS",
            message: `YAML documents exceed limit (${this.maxDocumentsPerFile}).`,
            path: relativePath,
            suggestion: "문서 수를 줄이거나 파일을 분할하세요.",
          });
          continue;
        }

        docs.forEach((value, docIndex) => {
          const resource = toRuntimeResource({
            value,
            file: relativePath,
            docIndex,
          });

          if (resource === null) {
            return;
          }

          if (resource.kind.trim().length === 0) {
            return;
          }

          resources.push(resource);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse YAML";
        errors.push({
          code: "E_CONFIG_PARSE_ERROR",
          message,
          path: relativePath,
          suggestion: "YAML 문법과 들여쓰기를 확인하세요.",
        });
      }
    }

    const validationErrors = validateResources(resources);
    errors.push(...validationErrors);

    return {
      resources,
      errors,
      scannedFiles: files,
    };
  }

  async loadOrThrow(bundleDir: string): Promise<RuntimeResource[]> {
    const result = await this.load(bundleDir);
    if (result.errors.length > 0) {
      const summary = result.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join("\n");
      throw new Error(summary);
    }

    return result.resources;
  }

  private async collectBundleFiles(bundleDir: string): Promise<string[]> {
    const collected: string[] = [];

    await this.walk(bundleDir, collected);

    return collected.sort((left, right) => left.localeCompare(right));
  }

  private async walk(currentDir: string, collected: string[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(fullPath, collected);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".yaml" && ext !== ".yml") {
        continue;
      }

      const baseName = path.basename(entry.name, ext).toLowerCase();
      if (!this.allowedBaseNames.has(baseName)) {
        continue;
      }

      collected.push(fullPath);
    }
  }
}
