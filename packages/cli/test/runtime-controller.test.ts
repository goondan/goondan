import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { WorkspacePaths } from '@goondan/runtime';
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

const connectorConfigBundle = connectorBundle.replace('  secrets:', '  config:');

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

const connectorConfigSource = `
import { writeFile } from 'node:fs/promises';

export default async function run(ctx) {
  const markerPath = ctx.config.MARKER_PATH;
  if (typeof markerPath !== 'string' || markerPath.length === 0) {
    throw new Error('MARKER_PATH config is required');
  }

  await writeFile(markerPath, 'started\\n', 'utf8');
  await new Promise(() => {});
}
`;

describe('LocalRuntimeController.startOrchestrator', () => {
  it('instance-key를 생략하면 폴더+패키지명 기반 키를 사용하고 동일 키 런타임을 재사용한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);
    let startedPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        ANTHROPIC_API_KEY: 'test-key',
      });

      const first = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      if (!first.pid) {
        throw new Error('첫 실행 pid가 없습니다.');
      }
      startedPid = first.pid;

      const expectedKey = new WorkspacePaths({
        stateRoot: fixture.stateRoot,
        projectRoot: fixture.bundleDir,
        packageName: '@goondan/test-runtime',
      }).workspaceId;

      expect(first.instanceKey).toBe(expectedKey);
      expect(first.instanceKey.includes('/')).toBe(false);

      const second = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      expect(second.instanceKey).toBe(expectedKey);
      expect(second.pid).toBe(first.pid);
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('foreground 모드에서는 이미 실행 중인 동일 instance-key에 attach하지 않고 오류를 반환한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);
    let startedPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        ANTHROPIC_API_KEY: 'test-key',
      });

      const started = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      if (!started.pid) {
        throw new Error('첫 실행 pid가 없습니다.');
      }
      startedPid = started.pid;

      await expect(
        controller.startOrchestrator({
          bundlePath: fixture.bundleDir,
          watch: false,
          foreground: true,
          interactive: false,
          noInstall: false,
          stateRoot: fixture.stateRoot,
        }),
      ).rejects.toThrow(/이미 실행 중인 Orchestrator 인스턴스가 있습니다/);
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

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

  it('.env 파일의 값을 자동 로드해 Orchestrator를 시작한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);
    let startedPid: number | undefined;

    try {
      await writeFile(path.join(fixture.bundleDir, '.env'), 'ANTHROPIC_API_KEY=loaded-from-dotenv\n', 'utf8');
      const controller = new LocalRuntimeController(fixture.bundleDir, {});

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
      expect(isProcessAlive(result.pid)).toBe(true);
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

  it('connection의 config 값이 connector context로 전달된다', async () => {
    const fixture = await createRuntimeFixtureWithConnector(connectorConfigBundle, connectorConfigSource);
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


  it('instance restart는 최신 runner를 다시 기동하고 기존 pid를 교체한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);
    let runningPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        ANTHROPIC_API_KEY: 'test-key',
      });

      const started = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      if (!started.pid) {
        throw new Error('start pid가 없습니다.');
      }

      const previousPid = started.pid;
      runningPid = previousPid;

      const restarted = await controller.restart({
        instanceKey: started.instanceKey,
        fresh: false,
        stateRoot: fixture.stateRoot,
      });

      expect(restarted.instanceKey).toBe(started.instanceKey);
      expect(restarted.pid).toBeDefined();
      if (!restarted.pid) {
        throw new Error('restart pid가 없습니다.');
      }

      runningPid = restarted.pid;
      expect(restarted.pid).not.toBe(previousPid);
      expect(isProcessAlive(restarted.pid)).toBe(true);

      await waitForProcessExit(previousPid);
      expect(isProcessAlive(previousPid)).toBe(false);

      const activePath = path.join(fixture.stateRoot, 'runtime', 'active.json');
      const activeRaw = await readFile(activePath, 'utf8');
      const activeState: unknown = JSON.parse(activeRaw);
      if (typeof activeState !== 'object' || activeState === null) {
        throw new Error('active.json 파싱 결과가 객체가 아닙니다.');
      }
      if (!('pid' in activeState) || typeof activeState.pid !== 'number') {
        throw new Error('active.json pid가 유효하지 않습니다.');
      }

      expect(activeState.pid).toBe(restarted.pid);
    } finally {
      if (runningPid && isProcessAlive(runningPid)) {
        process.kill(runningPid, 'SIGTERM');
        await waitForProcessExit(runningPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('instance restart 대상 키가 active 인스턴스와 다르면 오류를 반환한다', async () => {
    const fixture = await createRuntimeFixture(basicBundle);
    let runningPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        ANTHROPIC_API_KEY: 'test-key',
      });

      const started = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      runningPid = started.pid;

      await expect(
        controller.restart({
          instanceKey: 'another-instance',
          fresh: false,
          stateRoot: fixture.stateRoot,
        }),
      ).rejects.toThrow(/활성 오케스트레이터 인스턴스와 일치하지 않습니다/);
    } finally {
      if (runningPid && isProcessAlive(runningPid)) {
        process.kill(runningPid, 'SIGTERM');
        await waitForProcessExit(runningPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
