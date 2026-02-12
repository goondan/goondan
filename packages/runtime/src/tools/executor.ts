import type {
  JsonObject,
  Message,
  ToolCallResult,
  ToolContext,
  ToolCatalogItem,
} from "../types.js";
import type { ToolRegistry } from "./registry.js";

export interface ToolExecutionRequest {
  toolCallId: string;
  toolName: string;
  args: JsonObject;
  catalog: ToolCatalogItem[];
  context: ToolContext;
  allowRegistryBypass?: boolean;
}

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(request: ToolExecutionRequest): Promise<ToolCallResult> {
    if (!request.allowRegistryBypass && !isToolInCatalog(request.toolName, request.catalog)) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        status: "error",
        error: {
          name: "ToolNotInCatalogError",
          code: "E_TOOL_NOT_IN_CATALOG",
          message: `Tool '${request.toolName}' is not available in the current Tool Catalog.`,
          suggestion:
            "Agent 구성의 spec.tools에 해당 도구를 추가하거나, step 미들웨어에서 동적으로 등록하세요.",
        },
      };
    }

    const handler = this.registry.getHandler(request.toolName);
    if (handler === undefined) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        status: "error",
        error: {
          name: "ToolNotFoundError",
          code: "E_TOOL_NOT_FOUND",
          message: `Tool '${request.toolName}' is not registered.`,
          suggestion: "Tool registry와 번들 Tool 설정을 확인하세요.",
        },
      };
    }

    try {
      const output = await handler(request.context, request.args);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        status: "ok",
        output,
      };
    } catch (error) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        status: "error",
        error: toToolError(error),
      };
    }
  }
}

function isToolInCatalog(toolName: string, catalog: ToolCatalogItem[]): boolean {
  return catalog.some((item) => item.name === toolName);
}

function toToolError(error: unknown): {
  name?: string;
  message: string;
  code?: string;
} {
  if (error instanceof Error) {
    const toolError: {
      name?: string;
      message: string;
      code?: string;
    } = {
      name: error.name,
      message: error.message,
    };

    if (hasCode(error)) {
      toolError.code = error.code;
    }

    return toolError;
  }

  return {
    message: "Unknown tool execution error",
  };
}

function hasCode(error: Error): error is Error & { code: string } {
  if (!("code" in error)) {
    return false;
  }

  const maybeCode = Reflect.get(error, "code");
  return typeof maybeCode === "string";
}

export function createMinimalToolContext(input: {
  agentName: string;
  instanceKey: string;
  turnId: string;
  traceId: string;
  toolCallId: string;
  message: Message;
  workdir: string;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}): ToolContext {
  return {
    agentName: input.agentName,
    instanceKey: input.instanceKey,
    turnId: input.turnId,
    traceId: input.traceId,
    toolCallId: input.toolCallId,
    message: input.message,
    workdir: input.workdir,
    logger: input.logger ?? console,
  };
}
