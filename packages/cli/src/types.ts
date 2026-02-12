export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 130;

export type OutputFormat = 'text' | 'json' | 'github';

export interface DiagnosticIssue {
  code: string;
  message: string;
  path?: string;
  resource?: string;
  field?: string;
  suggestion?: string;
  helpUrl?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: DiagnosticIssue[];
  warnings: DiagnosticIssue[];
}

export interface RuntimeStartRequest {
  bundlePath: string;
  swarm?: string;
  instanceKey?: string;
  watch: boolean;
  interactive: boolean;
  input?: string;
  inputFile?: string;
  noInstall: boolean;
  envFile?: string;
  stateRoot?: string;
}

export interface RuntimeStartResult {
  instanceKey: string;
  pid?: number;
}

export interface RuntimeRestartRequest {
  agent?: string;
  fresh: boolean;
  stateRoot?: string;
}

export interface RuntimeRestartResult {
  restarted: string[];
}

export interface InstanceRecord {
  key: string;
  agent: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListInstancesRequest {
  agent?: string;
  limit: number;
  all: boolean;
  stateRoot?: string;
}

export interface DeleteInstanceRequest {
  key: string;
  force: boolean;
  stateRoot?: string;
}

export interface PackageAddRequest {
  ref: string;
  dev: boolean;
  exact: boolean;
  registry?: string;
  bundlePath: string;
  stateRoot?: string;
}

export interface PackageAddResult {
  ref: string;
  added: boolean;
  manifestPath: string;
  resolvedVersion?: string;
}

export interface PackageInstallRequest {
  frozenLockfile: boolean;
  bundlePath: string;
  registry?: string;
  stateRoot?: string;
}

export interface PackageInstallResult {
  installed: number;
  lockfilePath?: string;
}

export interface PackagePublishRequest {
  path: string;
  tag: string;
  access: 'public' | 'restricted';
  dryRun: boolean;
  registry?: string;
  stateRoot?: string;
}

export interface PackagePublishResult {
  published: boolean;
  registryUrl: string;
  packageName: string;
  version: string;
  tag: string;
  dryRun: boolean;
}

export interface RegistryPackageMetadata {
  name: string;
  latestVersion: string;
}

export interface RegistryPublishPayload {
  packageName: string;
  version: string;
  access: 'public' | 'restricted';
  tag: string;
  path: string;
}

export interface RegistryPublishResult {
  ok: boolean;
  registryUrl: string;
}

export interface RegistryClient {
  resolvePackage(ref: string, registryUrl: string, token?: string): Promise<RegistryPackageMetadata>;
  publishPackage(
    payload: RegistryPublishPayload,
    registryUrl: string,
    token?: string,
  ): Promise<RegistryPublishResult>;
}

export interface RuntimeController {
  startOrchestrator(request: RuntimeStartRequest): Promise<RuntimeStartResult>;
  restart(request: RuntimeRestartRequest): Promise<RuntimeRestartResult>;
}

export interface BundleValidator {
  validate(pathOrFile: string, strict: boolean, fix: boolean): Promise<ValidationResult>;
}

export interface InstanceStore {
  list(request: ListInstancesRequest): Promise<InstanceRecord[]>;
  delete(request: DeleteInstanceRequest): Promise<boolean>;
}

export interface PackageService {
  addDependency(request: PackageAddRequest): Promise<PackageAddResult>;
  installDependencies(request: PackageInstallRequest): Promise<PackageInstallResult>;
  publishPackage(request: PackagePublishRequest): Promise<PackagePublishResult>;
}

export interface DoctorCheck {
  category: string;
  name: string;
  level: 'ok' | 'warn' | 'fail';
  detail: string;
  suggestion?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  errors: number;
}

export interface DoctorService {
  run(bundlePath: string, fix: boolean, stateRoot?: string): Promise<DoctorReport>;
}

export interface CliIO {
  out(message: string): void;
  err(message: string): void;
}

export interface CliDependencies {
  io: CliIO;
  env: NodeJS.ProcessEnv;
  cwd: string;
  version: string;
  runtime: RuntimeController;
  validator: BundleValidator;
  instances: InstanceStore;
  packages: PackageService;
  doctor: DoctorService;
}

export interface ParsedArguments {
  command?: string;
  subcommand?: string;
  rest: string[];
  options: Record<string, string | boolean>;
  globalOptions: Record<string, string | boolean>;
}
