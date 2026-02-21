export const DEFAULT_AGENT_REQUEST_TIMEOUT_MS = 60_000;

export function resolveAgentRequestTimeoutMs(timeoutMs: number | undefined): number {
  if (
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    Number.isInteger(timeoutMs) &&
    timeoutMs > 0
  ) {
    return timeoutMs;
  }
  return DEFAULT_AGENT_REQUEST_TIMEOUT_MS;
}
