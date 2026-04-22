import { authHeaderObject } from '../lib/authHeaders';
import { formatExecutionError, type ExecutionErrorLike } from '../lib/formatExecutionError';
import type { WorkerCapability } from './autonomy';

export type ExecutionSummary = {
  id: string;
  action: string;
  success: boolean;
  summary: string;
  timestamp: string;
  workerId?: string;
  executor: 'local' | 'remote' | 'unavailable';
  type?: ExecutionErrorLike['type'];
  durationMs?: number;
};

export type WorkerDiagnostic = {
  id: string;
  name: string;
  platform: string;
  status: 'online' | 'offline' | 'busy';
  online: boolean;
  capabilities: WorkerCapability[];
  verifiedCapabilities: WorkerCapability[];
  lastHeartbeat: string;
  lastHeartbeatAt: string;
  lastHeartbeatAgeMs: number | null;
  failedTaskCount: number;
  currentTask?: string;
  currentTaskId?: string;
  authMode: 'api-key' | 'dev-fallback';
  endpoint?: string;
  host?: string;
  recentExecutionSummary: ExecutionSummary[];
};

export type ServerDiagnostics = {
  storageMode: string;
  workerAuthMode: 'api-key' | 'dev-fallback';
  heartbeatTtlMs: number;
  executionTimeouts: {
    localCommandMs: number;
    remoteWorkerMs: number;
    browserActionMs: number;
  };
  onlineWorkers: WorkerDiagnostic[];
  pendingApprovals: number;
  recentExecutionFailures: ExecutionSummary[];
};

export type WorkersDiagnosticsResponse = {
  workers: WorkerDiagnostic[];
  recentExecutionFailures: ExecutionSummary[];
};

export type DiagnosticsTestAction =
  | 'ping_worker'
  | 'safe_echo'
  | 'safe_read'
  | 'capability_missing'
  | 'simulate_timeout';

export type DiagnosticsTestResult = ExecutionErrorLike & {
  ok: boolean;
  success?: boolean;
  executor: 'local' | 'remote' | 'unavailable';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  content?: string;
  metadata?: Record<string, unknown>;
};

async function diagnosticsFetch<T>(input: string, init?: RequestInit) {
  const authHeaders = await authHeaderObject();
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders,
      ...init?.headers,
    },
  });

  const payload = await response.json().catch(() => ({})) as T & ExecutionErrorLike;
  if (!response.ok && !('ok' in (payload as Record<string, unknown>))) {
    throw new Error(formatExecutionError(payload));
  }
  return payload as T;
}

export const DiagnosticsService = {
  getServer() {
    return diagnosticsFetch<ServerDiagnostics>('/api/diagnostics/server');
  },

  getWorkers() {
    return diagnosticsFetch<WorkersDiagnosticsResponse>('/api/diagnostics/workers');
  },

  getWorker(id: string) {
    return diagnosticsFetch<WorkerDiagnostic>(`/api/diagnostics/workers/${encodeURIComponent(id)}`);
  },

  runTest(action: DiagnosticsTestAction, workerId?: string) {
    return diagnosticsFetch<DiagnosticsTestResult>('/api/diagnostics/test', {
      method: 'POST',
      body: JSON.stringify({ action, workerId }),
    });
  },
};
