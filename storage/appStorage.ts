export const STORAGE_COLLECTIONS = {
  approvals: "bizbot_approvals",
  schedules: "bizbot_schedules",
  runHistory: "bizbot_run_history",
  runTemplates: "bizbot_run_templates",
  neuralMemory: "bizbot_neural_memory",
  registeredTools: "bizbot_registered_tools",
  healingRecipes: "bizbot_healing_recipes",
  browserTrace: "bizbot_browser_trace",
  jobRuns: "bizbot_job_runs",
  workers: "bizbot_workers",
} as const;

export type StorageMode = "local-json" | "firestore";

export function getStorageMode(): StorageMode {
  return process.env.BIZBOT_STORAGE_MODE === "firestore" ? "firestore" : "local-json";
}
