import { spawn, execFile, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  GdnExecutionResult,
  ProviderConfig,
  RuntimeEventRecord,
} from './types.js';

export interface GdnHarnessOptions {
  /** goondan.yaml이 있는 디렉토리 */
  sampleDir: string;
  /** 프로바이더 설정 */
  providerConfig: ProviderConfig;
  /** gdn 실행 타임아웃 (ms). 기본 60000 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** orchestrator started 로그를 감지하기 위한 패턴 */
const ORCHESTRATOR_STARTED_PATTERN = /\[goondan-orchestrator\] started/;

/** orchestrator ready를 감지하지 못했을 때의 fallback 대기 시간 (ms) */
const STARTUP_FALLBACK_MS = 10_000;

/** base.jsonl polling 간격 (ms) */
const BASE_JSONL_POLL_INTERVAL_MS = 500;

/**
 * base.jsonl에 새 라인이 추가되지 않는 "무활동" 시간이 이 값을 초과하면 종료한다.
 * multi-agent delegation에서 coordinator→worker→coordinator 체인이 완료될 때까지 대기.
 * assistant 메시지가 감지된 후에만 이 idle 타이머가 활성화된다.
 */
const IDLE_TIMEOUT_MS = 30_000;

/**
 * 임시 디렉토리에 샘플을 복사하고 provider/model을 치환한다.
 */
export async function prepareSample(
  sampleDir: string,
  providerConfig: ProviderConfig,
): Promise<string> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gdn-eval-'),
  );
  await copyDir(sampleDir, tmpDir);

  // goondan.yaml에서 provider/model 치환
  const yamlPath = path.join(tmpDir, 'goondan.yaml');
  const yamlContent = await fs.readFile(yamlPath, 'utf-8');
  const replaced = replaceProviderInYaml(yamlContent, providerConfig);
  await fs.writeFile(yamlPath, replaced, 'utf-8');

  return tmpDir;
}

/**
 * YAML 내용에서 Model 리소스의 provider/model/env 필드를 치환하고,
 * eval에 불필요한 Connection(CLI 이외)과 관련 tool 참조를 제거한다.
 *
 * eval 실행 시 telegram/slack 등의 외부 connector는 불필요하며,
 * 포트 충돌이나 인증 토큰 부재로 시작 실패를 유발한다.
 */
function replaceProviderInYaml(
  yamlContent: string,
  config: ProviderConfig,
): string {
  const documents = yamlContent.split(/^---$/m);

  const replaced: string[] = [];

  for (const doc of documents) {
    // Connection 리소스 중 CLI connector가 아닌 것은 제거
    if (/kind:\s*Connection/.test(doc)) {
      if (isCliConnection(doc)) {
        replaced.push(doc);
      }
      // CLI가 아닌 Connection은 제거 (telegram, slack 등)
      continue;
    }

    if (/kind:\s*Model/.test(doc)) {
      const isFastModel = /name:\s*fast-model/.test(doc);
      const modelName = isFastModel ? config.models.fast : config.models.default;

      let result = doc;
      result = result.replace(
        /^(\s*provider:\s*).+$/gm,
        `$1${config.name}`,
      );
      result = result.replace(
        /^(\s*model:\s*).+$/gm,
        `$1${modelName}`,
      );
      result = result.replace(
        /^(\s*env:\s*).+$/gm,
        `$1${config.apiKeyEnv}`,
      );
      replaced.push(result);
      continue;
    }

    if (/kind:\s*Agent/.test(doc)) {
      let result = doc;
      // requiredTools 제거
      result = result.replace(
        /^\s*requiredTools:\s*\n(?:\s*-\s*.+\n)*/gm,
        '',
      );
      // eval에 불필요한 tool 참조 제거 (telegram, slack, wait, self-restart)
      result = removeNonEvalToolRefs(result);
      replaced.push(result);
      continue;
    }

    replaced.push(doc);
  }

  return replaced.join('---');
}

/**
 * Connection 리소스가 CLI connector를 사용하는지 확인한다.
 */
function isCliConnection(doc: string): boolean {
  return /name:\s*cli\b/.test(doc) && /kind:\s*Connector/.test(doc);
}

/**
 * Agent 문서에서 eval에 불필요한 tool 참조 블록을 제거한다.
 * telegram, slack, wait, self-restart tool은 eval 시 불필요하다.
 */
