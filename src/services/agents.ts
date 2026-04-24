import { authenticatedFetch } from '../lib/authHeaders';
import type { Agent } from './gemini';

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Error ${response.status}: ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      message = payload.error || message;
    } catch {
      // Ignore non-JSON responses.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function agentFetch<T>(input: string, init?: RequestInit) {
  return parseApiResponse<T>(
    await authenticatedFetch(input, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    }),
  );
}

export const AgentRegistryService = {
  async listCustomAgents() {
    const response = await agentFetch<{ agents: Agent[] } | Agent[]>('/api/agents');
    return Array.isArray(response) ? response : response.agents || [];
  },

  createAgent(payload: Partial<Agent> & Pick<Agent, 'name' | 'role' | 'description' | 'systemInstruction'>) {
    return agentFetch<Agent>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
