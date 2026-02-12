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
  errorMessageLimit?: number;
}

const DEFAULT_ERROR_MESSAGE_LIMIT = 1000;

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
      const limit = request.errorMessageLimit ?? DEFAULT_ERROR_MESSAGE_LIMIT;
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        status: "error",
        error: toToolError(error, limit),
      };
    }
  }
}

function isToolInCatalog(toolName: string, catalog: ToolCatalogItem[]): boolean {
  return catalog.some((item) => item.name === toolName);
}

function toToolError(error: unknown, limit: number): {
  name?: string;
  message: string;
  code?: string;
  suggestion?: string;
  helpUrl?: string;
} {
  if (error instanceof Error) {
    const toolError: {
      name?: string;
      message: string;
      code?: string;
      suggestion?: string;
      helpUrl?: string;
    } = {
      name: error.name,
      message: truncateErrorMessage(error.message, limit),
    };

    if (hasCode(error)) {
      toolError.code = error.code;
    }

    if (hasSuggestion(error)) {
      toolError.suggestion = error.suggestion;
    }

    if (hasHelpUrl(error)) {
      toolError.helpUrl = error.helpUrl;
    }

    return toolError;
  }

  return {
    message: truncateErrorMessage("Unknown tool execution error", limit),
  };
}

function hasCode(error: Error): error is Error & { code: string } {
  if (!("code" in error)) {
    return false;
  }

  const maybeCode = Reflect.get(error, "code");
  return typeof maybeCode === "string";
}

function hasSuggestion(error: Error): error is Error & { suggestion: string } {
  if (!("suggestion" in error)) {
    return false;
  }

  const maybeSuggestion = Reflect.get(error, "suggestion");
  return typeof maybeSuggestion === "string";
}

function hasHelpUrl(error: Error): error is Error & { helpUrl: string } {
  if (!("helpUrl" in error)) {
    return false;
  }

  const maybeHelpUrl = Reflect.get(error, "helpUrl");
  return typeof maybeHelpUrl === "string";
}

export function truncateErrorMessage(message: string, limit: number): string {
  if (message.length <= limit) {
    return message;
  }

  const truncationSuffix = "... (truncated)";
  const maxContentLength = limit - truncationSuffix.length;
  if (maxContentLength <= 0) {
    return message.slice(0, limit);
  }

  return message.slice(0, maxContentLength) + truncationSuffix;
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
