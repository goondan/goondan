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
  watch: boolean;
  foreground?: boolean;
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
  completion?: Promise<ExitCode>;
}

export interface RuntimeRestartRequest {
  agent?: string;
  instanceKey?: string;
  fresh: boolean;
  stateRoot?: string;
}

export interface RuntimeRestartResult {
  restarted: string[];
  instanceKey?: string;
  pid?: number;
}

export type LogStream = 'stdout' | 'stderr' | 'both';

export interface LogReadRequest {
  instanceKey?: string;
  process: string;
  stream: LogStream;
  lines: number;
  stateRoot?: string;
}

export interface LogChunk {
  stream: 'stdout' | 'stderr';
  path: string;
  lines: string[];
}

export interface LogReadResult {
  instanceKey: string;
  process: string;
  chunks: LogChunk[];
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

export interface PackageUpdateRequest {
  exact: boolean;
  bundlePath: string;
  registry?: string;
  stateRoot?: string;
}

export interface PackageUpdateChange {
  name: string;
  previousVersion: string;
  nextVersion: string;
  resolvedVersion: string;
}

export interface PackageUpdateSkipped {
  name: string;
  version: string;
  reason: string;
}

export interface PackageUpdateResult {
  manifestPath: string;
  total: number;
  updated: number;
  changes: PackageUpdateChange[];
  skipped: PackageUpdateSkipped[];
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

export interface StudioInstanceSummary {
  key: string;
  status: string;
  agent: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioParticipant {
  id: string;
  label: string;
  kind: 'agent' | 'user' | 'assistant' | 'tool' | 'extension' | 'connector' | 'system' | 'unknown';
  lastSeenAt: string;
}

export interface StudioInteractionHistory {
  at: string;
  from: string;
  to: string;
  direction: 'a->b' | 'b->a';
  kind: string;
  detail: string;
}

export interface StudioInteraction {
  key: string;
  a: string;
  b: string;
  total: number;
  lastSeenAt: string;
  direction: 'a->b' | 'b->a' | 'undirected';
  history: StudioInteractionHistory[];
}

export interface StudioTimelineEntry {
  at: string;
  kind: 'message' | 'runtime-event' | 'connector-log';
  source: string;
  target?: string;
  subtype: string;
  detail: string;
}

export interface StudioVisualization {
  instanceKey: string;
  participants: StudioParticipant[];
  interactions: StudioInteraction[];
  timeline: StudioTimelineEntry[];
  recentEvents: StudioTimelineEntry[];
}

export interface StudioInstancesRequest {
  stateRoot?: string;
}

export interface StudioInstanceRequest {
  stateRoot?: string;
  instanceKey: string;
  maxRecentEvents?: number;
}

export interface StudioServerRequest {
  stateRoot?: string;
  port: number;
  host: string;
}

export interface StudioServerSession {
  url: string;
  close(): Promise<void>;
  closed: Promise<void>;
}

export interface StudioService {
  listInstances(request: StudioInstancesRequest): Promise<StudioInstanceSummary[]>;
  loadVisualization(request: StudioInstanceRequest): Promise<StudioVisualization>;
  startServer(request: StudioServerRequest): Promise<StudioServerSession>;
}

export interface RegistryPackageMetadata {
  name: string;
  latestVersion: string;
}

export interface RegistryVersionDist {
  tarball: string;
  shasum: string;
  integrity: string;
}

export interface RegistryPackageVersionMetadata {
  version: string;
  dependencies: Record<string, string>;
  deprecated: string;
  access: 'public' | 'restricted';
  dist: RegistryVersionDist;
}

export interface RegistryPublishAttachment {
  data: string;
  contentType?: string;
  length?: number;
}

export interface RegistryPublishPayload {
  name: string;
  version: string;
  access: 'public' | 'restricted';
  description?: string;
  dependencies?: Record<string, string>;
  deprecated?: string;
  'dist-tags'?: Record<string, string>;
  _attachments: Record<string, RegistryPublishAttachment>;
}

export interface RegistryPublishResult {
  ok: boolean;
  registryUrl: string;
}

export interface RegistryClient {
  resolvePackage(ref: string, registryUrl: string, token?: string): Promise<RegistryPackageMetadata>;
  getPackageVersion(
    packageName: string,
    version: string,
    registryUrl: string,
    token?: string,
  ): Promise<RegistryPackageVersionMetadata>;
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
  updateDependencies(request: PackageUpdateRequest): Promise<PackageUpdateResult>;
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

export interface LogService {
  read(request: LogReadRequest): Promise<LogReadResult>;
}

export type InitTemplate = 'default' | 'multi-agent' | 'package' | 'minimal';

export interface InitRequest {
  targetDir: string;
  name: string;
  template: InitTemplate;
  git: boolean;
  force: boolean;
}

export interface InitResult {
  projectDir: string;
  template: InitTemplate;
  filesCreated: string[];
  gitInitialized: boolean;
}

export interface InitService {
  init(request: InitRequest): Promise<InitResult>;
}

export interface TerminalIO {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly columns: number;
  setRawMode(enable: boolean): void;
  onData(callback: (data: Buffer) => void): void;
  offData(callback: (data: Buffer) => void): void;
  resume(): void;
  pause(): void;
  write(data: string): void;
}

export interface CliIO {
  out(message: string): void;
  err(message: string): void;
}

export interface CliDependencies {
  io: CliIO;
  terminal: TerminalIO;
  env: NodeJS.ProcessEnv;
  cwd: string;
  version: string;
  runtime: RuntimeController;
  validator: BundleValidator;
  instances: InstanceStore;
  packages: PackageService;
  doctor: DoctorService;
  logs: LogService;
  init: InitService;
  studio: StudioService;
}
