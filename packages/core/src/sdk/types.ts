export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[] | undefined;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type UnknownObject = object;

export interface ObjectRef extends JsonObject {
  apiVersion?: string;
  kind?: string;
  name?: string;
}

export type ObjectRefLike = ObjectRef | string;

export interface ValueSource {
  value?: string;
  valueFrom?: {
    env?: string;
    secretRef?: { ref: string; key: string };
  };
}

export interface ResourceMeta {
  name: string;
  labels?: JsonObject;
}

export interface Resource<TSpec = JsonObject> {
  apiVersion?: string;
  kind: string;
  metadata: ResourceMeta;
  spec?: TSpec;
}

export interface ModelSpec {
  provider: string;
  name: string;
  endpoint?: string;
  options?: JsonObject;
}

export interface ToolExportSpec {
  name: string;
  description?: string;
  parameters?: JsonObject;
  handler?: string;
  auth?: { scopes?: string[] };
}

export interface ToolSpec {
  runtime?: string;
  entry: string;
  errorMessageLimit?: number;
  auth?: { oauthAppRef: ObjectRefLike; scopes?: string[] };
  exports: ToolExportSpec[];
}

export interface ToolCatalogItem {
  name: string;
  description?: string;
  parameters?: JsonObject;
  tool?: Resource<ToolSpec> | null;
  export?: ToolExportSpec | null;
  source?: JsonObject;
}

export interface ExtensionSpec<TConfig = JsonObject> {
  runtime?: string;
  entry: string;
  config?: TConfig;
}

export interface HookSpec {
  point: PipelinePoint;
  priority?: number;
  action: { toolCall: { tool: string; input?: JsonObject } };
}

export interface AgentSpec {
  modelConfig?: { modelRef: ObjectRefLike; params?: JsonObject };
  prompts?: { systemRef?: string; system?: string };
  tools?: Array<ObjectRefLike | SelectorBlock>;
  extensions?: Array<ObjectRefLike | SelectorBlock>;
  mcpServers?: Array<ObjectRefLike | SelectorBlock>;
  hooks?: HookSpec[];
  liveConfig?: { allowedPaths?: { agentRelative?: string[] } };
}

export interface SwarmSpec {
  entrypoint: ObjectRefLike;
  agents: ObjectRefLike[];
  policy?: {
    maxStepsPerTurn?: number;
    liveConfig?: {
      enabled?: boolean;
      store?: { instanceStateDir?: string };
      applyAt?: string[];
      allowedPaths?: { agentRelative?: string[]; swarmAbsolute?: string[] };
      emitConfigChangedEvent?: boolean;
    };
  };
}

export interface ConnectorSpec {
  type: string;
  auth?: { oauthAppRef?: ObjectRefLike; staticToken?: ValueSource };
  ingress?: Array<JsonObject>;
  egress?: { updatePolicy?: { mode?: string; debounceMs?: number } };
}

export interface OAuthAppSpec {
  provider: string;
  flow: 'authorizationCode' | 'deviceCode';
  subjectMode: 'global' | 'user';
  client?: { clientId?: ValueSource; clientSecret?: ValueSource };
  endpoints?: { authorizationUrl?: string; tokenUrl?: string; deviceAuthorizationUrl?: string };
  scopes?: string[];
  redirect?: { callbackPath?: string };
  options?: JsonObject;
}

export interface MCPServerSpec {
  transport: { type: 'stdio' | 'http'; command?: string[]; url?: string };
  attach?: { mode?: 'stateful' | 'stateless'; scope?: 'instance' | 'agent' };
  expose?: { tools?: boolean; resources?: boolean; prompts?: boolean };
}

export interface SelectorBlock {
  selector: { kind?: string; name?: string; matchLabels?: JsonObject };
  overrides?: JsonObject;
}

export type PipelinePoint =
  | 'turn.pre'
  | 'turn.post'
  | 'step.pre'
  | 'step.config'
  | 'step.tools'
  | 'step.blocks'
  | 'step.llmCall'
  | 'step.llmError'
  | 'step.post'
  | 'toolCall.pre'
  | 'toolCall.exec'
  | 'toolCall.post'
  | 'workspace.repoAvailable'
  | 'workspace.worktreeMounted';

export interface Block {
  type: string;
  content?: string;
  items?: JsonValue[];
}

export interface ToolCall extends JsonObject {
  id?: string;
  name: string;
  input?: JsonObject;
}

export interface ToolResult extends JsonObject {
  id: string;
  name: string;
  input?: JsonObject;
  output: JsonValue;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
}

export interface LlmResult {
  content?: string;
  toolCalls?: ToolCall[];
  meta?: { usage?: LlmUsage } & UnknownObject;
}

export interface ErrorInfo extends JsonObject {
  message: string;
  name?: string;
  code?: string;
}

export interface Turn {
  id: string;
  input: string;
  origin: JsonObject;
  auth: JsonObject;
  summary: string | null;
  toolResults: ToolResult[];
  metadata: JsonObject;
}

export interface Step {
  id: string;
  index: number;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  llmResult: LlmResult | null;
}