function removeNonEvalToolRefs(doc: string): string {
  const nonEvalTools = ['telegram', 'slack', 'wait', 'self-restart'];
  let result = doc;
  for (const toolName of nonEvalTools) {
    // multi-line tool ref block: "    - ref:\n        kind: Tool\n        name: <name>\n        package: ..."
    result = result.replace(
      new RegExp(`^\\s*- ref:\\s*\\n(?:\\s+\\w+:.*\\n)*?\\s+name:\\s*${toolName}\\s*\\n(?:\\s+\\w+:.*\\n)*`, 'gm'),
      '',
    );
  }
  return result;
}

/**
 * gdn run --foreground로 시나리오를 실행하고 결과를 반환한다.
 *
 * 실행 흐름:
 * 1. 임시 샘플 디렉토리 + 별도 state root 생성
 * 2. gdn package install 실행 (패키지 의존성 설치)
 * 3. gdn run --foreground 실행
 * 4. stdin으로 CLI connector JSON 메시지 전송 후 stdin 종료
 * 5. 응답 대기 후 프로세스 종료
 * 6. state root의 workspace에서 runtime-events/base.jsonl 파싱
 */
export async function runScenario(
  input: string,
  options: GdnHarnessOptions,
): Promise<GdnExecutionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tmpDir = await prepareSample(
    options.sampleDir,
    options.providerConfig,
  );
  const stateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gdn-eval-state-'),
  );

  const startTime = Date.now();

  try {
    // 패키지 의존성 설치
    await installPackages(tmpDir, stateRoot);

    const { stderr, exitCode } = await executeGdn(tmpDir, stateRoot, input, timeoutMs);
    const durationMs = Date.now() - startTime;
    const runtimeEvents = await parseRuntimeEvents(stateRoot);
    // base.jsonl의 assistant 응답을 우선 사용 (stdout은 시스템 로그)
    const agentResponse = await parseAgentResponse(stateRoot);

    const finalResponse = agentResponse.length > 0
      ? agentResponse
      : stderr.length > 0
        ? `[gdn stderr] ${stderr}`
        : '';

    return {
      response: finalResponse,
      runtimeEvents,
      exitCode,
      durationMs,
    };
  } finally {
    await cleanup(tmpDir);
    await cleanup(stateRoot);
  }
}

/**
 * gdn package install을 실행하여 패키지 의존성을 설치한다.
 */
function installPackages(workDir: string, stateRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const gdnBin = process.env['GDN_BIN'] ?? 'gdn';
    execFile(
      gdnBin,
      ['package', 'install', '--state-root', stateRoot],
      {
        cwd: workDir,
        env: { ...process.env },
        timeout: 30_000,
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`gdn package install failed: ${stderr || error.message}`));
          return;
        }
        resolve();
      },
    );
  });
}

interface GdnProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * gdn run --foreground를 실행한다.
 *
 * 이전 방식: 고정 STARTUP_DELAY 후 stdin 전송, 고정 RESPONSE_WAIT 후 종료.
 * 문제: 텍스트 응답이 base.jsonl에 플러시되기 전에 프로세스 종료됨.
 *
 * 새 방식:
 * 1. stderr에서 orchestrator started 로그를 감지하여 stdin 전송 시점 결정
 * 2. stateRoot에서 base.jsonl을 polling으로 감시, assistant 메시지 감지
 * 3. assistant 응답 감지 시 settle 대기 후 SIGTERM으로 종료
 * 4. timeoutMs를 hard timeout으로 사용 (응답이 없으면 강제 종료)
 */
