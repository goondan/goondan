import { vi } from 'vitest';
import type {
  BundleValidator,
  CliDependencies,
  DeleteInstanceRequest,
  DiagnosticIssue,
  DoctorReport,
  InitRequest,
  InitResult,
  InstanceRecord,
  ListInstancesRequest,
  LogReadRequest,
  LogReadResult,
  PackageAddRequest,
  PackageAddResult,
  PackageInstallRequest,
  PackageInstallResult,
  PackagePublishRequest,
  PackagePublishResult,
  RuntimeRestartRequest,
  RuntimeRestartResult,
  RuntimeStartRequest,
  RuntimeStartResult,
  StudioInstanceRequest,
  StudioInstancesRequest,
  StudioServerRequest,
  StudioServerSession,
  StudioVisualization,
  TerminalIO,
  ValidationResult,
} from '../src/types.js';

export interface MockState {
  outs: string[];
  errs: string[];
  initRequests: InitRequest[];
  runRequests: RuntimeStartRequest[];
  restartRequests: RuntimeRestartRequest[];
  listRequests: ListInstancesRequest[];
  logRequests: LogReadRequest[];
  deleteRequests: DeleteInstanceRequest[];
  addRequests: PackageAddRequest[];
  installRequests: PackageInstallRequest[];
  publishRequests: PackagePublishRequest[];
  studioListRequests: StudioInstancesRequest[];
  studioVisualizationRequests: StudioInstanceRequest[];
  studioServerRequests: StudioServerRequest[];
}

export interface MockTerminalState {
  writes: string[];
  rawMode: boolean;
  dataListeners: Array<(data: Buffer) => void>;
}

export function createMockTerminal(isTTY = true): { terminal: TerminalIO; state: MockTerminalState } {
  const state: MockTerminalState = {
    writes: [],
    rawMode: false,
    dataListeners: [],
  };

  const terminal: TerminalIO = {
    stdinIsTTY: isTTY,
    stdoutIsTTY: isTTY,
    columns: 80,
    setRawMode(enable: boolean): void {
      state.rawMode = enable;
    },
    onData(cb: (data: Buffer) => void): void {
      state.dataListeners.push(cb);
    },
    offData(cb: (data: Buffer) => void): void {
      const idx = state.dataListeners.indexOf(cb);
      if (idx >= 0) {
        state.dataListeners.splice(idx, 1);
      }
    },
    resume(): void {
      // no-op in mock
    },
    pause(): void {
      // no-op in mock
    },
    write(data: string): void {
      state.writes.push(data);
    },
  };

  return { terminal, state };
}

export function simulateKey(mockState: MockTerminalState, key: string): void {
  const buf = Buffer.from(key, 'utf8');
  for (const listener of [...mockState.dataListeners]) {
    listener(buf);
  }
}

export interface MockOverrides {
  cwd?: string;
  version?: string;
  env?: NodeJS.ProcessEnv;
  terminal?: TerminalIO;
  validateResult?: ValidationResult;
  startResult?: RuntimeStartResult;
  restartResult?: RuntimeRestartResult;
  listResult?: InstanceRecord[];
  deleteResult?: boolean;
  addResult?: PackageAddResult;
  installResult?: PackageInstallResult;
  publishResult?: PackagePublishResult;
  doctorResult?: DoctorReport;
  logResult?: LogReadResult;
  initResult?: InitResult;
  studioListResult?: { key: string; status: string; agent: string; createdAt: string; updatedAt: string }[];
  studioVisualizationResult?: StudioVisualization;
  studioServerResult?: StudioServerSession;
}

function defaultValidation(): ValidationResult {
  return {
    valid: true,
    errors: [],
    warnings: [],
  };
}

function defaultDoctor(): DoctorReport {
  return {
    checks: [],
    passed: 0,
    warnings: 0,
    errors: 0,
  };
}

