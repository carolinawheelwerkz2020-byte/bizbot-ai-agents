import { authenticatedFetch } from '../lib/authHeaders';

export type RegisteredTool = {
  id: string;
  description: string;
  command: string;
  cwd?: string;
  createdAt: string;
};

export type HealingRecipeStep = {
  type: 'command' | 'tool';
  value: string;
};

export type HealingRecipe = {
  id: string;
  description: string;
  steps: HealingRecipeStep[];
  createdAt: string;
};

export type CommandResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  signal?: string | null;
};

export type SelfHealResult = {
  success: boolean;
  steps: Array<Record<string, unknown>>;
};

export type ApprovalActionType =
  | 'register_tool'
  | 'install_npm_package'
  | 'save_healing_recipe'
  | 'run_healing_recipe'
  | 'self_heal_project';

export type UserRole = 'operator' | 'approver' | 'admin';

export type ApprovalPolicy = Record<ApprovalActionType, {
  requestRole: UserRole;
  approveRole: UserRole;
}>;

export type PendingApproval = {
  id: string;
  type: ApprovalActionType;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  requestedBy?: string;
  requestedByRole?: UserRole;
  result?: unknown;
};

export type BrowserTraceEntry = {
  id: string;
  action: string;
  status: 'success' | 'error';
  createdAt: string;
  url?: string;
  title?: string;
  details?: Record<string, unknown>;
  error?: string;
  artifactPath?: string;
};

export type BrowserReadResult = {
  title: string;
  url: string;
  content: string;
};

export type ScheduledJobTargetType = 'tool' | 'recipe' | 'self_heal' | 'estimate_scan';

export type ScheduledJob = {
  id: string;
  name: string;
  targetType: ScheduledJobTargetType;
  targetId?: string;
  intervalMinutes: number;
  status: 'active' | 'paused';
  createdAt: string;
  lastRunAt?: string;
  nextRunAt: string;
  lastResultStatus?: 'completed' | 'failed';
  lastResultSummary?: string;
};

export type JobRun = {
  id: string;
  scheduleId?: string;
  name: string;
  targetType: ScheduledJobTargetType;
  targetId?: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  startedAt: string;
  completedAt?: string;
  outputSummary?: string;
};

export type WorkerCapability =
  | 'shell'
  | 'filesystem'
  | 'git'
  | 'npm'
  | 'playwright'
  | 'browser'
  | 'seo_audit'
  | 'memory'
  | 'scheduler'
  | 'tool'
  | 'command'
  | 'file:read'
  | 'file:write'
  | 'file:edit';

export type WorkerNode = {
  id: string;
  name: string;
  platform: 'mac' | 'macos' | 'windows' | 'linux' | 'cloud' | 'unknown';
  status: 'online' | 'offline' | 'busy';
  lastHeartbeat: string;
  lastHeartbeatAt: string;
  capabilities: WorkerCapability[];
  currentTask?: string;
  currentTaskId?: string;
  endpoint?: string;
  host?: string;
  metadata?: Record<string, unknown>;
  failedTasksCount?: number;
};

export type AutonomyOverview = {
  registeredTools: RegisteredTool[];
  healingRecipes: HealingRecipe[];
  approvals: PendingApproval[];
  approvalPolicy: ApprovalPolicy;
  currentUserRole: UserRole;
  browser: {
    sessionOpen: boolean;
    headless: boolean;
    artifactsDir: string;
    recentTrace: BrowserTraceEntry[];
    lastActionAt?: string;
    lastError?: string;
    currentUrl: string;
  };
  schedules: ScheduledJob[];
  jobRuns: JobRun[];
  telemetry: {
    pendingApprovals: number;
    approvedApprovals: number;
    rejectedApprovals: number;
    activeSchedules: number;
    runningJobs: number;
    completedJobs: number;
    failedJobs: number;
    browserSuccesses: number;
    browserFailures: number;
  };
  relay: {
    allowedCommands: string[];
    allowedRoots: string[];
  };
  execution?: {
    mode: 'local-first' | 'remote-preferred';
    workerHeartbeatTtlMs: number;
    cloudSafeTools: string[];
    workerRequiredTools: string[];
  };
  workers?: WorkerNode[];
  limits: {
    maxHealingSteps: number;
    maxFetchedPageChars: number;
    maxCrawlPages: number;
  };
};

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `Error ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json() as { error?: string; details?: string };
      errorMessage = errorData.error || errorData.details || errorMessage;
    } catch {
      // Ignore non-JSON responses.
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

async function autonomyFetch<T>(input: string, init?: RequestInit) {
  const response = await authenticatedFetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  return parseApiResponse<T>(response);
}

export const AutonomyService = {
  getOverview() {
    return autonomyFetch<AutonomyOverview>('/api/autonomy/overview');
  },

  registerTool(payload: {
    id: string;
    description: string;
    command: string;
    cwd?: string;
  }) {
    return autonomyFetch<PendingApproval>('/api/autonomy/tools', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  runTool(id: string) {
    return autonomyFetch<RegisteredTool & CommandResult>('/api/autonomy/tools/run', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },

  installPackage(packageName: string, saveDev: boolean) {
    return autonomyFetch<PendingApproval>('/api/autonomy/install-package', {
      method: 'POST',
      body: JSON.stringify({ packageName, saveDev }),
    });
  },

  saveHealingRecipe(payload: {
    id: string;
    description: string;
    stepsJson: string;
  }) {
    return autonomyFetch<PendingApproval>('/api/autonomy/healing-recipes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  runHealingRecipe(id: string) {
    return autonomyFetch<PendingApproval>('/api/autonomy/healing-recipes/run', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },

  selfHealProject() {
    return autonomyFetch<PendingApproval>('/api/autonomy/self-heal', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  approveAction(id: string) {
    return autonomyFetch<PendingApproval>(`/api/autonomy/approvals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  rejectAction(id: string, reason?: string) {
    return autonomyFetch<PendingApproval>(`/api/autonomy/approvals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  createSchedule(payload: {
    name: string;
    targetType: ScheduledJobTargetType;
    targetId?: string;
    intervalMinutes: number;
  }) {
    return autonomyFetch<ScheduledJob>('/api/autonomy/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  toggleSchedule(id: string, active: boolean) {
    return autonomyFetch<ScheduledJob>(`/api/autonomy/schedules/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
  },

  runScheduleNow(id: string) {
    return autonomyFetch<JobRun>(`/api/autonomy/schedules/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  replayBrowserTrace(traceId: string) {
    return autonomyFetch<BrowserReadResult>('/api/autonomy/browser/replay', {
      method: 'POST',
      body: JSON.stringify({ traceId }),
    });
  },
};
