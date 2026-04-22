export type ExecutionErrorLike = {
  error?: string;
  type?: 'timeout' | 'capability_missing' | 'auth' | 'execution' | 'validation' | 'network';
  workerId?: string;
  durationMs?: number;
  unavailableReason?: string;
};

export function formatExecutionError(error: ExecutionErrorLike) {
  switch (error.type) {
    case 'auth':
      return 'Worker auth failed. Check WORKER_API_KEY.';
    case 'timeout':
      return `Execution timed out${error.durationMs ? ` after ${error.durationMs} ms` : ''}.`;
    case 'capability_missing':
      return error.unavailableReason || 'This worker does not support the required capability.';
    case 'network':
      return 'Worker is offline or unreachable.';
    case 'validation':
      return error.error || 'The requested action was blocked by validation.';
    case 'execution':
      return error.error || 'The worker failed while executing the action.';
    default:
      return error.error || error.unavailableReason || 'Execution failed.';
  }
}
