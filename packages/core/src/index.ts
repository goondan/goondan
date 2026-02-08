/**
 * Goondan Core - Agent Swarm Orchestrator
 *
 * @packageDocumentation
 */

// Types
export * from './types/index.js';

// Bundle
export * from './bundle/index.js';

// Pipeline - Export non-conflicting items only
// For full pipeline types, import directly from '@goondan/core/pipeline'
export {
  PIPELINE_POINTS,
  MUTATOR_POINTS,
  MIDDLEWARE_POINTS,
  isPipelinePoint,
  isMutatorPoint,
  isMiddlewarePoint,
  PipelineRegistry,
  PipelineExecutor,
  createPipelineApi,
} from './pipeline/index.js';

export type {
  PipelinePoint,
  MutatorPoint,
  MiddlewarePoint,
  MutatorHandler,
  MiddlewareHandler,
  MutatorOptions,
  MiddlewareOptions,
  BasePipelineContext,
  PipelineTurnContext,
  PipelineStepContext,
  PipelineToolCallContext,
  PipelineWorkspaceContext,
  PipelineLlmErrorContext,
  ContextBlock,
  SwarmInstanceRef,
  PipelineContextMap,
  ContextForPoint,
  PipelineResultMap,
  ResultForPoint,
  MutatorEntry,
  MiddlewareEntry,
  PipelineApi,
} from './pipeline/index.js';

// Tool
export * from './tool/index.js';

// Extension - Export non-conflicting items only
// For full extension types, import directly from '@goondan/core/extension'
export {
  createEventBus,
  createStateStore,
  ExtensionPipelineRegistry,
  ExtensionToolRegistry,
  createExtensionApi,
  ExtensionLoader,
} from './extension/index.js';

export type {
  // Extension API types (with Ext prefix to avoid conflicts)
  ExtPipelinePoint,
  ExtMutatorPoint,
  ExtMiddlewarePoint,
  ExtMutatorHandler,
  ExtMiddlewareHandler,
  ExtensionHandlerOptions,
  ExtensionPipelineContext,
  ExtPipelineApi,
  ExtContextForPoint,
  ExtResultForPoint,
  ExtLlmMessage,
  ExtSystemMessage,
  ExtUserMessage,
  ExtAssistantMessage,
  ExtToolMessage,
  ExtMessageAttachment,
  ExtToolCall,
  ExtToolResult,
  ExtTurnAuth,
  ExtTurn,
  ExtStep,
  ExtLlmResult,
  ExtContextBlock,
  ExtToolCatalogItem,
  ExtToolExportSpec,
  ExtEffectiveConfig,
  ExtTurnContext,
  ExtStepContext,
  ExtToolCallContext,
  ExtWorkspaceContext,
  ExtLlmErrorContext,
  ExtEventHandler,
  ExtEventBus,
  ExtToolRegistryApi,
  ExtDynamicToolDefinition,
  ExtDynamicToolHandler,
  ExtJsonSchemaProperty,
  ExtensionToolContext,
  ExtensionSwarmBundleApi,
  ExtensionOpenChangesetInput,
  ExtensionOpenChangesetResult,
  ExtensionCommitChangesetInput,
  ExtensionCommitChangesetResult,
  ExtensionLiveConfigApi,
  ExtensionLiveConfigPatch,
  ExtensionJsonPatchOperation,
  ExtensionOAuthApi,
  ExtensionOAuthTokenRequest,
  ExtensionOAuthTokenResult,
  ExtensionOAuthTokenReady,
  ExtensionOAuthTokenAuthorizationRequired,
  ExtensionOAuthTokenError,
  // Non-conflicting types
  ExtensionApi,
  RegisterFunction,
  StateStore,
  ExtensionLoadResult,
  CreateExtensionApiOptions,
  ExtensionLoaderOptions,
  ExtensionResolverFn,
} from './extension/index.js';

// Changeset - Export non-conflicting items only
// For full changeset types, import directly from '@goondan/core/changeset'
export {
  parseSwarmBundleRef,
  formatSwarmBundleRef,
  matchGlob,
  matchAnyPattern,
  validateChangesetPolicy,
  execGit,
  getHeadCommitSha,
  isGitRepository,
  parseGitStatus,
  categorizeChangedFiles,
  createWorktree,
  removeWorktree,
  SwarmBundleManagerImpl,
  createSwarmBundleApi,
} from './changeset/index.js';

export type {
  SwarmBundleRef,
  ParsedSwarmBundleRef,
  OpenChangesetInput,
  OpenChangesetResult,
  OpenChangesetHint,
  CommitChangesetInput,
  CommitChangesetResult,
  CommitSummary,
  CommitError,
  ChangesetPolicy,
  PolicyValidationResult,
  GitStatusCode,
  GitStatusEntry,
  SwarmBundleManager,
  SwarmBundleApi,
  RevisionChangedEvent,
  ChangesetEventRecord,
  SwarmBundleManagerOptions,
} from './changeset/index.js';

