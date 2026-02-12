import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ParsedPackageName } from "./package-name.js";
import type { RegistryPackageMetadata } from "./types.js";
import { isRegistryPackageMetadata } from "./validators.js";

const METADATA_FILE_NAME = "metadata.json";
const TARBALL_DIRECTORY_NAME = "tarballs";

export class FileRegistryStore {
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  async initialize(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
  }

  async getMetadata(packageName: ParsedPackageName): Promise<RegistryPackageMetadata | null> {
    const metadataPath = this.getMetadataPath(packageName);
    const exists = await this.pathExists(metadataPath);
    if (!exists) {
      return null;
    }

    const raw = await readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isRegistryPackageMetadata(parsed)) {
      throw new Error(`Corrupted metadata file: ${metadataPath}`);
    }

    return parsed;
  }

  async saveMetadata(packageName: ParsedPackageName, metadata: RegistryPackageMetadata): Promise<void> {
    const packageDirectory = this.getPackageDirectory(packageName);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(this.getMetadataPath(packageName), JSON.stringify(metadata, null, 2), "utf8");
  }

  async saveTarball(packageName: ParsedPackageName, version: string, tarball: Buffer): Promise<string> {
    const tarballDirectory = this.getTarballDirectory(packageName);
    await mkdir(tarballDirectory, { recursive: true });

    const filePath = this.getTarballPath(packageName, version);
    await writeFile(filePath, tarball);
    return filePath;
  }

  async readTarball(packageName: ParsedPackageName, version: string): Promise<Buffer | null> {
    const tarballPath = this.getTarballPath(packageName, version);
    const exists = await this.pathExists(tarballPath);
    if (!exists) {
      return null;
    }

    return readFile(tarballPath);
  }

  async removeVersion(packageName: ParsedPackageName, version: string): Promise<void> {
    const tarballPath = this.getTarballPath(packageName, version);
    await rm(tarballPath, { force: true });
  }

  async removePackage(packageName: ParsedPackageName): Promise<void> {
    const packageDirectory = this.getPackageDirectory(packageName);
    await rm(packageDirectory, { recursive: true, force: true });
  }

  private getPackageDirectory(packageName: ParsedPackageName): string {
    return path.join(this.storageRoot, "packages", encodeURIComponent(packageName.scope), encodeURIComponent(packageName.name));
  }

  private getMetadataPath(packageName: ParsedPackageName): string {
    return path.join(this.getPackageDirectory(packageName), METADATA_FILE_NAME);
  }

  private getTarballDirectory(packageName: ParsedPackageName): string {
    return path.join(this.getPackageDirectory(packageName), TARBALL_DIRECTORY_NAME);
  }

  private getTarballPath(packageName: ParsedPackageName, version: string): string {
    return path.join(this.getTarballDirectory(packageName), `${encodeURIComponent(version)}.tgz`);
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
