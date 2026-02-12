import { vi } from 'vitest';
import type {
  BundleValidator,
  CliDependencies,
  DeleteInstanceRequest,
  DiagnosticIssue,
  DoctorReport,
  InstanceRecord,
  ListInstancesRequest,
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
  ValidationResult,
} from '../src/types.js';

export interface MockState {
  outs: string[];
  errs: string[];
  runRequests: RuntimeStartRequest[];
  restartRequests: RuntimeRestartRequest[];
  listRequests: ListInstancesRequest[];
  deleteRequests: DeleteInstanceRequest[];
  addRequests: PackageAddRequest[];
  installRequests: PackageInstallRequest[];
  publishRequests: PackagePublishRequest[];
}

export interface MockOverrides {
  cwd?: string;
  version?: string;
  env?: NodeJS.ProcessEnv;
  validateResult?: ValidationResult;
  startResult?: RuntimeStartResult;
  restartResult?: RuntimeRestartResult;
  listResult?: InstanceRecord[];
  deleteResult?: boolean;
  addResult?: PackageAddResult;
  installResult?: PackageInstallResult;
  publishResult?: PackagePublishResult;
  doctorResult?: DoctorReport;
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
    runRequests: [],
    restartRequests: [],
    listRequests: [],
    deleteRequests: [],
    addRequests: [],
    installRequests: [],
    publishRequests: [],
  };

  const validateResult = overrides?.validateResult ?? defaultValidation();

  const validator: BundleValidator = {
    validate: vi.fn(async (): Promise<ValidationResult> => validateResult),
  };

  const deps: CliDependencies = {
    io: {
      out(message: string): void {
        state.outs.push(message);
      },
      err(message: string): void {
        state.errs.push(message);
      },
    },
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