export function createMockDeps(overrides?: MockOverrides): { deps: CliDependencies; state: MockState } {
  const state: MockState = {
    outs: [],
    errs: [],
    initRequests: [],
    runRequests: [],
    restartRequests: [],
    listRequests: [],
    logRequests: [],
    deleteRequests: [],
    addRequests: [],
    installRequests: [],
    publishRequests: [],
    studioListRequests: [],
    studioVisualizationRequests: [],
    studioServerRequests: [],
  };

  const validateResult = overrides?.validateResult ?? defaultValidation();

  const validator: BundleValidator = {
    validate: vi.fn(async (): Promise<ValidationResult> => validateResult),
  };

  const defaultTerminal = createMockTerminal(false).terminal;

  const deps: CliDependencies = {
    io: {
      out(message: string): void {
        state.outs.push(message);
      },
      err(message: string): void {
        state.errs.push(message);
      },
    },
    terminal: overrides?.terminal ?? defaultTerminal,
    env: overrides?.env ?? {},
    cwd: overrides?.cwd ?? '/tmp/project',
    version: overrides?.version ?? '2.0.0',
    runtime: {
      startOrchestrator: vi.fn(async (request: RuntimeStartRequest): Promise<RuntimeStartResult> => {
        state.runRequests.push(request);
        return (
          overrides?.startResult ?? {
            instanceKey: 'instance-1',
            pid: 1234,
          }
        );
      }),
      restart: vi.fn(async (request: RuntimeRestartRequest): Promise<RuntimeRestartResult> => {
        state.restartRequests.push(request);
        return (
          overrides?.restartResult ?? {
            restarted: ['all'],
          }
        );
      }),
    },
    validator,
    instances: {
      list: vi.fn(async (request: ListInstancesRequest): Promise<InstanceRecord[]> => {
        state.listRequests.push(request);
        return overrides?.listResult ?? [];
      }),
      delete: vi.fn(async (request: DeleteInstanceRequest): Promise<boolean> => {
        state.deleteRequests.push(request);
        return overrides?.deleteResult ?? true;
      }),
    },
    packages: {
      addDependency: vi.fn(async (request: PackageAddRequest): Promise<PackageAddResult> => {
        state.addRequests.push(request);
        return (
          overrides?.addResult ?? {
            ref: request.ref,
            added: true,
            manifestPath: '/tmp/project/goondan.yaml',
            resolvedVersion: '1.0.0',
          }
        );
      }),
      installDependencies: vi.fn(async (request: PackageInstallRequest): Promise<PackageInstallResult> => {
        state.installRequests.push(request);
        return (
          overrides?.installResult ?? {
            installed: 1,
            lockfilePath: '/tmp/project/goondan.lock.yaml',
          }
        );
      }),
      publishPackage: vi.fn(async (request: PackagePublishRequest): Promise<PackagePublishResult> => {
        state.publishRequests.push(request);
        return (
          overrides?.publishResult ?? {
            published: true,
            registryUrl: 'https://registry.goondan.ai',
            packageName: '@goondan/test',
            version: '1.2.3',
            tag: request.tag,
            dryRun: request.dryRun,
          }
        );
      }),
    },
    doctor: {
      run: vi.fn(async (): Promise<DoctorReport> => overrides?.doctorResult ?? defaultDoctor()),
    },
    logs: {
      read: vi.fn(async (request: LogReadRequest): Promise<LogReadResult> => {
        state.logRequests.push(request);
        return (
          overrides?.logResult ?? {
            instanceKey: request.instanceKey ?? 'instance-1',
            process: request.process,
            chunks: [
              {
                stream: 'stdout',
                path: '/tmp/goondan/runtime/logs/instance-1/orchestrator.stdout.log',
                lines: ['[default] log line'],
              },
            ],
          }
        );
      }),
    },
    init: {
      init: vi.fn(async (request: InitRequest): Promise<InitResult> => {
        state.initRequests.push(request);
        return (
          overrides?.initResult ?? {
            projectDir: request.targetDir,
            template: request.template,
            filesCreated: ['goondan.yaml', '.env', '.gitignore'],
            gitInitialized: request.git,
          }
        );
      }),
    },
    studio: {
      listInstances: vi.fn(async (request: StudioInstancesRequest) => {
        state.studioListRequests.push(request);
        return overrides?.studioListResult ?? [];
      }),
      loadVisualization: vi.fn(async (request: StudioInstanceRequest): Promise<StudioVisualization> => {
        state.studioVisualizationRequests.push(request);
        return (
          overrides?.studioVisualizationResult ?? {
            instanceKey: request.instanceKey,
            participants: [],
            interactions: [],
            timeline: [],
            recentEvents: [],
          }
        );
      }),
      startServer: vi.fn(async (request: StudioServerRequest): Promise<StudioServerSession> => {
        state.studioServerRequests.push(request);
        return (
          overrides?.studioServerResult ?? {
            url: `http://${request.host}:${String(request.port)}`,
            async close(): Promise<void> {
              return;
            },
            closed: Promise.resolve(),
          }
        );
      }),
    },
  };

  return { deps, state };
}

export function issue(code: string, message: string, extra?: Partial<DiagnosticIssue>): DiagnosticIssue {
  return {
    code,
    message,
    ...extra,
  };
}
