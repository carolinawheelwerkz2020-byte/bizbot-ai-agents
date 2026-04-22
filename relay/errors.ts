import type { ExecutionErrorType, ExecutionResponse } from "./types";

export function executionError(input: {
  error: string;
  type: ExecutionErrorType;
  executor?: ExecutionResponse["executor"];
  workerId?: string;
  details?: unknown;
  durationMs?: number;
  unavailableReason?: string;
}): ExecutionResponse {
  return {
    ok: false,
    success: false,
    executor: input.executor || "unavailable",
    workerId: input.workerId,
    error: input.error,
    type: input.type,
    details: input.details,
    durationMs: input.durationMs,
    unavailableReason: input.unavailableReason,
  };
}

export function normalizeExecutionError(
  error: unknown,
  type: ExecutionErrorType,
  executor: ExecutionResponse["executor"],
  workerId?: string,
): ExecutionResponse {
  return executionError({
    error: error instanceof Error ? error.message : "Unknown execution error.",
    type,
    executor,
    workerId,
  });
}

