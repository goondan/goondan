/**
 * Goondan Runtime Module
 *
 * Runtime 실행 모델 (SwarmInstance, AgentInstance, Turn, Step)
 * @see /docs/specs/runtime.md
 */

// Types
export type {
  SwarmBundleRef,
  SwarmInstanceStatus,
  AgentInstanceStatus,
  TurnStatus,
  StepStatus,
  AgentEventType,
  TurnOrigin,
  TurnAuth,
  LlmMessage,
  LlmSystemMessage,
  LlmUserMessage,
  LlmAssistantMessage,
  LlmToolMessage,
  MessageAttachment,
  LlmResult,
  ToolCall,
  ToolResult,
  ContextBlock,
  ToolCatalogItem,
  AgentEvent,
  MessageEvent,
  SystemMessageEvent,
  LlmMessageEvent,
  ReplaceEvent,
  RemoveEvent,
  TruncateEvent,
  TurnMessageState,
  TokenUsage,
  StepMetrics,
  TurnMetrics,
  RuntimeLogEntry,
  HealthCheckResult,
  InstanceGcPolicy,
} from './types.js';

export {
  isLlmSystemMessage,
  isLlmUserMessage,
  isLlmAssistantMessage,
  isLlmToolMessage,
  isSystemMessageEvent,
  isLlmMessageEvent,
  isReplaceMessageEvent,
  isRemoveMessageEvent,
  isTruncateMessageEvent,
  computeNextMessages,
  createTurnMessageState,
  maskSensitiveValue,
  isSensitiveKey,
  maskSensitiveFields,
  createToolCall,
  createToolResult,
  createAgentEvent,
} from './types.js';

// SwarmInstance
export type {
  SwarmInstance,
  SwarmInstanceManager,
  SwarmInstanceInfo,
  InstanceMetadataStatus,
  SwarmInstanceLifecycleHooks,
  SwarmInstanceManagerOptions,
} from './swarm-instance.js';
export { createSwarmInstance, createSwarmInstanceManager, toSwarmInstanceInfo } from './swarm-instance.js';

// AgentInstance
export type { AgentInstance, AgentEventQueue } from './agent-instance.js';
export { createAgentInstance, createAgentEventQueue } from './agent-instance.js';

// Turn
export type {
  Turn,
  TurnContext,
  TurnRunner,
  TurnRunnerOptions,
  TurnMessageEventType,
  PersistedToolCall,
  PersistedLlmMessage,
  TurnMessageBaseLogger,
  TurnMessageEventLogger,
  TurnMessageStateLogger,
  TurnMessageStateRecoverySnapshot,
} from './turn-runner.js';
export { createTurn, createTurnRunner } from './turn-runner.js';

// Runtime persistence wiring
export type {
  RuntimePersistenceWorkspaceAdapter,
  RuntimePersistenceBindings,
} from './persistence.js';
export { createRuntimePersistenceBindings } from './persistence.js';

// Step
export type {
  Step,
  StepContext,
  StepRunner,
  StepRunnerOptions,
  LlmCaller,
  ToolExecutor,
  RuntimePipelineExecutor,
} from './step-runner.js';
export { createStep, createStepRunner } from './step-runner.js';

// EffectiveConfig
export type {
  EffectiveConfig,
  EffectiveConfigLoader,
  BundleLoader,
} from './effective-config.js';
export { createEffectiveConfigLoader, normalizeByIdentity } from './effective-config.js';

// MessageBuilder
export type { MessageBuilder } from './message-builder.js';
export { createMessageBuilder, buildLlmMessages } from './message-builder.js';
