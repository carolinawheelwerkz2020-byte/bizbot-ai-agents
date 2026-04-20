import type { WorkflowShape } from '../../services/handoffPlan';
import type { PersistedMessage } from '../../services/persistence';

export type AppView = 'chat' | 'agents' | 'workflows' | 'toolbox';

export interface Message extends PersistedMessage {}

export interface WorkflowState {
  workflow: WorkflowShape;
  currentStep: number;
  isRunning: boolean;
  outputs: string[];
}

export type SystemLog = {
  msg: string;
  type: 'info' | 'warn' | 'success' | 'agent';
};
