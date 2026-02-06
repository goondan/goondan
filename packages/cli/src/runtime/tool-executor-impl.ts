/**
 * ToolExecutorImpl: Tool entry 모듈의 동적 로드 및 실행
 *
 * Tool의 spec.entry 경로에서 모듈을 동적 로드하고,
 * export된 핸들러 함수를 호출하여 ToolResult를 반환합니다.
 *
 * - 기본 모드: ref 세대별 Worker 격리 (메모리 회수 가능)
 * - 폴백 모드: in-process 실행
 *
 * @see /docs/specs/tool.md
 * @see /docs/specs/runtime.md - 6.4 Tool 실행
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { ToolExecutor, Step, ToolCall, ToolResult } from "@goondan/core/runtime";
import type {
  JsonValue,
  JsonObject,
  SwarmBundleApi,
  OpenChangesetInput,
  CommitChangesetInput,
} from "@goondan/core";

/**
 * Tool 모듈의 export 함수 타입
 */
interface ToolHandlerFn {
  (ctx: ToolRuntimeContext, input: JsonObject): Promise<JsonValue> | JsonValue;
}

/**
 * Worker 친화적인 Step 스냅샷
 */
interface ToolExecutionStepSnapshot {
  id: string;
  index: number;
  activeSwarmBundleRef: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  metadata: Record<string, JsonValue>;
  effectiveConfig: Step["effectiveConfig"];
  toolCatalog: Step["toolCatalog"];
  blocks: Step["blocks"];
  toolCalls: Step["toolCalls"];
  toolResults: Step["toolResults"];
  turn: {
    id: string;
    inputEvent: Step["turn"]["inputEvent"];
    origin: Step["turn"]["origin"];
    auth: Step["turn"]["auth"];
    status: string;
    currentStepIndex: number;
    startedAt: string;
    completedAt?: string;
    messages: Step["turn"]["messages"];
    metadata: Record<string, JsonValue>;
  };
  agent: {
    id: string;
    agentName: string;
    agentRef: Step["turn"]["agentInstance"]["agentRef"];
  };
  swarm: {
    id: string;
    instanceKey: string;
    swarmRef: Step["turn"]["agentInstance"]["swarmInstance"]["swarmRef"];
    activeSwarmBundleRef: string;
  };
}

/**
 * Worker에서 사용할 ToolContext 직렬화 데이터
 */
interface WorkerToolContextData {
  instance: {
    id: string;
    swarmName: string;
    status: string;
    swarmBundleRef: string;
  };
  swarm: Step["effectiveConfig"] extends infer T
    ? T extends { swarm: infer S }
      ? S
      : null
    : null;
  agent: Step["effectiveConfig"] extends infer T
    ? T extends { agent: infer A }
      ? A
      : null
    : null;
  turn: ToolExecutionStepSnapshot["turn"];
  step: ToolExecutionStepSnapshot;
  toolCatalog: Step["toolCatalog"];
}

/**
 * Tool 런타임 컨텍스트
 */
interface ToolRuntimeContext extends WorkerToolContextData {
  swarmBundleRoot: string;
  swarmBundle: {
    openChangeset: (input?: OpenChangesetInput) => Promise<unknown>;
    commitChangeset: (input: CommitChangesetInput) => Promise<unknown>;
    getActiveRef: () => string;
  };
  oauth: {
    getAccessToken: (_request: unknown) => Promise<{
      status: "error";
      error: { code: string; message: string };
    }>;
  };
  events: {
    emit: (_event: string, _data?: unknown) => void;
    on: (_event: string, _handler: (_data: unknown) => void) => void;
    off: (_event: string, _handler: (_data: unknown) => void) => void;
  };
  logger: Console;
}

/**
 * Worker execute payload
 */
interface WorkerExecutePayload {
  entryPath: string;
  exportName: string;
  input: JsonObject;
  activeRef: string;
  swarmBundleRoot: string;
  contextData: WorkerToolContextData;
}

/**
 * Worker 요청 메시지
 */
interface WorkerExecuteRequest {
  type: "execute";
  requestId: string;
  payload: WorkerExecutePayload;
}

/**
 * Worker 응답 메시지
 */
