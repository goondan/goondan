/**
 * Workspace 관련 타입 정의
 * @see /docs/specs/workspace.md
 */
import type { JsonObject, JsonValue } from '../types/json.js';

// ============================================================================
// 설정 관련 타입
// ============================================================================

/**
 * goondanHome 경로 결정을 위한 옵션
 */
export interface GoondanHomeOptions {
  /** CLI에서 전달된 경로 */
  cliStateRoot?: string;
  /** 환경 변수에서 읽은 경로 */
  envStateRoot?: string;
}

/**
 * WorkspacePaths 초기화 옵션
 */
export interface WorkspacePathsOptions {
  /** CLI에서 전달된 state root 경로 */
  stateRoot?: string;
  /** SwarmBundle 루트 경로 */
  swarmBundleRoot: string;
}

/**
 * SwarmBundleRoot 표준 레이아웃
 */
export interface SwarmBundleRootLayout {
  /** 메인 구성 파일 경로 (상대 경로) */
  configFile: string;
  /** 리소스 디렉터리 목록 (상대 경로) */
  resourceDirs?: string[];
  /** 프롬프트 디렉터리 (상대 경로) */
  promptsDir?: string;
  /** Tool 디렉터리 (상대 경로) */
  toolsDir?: string;
  /** Extension 디렉터리 (상대 경로) */
  extensionsDir?: string;
  /** Connector 디렉터리 (상대 경로) */
  connectorsDir?: string;
  /** Bundle Package 매니페스트 (상대 경로) */
  bundleManifest?: string;
}

// ============================================================================
// 경로 관련 타입
// ============================================================================

/**
 * Instance State 경로
 */
export interface InstanceStatePaths {
  /** 인스턴스 상태 루트 */
  root: string;
  /** 인스턴스 메타데이터 파일 */
  metadataFile: string;
  /** Swarm 이벤트 로그 */
  swarmEventsLog: string;
  /** Turn/Step 메트릭 로그 */
  metricsLog: string;
  /** Extension 공유 상태 파일 (instance.shared) */
  extensionSharedState: string;
  /** 인스턴스별 워크스페이스 디렉터리 (Tool CWD 바인딩용) */
  workspace: string;
  /** Extension별 상태 경로 생성 */
  extensionState(extensionName: string): string;
  /** Agent별 경로 생성 */
  agent(agentName: string): AgentStatePaths;
}

/**
 * Agent State 경로
 */
export interface AgentStatePaths {
  /** Agent 상태 루트 */
  root: string;
  /** Message base 스냅샷 로그 */
  messageBaseLog: string;
  /** Turn 메시지 이벤트 로그 */
  messageEventsLog: string;
  /** Agent 이벤트 로그 */
  eventsLog: string;
}

/**
 * System State 경로
 */
export interface SystemStatePaths {
  /** System State 루트 (= goondanHome) */
  root: string;
  /** Bundle Package 레지스트리 파일 */
  bundlesRegistry: string;
  /** Bundle Package 캐시 디렉터리 */
  bundlesCache: string;
  /** Worktrees 디렉터리 */
  worktrees: string;
  /** OAuth 저장소 */
  oauth: OAuthStorePaths;
  /** Secrets 디렉터리 */
  secrets: string;
  /** Metrics 디렉터리 */
  metricsDir: string;
  /** 런타임 메트릭 로그 */
  runtimeMetricsLog: string;
  /** Instances 디렉터리 */
  instances: string;
  /** 특정 Bundle Package 캐시 경로 */
  bundleCachePath(scope: string, name: string, version: string): string;
  /** 특정 Changeset worktree 경로 */
  changesetWorktreePath(workspaceId: string, changesetId: string): string;
  /** 특정 Instance State 경로 */
  instanceStatePath(workspaceId: string, instanceId: string): string;
}

/**
 * OAuth 저장소 경로
 */
export interface OAuthStorePaths {
  /** OAuth 루트 */
  root: string;
  /** Grants 디렉터리 */
  grants: string;
  /** Sessions 디렉터리 */
  sessions: string;
  /** 특정 Grant 파일 경로 */
  grantPath(subjectHash: string): string;
  /** 특정 Session 파일 경로 */
  sessionPath(authSessionId: string): string;
}

// ============================================================================
// 로그 관련 타입
// ============================================================================

/**
 * 로그 레벨
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 일반 로그 엔트리
 */
