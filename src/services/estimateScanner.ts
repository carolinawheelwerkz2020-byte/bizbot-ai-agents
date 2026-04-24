import { authenticatedFetch } from '../lib/authHeaders';

export type EstimateLeadCandidate = {
  messageId: string;
  threadId?: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  status: 'hot_estimate_lead' | 'needs_reply' | 'low_confidence';
  requestedService: string;
  missingInfo: string[];
  urgency: 'high' | 'normal' | 'low';
  photosAttached: boolean;
  recommendedNextAction: string;
  dashboardFields: {
    customerName: string;
    email: string;
    phone?: string;
    vehicle?: string;
    wheelIssue?: string;
    serviceRequested: string;
    photosAttached: boolean;
    status: string;
    recommendedFollowUp: string;
  };
  draftReply: string;
};

export type EstimateScanRun = {
  id: string;
  ranAt: string;
  configured: boolean;
  authMode: 'oauth-refresh-token' | 'not-configured';
  query: string;
  lookbackDays: number;
  leads: EstimateLeadCandidate[];
  summary: string;
  setupSteps?: string[];
  error?: string;
};

export type EstimateScannerStatus = {
  configured: boolean;
  authMode: 'oauth-refresh-token' | 'not-configured';
  scope: string;
  recentRuns: EstimateScanRun[];
  setupSteps: string[];
};

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `Error ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json() as { error?: string; details?: string };
      errorMessage = errorData.error || errorData.details || errorMessage;
    } catch {
      // Keep default message for non-JSON responses.
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

async function scannerFetch<T>(input: string, init?: RequestInit) {
  const response = await authenticatedFetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  return parseApiResponse<T>(response);
}

export const EstimateScannerService = {
  getStatus() {
    return scannerFetch<EstimateScannerStatus>('/api/integrations/gmail/estimate-scanner/status');
  },

  run(payload?: { lookbackDays?: number; maxResults?: number }) {
    return scannerFetch<EstimateScanRun>('/api/integrations/gmail/estimate-scanner/run', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },
};
