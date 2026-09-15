/** The fields `실행 오류` defines, read from a thrown value without depending on the exception class. */
export interface ExecutionError { where: string; codes: string[]; message: string; attempt: number; toolCall?: unknown }

/** Reads an execution error, or reports `undefined` when the value does not carry the fields. */
export function executionError(error: unknown): ExecutionError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("where" in error) || !("codes" in error) || !("attempt" in error)) return undefined;
  const where: unknown = error.where;
  const codes: unknown = error.codes;
  const attempt: unknown = error.attempt;
  const message: unknown = "message" in error ? error.message : "";
  if (typeof where !== "string" || !Array.isArray(codes) || typeof attempt !== "number") return undefined;
  const read: ExecutionError = { where, codes: codes.map((code) => String(code)), message: String(message), attempt };
  if ("toolCall" in error) read.toolCall = error.toolCall;
  return read;
}
