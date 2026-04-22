import type { WorkerCapability, WorkerNode, WorkerPlatform, WorkerStatus } from "../relay/types";
import { logWorkerEvent } from "../relay/logger";

export type WorkerRegistration = {
  id?: string;
  name: string;
  platform?: WorkerPlatform;
  capabilities?: WorkerCapability[];
  endpoint?: string;
  host?: string;
  metadata?: Record<string, unknown>;
  verifiedCapabilities?: WorkerCapability[];
};

export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerNode>();
  private readonly ttlMs: number;

  constructor(ttlMs = 45_000) {
    this.ttlMs = ttlMs;
  }

  register(input: WorkerRegistration) {
    const id = input.id?.trim() || `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const existing = this.workers.get(id);
    const worker: WorkerNode = {
      id,
      name: input.name.trim() || existing?.name || id,
      platform: input.platform || existing?.platform || "unknown",
      status: "online",
      capabilities: input.capabilities || existing?.capabilities || [],
      verifiedCapabilities: input.verifiedCapabilities || input.capabilities || existing?.verifiedCapabilities || [],
      endpoint: input.endpoint || existing?.endpoint,
      host: input.host || existing?.host,
      metadata: input.metadata || existing?.metadata,
      currentTask: existing?.currentTask,
      currentTaskId: existing?.currentTaskId,
      lastHeartbeat: now,
      lastHeartbeatAt: now,
      failedTasksCount: existing?.failedTasksCount || 0,
    };
    this.workers.set(id, worker);
    logWorkerEvent("worker.register", {
      workerId: id,
      platform: worker.platform,
      capabilities: worker.capabilities,
      verifiedCapabilities: worker.verifiedCapabilities,
      result: "success",
    });
    return worker;
  }

  heartbeat(id: string, status: WorkerStatus = "online", currentTask?: string, currentTaskId?: string) {
    const worker = this.workers.get(id);
    if (!worker) {
      throw new Error(`Worker ${id} is not registered.`);
    }
    const next: WorkerNode = {
      ...worker,
      status,
      currentTask,
      currentTaskId,
      lastHeartbeat: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };
    this.workers.set(id, next);
    logWorkerEvent("worker.heartbeat", {
      workerId: id,
      status,
      currentTask,
      result: "success",
    });
    return next;
  }

  list() {
    const now = Date.now();
    return [...this.workers.values()].map((worker) => {
      const lastSeen = new Date(worker.lastHeartbeat).getTime();
      if (worker.status !== "offline" && Number.isFinite(lastSeen) && now - lastSeen > this.ttlMs) {
        const offline = { ...worker, status: "offline" as const };
        this.workers.set(worker.id, offline);
        return offline;
      }
      return worker;
    });
  }

  findCompatible(capabilities: WorkerCapability[], preferredWorkerId?: string) {
    const onlineWorkers = this.list().filter((worker) => worker.status === "online");
    const candidates = preferredWorkerId
      ? onlineWorkers.filter((worker) => worker.id === preferredWorkerId)
      : onlineWorkers;

    return candidates
      .filter((worker) => {
        const verified = worker.verifiedCapabilities || worker.capabilities;
        const quarantineMs = worker.quarantinedUntil ? new Date(worker.quarantinedUntil).getTime() : 0;
        return (!quarantineMs || quarantineMs <= Date.now())
          && capabilities.every((capability) => verified.includes(capability));
      })
      .sort((a, b) => {
        const failureDelta = (a.failedTasksCount || 0) - (b.failedTasksCount || 0);
        if (failureDelta !== 0) return failureDelta;
        return new Date(b.lastHeartbeatAt).getTime() - new Date(a.lastHeartbeatAt).getTime();
      })[0];
  }

  get(id: string) {
    return this.list().find((worker) => worker.id === id);
  }

  markTaskResult(id: string, failed: boolean) {
    const worker = this.workers.get(id);
    if (!worker) return;
    const failedTasksCount = failed ? (worker.failedTasksCount || 0) + 1 : worker.failedTasksCount || 0;
    this.workers.set(id, {
      ...worker,
      status: "online",
      currentTask: undefined,
      currentTaskId: undefined,
      failedTasksCount,
      quarantinedUntil: failedTasksCount >= 3 ? new Date(Date.now() + 60_000).toISOString() : worker.quarantinedUntil,
      lastHeartbeat: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    });
    logWorkerEvent("worker.task_result", {
      workerId: id,
      result: failed ? "fail" : "success",
      failedTasksCount,
    });
  }
}
