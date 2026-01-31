import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readFileIfExists(
  filePath: string,
  encoding: BufferEncoding = 'utf8'
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function appendJsonl(filePath: string, obj: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const line = `${JSON.stringify(obj)}\n`;
  await fs.appendFile(filePath, line, 'utf8');
}

export async function readJsonl<T = unknown>(filePath: string): Promise<T[]> {
  const content = await readFileIfExists(filePath, 'utf8');
  if (!content) return [];
  return content
    .split(/\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function readLastJsonl<T = unknown>(filePath: string): Promise<T | null> {
  const content = await readFileIfExists(filePath, 'utf8');
  if (!content) return null;
  const lines = content.split(/\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;
  const lastLine = lines.at(-1);
  if (!lastLine) return null;
  return JSON.parse(lastLine) as T;
}

export async function writeYaml(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const yamlText = YAML.stringify(data);
  await fs.writeFile(filePath, yamlText, 'utf8');
}

export async function readYamlIfExists<T = unknown>(filePath: string): Promise<T | null> {
  const content = await readFileIfExists(filePath, 'utf8');
  if (!content) return null;
  return YAML.parse(content) as T;
}
