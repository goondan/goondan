import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { LocalRuntimeController } from '../src/services/runtime.js';

interface RuntimeFixture {
  rootDir: string;
  bundleDir: string;
  stateRoot: string;
  manifestPath: string;
}

async function createRuntimeFixture(bundleContent: string): Promise<RuntimeFixture> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'goondan-cli-runtime-'));
  const bundleDir = path.join(rootDir, 'bundle');
  const stateRoot = path.join(rootDir, 'state');
  const manifestPath = path.join(bundleDir, 'goondan.yaml');

  await mkdir(bundleDir, { recursive: true });
  await writeFile(manifestPath, bundleContent, 'utf8');

  return {
    rootDir,
    bundleDir,
    stateRoot,
    manifestPath,
  };
}

async function createRuntimeFixtureWithConnector(
  bundleContent: string,
  connectorSource: string,
): Promise<RuntimeFixture> {
  const fixture = await createRuntimeFixture(bundleContent);
  await writeFile(path.join(fixture.bundleDir, 'connector.js'), connectorSource, 'utf8');
  return fixture;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await readFile(filePath, 'utf8');
      return value;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(`파일 생성 대기 시간 초과: ${filePath}`);
}

const basicBundle = `
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: "@goondan/test-runtime"
spec:
  version: "0.1.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: test-model
spec:
  provider: anthropic
  model: claude-sonnet-4-5
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: bot
spec:
  modelConfig:
    modelRef: "Model/test-model"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/bot"
  agents:
    - ref: "Agent/bot"
`;

const connectorBundle = `
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: "@goondan/test-runtime"
spec:
  version: "0.1.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: dummy-model
spec:
  provider: anthropic
  model: claude-sonnet-4-5
  apiKey:
    value: "dummy"
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: bot
spec:
  modelConfig:
    modelRef: "Model/dummy-model"
  prompts:
    systemPrompt: "test"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/bot"
  agents:
    - ref: "Agent/bot"
---
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: sample-connector
spec:
  entry: "./connector.js"
  events:
    - name: sample_event
---
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: sample-connection
spec:
  connectorRef: "Connector/sample-connector"
  swarmRef: "Swarm/default"
  secrets:
    MARKER_PATH:
      valueFrom:
        env: SAMPLE_MARKER_PATH
`;

const connectorSource = `
import { writeFile } from 'node:fs/promises';

export default async function run(ctx) {
  const markerPath = ctx.secrets.MARKER_PATH;
  if (typeof markerPath !== 'string' || markerPath.length === 0) {
    throw new Error('MARKER_PATH secret is required');
  }

  await writeFile(markerPath, 'started\\n', 'utf8');
  await new Promise(() => {});
}
`;

describe('LocalRuntimeController.startOrchestrator', () => {
  it('Orchestrator runner를 백그라운드 프로세스로 기동하고 active.json에 pid를 기록한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);
    let startedPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        ANTHROPIC_API_KEY: 'test-key',
      });

      const result = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      expect(result.pid).toBeDefined();
      if (!result.pid) {
        return;
      }
      startedPid = result.pid;

      expect(result.pid).toBeGreaterThan(0);
      expect(result.pid).not.toBe(process.pid);
      expect(isProcessAlive(result.pid)).toBe(true);

      const activePath = path.join(fixture.stateRoot, 'runtime', 'active.json');
      const activeRaw = await readFile(activePath, 'utf8');
      const activeState: unknown = JSON.parse(activeRaw);
      if (typeof activeState !== 'object' || activeState === null) {
        throw new Error('active.json 파싱 결과가 객체가 아닙니다.');
      }
      if (!('pid' in activeState) || typeof activeState.pid !== 'number') {
        throw new Error('active.json에 pid가 기록되지 않았습니다.');
      }
      expect(activeState.pid).toBe(result.pid);
      if (!('logs' in activeState) || !Array.isArray(activeState.logs)) {
        throw new Error('active.json에 logs가 기록되지 않았습니다.');
      }
      expect(activeState.logs.length).toBeGreaterThan(0);
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('필수 env가 누락되면 시작 단계에서 원인을 포함한 오류를 출력한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {});

      await expect(
        controller.startOrchestrator({
          bundlePath: fixture.bundleDir,
          watch: false,
          interactive: false,
          noInstall: false,
          stateRoot: fixture.stateRoot,
        }),
      ).rejects.toThrow(/필수 환경 변수가 없습니다.*ANTHROPIC_API_KEY/s);
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('connection으로 참조된 connector entry를 실제로 실행한다', async () => {
    const fixture = await createRuntimeFixtureWithConnector(connectorBundle, connectorSource);
    const markerPath = path.join(fixture.rootDir, 'connector.marker');
    let startedPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        SAMPLE_MARKER_PATH: markerPath,
      });

      const result = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      if (!result.pid) {
        throw new Error('pid가 반환되지 않았습니다.');
      }
      startedPid = result.pid;

      const marker = await waitForFile(markerPath);
      expect(marker.trim()).toBe('started');
      expect(isProcessAlive(result.pid)).toBe(true);
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
