import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

await copyYamlTree(srcDir);

async function copyYamlTree(currentDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await copyYamlTree(sourcePath);
        return;
      }
      if (!entry.isFile()) return;
      if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) return;
      const relativePath = path.relative(srcDir, sourcePath);
      const targetPath = path.join(distDir, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }),
  );
}
