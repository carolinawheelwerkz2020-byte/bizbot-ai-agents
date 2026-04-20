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

export type AutonomyOverview = {
  registeredTools: RegisteredTool[];
  healingRecipes: HealingRecipe[];
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
    return autonomyFetch<RegisteredTool>('/api/autonomy/tools', {
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
    return autonomyFetch<CommandResult & { packageName: string; saveDev: boolean }>('/api/autonomy/install-package', {
      method: 'POST',
      body: JSON.stringify({ packageName, saveDev }),
    });
  },

  saveHealingRecipe(payload: {
    id: string;
    description: string;
    stepsJson: string;
  }) {
    return autonomyFetch<HealingRecipe>('/api/autonomy/healing-recipes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  runHealingRecipe(id: string) {
    return autonomyFetch<{
      id: string;
      description: string;
      success: boolean;
      steps: Array<Record<string, unknown>>;
    }>('/api/autonomy/healing-recipes/run', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },

  selfHealProject() {
    return autonomyFetch<SelfHealResult>('/api/autonomy/self-heal', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};