function executeGdn(
  workDir: string,
  stateRoot: string,
  input: string,
  timeoutMs: number,
): Promise<GdnProcessResult> {
  return new Promise((resolve, reject) => {
    const gdnBin = process.env['GDN_BIN'] ?? 'gdn';
    const child: ChildProcess = spawn(
      gdnBin,
      ['run', '--foreground', '--state-root', stateRoot],
      {
        cwd: workDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let stdinSent = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    // stdout/stderr 출력도 활동으로 간주 — LLM 호출 중에도 runtime 로그가 출력됨
    let lastProcessOutputTime = Date.now();

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      lastProcessOutputTime = Date.now();

      // orchestrator started 로그를 감지하여 stdin 전송
      // runtime-runner의 console.info는 stdout으로 출력됨
      if (!stdinSent && ORCHESTRATOR_STARTED_PATTERN.test(chunk)) {
        sendStdinMessage();
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      lastProcessOutputTime = Date.now();

      // stderr에서도 orchestrator started 감지 (runtime 설정에 따라 달라질 수 있음)
      if (!stdinSent && ORCHESTRATOR_STARTED_PATTERN.test(chunk)) {
        sendStdinMessage();
      }
    });

    function finish(exitCode: number): void {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(fallbackTimer);
      if (pollTimer !== undefined) clearInterval(pollTimer);
      resolve({ stdout, stderr, exitCode });
    }

    function gracefulStop(): void {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }

    function sendStdinMessage(): void {
      if (stdinSent || settled || !child.stdin) return;
      stdinSent = true;

      const cliMessage = JSON.stringify({
        name: 'stdin_message',
        text: input,
        instanceKey: 'eval-test',
      });

      child.stdin.write(cliMessage + '\n', () => {
        // stdin 전송 후 base.jsonl polling 시작
        startBaseJsonlPolling();
      });
    }

    function startBaseJsonlPolling(): void {
      if (pollTimer !== undefined || settled) return;

      let lastKnownBaseLines = 0;
      let lastKnownTotalLines = 0;
      let assistantFound = false;
      let lastActivityTime = Date.now();

      pollTimer = setInterval(() => {
        if (settled) return;

        // base.jsonl에서 assistant 메시지 감지 + 전체 jsonl 활동 감지
        const basePromise = pollBaseJsonl(stateRoot, lastKnownBaseLines);
        const activityPromise = countAllJsonlLines(stateRoot);

        void Promise.all([basePromise, activityPromise]).then(([baseResult, totalLines]) => {
          if (settled) return;

          // 어떤 jsonl 파일이든 새 라인이 추가되면 활동 시간 갱신
          if (totalLines > lastKnownTotalLines) {
            lastActivityTime = Date.now();
          }

          // stdout/stderr 출력이 있었으면 활동 시간 갱신
          // LLM 호출 중에도 runtime은 로그를 출력하므로
          if (lastProcessOutputTime > lastActivityTime) {
            lastActivityTime = lastProcessOutputTime;
          }

          if (baseResult.found) {
            assistantFound = true;
          }

          lastKnownBaseLines = baseResult.lineCount;
          lastKnownTotalLines = totalLines;

          // assistant 응답이 감지된 후, idle timeout이 지나면 종료
          // multi-agent 체인에서 worker가 작업 중이면 각종 jsonl에 계속 이벤트가 기록됨
          if (assistantFound && Date.now() - lastActivityTime >= IDLE_TIMEOUT_MS) {
            if (pollTimer !== undefined) clearInterval(pollTimer);
            pollTimer = undefined;
            gracefulStop();
          }
        });
      }, BASE_JSONL_POLL_INTERVAL_MS);
    }

    // Hard timeout: 전체 시나리오 타임아웃
    const hardTimer = setTimeout(() => {
      if (settled) return;
      gracefulStop();
      // SIGTERM 후 close 이벤트에서 finish가 호출됨
      // 만약 5초 내에 close가 안 오면 SIGKILL 후 강제 finish
      setTimeout(() => {
        finish(124);
      }, 6000);
    }, timeoutMs);

    // Fallback: orchestrator started 로그를 감지하지 못했을 때의 안전장치
    const fallbackTimer = setTimeout(() => {
      if (!stdinSent) {
        sendStdinMessage();
      }
    }, STARTUP_FALLBACK_MS);

    child.on('close', (code) => {
      finish(code ?? 1);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(fallbackTimer);
      if (pollTimer !== undefined) clearInterval(pollTimer);
      reject(new Error(`Failed to spawn gdn: ${err.message}`));
    });
  });
}

/**
 * stateRoot 하위의 base.jsonl 파일들을 탐색하여 assistant 메시지 존재 여부를 확인한다.
 * 새 assistant 메시지가 발견되면 found: true를 반환한다.
 */
async function pollBaseJsonl(
  stateRoot: string,
  previousLineCount: number,
): Promise<{ found: boolean; lineCount: number }> {
  const baseFiles = await findJsonlFiles(stateRoot, 'base.jsonl');
  let totalLines = 0;
  let foundAssistant = false;

  for (const filePath of baseFiles) {
    const content = await safeReadFile(filePath);
    if (!content) continue;

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    totalLines += lines.length;

    // 이전에 확인한 라인 수보다 많은 경우에만 새 라인 검사
    if (totalLines > previousLineCount) {
      for (const line of lines) {
        try {
          const parsed: unknown = JSON.parse(line.trim());
          if (isAssistantMessage(parsed)) {
            foundAssistant = true;
          }
        } catch {
          // 손상된 라인은 무시
        }
      }
    }
  }

  return { found: foundAssistant, lineCount: totalLines };
}

/**
 * stateRoot 하위의 모든 .jsonl 파일의 총 라인 수를 반환한다.
 * 활동 감지용으로 사용: base.jsonl, runtime-events.jsonl, events.jsonl 등
 * 어떤 파일이든 새 라인이 추가되면 에이전트가 활동 중인 것으로 판단한다.
 */
async function countAllJsonlLines(stateRoot: string): Promise<number> {
  const files: string[] = [];
  await walkDir(stateRoot, (filePath) => {
    if (filePath.endsWith('.jsonl')) {
      files.push(filePath);
    }
  });

  let totalLines = 0;
  for (const filePath of files) {
    const content = await safeReadFile(filePath);
    if (!content) continue;
    totalLines += content.split('\n').filter((l) => l.trim().length > 0).length;
  }

  return totalLines;
}

/**
 * runtime-events.jsonl을 파싱한다.
 */
export async function parseRuntimeEvents(
  stateRoot: string,
): Promise<RuntimeEventRecord[]> {
  const results: RuntimeEventRecord[] = [];
  const eventsFiles = await findJsonlFiles(stateRoot, 'runtime-events.jsonl');

  for (const filePath of eventsFiles) {
    const content = await safeReadFile(filePath);
    if (!content) continue;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isRuntimeEventRecord(parsed)) {
          results.push(parsed);
        }
      } catch {
        // 손상된 라인은 무시
      }
    }
  }

  return results;
}