export interface LogEntry {
  /** 기록 시각 (ISO8601) */
  timestamp: string;
  /** 로그 레벨 */
  level: LogLevel;
  /** 카테고리 */
  category: string;
  /** 메시지 */
  message: string;
  /** 추가 데이터 (선택) */
  data?: JsonObject;
  /** Turn ID (선택) */
  turnId?: string;
  /** Step ID (선택) */
  stepId?: string;
  /** 에이전트 이름 (선택) */
  agentName?: string;
}

/**
 * Tool 호출 정보
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

/**
 * LLM 메시지 타입
 */
export type LlmMessage =
  | { id: string; role: 'system'; content: string }
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { id: string; role: 'tool'; toolCallId: string; toolName: string; output: JsonValue };

/**
 * Message base Delta 로그 레코드
 *
 * 각 메시지를 개별 레코드로 기록하여 O(N^2) 중복을 방지한다.
 * seq 필드로 전체 메시지 목록에서의 순서를 추적한다.
 */
export interface MessageBaseLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'message.base';
  /** 기록 시각 (ISO8601) */
  recordedAt: string;
  /** 추적 ID (분산 추적용) */
  traceId: string;
  /** 인스턴스 ID */
  instanceId: string;
  /** 인스턴스 키 */
  instanceKey: string;
  /** 에이전트 이름 */
  agentName: string;
  /** Turn ID */
  turnId: string;
  /** 단일 메시지 */
  message: LlmMessage;
  /** 전체 메시지 목록에서의 인덱스 (0-based) */
  seq: number;
}

/**
 * 메시지 이벤트 타입
 */
export type MessageEventType =
  | 'system_message'
  | 'llm_message'
  | 'replace'
  | 'remove'
  | 'truncate';

/**
 * Turn 메시지 이벤트 로그 레코드
 */
export interface MessageEventLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'message.event';
  /** 기록 시각 (ISO8601) */
  recordedAt: string;
  /** 추적 ID (분산 추적용) */
  traceId: string;
  /** 인스턴스 ID */
  instanceId: string;
  /** 인스턴스 키 */
  instanceKey: string;
  /** 에이전트 이름 */
  agentName: string;
  /** Turn ID */
  turnId: string;
  /** Turn 내 이벤트 순번(단조 증가) */
  seq: number;
  /** 이벤트 타입 */
  eventType: MessageEventType;
  /** 이벤트 페이로드 */
  payload: JsonObject;
  /** Step ID (선택) */
  stepId?: string;
}

/**
 * @deprecated LlmMessageLogRecord는 MessageBaseLogRecord + MessageEventLogRecord로 대체됨
 */
export interface LlmMessageLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'llm.message';
  /** 기록 시각 (ISO8601) */
  recordedAt: string;
  /** 인스턴스 ID */
  instanceId: string;
  /** 인스턴스 키 */
  instanceKey: string;
  /** 에이전트 이름 */
  agentName: string;
  /** Turn ID */
  turnId: string;
  /** Step ID (선택) */
  stepId?: string;
  /** Step 인덱스 (선택) */
  stepIndex?: number;
  /** LLM 메시지 내용 */
  message: LlmMessage;
}

/**
 * Instance Metadata 스키마
 */
export interface InstanceMetadata {
  /** 인스턴스 상태 */
  status: SwarmInstanceStatus;
  /** 마지막 갱신 시각 (ISO8601) */
  updatedAt: string;
  /** 인스턴스 생성 시각 (ISO8601) */
  createdAt: string;
  /** TTL 만료 시각 (선택, ISO8601) */
  expiresAt?: string;
}

/**
 * Swarm Instance 상태
 */
export type SwarmInstanceStatus = 'running' | 'paused' | 'terminated';

/**
 * Turn 메트릭 로그 레코드
 */
export interface TurnMetricsLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'metrics.turn';
  /** 기록 시각 (ISO8601) */
  recordedAt: string;
  /** 추적 ID */
  traceId: string;
  /** Turn ID */
  turnId: string;
  /** Step ID (선택) */
  stepId?: string;
  /** 인스턴스 ID */
  instanceId: string;
  /** 에이전트 이름 */
  agentName: string;
  /** 레이턴시 (밀리초) */
  latencyMs: number;
  /** 토큰 사용량 */
  tokenUsage: TokenUsage;
  /** Tool 호출 횟수 */
  toolCallCount: number;
  /** 오류 횟수 */
  errorCount: number;
}

/**
 * 토큰 사용량
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * Swarm 이벤트 종류
 */
