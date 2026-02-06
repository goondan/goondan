/**
 * CLI Runtime 공유 타입
 *
 * run.ts와 connector 모듈이 공유하는 타입 정의.
 * 순환 의존성을 방지하기 위해 별도 파일로 분리.
 */

import type {
  TurnRunner,
  SwarmInstanceManager,
  AgentInstance,
} from "@goondan/core";
import type { BundleLoadResult } from "@goondan/core";
import type { RevisionedToolExecutor } from "./tool-executor-impl.js";

/**
 * 리비전 전환 상태
 */
export interface RevisionState {
  activeRef: string;
  pendingRef?: string;
  inFlightTurnsByRef: Map<string, number>;
}

/**
 * Runtime context for running turns
 */
export interface RuntimeContext {
  turnRunner: TurnRunner;
  toolExecutor: RevisionedToolExecutor;
  swarmInstanceManager: SwarmInstanceManager;
  swarmName: string;
  entrypointAgent: string;
  instanceKey: string;
  bundleRootDir: string;
  configPath: string;
  currentBundle: BundleLoadResult;
  revisionState: RevisionState;
  /** AgentInstance 캐시 (cacheKey -> AgentInstance) */
  agentInstances: Map<string, AgentInstance>;
}

/**
 * 커넥터 턴 실행 결과
 */
export interface ProcessConnectorTurnResult {
  response: string;
  status: "completed" | "failed";
}
