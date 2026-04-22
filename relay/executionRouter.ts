import type { Executor, ExecutionRequest, ExecutionResponse, WorkerCapability, WorkerNode } from "./types";
import { RemoteExecutor } from "./remoteExecutor";
import { WorkerRegistry } from "../storage/workerRegistry";
import type { ExecutionDiagnosticsStore } from "../storage/executionDiagnostics";
import { executionError } from "./errors";
import { logWorkerEvent } from "./logger";

const CAPABILITY_BY_KIND: Record<ExecutionRequest["kind"], WorkerCapability[]> = {
  command: ["shell"],
  "file.read": ["filesystem"],
  "file.write": ["filesystem"],
  "file.edit": ["filesystem"],
  "browser.action": ["playwright"],
  tool: ["tool"],
};

export type ExecutionRouterOptions = {
  localExecutor: Executor;
  workerRegistry: WorkerRegistry;
  remoteExecutor?: Executor;
  preferRemote?: boolean;
  diagnostics?: ExecutionDiagnosticsStore;
};

export class ExecutionRouter {
  private readonly remoteExecutor: Executor;

  constructor(private readonly options: ExecutionRouterOptions) {
    this.remoteExecutor = options.remoteExecutor || new RemoteExecutor({
      timeoutMs: Number(process.env.REMOTE_WORKER_TIMEOUT_MS || 60_000),
    });
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    const requiredCapabilities = request.requiredCapabilities || CAPABILITY_BY_KIND[request.kind] || [];
    logWorkerEvent("router.received", {
      action: request.kind,
      requiredCapabilities,
      preferredWorkerId: request.preferredWorkerId,
    });

    if (!this.options.preferRemote) {
      const local = await this.options.localExecutor.execute(request);
      if (local.executor !== "unavailable") {
        logWorkerEvent(local.ok ? "router.local.success" : "router.local.fail", {
          action: request.kind,
          error: local.error,
          type: local.type,
        });
        this.options.diagnostics?.record(request, local);
        return local;
      }
    }

    const worker = this.options.workerRegistry.findCompatible(requiredCapabilities, request.preferredWorkerId);
    if (!worker) {
      const workers = this.options.workerRegistry.list();
      const onlineWorkers = workers.filter((candidate) => candidate.status === "online");
      const preferredWorker = request.preferredWorkerId
        ? workers.find((candidate) => candidate.id === request.preferredWorkerId)
        : undefined;
      const detail = preferredWorker
        ? `Requested worker "${request.preferredWorkerId}" is ${preferredWorker.status} with capabilities: ${preferredWorker.capabilities.join(", ") || "none"}.`
        : `Online workers: ${onlineWorkers.length}. Required capabilities: ${requiredCapabilities.join(", ") || request.kind}.`;
      if (this.options.preferRemote) {
        const result = executionError({
          error: "No suitable worker is available.",
          type: "capability_missing",
          executor: "unavailable",
          unavailableReason: `No suitable worker is available. ${detail}`,
          details: { requiredCapabilities, preferredWorkerId: request.preferredWorkerId },
        });
        this.options.diagnostics?.record(request, result);
        return result;
      }
      const result = executionError({
        error: `No executor supports ${request.kind}.`,
        type: "capability_missing",
        executor: "unavailable",
        unavailableReason: `No executor supports ${request.kind}. ${detail}`,
        details: { requiredCapabilities, preferredWorkerId: request.preferredWorkerId },
      });
      this.options.diagnostics?.record(request, result);
      return result;
    }

    logWorkerEvent("router.remote.selected", {
      action: request.kind,
      workerId: worker.id,
      capabilities: worker.verifiedCapabilities || worker.capabilities,
    });
    const result = await this.remoteExecutor.execute({ ...request, worker } as ExecutionRequest & { worker: WorkerNode });
    this.options.workerRegistry.markTaskResult(worker.id, !result.ok);
    this.options.diagnostics?.record(request, result);
    return result;
  }
}
