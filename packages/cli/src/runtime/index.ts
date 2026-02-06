/**
 * CLI Runtime Module
 *
 * gdn run 명령어에서 사용하는 런타임 구현체들을 제공합니다.
 * - BundleLoaderImpl: BundleLoadResult 기반 BundleLoader 구현
 * - LlmCallerImpl: AI SDK 기반 LLM 호출 구현
 * - ToolExecutorImpl: Tool entry 모듈 동적 로드/실행 구현
 */

export { createBundleLoaderImpl } from "./bundle-loader-impl.js";
export type { BundleLoaderImplOptions } from "./bundle-loader-impl.js";

export { createLlmCallerImpl } from "./llm-caller-impl.js";

export { createToolExecutorImpl } from "./tool-executor-impl.js";
export {
  isRevisionedToolExecutor,
} from "./tool-executor-impl.js";
export type {
  ToolExecutorImplOptions,
  RevisionedToolExecutor,
} from "./tool-executor-impl.js";

export {
  detectConnections,
  extractStaticToken,
  toIngressRules,
  resolveAgentFromRoute,
  isObjectWithKey,
} from "./connector-runner.js";
export type {
  DetectedConnection,
  ConnectorRunner,
} from "./connector-runner.js";

export { TelegramConnectorRunner } from "./telegram-connector.js";
export type { TelegramConnectorOptions } from "./telegram-connector.js";

export type {
  RuntimeContext,
  RevisionState,
  ProcessConnectorTurnResult,
} from "./types.js";
