/**
 * Goondan Pipeline System
 *
 * 파이프라인은 Goondan Runtime의 실행 라이프사이클에서 Extension이 개입할 수 있는 표준 확장 지점입니다.
 * 파이프라인을 통해 확장은 도구 카탈로그 조작, 컨텍스트 블록 주입, LLM 호출 래핑, 도구 실행 제어 등을 수행할 수 있습니다.
 *
 * @packageDocumentation
 * @see /docs/specs/pipeline.md
 */

// Types
export type {
  PipelinePoint,
  MutatorPoint,
  MiddlewarePoint,
  MutatorHandler,
  MiddlewareHandler,
  MutatorOptions,
  MiddlewareOptions,
} from './types.js';

export {
  PIPELINE_POINTS,
  MUTATOR_POINTS,
  MIDDLEWARE_POINTS,
  isPipelinePoint,
  isMutatorPoint,
  isMiddlewarePoint,
} from './types.js';

// Context - Export with Pipeline prefix to avoid conflicts
export type {
  BasePipelineContext,
  TurnContext as PipelineTurnContext,
  StepContext as PipelineStepContext,
  ToolCallContext as PipelineToolCallContext,
  WorkspaceContext as PipelineWorkspaceContext,
  LlmErrorContext as PipelineLlmErrorContext,
  Turn as PipelineTurn,
  Step as PipelineStep,
  TurnAuth as PipelineTurnAuth,
  ToolCall as PipelineToolCall,
  ToolResult as PipelineToolResult,
  LlmResult as PipelineLlmResult,
  ToolCatalogItem as PipelineToolCatalogItem,
  ContextBlock,
  LlmMessage as PipelineLlmMessage,
  SwarmInstanceRef,
  EventBus as PipelineEventBus,
  PipelineContextMap,
  ContextForPoint,
  PipelineResultMap,
  ResultForPoint,
} from './context.js';

// Also export original names for direct pipeline module imports
export type {
  TurnContext,
  StepContext,
  ToolCallContext,
  WorkspaceContext,
  LlmErrorContext,
  Turn,
  Step,
  TurnAuth,
  ToolCall,
  ToolResult,
  LlmResult,
  ToolCatalogItem,
  LlmMessage,
  EventBus,
} from './context.js';

// Registry
export { PipelineRegistry } from './registry.js';
export type { MutatorEntry, MiddlewareEntry } from './registry.js';

// Executor
export { PipelineExecutor } from './executor.js';

// API
export { createPipelineApi } from './api.js';
export type { PipelineApi } from './api.js';
