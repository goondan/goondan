import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, readFileIfExists } from './fs.js';

const DEFAULT_MAX_LINES_PER_FILE = 1000;

export type JsonlSegmentWriterOptions = {
  dirPath: string;
  maxLinesPerFile?: number;
  logger?: Console;
};

export function formatSegmentFileName(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}_${hour}-${minute}-${second}_${ms}.jsonl`;
}

export async function listSegmentFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
}

export async function readJsonlSegmentFile(filePath: string): Promise<unknown[]> {
  const content = await readFileIfExists(filePath, 'utf8');
  if (!content) return [];
  const lines = content.split(/\n/).filter((line) => line.trim().length > 0);
  const out: unknown[] = [];
  for (const line of lines) {
    out.push(JSON.parse(line));
  }
  return out;
}

export async function readJsonlSegmentsNewestFirst(
  dirPath: string,
  options: { maxRecords?: number } = {}
): Promise<unknown[]> {
  const maxRecords = options.maxRecords;
  const namesAsc = await listSegmentFiles(dirPath);
  const namesDesc = namesAsc.slice().reverse();
  const records: unknown[] = [];

  for (const name of namesDesc) {
    if (typeof maxRecords === 'number' && records.length >= maxRecords) break;
    const filePath = path.join(dirPath, name);
    const content = await readFileIfExists(filePath, 'utf8');
    if (!content) continue;
    const lines = content.split(/\n/).filter((line) => line.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (typeof maxRecords === 'number' && records.length >= maxRecords) break;
      const line = lines[i];
      if (!line) continue;
      records.push(JSON.parse(line));
    }
  }

  return records;
}

export class JsonlSegmentWriter {
  private dirPath: string;
  private maxLinesPerFile: number;
  private logger: Console;
  private initialized = false;
  private currentFileName: string | null = null;
  private currentLineCount = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: JsonlSegmentWriterOptions) {
    this.dirPath = options.dirPath;
    this.maxLinesPerFile = options.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE;
    this.logger = options.logger || console;
  }

  append(record: unknown): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.appendInternal(record));
    return this.writeChain;
  }

  private async appendInternal(record: unknown): Promise<void> {
    await this.ensureInitialized();
    if (this.currentLineCount >= this.maxLinesPerFile) {
      await this.createNewSegment();
    }
    const fileName = this.currentFileName;
    if (!fileName) {
      throw new Error('현재 JSONL 세그먼트 파일이 없습니다.');
    }
    const filePath = path.join(this.dirPath, fileName);
    const line = `${JSON.stringify(record)}\n`;
    await fs.appendFile(filePath, line, 'utf8');
    await fs.chmod(filePath, 0o600).catch(() => undefined);
    this.currentLineCount += 1;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await ensureDir(this.dirPath);
    await fs.chmod(this.dirPath, 0o700).catch(() => undefined);

    const names = await listSegmentFiles(this.dirPath);
    const latest = names.at(-1) || null;
    if (!latest) {
      await this.createNewSegment();
      this.initialized = true;
      return;
    }

    const latestPath = path.join(this.dirPath, latest);
    const content = await readFileIfExists(latestPath, 'utf8');
    const lineCount = content ? countJsonlLines(content) : 0;
    if (lineCount >= this.maxLinesPerFile) {
      await this.createNewSegment();
      this.initialized = true;
      return;
    }

    this.currentFileName = latest;
    this.currentLineCount = lineCount;
    await fs.chmod(latestPath, 0o600).catch(() => undefined);
    this.initialized = true;
  }

  private async createNewSegment(): Promise<void> {
    await ensureDir(this.dirPath);
    await fs.chmod(this.dirPath, 0o700).catch(() => undefined);

    let cursor = new Date();
    for (let i = 0; i < 1000; i += 1) {
      const fileName = formatSegmentFileName(cursor);
      const filePath = path.join(this.dirPath, fileName);
      try {
        const handle = await fs.open(filePath, 'wx');
        await handle.close();
        await fs.chmod(filePath, 0o600).catch(() => undefined);
        this.currentFileName = fileName;
        this.currentLineCount = 0;
        return;
      } catch (err) {
        if (isErrno(err, 'EEXIST')) {
          cursor = new Date(cursor.getTime() + 1);
          continue;
        }
        this.logger.error?.('세그먼트 파일 생성 실패:', err);
        throw err;
      }
    }
    throw new Error('세그먼트 파일 이름 충돌이 너무 많아 새 파일을 만들 수 없습니다.');
  }
}

function countJsonlLines(content: string): number {
  return content.split(/\n/).filter((line) => line.trim().length > 0).length;
}

function isErrno(err: unknown, code: string): boolean {
  return hasErrCode(err) && err.code === code;
}

function hasErrCode(err: unknown): err is { code: unknown } {
  return typeof err === 'object' && err !== null && 'code' in err;
}