interface WorkerExecuteResult {
  type: "result";
  requestId: string;
  status: "ok" | "error";
  output?: JsonValue;
  error?: {
    message: string;
    name?: string;
  };
}

/**
 * Worker -> Main API 호출 메시지
 */
interface WorkerApiCall {
  type: "api.call";
  requestId: string;
  method: "swarmBundle.openChangeset" | "swarmBundle.commitChangeset";
  input?: unknown;
}

/**
 * Main -> Worker API 결과 메시지
 */
interface MainApiResultMessage {
  type: "api.result";
  requestId: string;
  status: "ok" | "error";
  result?: unknown;
  error?: {
    message: string;
    name?: string;
  };
}

/**
 * Worker 로그 메시지
 */
interface WorkerLogMessage {
  type: "log";
  level: "debug" | "info" | "warn" | "error" | "log";
  args: unknown[];
}

/**
 * Pending 요청
 */
interface PendingRequest {
  resolve: (result: WorkerExecuteResult) => void;
  reject: (error: Error) => void;
}

/**
 * ref 세대별 Worker 상태
 */
interface RevisionWorkerState {
  ref: string;
  worker: Worker;
  pendingRequests: Map<string, PendingRequest>;
  inFlightTurns: number;
  inFlightCalls: number;
  lastUsedAt: number;
}

/**
 * ToolExecutorImpl 생성 옵션
 */
export interface ToolExecutorImplOptions {
  /** Bundle 루트 디렉토리 (entry 상대 경로 해석에 사용) */
  bundleRootDir: string;
  /** 동시에 유지할 최대 ref 세대 수 */
  maxActiveGenerations?: number;
  /** true면 ref 세대별 Worker 격리 (기본값: true) */
  isolateByRevision?: boolean;
  /** 실제 SwarmBundle API (open/commit/getActiveRef) */
  swarmBundleApi?: SwarmBundleApi;
  /** SwarmBundle 루트 경로 (Tool context 제공) */
  swarmBundleRoot?: string;
  /** Worker 로그 전달 대상 */
  logger?: Console;
  /** commit 성공 시 새 ref 통지 콜백 */
  onCommittedRef?: (newRef: string) => void;
}

/**
 * 리비전 격리 지원 ToolExecutor 확장 인터페이스
 */
export interface RevisionedToolExecutor extends ToolExecutor {
  beginTurn(ref: string): void;
  endTurn(ref: string): void;
  dispose(): Promise<void>;
  getGenerationRefs(): string[];
}

/**
 * ToolExecutor가 RevisionedToolExecutor인지 확인
 */
export function isRevisionedToolExecutor(value: ToolExecutor): value is RevisionedToolExecutor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["beginTurn"] === "function" &&
    typeof value["endTurn"] === "function" &&
    typeof value["dispose"] === "function"
  );
}

/**
 * Worker 내부 실행 코드 (CommonJS eval)
 */
const TOOL_WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const moduleCache = new Map();
const pendingApiCalls = new Map();
let apiRequestSeq = 0;

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function isHandler(value) {
  return typeof value === "function";
}

function toPlain(value) {
  if (value === null) {
    return null;
  }
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return value;
  }
  if (type === "undefined") {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return String(value);
  }
}

function findHandler(mod, exportName) {
  if (!isRecord(mod)) {
    return null;
  }

  if (isHandler(mod[exportName])) {
    return mod[exportName];
  }

  const camelCase = exportName.replace(/\\.(\\w)/g, (_, c) => c.toUpperCase());
  if (isHandler(mod[camelCase])) {
    return mod[camelCase];
  }

  const segments = exportName.split(".");
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : undefined;
  if (lastSegment && isHandler(mod[lastSegment])) {
    return mod[lastSegment];
  }

  if (isHandler(mod.default)) {
    return mod.default;
  }

  if (isRecord(mod.default)) {
    const defaultObj = mod.default;
    if (isHandler(defaultObj[exportName])) {
      return defaultObj[exportName];
    }
    if (isHandler(defaultObj[camelCase])) {
      return defaultObj[camelCase];
    }
    if (lastSegment && isHandler(defaultObj[lastSegment])) {
      return defaultObj[lastSegment];
    }
  }

  return null;
}

