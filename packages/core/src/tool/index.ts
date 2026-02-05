/**
 * Tool 시스템
 * @see /docs/specs/tool.md
 *
 * Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위입니다.
 */

// Types
export type {
  // Handler
  ToolHandler,
  // Context
  ToolContext,
  SwarmInstance,
  Turn,
  TurnAuth,
  Step,
  LlmResult,
  LlmMessage,
  SwarmBundleApi,
  OAuthApi,
  OAuthTokenRequest,
  OAuthTokenResult,
  OAuthTokenReady,
  OAuthAuthorizationRequired,
  OAuthTokenError,
  EventBus,
  // Call
  ToolCall,
  // Result
  ToolResult,
  ToolError,
  // Catalog
  ToolCatalogItem,
  ToolSource,
  LlmTool,
  // Dynamic
  DynamicToolDefinition,
  ToolRegistryApi,
  // Async
  AsyncToolOutput,
  // Validation
  HandlerValidationResult,
} from './types.js';

// Classes
export { ToolRegistry } from './registry.js';
export { ToolCatalog } from './catalog.js';
export { ToolExecutor } from './executor.js';
export { ToolLoader } from './loader.js';
export { ToolContextBuilder } from './context.js';

// Utils
export {
  truncateErrorMessage,
  createToolErrorResult,
  createToolSuccessResult,
  createToolPendingResult,
  isAsyncToolResult,
} from './utils.js';