export type SwarmEventKind =
  | 'swarm.created'
  | 'swarm.started'
  | 'swarm.stopped'
  | 'swarm.paused'
  | 'swarm.resumed'
  | 'swarm.terminated'
  | 'swarm.deleted'
  | 'swarm.error'
  | 'swarm.configChanged'
  | 'agent.created'
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.delegate'
  | 'agent.delegationResult'
  | 'changeset.committed'
  | 'changeset.rejected'
  | 'changeset.activated'
  | string; // 확장 가능

/**
 * Swarm 이벤트 로그 레코드
 */
export interface SwarmEventLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'swarm.event';
  /** 기록 시각 (ISO8601) */
  recordedAt: string;
  /** 추적 ID (분산 추적용) */
  traceId: string;
  /** 이벤트 종류 */
  kind: SwarmEventKind;
  /** 인스턴스 ID */
  instanceId: string;
  /** 인스턴스 키 */
  instanceKey: string;
  /** Swarm 이름 */
  swarmName: string;
  /** 관련 에이전트 이름 (선택) */
  agentName?: string;
  /** 이벤트 데이터 (선택) */
  data?: JsonObject;
}

/**
 * Agent 이벤트 종류
 */
export type AgentEventKind =
  | 'turn.started'
  | 'turn.completed'
  | 'turn.error'
  | 'step.started'
  | 'step.completed'
  | 'step.error'
  | 'step.llmCall'
  | 'step.llmResult'
  | 'step.llmError'
  | 'toolCall.started'
  | 'toolCall.completed'
  | 'toolCall.error'
  | 'liveConfig.patchProposed'
  | 'liveConfig.patchApplied'
  | 'auth.required'
  | 'auth.granted'
  | string; // 확장 가능

/**
 * Agent 이벤트 로그 레코드
 */
export interface AgentEventLogRecord {
  /** 레코드 타입 (고정값) */
  type: 'agent.event';
  /** 기록 시각 (ISO8601) */
  recordedAt: string;
  /** 추적 ID (분산 추적용) */
  traceId: string;
  /** 이벤트 종류 */
  kind: AgentEventKind;
  /** 인스턴스 ID */
  instanceId: string;
  /** 인스턴스 키 */
  instanceKey: string;
  /** 에이전트 이름 */
  agentName: string;
  /** Turn ID (선택) */
  turnId?: string;
  /** Step ID (선택) */
  stepId?: string;
  /** Step 인덱스 (선택) */
  stepIndex?: number;
  /** 이벤트 데이터 (선택) */
  data?: JsonObject;
}

// ============================================================================
// Secrets 관련 타입
// ============================================================================

/**
 * Secret 메타데이터
 */
export interface SecretMetadata {
  /** 설명 */
  description?: string;
  /** 생성 시각 */
  createdAt?: string;
  /** 수정 시각 */
  updatedAt?: string;
  /** 사용자 정의 태그 */
  tags?: string[];
}

/**
 * Secret 엔트리
 */
export interface SecretEntry {
  /** 비밀 값 */
  value: string;
  /** 메타데이터 (선택) */
  metadata?: SecretMetadata;
}

// ============================================================================
// 이벤트 관련 타입
// ============================================================================

/**
 * workspace.repoAvailable 이벤트
 */
export interface WorkspaceRepoAvailableEvent {
  type: 'workspace.repoAvailable';
  path: string;
  workspaceId: string;
}

/**
 * workspace.worktreeMounted 이벤트
 */
export interface WorkspaceWorktreeMountedEvent {
  type: 'workspace.worktreeMounted';
  path: string;
  workspaceId: string;
  changesetId: string;
}

/**
 * Workspace 이벤트 타입
 */
export type WorkspaceEvent = WorkspaceRepoAvailableEvent | WorkspaceWorktreeMountedEvent;

/**
 * Workspace 이벤트 이름
 */
export type WorkspaceEventName = WorkspaceEvent['type'];

/**
 * 이벤트 리스너 타입
 */
export type WorkspaceEventListener<E extends WorkspaceEvent> = (event: E) => void;

// ============================================================================
// Manager 관련 타입
// ============================================================================

/**
 * WorkspaceManager 생성 옵션
 */
export interface WorkspaceManagerOptions {
  /** State root 경로 */
  stateRoot?: string;
  /** SwarmBundle root 경로 */
  swarmBundleRoot: string;
  /** Workspace root 경로 (선택, 기본값: swarmBundleRoot) */
  workspaceRoot?: string;
}
