export type WorkerCapability =
  | "shell"
  | "filesystem"
  | "git"
  | "npm"
  | "playwright"
  | "browser"
  | "seo_audit"
  | "memory"
  | "scheduler"
  | "tool"
  | "command"
  | "file:read"
  | "file:write"
  | "file:edit";

export type WorkerPlatform = "mac" | "macos" | "windows" | "linux" | "cloud" | "unknown";

export type WorkerStatus = "online" | "offline" | "busy";

export type ExecutionErrorType =
  | "timeout"
  | "capability_missing"
  | "auth"
  | "execution"
  | "validation"
  | "network";

export type WorkerNode = {
  id: string;
  name: string;
  platform: WorkerPlatform;
  status: WorkerStatus;
  capabilities: WorkerCapability[];
  lastHeartbeat: string;
  lastHeartbeatAt: string;
  currentTask?: string;
  currentTaskId?: string;
  endpoint?: string;
  host?: string;
  metadata?: Record<string, unknown>;
  failedTasksCount?: number;
  verifiedCapabilities?: WorkerCapability[];
  quarantinedUntil?: string;
};

export type ExecutionKind =
  | "command"
  | "file.read"
  | "file.write"
  | "file.edit"
  | "browser.action"
  | "tool";

export type ExecutionRequest = {
  kind: ExecutionKind;
  command?: string;
  workdir?: string;
  path?: string;
  content?: string;
  oldString?: string;
  newString?: string;
  browserAction?: string;
  toolId?: string;
  payload?: Record<string, unknown>;
  requiredCapabilities?: WorkerCapability[];
  preferredWorkerId?: string;
  taskId?: string;
};

export type ExecutionResponse = {
  ok: boolean;
  success?: boolean;
  executor: "local" | "remote" | "unavailable";
  workerId?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  signal?: string | null;
  content?: string;
  error?: string;
  type?: ExecutionErrorType;
  details?: unknown;
  durationMs?: number;
  unavailableReason?: string;
  metadata?: Record<string, unknown>;
};

export type ExecutionSummary = {
  id: string;
  action: ExecutionKind | string;
  success: boolean;
  summary: string;
  timestamp: string;
  workerId?: string;
  executor: ExecutionResponse["executor"];
  type?: ExecutionErrorType;
  durationMs?: number;
};

export type Executor = {
  execute(request: ExecutionRequest): Promise<ExecutionResponse>;
};

export type ExecutionTarget = {
  worker?: WorkerNode;
  executor: "local" | "remote" | "cloud";
};

export type ToolExecutor = Executor;

export type CommandExecutor = {
  executeCommand(command: string, workdir?: string): Promise<ExecutionResponse>;
};

export type FileExecutor = {
  readFile(path: string): Promise<ExecutionResponse>;
  writeFile(path: string, content: string): Promise<ExecutionResponse>;
  editFile(path: string, oldString: string, newString: string): Promise<ExecutionResponse>;
};

export type BrowserExecutor = {
  executeBrowserAction(action: string, payload?: Record<string, unknown>): Promise<ExecutionResponse>;
};
