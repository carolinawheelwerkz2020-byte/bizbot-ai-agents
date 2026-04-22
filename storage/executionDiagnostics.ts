import type { ExecutionRequest, ExecutionResponse, ExecutionSummary } from "../relay/types";

const MAX_EXECUTION_SUMMARIES = 80;

export class ExecutionDiagnosticsStore {
  private readonly summaries: ExecutionSummary[] = [];

  record(request: ExecutionRequest, response: ExecutionResponse) {
    const summary: ExecutionSummary = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: request.kind,
      success: response.ok,
      summary: response.ok
        ? `Completed ${request.kind}${response.workerId ? ` on ${response.workerId}` : ""}.`
        : response.error || response.unavailableReason || `Failed ${request.kind}.`,
      timestamp: new Date().toISOString(),
      workerId: response.workerId,
      executor: response.executor,
      type: response.type,
      durationMs: response.durationMs,
    };
    this.summaries.unshift(summary);
    this.summaries.splice(MAX_EXECUTION_SUMMARIES);
    return summary;
  }

  list(limit = 20) {
    return this.summaries.slice(0, limit);
  }

  failures(limit = 20) {
    return this.summaries.filter((entry) => !entry.success).slice(0, limit);
  }

  byWorker(workerId: string, limit = 10) {
    return this.summaries.filter((entry) => entry.workerId === workerId).slice(0, limit);
  }
}
