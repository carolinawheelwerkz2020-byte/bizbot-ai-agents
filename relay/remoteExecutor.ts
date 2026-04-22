import type { ExecutionRequest, ExecutionResponse, Executor, WorkerNode } from "./types";
import { executionError } from "./errors";
import { logWorkerEvent } from "./logger";
import { getWorkerApiKey } from "./workerAuth";

export type RemoteExecutorOptions = {
  timeoutMs?: number;
  retryOnce?: boolean;
};

export class RemoteExecutor implements Executor {
  constructor(private readonly options: RemoteExecutorOptions = {}) {}

  async execute(request: ExecutionRequest & { worker?: WorkerNode }): Promise<ExecutionResponse> {
    if (!request.worker?.endpoint) {
      return executionError({
        error: "No compatible remote worker endpoint is available yet.",
        type: "capability_missing",
        executor: "unavailable",
        workerId: request.worker?.id,
        unavailableReason: "No compatible remote worker endpoint is available yet.",
      });
    }

    const startedAt = Date.now();
    const attempts = this.options.retryOnce === false ? 1 : 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs || 60_000);
      try {
        logWorkerEvent("remote.execute.start", {
          workerId: request.worker.id,
          action: request.kind,
          attempt,
        });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const workerApiKey = getWorkerApiKey();
        if (workerApiKey) {
          headers.Authorization = `Bearer ${workerApiKey}`;
        }

        const response = await fetch(new URL("/execute", request.worker.endpoint), {
          method: "POST",
          headers,
          body: JSON.stringify({ ...request, worker: undefined }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as ExecutionResponse;
        const result = {
          ...payload,
          ok: Boolean(payload.ok),
          success: payload.success ?? Boolean(payload.ok),
          executor: "remote" as const,
          workerId: request.worker.id,
          durationMs: payload.durationMs ?? Date.now() - startedAt,
        };
        logWorkerEvent(result.ok ? "remote.execute.success" : "remote.execute.fail", {
          workerId: request.worker.id,
          action: request.kind,
          status: response.status,
          durationMs: result.durationMs,
          error: result.error,
        });
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") {
          return executionError({
            error: "Execution timed out",
            type: "timeout",
            executor: "remote",
            workerId: request.worker.id,
            durationMs: Date.now() - startedAt,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return executionError({
      error: lastError instanceof Error ? lastError.message : "Remote worker execution failed.",
      type: "network",
      executor: "remote",
      workerId: request.worker.id,
      durationMs: Date.now() - startedAt,
    });
  }
}