export interface StepContext {
  instance: unknown;
  swarm: Resource;
  agent: Resource;
  turn: Turn;
  step: Step | null;
  effectiveConfig?: EffectiveConfig | null;
  toolCatalog?: ToolCatalogItem[];
  blocks?: Block[];
  llmResult?: LlmResult | null;
  llmError?: ErrorInfo | null;
  toolCall?: ToolCall;
  toolResult?: JsonValue;
}

export interface PipelineApi<Ctx> {
  mutate: (point: PipelinePoint, fn: (ctx: Ctx) => Promise<Ctx | void> | Ctx | void) => void;
  wrap: <R = Ctx>(point: PipelinePoint, fn: (next: (ctx: Ctx) => Promise<R>) => (ctx: Ctx) => Promise<R>) => void;
}

export interface LiveConfigApi {
  proposePatch: (proposal: LiveConfigPatchProposal) => Promise<LivePatch> | LivePatch;
}

export interface ToolContext {
  instance: unknown;
  swarm: Resource;
  agent: Resource;
  turn: Turn;
  step: Step;
  toolCatalog: ToolCatalogItem[];
  liveConfig: LiveConfigApi;
  oauth: { getAccessToken: (request: { oauthAppRef: ObjectRefLike; scopes?: string[]; minTtlSeconds?: number }) => Promise<OAuthTokenResult> };
  events: EventBus;
  logger: Console;
}

export type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;

export interface ExtensionApi<State = UnknownObject, Config = JsonObject> {
  extension: Resource<ExtensionSpec<Config>>;
  pipelines: PipelineApi<StepContext>;
  tools: { register: (toolDef: DynamicToolDefinition) => void };
  events: EventBus;
  liveConfig: LiveConfigApi;
  extState: () => State;
}

export interface DynamicToolDefinition {
  name: string;
  handler: ToolHandler;
  tool?: Resource<ToolSpec> | null;
  definition?: ToolExportSpec;
}

export interface EventBus {
  emit: (event: string, payload: UnknownObject) => void;
  on?: (event: string, handler: (payload: UnknownObject) => void) => void;
  off?: (event: string, handler: (payload: UnknownObject) => void) => void;
}

export interface EffectiveConfig {
  swarm: Resource;
  agent: Resource;
  revision: number;
}

export interface LiveConfigPatchOp {
  op: string;
  path: string;
  from?: string;
  value?: JsonValue;
}

export interface LiveConfigPatchSpec {
  type: 'json6902';
  ops: LiveConfigPatchOp[];
}

export interface LiveConfigPatchProposal {
  scope: 'agent' | 'swarm';
  target?: ObjectRef;
  applyAt: PipelinePoint | string;
  patch: LiveConfigPatchSpec;
  source?: { type: 'tool' | 'extension' | 'sidecar' | 'system'; name?: string };
  reason?: string;
}

export interface LivePatch {
  apiVersion?: string;
  kind: 'LivePatch';
  metadata: { name: string };
  spec: LiveConfigPatchProposal & { recordedAt: string };
}

export interface LivePatchStatus {
  patchName: string;
  agentName: string;
  result: 'applied' | 'pending' | 'rejected' | 'failed';
  evaluatedAt: string;
  appliedAt?: string;
  effectiveRevision?: number;
  appliedInStepId?: string;
  reason?: string;
}

export interface LiveConfigCursor {
  version?: number;
  patchLog?: {
    format?: string;
    lastReadOffsetBytes?: number;
    lastEvaluatedPatchName?: string;
    lastAppliedPatchName?: string;
  };
  swarmPatchLog?: {
    format?: string;
    lastReadOffsetBytes?: number;
    lastEvaluatedPatchName?: string;
    lastAppliedPatchName?: string;
  };
  effective?: {
    revision?: number;
    lastAppliedAt?: string;
  };
}

export interface OAuthTokenReady extends JsonObject {
  status: 'ready';
  accessToken: string;
  tokenType?: string;
  expiresAt?: string;
  scopes?: string[];
}

export interface OAuthTokenAuthorizationRequired extends JsonObject {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
  message: string;
}

export interface OAuthTokenError extends JsonObject {
  status: 'error';
  error: { code: string; message: string };
}

export type OAuthTokenResult = OAuthTokenReady | OAuthTokenAuthorizationRequired | OAuthTokenError;

export interface AuthResumePayload extends JsonObject {
  swarmRef: ObjectRefLike;
  instanceKey: string;
  agentName?: string;
  origin?: JsonObject;
  auth?: JsonObject;
}

export interface BundleManifest {
  apiVersion?: string;
  kind: 'Bundle';
  metadata: ResourceMeta;
  spec: {
    version?: string;
    dependencies?: string[];
    include: string[];
  };
}

export interface BundleRegistration {
  name: string;
  path: string;
  enabled?: boolean;
  fingerprint?: string;
  updatedAt?: string;
  source?: {
    type: 'npm' | 'git';
    name?: string;
    version?: string;
    registry?: string;
    host?: string;
    org?: string;
    repo?: string;
    path?: string;
    ref?: string;
    url?: string;
    commit?: string;
    spec?: string;
  };
}

export interface BundleLockfile {
  generatedAt: string;
  bundles: Array<Required<Pick<BundleRegistration, 'name' | 'path' | 'fingerprint'>> & { enabled?: boolean }>;
}
