export function logWorkerEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    scope: "worker-execution",
    event,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}