// Connector - Export non-conflicting items only
// For full connector types, import directly from '@goondan/core/connector'
export {
  // Ingress
  matchIngressRule,
  routeEvent,
  IngressMatcher,
  // Entry Function loading
  createConnectorContext,
  loadConnectorEntry,
  validateConnectorEntry,
} from './connector/index.js';

export type {
  // Connector runtime types
  ConnectorEntryFunction,
  ConnectorContext,
  ConnectorTriggerEvent,
  ConnectorEvent,
  ConnectorEventMessage,
  TriggerPayload,
  HttpTriggerPayload,
  CronTriggerPayload,
  CliTriggerPayload,
  CustomTriggerPayload,
  OAuthTokenRequest as ConnectorOAuthTokenRequest,
  OAuthTokenResult as ConnectorOAuthTokenResult,
  // Options types
  CreateConnectorContextOptions,
  ValidateEntryResult,
} from './connector/index.js';

// Workspace
export * from './workspace/index.js';

// Runtime - Export non-conflicting items only
// For full runtime types, import directly from '@goondan/core/runtime'
export {
  // Types - Type guards and factories
  isLlmSystemMessage,
  isLlmUserMessage,
  isLlmAssistantMessage,
  isLlmToolMessage,
  createToolCall,
  createToolResult,
  createAgentEvent,
  // SwarmInstance
  createSwarmInstance,
  createSwarmInstanceManager,
  // AgentInstance
  createAgentInstance,
  createAgentEventQueue,
  // Turn
  createTurn,
  createTurnRunner,
  // Step
  createStep,
  createStepRunner,
  // EffectiveConfig
  createEffectiveConfigLoader,
  normalizeByIdentity,
  // MessageBuilder
  createMessageBuilder,
  buildLlmMessages,
} from './runtime/index.js';

export type {
  // Instance types (using Runtime prefix to avoid conflicts)
  SwarmInstance as RuntimeSwarmInstance,
  SwarmInstanceManager,
  AgentInstance,
  AgentEventQueue,
  // Turn/Step types
  Turn,
  TurnContext,
  TurnRunner,
  TurnRunnerOptions,
  Step,
  StepContext,
  StepRunner,
  StepRunnerOptions,
  LlmCaller,
  ToolExecutor as RuntimeToolExecutor,
  // Config
  EffectiveConfig,
  EffectiveConfigLoader,
  BundleLoader,
  // MessageBuilder
  MessageBuilder,
  // Status types (using Runtime prefix)
  SwarmInstanceStatus,
  AgentInstanceStatus,
  TurnStatus,
  StepStatus,
  AgentEventType,
  // Message types (using Runtime prefix)
  LlmMessage as RuntimeLlmMessage,
  LlmSystemMessage,
  LlmUserMessage,
  LlmAssistantMessage,
  LlmToolMessage,
  LlmResult,
  // Event/Auth types (using Runtime prefix)
  TurnOrigin,
  AgentEvent,
  // ToolCall/ToolResult defined in tool module, so skip
  ContextBlock as RuntimeContextBlock,
} from './runtime/index.js';

// OAuth - Export non-conflicting items only
// For full OAuth types, import directly from '@goondan/core/oauth'
export {
  // PKCE
  generatePKCE,
  verifyPKCE,
  // Subject
  resolveSubject,
  // Store
  createOAuthStore,
  generateGrantId,
  // Token
  isTokenValid,
  needsRefresh,
  createRefreshManager,
  // Authorization
  generateState,
  parseState,
  buildAuthorizationUrl,
  validateScopes,
  // API
  createOAuthManager,
} from './oauth/index.js';

export type {
  // Store
  OAuthStore,
  // Token
  RefreshManager,
  RefreshFn,
  // API
  OAuthManager,
  ConfigLoader,
  OAuthManagerDependencies,
  // Types (non-conflicting)
  OAuthApi,
  OAuthTokenReady,
  OAuthTokenAuthorizationRequired,
  OAuthTokenError,
  TurnAuthActor,
  TurnAuthSubjects,
  EncryptedValue,
  EncryptionService,
  OAuthGrantRecord,
  OAuthGrantSpec,
  OAuthGrantToken,
  AuthSessionRecord,
  AuthSessionSpec,
  AuthSessionFlow,
  ResumeInfo,
  PKCEChallenge,
  StatePayload,
  CallbackParams,
  TokenResponse,
  OAuthErrorCode,
} from './oauth/index.js';
