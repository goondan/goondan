import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
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

async function createRuntimeFixtureWithExtension(
  bundleContent: string,
  extensionSource: string,
): Promise<RuntimeFixture> {
  const fixture = await createRuntimeFixture(bundleContent);
  await writeFile(path.join(fixture.bundleDir, 'ext.js'), extensionSource, 'utf8');
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

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null || typeof address.port !== 'number') {
        server.close(() => {
          reject(new Error('사용 가능한 포트를 확인할 수 없습니다.'));
        });
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
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

async function waitForFileContains(filePath: string, needle: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await readFile(filePath, 'utf8');
      if (raw.includes(needle)) {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  throw new Error(`파일 내용 대기 시간 초과: ${filePath} needle=${needle}`);
}

async function waitForConnectorParentPid(
  filePath: string,
  expectedParentPid: number,
  timeoutMs = 5000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const marker = await readFile(filePath, 'utf8');
      const parsed = parseConnectorPidMarker(marker);
      if (parsed.ppid === expectedParentPid) {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  throw new Error(`connector marker 대기 시간 초과: expected parent pid=${expectedParentPid}`);
}

function parseConnectorPidMarker(raw: string): { pid: number; ppid: number } {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('connector marker 형식이 객체가 아닙니다.');
  }
  if (!('pid' in parsed) || typeof parsed.pid !== 'number') {
    throw new Error('connector marker에 pid가 없습니다.');
  }
  if (!('ppid' in parsed) || typeof parsed.ppid !== 'number') {
    throw new Error('connector marker에 ppid가 없습니다.');
  }

  return {
    pid: parsed.pid,
    ppid: parsed.ppid,
  };
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
`;

const fixedSwarmInstanceKeyBundle = `
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
  prompts:
    systemPrompt: "test"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  instanceKey: "fixed-main"
  entryAgent: "Agent/bot"
  agents:
    - ref: "Agent/bot"
`;

const bundleWithoutPackage = `
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

const connectorPortBindingBundle = `
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
  config:
    LISTEN_PORT:
      valueFrom:
        env: SAMPLE_LISTEN_PORT
  secrets:
    MARKER_PATH:
      valueFrom:
        env: SAMPLE_MARKER_PATH
`;

const extensionBundle = `
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
kind: Extension
metadata:
  name: context-injector
spec:
  entry: "./ext.js"
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
  extensions:
    - ref: "Extension/context-injector"
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

const connectorSecretRefBundle = `
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
        secretRef:
          ref: "Secret/runtime-marker"
          key: "path"
`;

const connectorSource = `
import { writeFile } from 'node:fs/promises';

export default async function run(ctx) {
  const markerPath = ctx.secrets.MARKER_PATH;
  if (typeof markerPath !== 'string' || markerPath.length === 0) {
    throw new Error('MARKER_PATH secret is required');
  }

  await writeFile(markerPath, JSON.stringify({ pid: process.pid, ppid: process.ppid }) + '\\n', 'utf8');
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

const connectorPortBindingSource = `
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';

function parsePort(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('LISTEN_PORT config is required');
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('LISTEN_PORT must be a valid TCP port number');
  }

  return parsed;
}

export default async function run(ctx) {
  const markerPath = ctx.secrets.MARKER_PATH;
  if (typeof markerPath !== 'string' || markerPath.length === 0) {
    throw new Error('MARKER_PATH secret is required');
  }

  const port = parsePort(ctx.config.LISTEN_PORT);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  await writeFile(
    markerPath,
    JSON.stringify({ pid: process.pid, ppid: process.ppid, port }) + '\\n',
    'utf8',
  );
  await new Promise(() => {});
}
`;

const extensionTurnOverrideSource = `
import { writeFile } from 'node:fs/promises';

function createMessage(text, turnId) {
  return {
    id: \`ext-msg-\${Date.now()}\`,
    data: {
      role: 'assistant',
      content: text,
    },
    metadata: {},
    createdAt: new Date(),
    source: {
      type: 'extension',
      extensionName: 'context-injector',
    },
  };
}

export function register(api) {
  const markerPath = process.env.EXT_MARKER_PATH;
  if (typeof markerPath === 'string' && markerPath.length > 0) {
    void writeFile(
      markerPath,
      JSON.stringify({ phase: 'register' }) + '\\n',
      'utf8',
    );
  }

  api.pipeline.register('turn', async (ctx) => {
    if (typeof markerPath === 'string' && markerPath.length > 0) {
      const payload = {
        phase: 'turn',
        runtimeCatalog: ctx.metadata.runtimeCatalog ?? null,
      };
      await writeFile(markerPath, JSON.stringify(payload) + '\\n', 'utf8');
    }

    return {
      turnId: ctx.turnId,
      finishReason: 'text_response',
      responseMessage: createMessage('handled by extension', ctx.turnId),
    };
  });
}
`;

describe('LocalRuntimeController.startOrchestrator', () => {
  it('instance-key를 생략하면 Swarm.metadata.name 기반 키를 사용하고 동일 키 런타임을 재사용한다', async () => {
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

      const expectedKey = 'default';

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

  it('Swarm.spec.instanceKey가 있으면 해당 고정 키를 사용한다', async () => {
    const fixture = await createRuntimeFixture(fixedSwarmInstanceKeyBundle);
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

      expect(first.instanceKey).toBe('fixed-main');

      const second = await controller.startOrchestrator({
        bundlePath: fixture.bundleDir,
        watch: false,
        interactive: false,
        noInstall: false,
        stateRoot: fixture.stateRoot,
      });

      expect(second.instanceKey).toBe('fixed-main');
      expect(second.pid).toBe(first.pid);
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('goondan.yaml에 kind: Package 문서가 없으면 시작을 거부한다', async () => {
    const fixture = await createRuntimeFixture(bundleWithoutPackage);

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        ANTHROPIC_API_KEY: 'test-key',
      });

      await expect(
        controller.startOrchestrator({
          bundlePath: fixture.bundleDir,
          watch: false,
          interactive: false,
          noInstall: false,
          stateRoot: fixture.stateRoot,
        }),
      ).rejects.toThrow(/kind: Package 문서와 metadata.name이 필요합니다/);
    } finally {
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

  it('connection으로 참조된 connector entry를 child process에서 실행한다', async () => {
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
      const pidMarker = parseConnectorPidMarker(marker);
      expect(pidMarker.pid).toBeGreaterThan(0);
      expect(pidMarker.pid).not.toBe(result.pid);
      expect(pidMarker.ppid).toBe(result.pid);
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

  it('connection의 valueFrom.secretRef 값을 env 컨벤션으로 해석해 connector에 전달한다', async () => {
    const fixture = await createRuntimeFixtureWithConnector(connectorSecretRefBundle, connectorSource);
    const markerPath = path.join(fixture.rootDir, 'connector.marker');
    let startedPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        GOONDAN_SECRET_RUNTIME_MARKER_PATH: markerPath,
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
      const pidMarker = parseConnectorPidMarker(marker);
      expect(pidMarker.pid).toBeGreaterThan(0);
      expect(pidMarker.ppid).toBe(result.pid);
      expect(isProcessAlive(result.pid)).toBe(true);
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('Agent extension가 startup 시 로드되고 middleware를 등록할 수 있다', async () => {
    const fixture = await createRuntimeFixtureWithExtension(
      extensionBundle,
      extensionTurnOverrideSource,
    );
    let startedPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {});

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

      const activePath = path.join(fixture.stateRoot, 'runtime', 'active.json');
      const activeRaw = await readFile(activePath, 'utf8');
      const active: unknown = JSON.parse(activeRaw);
      if (typeof active !== 'object' || active === null || !('logs' in active) || !Array.isArray(active.logs)) {
        throw new Error('active.json logs 형식이 올바르지 않습니다.');
      }

      const firstLog = active.logs[0];
      if (typeof firstLog !== 'object' || firstLog === null || !('stdout' in firstLog)) {
        throw new Error('orchestrator stdout 로그 경로를 찾지 못했습니다.');
      }
      if (typeof firstLog.stdout !== 'string' || firstLog.stdout.length === 0) {
        throw new Error('orchestrator stdout 로그 경로가 비어 있습니다.');
      }

      await waitForFileContains(
        firstLog.stdout,
        '[extension.loader] registered context-injector',
        10_000,
      );
    } finally {
      if (startedPid && isProcessAlive(startedPid)) {
        process.kill(startedPid, 'SIGTERM');
        await waitForProcessExit(startedPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }, 15_000);


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

  it('instance restart는 포트 점유 connector가 있어도 기존 pid 종료 후 재기동한다', async () => {
    const fixture = await createRuntimeFixtureWithConnector(
      connectorPortBindingBundle,
      connectorPortBindingSource,
    );
    const markerPath = path.join(fixture.rootDir, 'connector-port.marker');
    const listenPort = await findAvailablePort();
    let runningPid: number | undefined;

    try {
      const controller = new LocalRuntimeController(fixture.bundleDir, {
        SAMPLE_MARKER_PATH: markerPath,
        SAMPLE_LISTEN_PORT: String(listenPort),
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
      await waitForConnectorParentPid(markerPath, previousPid, 10_000);

      const restarted = await controller.restart({
        instanceKey: started.instanceKey,
        fresh: false,
        stateRoot: fixture.stateRoot,
      });

      if (!restarted.pid) {
        throw new Error('restart pid가 없습니다.');
      }

      runningPid = restarted.pid;
      expect(restarted.pid).not.toBe(previousPid);
      expect(isProcessAlive(restarted.pid)).toBe(true);
      await waitForProcessExit(previousPid, 10_000);
      expect(isProcessAlive(previousPid)).toBe(false);
      await waitForConnectorParentPid(markerPath, restarted.pid, 10_000);
    } finally {
      if (runningPid && isProcessAlive(runningPid)) {
        process.kill(runningPid, 'SIGTERM');
        await waitForProcessExit(runningPid);
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }, 20_000);

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
