/**
 * Goondan Workspace System
 *
 * 워크스페이스 관리 및 파일시스템 레이아웃 유틸리티
 * @see /docs/specs/workspace.md
 */

// Types
export type {
  GoondanHomeOptions,
  WorkspacePathsOptions,
  SwarmBundleRootLayout,
  InstanceStatePaths,
  AgentStatePaths,
  SystemStatePaths,
  OAuthStorePaths,
  LogLevel,
  LogEntry,
  // ToolCall과 LlmMessage는 tool 모듈과 충돌하므로 별칭 사용
  ToolCall as WorkspaceToolCall,
  LlmMessage as WorkspaceLlmMessage,
  LlmMessageLogRecord,
  MessageBaseLogRecord,
  MessageEventLogRecord,
  MessageEventType,
  InstanceMetadata,
  SwarmInstanceStatus,
  TurnMetricsLogRecord,
  TokenUsage,
  SwarmEventKind,
  SwarmEventLogRecord,
  AgentEventKind,
  AgentEventLogRecord,
  SecretMetadata,
  SecretEntry,
  WorkspaceRepoAvailableEvent,
  WorkspaceWorktreeMountedEvent,
  WorkspaceEvent,
  WorkspaceEventName,
  WorkspaceEventListener,
  WorkspaceManagerOptions,
} from './types.js';

// Config utilities
export {
  resolveGoondanHome,
  generateWorkspaceId,
  generateInstanceId,
  DEFAULT_LAYOUT,
} from './config.js';

// Paths
export { WorkspacePaths } from './paths.js';

// Secrets
export { SecretsStore } from './secrets.js';

// Logs
export {
  JsonlWriter,
  MessageBaseLogger,
  MessageEventLogger,
  SwarmEventLogger,
  AgentEventLogger,
  TurnMetricsLogger,
} from './logs.js';

export type {
  MessageBaseDeltaInput,
  MessageBaseRewriteInput,
  MessageEventLogInput,
  SwarmEventLogInput,
  AgentEventLogInput,
  TurnMetricsLogInput,
} from './logs.js';

// Manager
export { WorkspaceManager } from './manager.js';
