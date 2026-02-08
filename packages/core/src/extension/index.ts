/**
 * Extension 시스템 모듈
 * @see /docs/specs/extension.md
 */

// Types - Export Extension-specific types only (avoid conflicts with pipeline and tool modules)
export type {
  // Extension-specific Pipeline Types (aliased to avoid conflicts)
  PipelinePoint as ExtPipelinePoint,
  MutatorPoint as ExtMutatorPoint,
  MiddlewarePoint as ExtMiddlewarePoint,
  MutatorHandler as ExtMutatorHandler,
  MiddlewareHandler as ExtMiddlewareHandler,
  HandlerOptions as ExtensionHandlerOptions,
  PipelineContext as ExtensionPipelineContext,
  PipelineApi as ExtPipelineApi,
  ContextForPoint as ExtContextForPoint,
  ResultForPoint as ExtResultForPoint,

  // Context Types (Extension-specific naming to avoid conflicts)
  LlmMessage as ExtLlmMessage,
  SystemMessage as ExtSystemMessage,
  UserMessage as ExtUserMessage,
  AssistantMessage as ExtAssistantMessage,
  ToolMessage as ExtToolMessage,
  MessageAttachment as ExtMessageAttachment,
  ToolCall as ExtToolCall,
  ToolResult as ExtToolResult,
  TurnAuth as ExtTurnAuth,
  Turn as ExtTurn,
  Step as ExtStep,
  LlmResult as ExtLlmResult,
  ContextBlock as ExtContextBlock,
  ToolCatalogItem as ExtToolCatalogItem,
  ToolExportSpec as ExtToolExportSpec,
  EffectiveConfig as ExtEffectiveConfig,
  MessageEvent as ExtMessageEvent,
  TurnContext as ExtTurnContext,
  StepContext as ExtStepContext,
  LlmInputContext as ExtLlmInputContext,
  ToolCallContext as ExtToolCallContext,
  WorkspaceContext as ExtWorkspaceContext,
  LlmErrorContext as ExtLlmErrorContext,

  // API Types (aliased to avoid conflicts with tool module)
  EventHandler as ExtEventHandler,
  EventBus as ExtEventBus,
  ToolRegistryApi as ExtToolRegistryApi,
  DynamicToolDefinition as ExtDynamicToolDefinition,
  DynamicToolHandler as ExtDynamicToolHandler,
  JsonSchemaProperty as ExtJsonSchemaProperty,
  ToolContext as ExtensionToolContext,
  SwarmBundleApi as ExtensionSwarmBundleApi,
  OpenChangesetInput as ExtensionOpenChangesetInput,
  OpenChangesetResult as ExtensionOpenChangesetResult,
  CommitChangesetInput as ExtensionCommitChangesetInput,
  CommitChangesetResult as ExtensionCommitChangesetResult,
  LiveConfigApi as ExtensionLiveConfigApi,
  LiveConfigPatch as ExtensionLiveConfigPatch,
  JsonPatchOperation as ExtensionJsonPatchOperation,
  OAuthApi as ExtensionOAuthApi,
  OAuthTokenRequest as ExtensionOAuthTokenRequest,
  OAuthTokenResult as ExtensionOAuthTokenResult,
  OAuthTokenReady as ExtensionOAuthTokenReady,
  OAuthTokenAuthorizationRequired as ExtensionOAuthTokenAuthorizationRequired,
  OAuthTokenError as ExtensionOAuthTokenError,

  // ExtensionApi
  ExtensionApi,
  RegisterFunction,

  // State Store Types
  CreateStateStoreOptions,
  StateStorePersistence,
  StateStore,

  // Loader Types
  ExtensionLoadResult,
} from './types.js';

// Implementations
export { createEventBus } from './event-bus.js';
export { createStateStore } from './state-store.js';
export { PipelineRegistry as ExtensionPipelineRegistry } from './pipeline-registry.js';
export { ToolRegistry as ExtensionToolRegistry } from './tool-registry.js';
export { createExtensionApi } from './api.js';
export type { CreateExtensionApiOptions } from './api.js';
export { ExtensionLoader } from './loader.js';
export type { ExtensionLoaderOptions, ExtensionResolverFn } from './loader.js';
