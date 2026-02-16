import type { JsonObject, JsonValue, ToolContext, ToolHandler } from '../types.js';
import { optionalString } from '../utils.js';

export const request: ToolHandler = async (
  _ctx: ToolContext,
  input: JsonObject
): Promise<JsonValue> => {
  const rawReason = optionalString(input, 'reason');
  const reason = rawReason && rawReason.trim().length > 0
    ? rawReason.trim()
    : 'tool:self-restart';

  return {
    ok: true,
    restartRequested: true,
    restartReason: reason,
  };
};

export const handlers = {
  request,
} satisfies Record<string, ToolHandler>;