async function loadToolModule(entryPath) {
  const absolutePath = path.isAbsolute(entryPath)
    ? entryPath
    : path.resolve(process.cwd(), entryPath);

  const cached = moduleCache.get(absolutePath);
  if (cached) {
    return cached;
  }

  const moduleUrl = pathToFileURL(absolutePath).href;
  const mod = await import(moduleUrl);
  moduleCache.set(absolutePath, mod);
  return mod;
}

function nextApiRequestId() {
  apiRequestSeq += 1;
  return "api-" + Date.now().toString(36) + "-" + String(apiRequestSeq);
}

function callApi(method, input) {
  const requestId = nextApiRequestId();
  return new Promise((resolve, reject) => {
    pendingApiCalls.set(requestId, { resolve, reject });
    parentPort.postMessage({
      type: "api.call",
      requestId,
      method,
      input,
    });
  });
}

function createLogger() {
  const logger = {};
  const levels = ["debug", "info", "warn", "error", "log"];

  for (const level of levels) {
    logger[level] = (...args) => {
      parentPort.postMessage({
        type: "log",
        level,
        args: args.map((arg) => toPlain(arg)),
      });
    };
  }

  return logger;
}

function createToolContext(payload) {
  const contextData = isRecord(payload.contextData) ? payload.contextData : {};
  const activeRef = typeof payload.activeRef === "string" ? payload.activeRef : "default";
  const swarmBundleRoot = typeof payload.swarmBundleRoot === "string"
    ? payload.swarmBundleRoot
    : process.cwd();

  const swarmBundle = {
    openChangeset: async (input) => {
      return await callApi("swarmBundle.openChangeset", input);
    },
    commitChangeset: async (input) => {
      return await callApi("swarmBundle.commitChangeset", input);
    },
    getActiveRef: () => activeRef,
  };

  const oauth = {
    getAccessToken: async (_request) => ({
      status: "error",
      error: {
        code: "NOT_IMPLEMENTED",
        message: "OAuth is not configured in worker mode",
      },
    }),
  };

  const events = {
    emit: (_event, _data) => {},
    on: (_event, _handler) => {},
    off: (_event, _handler) => {},
  };

  return {
    ...contextData,
    swarmBundleRoot,
    swarmBundle,
    oauth,
    events,
    logger: createLogger(),
  };
}

function resolveApiResult(msg) {
  if (!isRecord(msg)) {
    return;
  }
  if (msg.type !== "api.result") {
    return;
  }
  if (typeof msg.requestId !== "string") {
    return;
  }

  const pending = pendingApiCalls.get(msg.requestId);
  if (!pending) {
    return;
  }
  pendingApiCalls.delete(msg.requestId);

  if (msg.status === "ok") {
    pending.resolve(msg.result);
    return;
  }

  const errorObj = isRecord(msg.error) ? msg.error : {};
  const errorName = typeof errorObj.name === "string" ? errorObj.name : "Error";
  const errorMessage = typeof errorObj.message === "string"
    ? errorObj.message
    : "Worker API call failed";
  const err = new Error(errorMessage);
  err.name = errorName;
  pending.reject(err);
}

