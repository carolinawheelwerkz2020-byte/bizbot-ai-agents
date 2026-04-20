import { authHeaderObject } from '../lib/authHeaders';

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

export type AutonomyOverview = {
  registeredTools: RegisteredTool[];
  healingRecipes: HealingRecipe[];
  approvals: PendingApproval[];
  approvalPolicy: ApprovalPolicy;
  currentUserRole: UserRole;
  relay: {
    allowedCommands: string[];
    allowedRoots: string[];
  };
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
  const authHeaders = await authHeaderObject();
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders,
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
};
