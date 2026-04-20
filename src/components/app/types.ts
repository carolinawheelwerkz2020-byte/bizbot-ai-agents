import type { WorkflowShape } from '../../services/handoffPlan';
import type { PersistedMessage } from '../../services/persistence';

export type AppView = 'chat' | 'agents' | 'workflows' | 'toolbox';

export interface Message extends PersistedMessage {}

export interface WorkflowStepRun {
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

export interface WorkflowState {
  workflow: WorkflowShape;
  currentStep: number;
  isRunning: boolean;
  outputs: string[];
  steps: WorkflowStepRun[];
  startedAt: Date;
  completedAt?: Date;
}

export type SystemLog = {
  msg: string;
  type: 'info' | 'warn' | 'success' | 'agent';
};

export type ApprovalSummary = {
  pendingCount: number;
};

export type RunSummary = {
  id: string;
  agentId: string;
  title: string;
  sourcePrompt: string;
  startedAt: Date;
  completedAt: Date;
  status: 'completed' | 'failed';
  handoffCount: number;
  approvalCount: number;
  workflowLaunched: boolean;
  notes: string;
};
