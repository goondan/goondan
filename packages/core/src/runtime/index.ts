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
  LlmResult,
  ToolCall,
  ToolResult,
  ContextBlock,
  ToolCatalogItem,
  AgentEvent,
} from './types.js';

export {
  isLlmSystemMessage,
  isLlmUserMessage,
  isLlmAssistantMessage,
  isLlmToolMessage,
  createToolCall,
  createToolResult,
  createAgentEvent,
} from './types.js';

// SwarmInstance
export type { SwarmInstance, SwarmInstanceManager } from './swarm-instance.js';
export { createSwarmInstance, createSwarmInstanceManager } from './swarm-instance.js';

// AgentInstance
export type { AgentInstance, AgentEventQueue } from './agent-instance.js';
export { createAgentInstance, createAgentEventQueue } from './agent-instance.js';

// Turn
export type { Turn, TurnContext, TurnRunner, TurnRunnerOptions } from './turn-runner.js';
export { createTurn, createTurnRunner } from './turn-runner.js';

// Step
export type {
  Step,
  StepContext,
  StepRunner,
  StepRunnerOptions,
  LlmCaller,
  ToolExecutor,
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
