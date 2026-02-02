/**
 * 코딩 작업 도구
 *
 * code.read - 파일 읽기
 * code.write - 파일 작성/수정
 * code.execute - 코드 실행 (sandbox)
 * code.search - 코드 검색 (grep)
 * code.analyze - 코드 분석 (구조, 의존성)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { JsonObject, ToolHandler, ToolContext } from '@goondan/core';

const execAsync = promisify(exec);

// 작업 디렉터리 (환경변수 또는 기본값)
function getWorkDir(): string {
  return process.env.GOONDAN_WORK_DIR || process.cwd();
}

// 경로 보안 검증
function validatePath(targetPath: string): string {
  const workDir = getWorkDir();
  const resolved = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(workDir, targetPath);

  // 작업 디렉터리 밖으로 나가는 것 방지
  const relative = path.relative(workDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`접근이 허용되지 않은 경로입니다: ${targetPath}`);
  }

  return resolved;
}

interface CodeReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

interface CodeWriteInput {
  path: string;
  content: string;
  createDirs?: boolean;
}

interface CodeExecuteInput {
  language: 'javascript' | 'typescript' | 'python' | 'bash';
  code: string;
  timeout?: number;
}

interface CodeSearchInput {
  pattern: string;
  path?: string;
  filePattern?: string;
  maxResults?: number;
}

interface CodeAnalyzeInput {
  path: string;
  type?: 'structure' | 'dependencies' | 'summary';
}

export const handlers: Record<string, ToolHandler> = {
  /**
   * 파일 읽기 (줄 번호 포함)
   */
  'code.read': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<CodeReadInput>;
    const targetPath = payload.path;
    if (!targetPath) {
      throw new Error('path가 필요합니다.');
    }

    const resolved = validatePath(targetPath);
    const content = await fs.readFile(resolved, 'utf8');
    const lines = content.split('\n');

    const startLine = Math.max(1, payload.startLine || 1);
    const endLine = Math.min(lines.length, payload.endLine || lines.length);

    const selectedLines = lines.slice(startLine - 1, endLine);
    const numberedLines = selectedLines.map((line, idx) => {
      const lineNum = (startLine + idx).toString().padStart(4, ' ');
      return `${lineNum} │ ${line}`;
    });

    const result: JsonObject = {
      path: path.relative(getWorkDir(), resolved),
      totalLines: lines.length,
      startLine,
      endLine,
      content: numberedLines.join('\n'),
    };

    return result;
  },

  /**
   * 파일 작성/수정
   */
  'code.write': async (ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<CodeWriteInput>;
    const targetPath = payload.path;
    const content = payload.content;

    if (!targetPath) {
      throw new Error('path가 필요합니다.');
    }
    if (typeof content !== 'string') {
      throw new Error('content가 필요합니다.');
    }

    const resolved = validatePath(targetPath);

    // 디렉터리 생성
    if (payload.createDirs !== false) {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
    }

    // 기존 파일이 있는지 확인
    let isNew = true;
    try {
      await fs.access(resolved);
      isNew = false;
    } catch {
      // 새 파일
    }

    await fs.writeFile(resolved, content, 'utf8');

    const result: JsonObject = {
      path: path.relative(getWorkDir(), resolved),
      action: isNew ? 'created' : 'updated',
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf8'),
    };

    // 이벤트 발행 (선택)
    ctx.events.emit('code.written', {
      path: resolved,
      relativePath: result.path,
      action: result.action,
    });

    return result;
  },

  /**
   * 코드 실행 (sandboxed)
   */
  'code.execute': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<CodeExecuteInput>;
    const language = payload.language;
    const code = payload.code;
    const timeout = payload.timeout ?? 30000; // 기본 30초

    if (!language) {
      throw new Error('language가 필요합니다. (javascript, typescript, python, bash)');
    }
    if (!code) {
      throw new Error('code가 필요합니다.');
    }

    const workDir = getWorkDir();
    let command: string;
    let tempFile: string | null = null;

    try {
      switch (language) {
        case 'javascript':
          tempFile = path.join(workDir, `.temp_${Date.now()}.mjs`);
          await fs.writeFile(tempFile, code);
          command = `node "${tempFile}"`;
          break;

        case 'typescript':
          tempFile = path.join(workDir, `.temp_${Date.now()}.ts`);
          await fs.writeFile(tempFile, code);
          command = `npx tsx "${tempFile}"`;
          break;

        case 'python':
          tempFile = path.join(workDir, `.temp_${Date.now()}.py`);
          await fs.writeFile(tempFile, code);
          command = `python3 "${tempFile}"`;
          break;

        case 'bash':
          // bash는 직접 실행
          command = code;
          break;

        default:
          throw new Error(`지원하지 않는 언어입니다: ${language}`);
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
        env: {
          ...process.env,
          NODE_ENV: 'sandbox',
        },
      });

      return {
        success: true,
        language,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (error) {
      const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };
      return {
        success: false,
        language,
        exitCode: execError.code,
        stdout: execError.stdout?.trim() || '',
        stderr: execError.stderr?.trim() || '',
        error: execError.killed ? 'Timeout exceeded' : execError.message,
      };
    } finally {
      // 임시 파일 정리
      if (tempFile) {
        await fs.unlink(tempFile).catch(() => {});
      }
    }
  },

  /**
   * 코드 검색 (grep)
   */
  'code.search': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<CodeSearchInput>;
    const pattern = payload.pattern;
    if (!pattern) {
      throw new Error('pattern이 필요합니다.');
    }

    const searchPath = validatePath(payload.path || '.');
    const filePattern = payload.filePattern || '*.{ts,js,py,java,go,rs}';
    const maxResults = payload.maxResults ?? 50;

    try {
      // grep 사용
      const { stdout } = await execAsync(
        `grep -rn --include="${filePattern}" "${pattern.replace(/"/g, '\\"')}" . 2>/dev/null | head -n ${maxResults}`,
        { cwd: searchPath, maxBuffer: 1024 * 1024 }
      );

      const lines = stdout.trim().split('\n').filter(Boolean);
      const results = lines.map((line) => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (!match) return { raw: line };
        const lineContent = match[3];
        return {
          file: match[1],
          line: parseInt(match[2] || '0', 10),
          content: lineContent ? (lineContent.length > 200 ? lineContent.slice(0, 200) + '...' : lineContent) : '',
        };
      });

      return {
        pattern,
        searchPath: path.relative(getWorkDir(), searchPath) || '.',
        count: results.length,
        truncated: results.length >= maxResults,
        results,
      };
    } catch {
      return {
        pattern,
        searchPath: path.relative(getWorkDir(), searchPath) || '.',
        count: 0,
        results: [],
        message: '검색 결과가 없습니다.',
      };
    }
  },

  /**
   * 코드 분석
   */
  'code.analyze': async (_ctx: ToolContext, input: JsonObject) => {
    const payload = input as Partial<CodeAnalyzeInput>;
    const targetPath = payload.path;
    if (!targetPath) {
      throw new Error('path가 필요합니다.');
    }

    const resolved = validatePath(targetPath);
    const stat = await fs.stat(resolved);
    const analysisType = payload.type || 'summary';

    if (stat.isDirectory()) {
      // 디렉터리 분석
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile());
      const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));

      const filesByExt: Record<string, number> = {};
      for (const file of files) {
        const ext = path.extname(file.name) || '(none)';
        filesByExt[ext] = (filesByExt[ext] || 0) + 1;
      }

      return {
        path: path.relative(getWorkDir(), resolved) || '.',
        type: 'directory',
        analysis: analysisType,
        stats: {
          files: files.length,
          directories: dirs.length,
          filesByExtension: filesByExt,
        },
        topLevelItems: [...dirs.map((d) => `📁 ${d.name}/`), ...files.map((f) => `📄 ${f.name}`)].slice(0, 30),
      };
    }

    // 파일 분석
    const content = await fs.readFile(resolved, 'utf8');
    const lines = content.split('\n');
    const ext = path.extname(resolved);

    const analysis: JsonObject = {
      path: path.relative(getWorkDir(), resolved),
      type: 'file',
      extension: ext,
      lines: lines.length,
      bytes: Buffer.byteLength(content, 'utf8'),
    };

    if (analysisType === 'structure') {
      // 코드 구조 분석 (간단)
      const functions = lines.filter((l) =>
        /^\s*(function|const|let|var|def|async function|export function|export const)/.test(l)
      );
      const classes = lines.filter((l) => /^\s*(class|interface|type|struct)/.test(l));
      const imports = lines.filter((l) => /^\s*(import|from|require)/.test(l));

      analysis.structure = {
        functions: functions.length,
        classes: classes.length,
        imports: imports.length,
        preview: {
          functions: functions.slice(0, 10).map((l) => l.trim()),
          classes: classes.slice(0, 10).map((l) => l.trim()),
        },
      };
    }

    if (analysisType === 'dependencies' && (ext === '.json' || resolved.endsWith('package.json'))) {
      try {
        const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        analysis.dependencies = {
          dependencies: Object.keys(pkg.dependencies || {}),
          devDependencies: Object.keys(pkg.devDependencies || {}),
        };
      } catch {
        analysis.dependencies = { error: 'JSON 파싱 실패' };
      }
    }

    return analysis;
  },
};
