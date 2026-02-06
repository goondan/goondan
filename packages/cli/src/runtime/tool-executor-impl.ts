/**
 * ToolExecutorImpl: Tool entry 모듈의 동적 로드 및 실행
 *
 * Tool의 spec.entry 경로에서 모듈을 동적 import하고,
 * export된 핸들러 함수를 호출하여 ToolResult를 반환합니다.
 *
 * @see /docs/specs/tool.md
 * @see /docs/specs/runtime.md - 6.4 Tool 실행
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolExecutor, Step, ToolCall, ToolResult } from "@goondan/core/runtime";
import type { JsonValue, JsonObject } from "@goondan/core";

/**
 * Tool 모듈의 export 함수 타입
 */
interface ToolHandlerFn {
  (input: JsonObject, context: ToolExecutionContext): Promise<JsonValue> | JsonValue;
}

/**
 * Tool 실행 컨텍스트 (Tool 핸들러에 전달)
 */
interface ToolExecutionContext {
  /** Tool call ID */
  toolCallId: string;
  /** Step 참조 */
  step: Step;
}

/**
 * 모듈 캐시 (동일 모듈 중복 import 방지)
 */
const moduleCache = new Map<string, Record<string, unknown>>();

/**
 * Tool entry에서 모듈 로드
 */
async function loadToolModule(
  entryPath: string,
): Promise<Record<string, unknown>> {
  const cached = moduleCache.get(entryPath);
  if (cached) {
    return cached;
  }

  const absolutePath = path.isAbsolute(entryPath)
    ? entryPath
    : path.resolve(process.cwd(), entryPath);

  const moduleUrl = pathToFileURL(absolutePath).href;
  const mod = await import(moduleUrl) as Record<string, unknown>;
  moduleCache.set(entryPath, mod);
  return mod;
}

/**
 * Tool export에서 핸들러 함수 찾기
 *
 * export name은 "namespace.functionName" 형식일 수 있음
 * 모듈에서는 다음 순서로 찾기:
 * 1. 정확한 이름으로 export된 함수 (예: "delegate.toAgent")
 * 2. camelCase 변환 (예: "delegateToAgent")
 * 3. 마지막 세그먼트 (예: "toAgent")
 * 4. default export
 */
function findHandler(
  mod: Record<string, unknown>,
  exportName: string,
): ToolHandlerFn | null {
  // 1. 정확한 이름
  if (typeof mod[exportName] === "function") {
    return mod[exportName] as ToolHandlerFn;
  }

  // 2. dot을 camelCase로 변환
  const camelCase = exportName.replace(/\.(\w)/g, (_, c: string) =>
    c.toUpperCase(),
  );
  if (typeof mod[camelCase] === "function") {
    return mod[camelCase] as ToolHandlerFn;
  }

  // 3. 마지막 세그먼트
  const segments = exportName.split(".");
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && typeof mod[lastSegment] === "function") {
    return mod[lastSegment] as ToolHandlerFn;
  }

  // 4. default export
  if (typeof mod["default"] === "function") {
    return mod["default"] as ToolHandlerFn;
  }

  // default export가 객체이고 그 안에 함수가 있는 경우
  if (mod["default"] && typeof mod["default"] === "object") {
    const defaultObj = mod["default"] as Record<string, unknown>;
    if (typeof defaultObj[exportName] === "function") {
      return defaultObj[exportName] as ToolHandlerFn;
    }
    if (typeof defaultObj[camelCase] === "function") {
      return defaultObj[camelCase] as ToolHandlerFn;
    }
    if (lastSegment && typeof defaultObj[lastSegment] === "function") {
      return defaultObj[lastSegment] as ToolHandlerFn;
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
 * ToolExecutorImpl 생성 옵션
 */
export interface ToolExecutorImplOptions {
  /** Bundle 루트 디렉토리 (entry 상대 경로 해석에 사용) */
  bundleRootDir: string;
}

/**
 * ToolExecutor 구현 생성
 */
export function createToolExecutorImpl(
  options: ToolExecutorImplOptions,
): ToolExecutor {
  const { bundleRootDir } = options;

  return {
    async execute(toolCall: ToolCall, step: Step): Promise<ToolResult> {
      // Step의 effectiveConfig에서 해당 tool의 entry 경로 찾기
      const catalogItem = step.toolCatalog.find(
        (item) => item.name === toolCall.name,
      );

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

      // Tool resource에서 entry 경로 가져오기
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
        : path.resolve(bundleRootDir, toolSpec.entry);

      try {
        // 모듈 로드
        const mod = await loadToolModule(entryPath);

        // 핸들러 찾기
        const handler = findHandler(mod, toolCall.name);
        if (!handler) {
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            error: {
              status: "error",
              error: {
                message: `Handler function not found for tool: ${toolCall.name} in ${entryPath}`,
                name: "HandlerNotFoundError",
              },
            },
          };
        }

        // 실행
        const context: ToolExecutionContext = {
          toolCallId: toolCall.id,
          step,
        };

        const output = await handler(toolCall.input, context);

        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: output ?? null,
        };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error(String(err));
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
    },
  };
}