/**
 * messages/base.jsonl에서 assistant 응답을 추출한다.
 */
export async function parseAgentResponse(stateRoot: string): Promise<string> {
  const baseFiles = await findJsonlFiles(stateRoot, 'base.jsonl');
  const responses: string[] = [];

  for (const filePath of baseFiles) {
    const content = await safeReadFile(filePath);
    if (!content) continue;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isAssistantMessage(parsed)) {
          const text = extractTextFromMessage(parsed);
          if (text) responses.push(text);
        }
      } catch {
        // 손상된 라인은 무시
      }
    }
  }

  return responses.join('\n');
}

/**
 * 임시 디렉토리를 정리한다.
 */
export async function cleanup(tmpDir: string): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // cleanup 실패는 무시
  }
}

// --- 내부 유틸리티 ---

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function findJsonlFiles(
  dir: string,
  filename: string,
): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, (filePath) => {
    if (path.basename(filePath) === filename) {
      results.push(filePath);
    }
  });
  return results;
}

async function walkDir(
  dir: string,
  callback: (filePath: string) => void,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

// --- Type guards ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeEventRecord(value: unknown): value is RuntimeEventRecord {
  if (!isRecord(value)) return false;
  return typeof value['type'] === 'string';
}

/**
 * base.jsonl의 assistant 메시지를 판별한다.
 *
 * base.jsonl 형식은 두 가지:
 * 1. Delta 형식: `{ id, data: { role: "assistant", content: [...] }, metadata, ... }`
 * 2. Legacy 형식: `{ role: "assistant", content: ... }`
 */
function isAssistantMessage(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  // Delta 형식: data.role === 'assistant'
  if (isRecord(value['data']) && value['data']['role'] === 'assistant') {
    return true;
  }
  // Legacy 형식: role === 'assistant'
  return value['role'] === 'assistant';
}

/**
 * assistant 메시지에서 텍스트를 추출한다.
 */
function extractTextFromMessage(msg: Record<string, unknown>): string | undefined {
  // Delta 형식: data.content에서 추출
  const data = isRecord(msg['data']) ? msg['data'] : msg;

  if (isRecord(data['message']) && typeof data['message']['text'] === 'string') {
    return data['message']['text'];
  }
  if (typeof data['content'] === 'string') {
    return data['content'];
  }
  if (Array.isArray(data['content'])) {
    const texts: string[] = [];
    for (const part of data['content']) {
      if (isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string') {
        texts.push(part['text']);
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }
  return undefined;
}