parentPort.on("message", async (msg) => {
  if (!isRecord(msg)) {
    return;
  }

  if (msg.type === "api.result") {
    resolveApiResult(msg);
    return;
  }

  if (msg.type !== "execute") {
    return;
  }

  const requestId = typeof msg.requestId === "string" ? msg.requestId : "unknown";

  try {
    const payload = isRecord(msg.payload) ? msg.payload : {};
    const entryPath = typeof payload.entryPath === "string" ? payload.entryPath : "";
    const exportName = typeof payload.exportName === "string" ? payload.exportName : "";
    const input = isRecord(payload.input) ? payload.input : {};

    const mod = await loadToolModule(entryPath);
    const handler = findHandler(mod, exportName);

    if (!handler) {
      throw new Error("Handler function not found for tool: " + exportName + " in " + entryPath);
    }

    const context = createToolContext(payload);
    const output = await handler(context, input);

    parentPort.postMessage({
      type: "result",
      requestId,
      status: "ok",
      output: output ?? null,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    parentPort.postMessage({
      type: "result",
      requestId,
      status: "error",
      error: {
        message: error.message,
        name: error.name,
      },
    });
  }
});
`;

/**
 * in-process 모듈 캐시
 */
const inProcessModuleCache = new Map<string, Record<string, unknown>>();

/**
 * object 타입 가드
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * string 타입 가드
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * 함수 타입 가드
 */
function isToolHandlerFn(value: unknown): value is ToolHandlerFn {
  return typeof value === "function";
}

/**
 * Worker result 메시지 가드
 */
function isWorkerExecuteResult(value: unknown): value is WorkerExecuteResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["type"] === "result" &&
    isString(value["requestId"]) &&
    (value["status"] === "ok" || value["status"] === "error")
  );
}

/**
 * Worker API call 메시지 가드
 */
function isWorkerApiCall(value: unknown): value is WorkerApiCall {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["type"] === "api.call" &&
    isString(value["requestId"]) &&
    (value["method"] === "swarmBundle.openChangeset" || value["method"] === "swarmBundle.commitChangeset")
  );
}

/**
 * Worker 로그 메시지 가드
 */
function isWorkerLogMessage(value: unknown): value is WorkerLogMessage {
  if (!isRecord(value)) {
    return false;
  }

  const level = value["level"];
  return (
    value["type"] === "log" &&
    (level === "debug" || level === "info" || level === "warn" || level === "error" || level === "log") &&
    Array.isArray(value["args"])
  );
}

/**
 * unknown을 module record로 변환
 */
function toModuleRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return {};
}

/**
 * ref 정규화
 */
function normalizeRef(ref: string | undefined): string {
  const trimmed = ref?.trim();
  if (!trimmed) {
    return "default";
  }
  return trimmed;
}

/**
 * ObjectRefLike에서 이름 추출
 */
function resolveRefName(ref: unknown): string {
  if (typeof ref === "string") {
    const parts = ref.split("/");
    if (parts.length === 2 && parts[1]) {
      return parts[1];
    }
    return ref;
  }

  if (isRecord(ref) && isString(ref["name"])) {
    return ref["name"];
  }

  return "default";
}

/**
 * 요청 ID 생성
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Tool entry에서 in-process 모듈 로드
 */
async function loadToolModuleInProcess(
  entryPath: string,
): Promise<Record<string, unknown>> {
  const absolutePath = path.isAbsolute(entryPath)
    ? entryPath
    : path.resolve(process.cwd(), entryPath);

  const cached = inProcessModuleCache.get(absolutePath);
  if (cached) {
    return cached;
  }

  const moduleUrl = pathToFileURL(absolutePath).href;
  const mod = await import(moduleUrl);
  const record = toModuleRecord(mod);
  inProcessModuleCache.set(absolutePath, record);
  return record;
}

/**
 * Tool export에서 핸들러 함수 찾기
 */
function findHandler(
  mod: Record<string, unknown>,
  exportName: string,
): ToolHandlerFn | null {
  const exact = mod[exportName];
  if (isToolHandlerFn(exact)) {
    return exact;
  }

  const camelCase = exportName.replace(/\.(\w)/g, (_whole, captured: string) => captured.toUpperCase());
  const camelCaseHandler = mod[camelCase];
  if (isToolHandlerFn(camelCaseHandler)) {
    return camelCaseHandler;
  }

  const segments = exportName.split(".");
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : undefined;
  if (lastSegment) {
    const segmentHandler = mod[lastSegment];
    if (isToolHandlerFn(segmentHandler)) {
      return segmentHandler;
    }
  }

  const defaultExport = mod["default"];
  if (isToolHandlerFn(defaultExport)) {
    return defaultExport;
  }

  if (isRecord(defaultExport)) {
    const defaultExact = defaultExport[exportName];
    if (isToolHandlerFn(defaultExact)) {
      return defaultExact;
    }

    const defaultCamelCase = defaultExport[camelCase];
    if (isToolHandlerFn(defaultCamelCase)) {
      return defaultCamelCase;
    }

    if (lastSegment) {
      const defaultSegment = defaultExport[lastSegment];
      if (isToolHandlerFn(defaultSegment)) {
        return defaultSegment;
      }
    }
  }

  return null;
}

/**
 * 에러 메시지 잘라내기
 */
function truncateMessage(message: string, limit: number = 1000): string {
  if (message.length <= limit) {
    return message;
  }
  return message.substring(0, limit) + "... (truncated)";
}

/**
 * Worker 전송용 Step 스냅샷 생성
 */
function createStepSnapshot(step: Step): ToolExecutionStepSnapshot {
  const startedAt = step.startedAt.toISOString();
  const completedAt = step.completedAt?.toISOString();
  const turnStartedAt = step.turn.startedAt.toISOString();
  const turnCompletedAt = step.turn.completedAt?.toISOString();

  return {
    id: step.id,
    index: step.index,
    activeSwarmBundleRef: step.activeSwarmBundleRef,
    status: step.status,
    startedAt,
    completedAt,
    metadata: step.metadata,
    effectiveConfig: step.effectiveConfig,
    toolCatalog: step.toolCatalog,
    blocks: step.blocks,
    toolCalls: step.toolCalls,
    toolResults: step.toolResults,
    turn: {
      id: step.turn.id,
      inputEvent: step.turn.inputEvent,
      origin: step.turn.origin,
      auth: step.turn.auth,
      status: step.turn.status,
      currentStepIndex: step.turn.currentStepIndex,
      startedAt: turnStartedAt,
      completedAt: turnCompletedAt,
      messages: step.turn.messages,
      metadata: step.turn.metadata,
    },
    agent: {
      id: step.turn.agentInstance.id,
      agentName: step.turn.agentInstance.agentName,
      agentRef: step.turn.agentInstance.agentRef,
    },
    swarm: {
      id: step.turn.agentInstance.swarmInstance.id,
      instanceKey: step.turn.agentInstance.swarmInstance.instanceKey,
      swarmRef: step.turn.agentInstance.swarmInstance.swarmRef,
      activeSwarmBundleRef: step.turn.agentInstance.swarmInstance.activeSwarmBundleRef,
    },
  };
}

/**
 * Worker 전송용 ToolContext 데이터 생성
 */
function createWorkerToolContextData(
  step: Step,
  snapshot: ToolExecutionStepSnapshot,
): WorkerToolContextData {
  const swarmName = resolveRefName(step.turn.agentInstance.swarmInstance.swarmRef);
  const swarmStatus = step.turn.agentInstance.swarmInstance.status;

  return {
    instance: {
      id: step.turn.agentInstance.swarmInstance.id,
      swarmName,
      status: swarmStatus,
      swarmBundleRef: step.activeSwarmBundleRef,
    },
    swarm: step.effectiveConfig?.swarm ?? null,
    agent: step.effectiveConfig?.agent ?? null,
    turn: snapshot.turn,
    step: snapshot,
    toolCatalog: step.toolCatalog,
  };
}

/**
 * Worker 생성
 */
function createRevisionWorker(): Worker {
  return new Worker(TOOL_WORKER_SOURCE, { eval: true });
}

/**
 * pending 요청 전체 실패 처리
 */
function rejectAllPendingRequests(state: RevisionWorkerState, error: Error): void {
  for (const pending of state.pendingRequests.values()) {
    pending.reject(error);
  }
  state.pendingRequests.clear();
}

/**
 * openChangeset 입력 파싱
 */
function parseOpenChangesetInput(input: unknown): OpenChangesetInput | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    return undefined;
  }

  const reason = input["reason"];
  if (reason === undefined) {
    return undefined;
  }

  if (!isString(reason)) {
    return undefined;
  }

  return { reason };
}

/**
 * commitChangeset 입력 파싱
 */
function parseCommitChangesetInput(input: unknown): CommitChangesetInput | null {
  if (!isRecord(input)) {
    return null;
  }

  const changesetId = input["changesetId"];
  if (!isString(changesetId) || changesetId.trim() === "") {
    return null;
  }

  const message = input["message"];
  if (message !== undefined && !isString(message)) {
    return null;
  }

  if (isString(message)) {
    return {
      changesetId,
      message,
    };
  }

  return {
    changesetId,
  };
}

/**
 * commit 결과에서 새 ref 추출
 */
function extractCommittedRef(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  const status = result["status"];
  const newRef = result["newRef"];

  if (status !== "ok") {
    return undefined;
  }

  if (!isString(newRef) || newRef.trim() === "") {
    return undefined;
  }

  return newRef;
}

/**
 * 리비전별 Tool 실행기 구현
 */
class RevisionedToolExecutorImpl implements RevisionedToolExecutor {
  private readonly bundleRootDir: string;
  private readonly maxActiveGenerations: number;
  private readonly isolateByRevision: boolean;
  private readonly swarmBundleApi?: SwarmBundleApi;
  private readonly swarmBundleRoot: string;
  private readonly logger: Console;
  private readonly onCommittedRef?: (newRef: string) => void;
  private readonly workersByRef = new Map<string, RevisionWorkerState>();

  constructor(options: ToolExecutorImplOptions) {
    this.bundleRootDir = options.bundleRootDir;
    this.maxActiveGenerations = Math.max(1, options.maxActiveGenerations ?? 3);
    this.isolateByRevision = options.isolateByRevision !== false;
    this.swarmBundleApi = options.swarmBundleApi;
    this.swarmBundleRoot = options.swarmBundleRoot ?? options.bundleRootDir;
    this.logger = options.logger ?? console;
    this.onCommittedRef = options.onCommittedRef;
  }

  beginTurn(ref: string): void {
    if (!this.isolateByRevision) {
      return;
    }

    const normalizedRef = normalizeRef(ref);
    const state = this.getOrCreateWorkerState(normalizedRef);
    state.inFlightTurns += 1;
    state.lastUsedAt = Date.now();
  }

  endTurn(ref: string): void {
    if (!this.isolateByRevision) {
      return;
    }

    const normalizedRef = normalizeRef(ref);
    const state = this.workersByRef.get(normalizedRef);
    if (!state) {
      return;
    }

    state.inFlightTurns = Math.max(0, state.inFlightTurns - 1);
    state.lastUsedAt = Date.now();
    void this.trimIdleGenerations();
  }

  async execute(toolCall: ToolCall, step: Step): Promise<ToolResult> {
    const catalogItem = step.toolCatalog.find((item) => item.name === toolCall.name);

    if (!catalogItem) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: {
          status: "error",
          error: {
            message: `Tool not found in catalog: ${toolCall.name}`,
            name: "ToolNotFoundError",
          },
        },
      };
    }

    const toolSpec = catalogItem.tool?.spec;
    if (!toolSpec) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: {
          status: "error",
          error: {
            message: `Tool spec not found for: ${toolCall.name}`,
            name: "ToolSpecError",
          },
        },
      };
    }

    const entryPath = path.isAbsolute(toolSpec.entry)
      ? toolSpec.entry
      : path.resolve(this.bundleRootDir, toolSpec.entry);

    const activeRef = normalizeRef(step.activeSwarmBundleRef);
    const stepSnapshot = createStepSnapshot(step);
    const contextData = createWorkerToolContextData(step, stepSnapshot);

    try {
      let execResult: WorkerExecuteResult;

      if (this.isolateByRevision) {
        const state = this.getOrCreateWorkerState(activeRef);
        state.inFlightCalls += 1;
        state.lastUsedAt = Date.now();

        try {
          execResult = await this.executeOnWorker(state, {
            entryPath,
            exportName: toolCall.name,
            input: toolCall.input,
            activeRef,
            swarmBundleRoot: this.swarmBundleRoot,
            contextData,
          });
        } finally {
          state.inFlightCalls = Math.max(0, state.inFlightCalls - 1);
          state.lastUsedAt = Date.now();
          await this.trimIdleGenerations();
        }
      } else {
        execResult = await this.executeInProcess(
          entryPath,
          toolCall,
          step,
          activeRef,
          contextData,
        );
      }

      if (execResult.status === "error") {
        const errorMessageLimit = toolSpec.errorMessageLimit ?? 1000;
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          error: {
            status: "error",
            error: {
              message: truncateMessage(
                execResult.error?.message ?? "Unknown tool execution error",
                errorMessageLimit,
              ),
              name: execResult.error?.name ?? "ToolExecutionError",
            },
          },
        };
      }

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: execResult.output ?? null,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorMessageLimit = toolSpec.errorMessageLimit ?? 1000;

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: {
          status: "error",
          error: {
            message: truncateMessage(error.message, errorMessageLimit),
            name: error.name,
          },
        },
      };
    }
  }

  async dispose(): Promise<void> {
    const states = Array.from(this.workersByRef.values());
    this.workersByRef.clear();

    for (const state of states) {
      rejectAllPendingRequests(state, new Error(`Tool worker disposed for ref '${state.ref}'`));
      await state.worker.terminate();
    }
  }

  getGenerationRefs(): string[] {
    return Array.from(this.workersByRef.keys());
  }

  private getOrCreateWorkerState(ref: string): RevisionWorkerState {
    const existing = this.workersByRef.get(ref);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const worker = createRevisionWorker();
    const state: RevisionWorkerState = {
      ref,
      worker,
      pendingRequests: new Map(),
      inFlightTurns: 0,
      inFlightCalls: 0,
      lastUsedAt: Date.now(),
    };

    worker.on("message", (message: unknown) => {
      if (isWorkerExecuteResult(message)) {
        const pending = state.pendingRequests.get(message.requestId);
        if (!pending) {
          return;
        }

        state.pendingRequests.delete(message.requestId);
        pending.resolve(message);
        return;
      }

      if (isWorkerApiCall(message)) {
        void this.handleWorkerApiCall(state, message);
        return;
      }

      if (isWorkerLogMessage(message)) {
        this.forwardWorkerLog(message);
      }
    });

    worker.on("error", (error: Error) => {
      this.workersByRef.delete(ref);
      rejectAllPendingRequests(state, error);
    });

    worker.on("exit", (code: number) => {
      this.workersByRef.delete(ref);

      if (state.pendingRequests.size === 0) {
        return;
      }

      if (code === 0) {
        rejectAllPendingRequests(
          state,
          new Error(`Tool worker exited unexpectedly for ref '${ref}'`),
        );
        return;
      }

      rejectAllPendingRequests(
        state,
        new Error(`Tool worker crashed for ref '${ref}' (exit code: ${String(code)})`),
      );
    });

    this.workersByRef.set(ref, state);
    return state;
  }

  private async handleWorkerApiCall(
    state: RevisionWorkerState,
    message: WorkerApiCall,
  ): Promise<void> {
    if (!this.swarmBundleApi) {
      this.postApiError(state, message.requestId, new Error("SwarmBundle API is not configured"));
      return;
    }

    try {
      if (message.method === "swarmBundle.openChangeset") {
        const openInput = parseOpenChangesetInput(message.input);
        const result = await this.swarmBundleApi.openChangeset(openInput);
        this.postApiOk(state, message.requestId, result);
        return;
      }

      if (message.method === "swarmBundle.commitChangeset") {
        const commitInput = parseCommitChangesetInput(message.input);
        if (!commitInput) {
          throw new Error("Invalid commitChangeset input");
        }

        const result = await this.swarmBundleApi.commitChangeset(commitInput);
        const committedRef = extractCommittedRef(result);
        if (committedRef && this.onCommittedRef) {
          this.onCommittedRef(committedRef);
        }

        this.postApiOk(state, message.requestId, result);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.postApiError(state, message.requestId, err);
    }
  }

  private postApiOk(state: RevisionWorkerState, requestId: string, result: unknown): void {
    const payload: MainApiResultMessage = {
      type: "api.result",
      requestId,
      status: "ok",
      result,
    };
    state.worker.postMessage(payload);
  }

  private postApiError(state: RevisionWorkerState, requestId: string, error: Error): void {
    const payload: MainApiResultMessage = {
      type: "api.result",
      requestId,
      status: "error",
      error: {
        message: error.message,
        name: error.name,
      },
    };
    state.worker.postMessage(payload);
  }

  private forwardWorkerLog(message: WorkerLogMessage): void {
    const args = message.args;

    if (message.level === "debug") {
      this.logger.debug?.(...args);
      return;
    }
    if (message.level === "info") {
      this.logger.info?.(...args);
      return;
    }
    if (message.level === "warn") {
      this.logger.warn?.(...args);
      return;
    }
    if (message.level === "error") {
      this.logger.error?.(...args);
      return;
    }

    this.logger.log?.(...args);
  }

  private async executeOnWorker(
    state: RevisionWorkerState,
    payload: WorkerExecutePayload,
  ): Promise<WorkerExecuteResult> {
    const requestId = generateRequestId();
    const request: WorkerExecuteRequest = {
      type: "execute",
      requestId,
      payload,
    };

    return new Promise<WorkerExecuteResult>((resolve, reject) => {
      state.pendingRequests.set(requestId, { resolve, reject });

      try {
        state.worker.postMessage(request);
      } catch (error) {
        state.pendingRequests.delete(requestId);
        const err = error instanceof Error ? error : new Error(String(error));
        reject(err);
      }
    });
  }

  private createInProcessContext(
    contextData: WorkerToolContextData,
    activeRef: string,
  ): ToolRuntimeContext {
    const logger = this.logger;

    const swarmBundle = {
      openChangeset: async (input?: OpenChangesetInput): Promise<unknown> => {
        if (!this.swarmBundleApi) {
          throw new Error("SwarmBundle API is not configured");
        }
        return this.swarmBundleApi.openChangeset(input);
      },
      commitChangeset: async (input: CommitChangesetInput): Promise<unknown> => {
        if (!this.swarmBundleApi) {
          throw new Error("SwarmBundle API is not configured");
        }

        const result = await this.swarmBundleApi.commitChangeset(input);
        const committedRef = extractCommittedRef(result);
        if (committedRef && this.onCommittedRef) {
          this.onCommittedRef(committedRef);
        }
        return result;
      },
      getActiveRef: (): string => {
        if (!this.swarmBundleApi) {
          return activeRef;
        }
        return this.swarmBundleApi.getActiveRef();
      },
    };

    return {
      ...contextData,
      swarmBundleRoot: this.swarmBundleRoot,
      swarmBundle,
      oauth: {
        getAccessToken: async () => ({
          status: "error",
          error: {
            code: "NOT_IMPLEMENTED",
            message: "OAuth is not configured in CLI runtime",
          },
        }),
      },
      events: {
        emit: () => {},
        on: () => {},
        off: () => {},
      },
      logger,
    };
  }

  private async executeInProcess(
    entryPath: string,
    toolCall: ToolCall,
    _step: Step,
    activeRef: string,
    contextData: WorkerToolContextData,
  ): Promise<WorkerExecuteResult> {
    try {
      const mod = await loadToolModuleInProcess(entryPath);
      const handler = findHandler(mod, toolCall.name);

      if (!handler) {
        return {
          type: "result",
          requestId: generateRequestId(),
          status: "error",
          error: {
            message: `Handler function not found for tool: ${toolCall.name} in ${entryPath}`,
            name: "HandlerNotFoundError",
          },
        };
      }

      const context = this.createInProcessContext(contextData, activeRef);
      const output = await handler(context, toolCall.input);

      return {
        type: "result",
        requestId: generateRequestId(),
        status: "ok",
        output: output ?? null,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        type: "result",
        requestId: generateRequestId(),
        status: "error",
        error: {
          message: err.message,
          name: err.name,
        },
      };
    }
  }

  private async trimIdleGenerations(): Promise<void> {
    if (!this.isolateByRevision) {
      return;
    }

    if (this.workersByRef.size <= this.maxActiveGenerations) {
      return;
    }

    const candidates = Array.from(this.workersByRef.values())
      .filter((state) => state.inFlightTurns === 0 && state.inFlightCalls === 0)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    for (const candidate of candidates) {
      if (this.workersByRef.size <= this.maxActiveGenerations) {
        break;
      }

      this.workersByRef.delete(candidate.ref);
      rejectAllPendingRequests(
        candidate,
        new Error(`Tool worker retired for ref '${candidate.ref}'`),
      );
      await candidate.worker.terminate();
    }
  }
}

/**
 * ToolExecutor 구현 생성
 */
export function createToolExecutorImpl(
  options: ToolExecutorImplOptions,
): RevisionedToolExecutor {
  return new RevisionedToolExecutorImpl(options);
}
