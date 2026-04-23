import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { google } from "googleapis";
import admin from "firebase-admin";
import { chromium, type Browser, type Page } from "playwright";
import { createCommandPolicy } from "./relay/commandPolicy";
import { createFilePolicy } from "./relay/filePolicy";
import { ExecutionRouter } from "./relay/executionRouter";
import { LocalExecutor } from "./relay/localExecutor";
import { executionError } from "./relay/errors";
import { isWorkerRequestAuthorized, unauthorizedWorkerResponse } from "./relay/workerAuth";
import { logWorkerEvent } from "./relay/logger";
import { WorkerRegistry } from "./storage/workerRegistry";
import { ExecutionDiagnosticsStore } from "./storage/executionDiagnostics";
import type { ExecutionRequest, WorkerCapability, WorkerPlatform, WorkerStatus } from "./relay/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, ".env.local"), override: true });

type RequestHistoryEntry = {
  role?: string;
  parts?: Part[];
};

type AuthenticatedRequest = express.Request & {
  userEmail?: string;
  userRole?: UserRole;
};

type UserRole = "operator" | "approver" | "admin";

type RequestFile = {
  mimeType: string;
  data?: string;
  geminiFile?: {
    uri: string;
    mimeType?: string;
  };
};

type UploadedFile = {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
};

type ToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

type RegisteredTool = {
  id: string;
  description: string;
  command: string;
  cwd?: string;
  createdAt: string;
};

type CustomAgent = {
  id: string;
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
  autonomous: boolean;
  icon: string;
  color: string;
  suggestedPrompts: string[];
  createdAt: string;
};

type HealingRecipeStep = {
  type: "command" | "tool";
  value: string;
};

type HealingRecipe = {
  id: string;
  description: string;
  steps: HealingRecipeStep[];
  createdAt: string;
};

type ApprovalActionType =
  | "register_tool"
  | "install_npm_package"
  | "save_healing_recipe"
  | "run_healing_recipe"
  | "self_heal_project";

type PendingApproval = {
  id: string;
  type: ApprovalActionType;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  reason?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  requestedBy?: string;
  requestedByRole?: UserRole;
  result?: unknown;
};

type BrowserTraceEntry = {
  id: string;
  action: string;
  status: "success" | "error";
  createdAt: string;
  url?: string;
  title?: string;
  details?: Record<string, unknown>;
  error?: string;
  artifactPath?: string;
};

type ScheduledJobTargetType = "tool" | "recipe" | "self_heal" | "estimate_scan";

type ScheduledJob = {
  id: string;
  name: string;
  targetType: ScheduledJobTargetType;
  targetId?: string;
  intervalMinutes: number;
  status: "active" | "paused";
  createdAt: string;
  lastRunAt?: string;
  nextRunAt: string;
  lastResultStatus?: "completed" | "failed";
  lastResultSummary?: string;
};

type JobRun = {
  id: string;
  scheduleId?: string;
  name: string;
  targetType: ScheduledJobTargetType;
  targetId?: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  startedAt: string;
  completedAt?: string;
  outputSummary?: string;
};

type EstimateLeadCandidate = {
  messageId: string;
  threadId?: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  status: "hot_estimate_lead" | "needs_reply" | "low_confidence";
  requestedService: string;
  missingInfo: string[];
  urgency: "high" | "normal" | "low";
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

type EstimateScanRun = {
  id: string;
  ranAt: string;
  configured: boolean;
  authMode: "oauth-refresh-token" | "not-configured";
  query: string;
  lookbackDays: number;
  leads: EstimateLeadCandidate[];
  summary: string;
  setupSteps?: string[];
  error?: string;
};

type StoredRunSummary = {
  id: string;
  agentId: string;
  title: string;
  sourcePrompt: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed";
  handoffCount: number;
  approvalCount: number;
  workflowLaunched: boolean;
  notes: string;
};

type StoredRunTemplate = {
  id: string;
  name: string;
  agentId: string;
  prompt: string;
  createdAt: string;
  sourceRunId: string;
  notes?: string;
};

const MAX_MESSAGE_LENGTH = 262_144;
const MAX_FILES = 8;
const MAX_TOTAL_INLINE_BYTES = 80 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/", "video/", "application/pdf", "text/", "application/json"];
const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";
const DEFAULT_RELAY_ALLOWED_COMMANDS = [
  "npm",
  "npx",
  "node",
  "git",
  "tsx",
  "tsc",
  "vite",
  "pnpm",
  "yarn",
  "bun",
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "make",
  "sh",
  "bash",
  "zsh",
];
const RELAY_ALLOWED_COMMANDS = new Set(
  (process.env.RELAY_ALLOWED_COMMANDS || DEFAULT_RELAY_ALLOWED_COMMANDS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const RELAY_ALLOW_SHELL_OPERATORS = process.env.RELAY_ALLOW_SHELL_OPERATORS === "true";
const RELAY_ALLOWED_ROOTS = [
  path.resolve(process.env.RELAY_ROOT || process.cwd()),
];
const MEMORY_STORE_PATH = path.join(process.cwd(), ".bizbot-memory.json");
const TOOL_REGISTRY_PATH = path.join(process.cwd(), ".bizbot-tools.json");
const HEALING_RECIPES_PATH = path.join(process.cwd(), ".bizbot-healing-recipes.json");
const APPROVALS_PATH = path.join(process.cwd(), ".bizbot-approvals.json");
const RUN_HISTORY_PATH = path.join(process.cwd(), ".bizbot-run-history.json");
const RUN_TEMPLATES_PATH = path.join(process.cwd(), ".bizbot-run-templates.json");
const CUSTOM_AGENTS_PATH = path.join(process.cwd(), ".bizbot-agents.json");
const BROWSER_TRACE_PATH = path.join(process.cwd(), ".bizbot-browser-trace.json");
const SCHEDULED_JOBS_PATH = path.join(process.cwd(), ".bizbot-scheduled-jobs.json");
const JOB_RUNS_PATH = path.join(process.cwd(), ".bizbot-job-runs.json");
const ESTIMATE_SCAN_RUNS_PATH = path.join(process.cwd(), ".bizbot-estimate-scans.json");
const WORKER_HEARTBEAT_TTL_MS = Number(process.env.WORKER_HEARTBEAT_TTL_MS || 45_000);
const MAX_FETCHED_PAGE_CHARS = 12_000;
const MAX_CRAWL_PAGES = 20;
const MAX_HEALING_STEPS = 12;
const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "true";
const BROWSER_ARTIFACTS_DIR = path.join(process.cwd(), ".browser-artifacts");
const MAX_BROWSER_TRACE_ENTRIES = 60;
const BROWSER_ACTION_TIMEOUT_MS = 20_000;
const MAX_JOB_RUN_ENTRIES = 120;
const MAX_SCHEDULED_JOBS = 30;
const AUTO_APPROVE_ACTIONS = new Set(
  (process.env.BIZBOT_AUTO_APPROVE_ACTIONS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const ROLE_RANK: Record<UserRole, number> = {
  operator: 1,
  approver: 2,
  admin: 3,
};

const APPROVAL_POLICY: Record<ApprovalActionType, { requestRole: UserRole; approveRole: UserRole }> = {
  register_tool: { requestRole: "operator", approveRole: "approver" },
  install_npm_package: { requestRole: "approver", approveRole: "admin" },
  save_healing_recipe: { requestRole: "operator", approveRole: "approver" },
  run_healing_recipe: { requestRole: "operator", approveRole: "approver" },
  self_heal_project: { requestRole: "approver", approveRole: "admin" },
};

const commandPolicy = createCommandPolicy(RELAY_ALLOWED_COMMANDS);
const filePolicy = createFilePolicy(RELAY_ALLOWED_ROOTS);
const workerRegistry = new WorkerRegistry(WORKER_HEARTBEAT_TTL_MS);
const executionDiagnostics = new ExecutionDiagnosticsStore();
const localExecutor = new LocalExecutor({
  commandPolicy,
  filePolicy,
  defaultCwd: process.cwd(),
  timeoutMs: 60_000,
  allowShellSyntax: RELAY_ALLOW_SHELL_OPERATORS,
});
const executionRouter = new ExecutionRouter({
  localExecutor,
  workerRegistry,
  diagnostics: executionDiagnostics,
  preferRemote: process.env.BIZBOT_PREFER_REMOTE_WORKERS === "true",
});

let browserSession: Browser | null = null;
let browserPageSession: Page | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;
let schedulerTickInFlight = false;

function ensureFirebaseAdmin() {
  if (admin.apps.length > 0) return;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

function getAllowedEmails() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getEmailsFromEnv(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getUserRole(email?: string): UserRole {
  if (!email) return "operator";
  if (getEmailsFromEnv("ADMIN_EMAILS").includes(email)) return "admin";
  if (getEmailsFromEnv("APPROVER_EMAILS").includes(email)) return "approver";
  return "operator";
}

function hasRequiredRole(role: UserRole | undefined, requiredRole: UserRole) {
  return ROLE_RANK[role || "operator"] >= ROLE_RANK[requiredRole];
}

function enforceActionRole(role: UserRole | undefined, actionType: ApprovalActionType, phase: "request" | "approve") {
  const policy = APPROVAL_POLICY[actionType];
  const requiredRole = phase === "request" ? policy.requestRole : policy.approveRole;
  if (!hasRequiredRole(role, requiredRole)) {
    throw new Error(`This action requires ${requiredRole} privileges to ${phase}.`);
  }
}

function getBearerToken(header?: string) {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

async function requireAuth(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.path.startsWith("/workers")) {
    const workerAuth = isWorkerRequestAuthorized(req.headers);
    if (workerAuth.ok) {
      return next();
    }
  }

  if (AUTH_DISABLED) {
    return next();
  }

  try {
    ensureFirebaseAdmin();
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Sign in required." });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email || "").toLowerCase();
    const allowedEmails = getAllowedEmails();

    if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
      return res.status(403).json({ error: "Your account is not authorized for this app." });
    }

    req.userEmail = email || undefined;
    req.userRole = getUserRole(email || undefined);
    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auth error.";
    console.error("[auth]", message);
    return res.status(401).json({ error: "Invalid or expired session. Sign in again." });
  }
}

function isPathInsideRoot(targetPath: string, rootPath: string) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRelayPath(inputPath: string) {
  const resolvedPath = path.resolve(inputPath);
  const isAllowed = RELAY_ALLOWED_ROOTS.some((root) => isPathInsideRoot(resolvedPath, root));
  if (!isAllowed) {
    throw new Error("Requested path is outside the allowed relay workspace.");
  }
  return resolvedPath;
}

function tokenizeCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("No command provided.");
  }

  if (/\brm\s+-rf\b/i.test(trimmed) || /\bsudo\b/i.test(trimmed)) {
    throw new Error("Blocked by command policy: sudo and destructive rm -rf are not allowed.");
  }

  if (/[|&;><`$]/.test(trimmed) && !RELAY_ALLOW_SHELL_OPERATORS) {
    throw new Error("Shell operators are not allowed in relay commands unless RELAY_ALLOW_SHELL_OPERATORS=true.");
  }

  return trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

function validateRelayCommand(command: string) {
  const parts = tokenizeCommand(command);
  const executable = parts[0]?.toLowerCase();
  if (!executable || (!RELAY_ALLOWED_COMMANDS.has("*") && !RELAY_ALLOWED_COMMANDS.has(executable))) {
    throw new Error(`Command "${parts[0] || ""}" is not allowed by the relay policy.`);
  }
  return {
    executable: parts[0],
    args: parts.slice(1),
  };
}

function isAllowedMimeType(mimeType?: string) {
  if (!mimeType) return false;
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix) || mimeType === prefix);
}

function estimateBase64Bytes(data: string) {
  return Math.ceil((data.length * 3) / 4);
}

function validateChatBody(body: {
  message?: unknown;
  files?: RequestFile[];
  history?: RequestHistoryEntry[];
  toolResults?: unknown[];
}) {
  if (body.message != null && String(body.message).length > MAX_MESSAGE_LENGTH) {
    return "Message too long.";
  }

  if (Array.isArray(body.history) && body.history.length > 200) {
    return "History is too long.";
  }

  if (Array.isArray(body.toolResults) && body.toolResults.length > 50) {
    return "Too many tool results were provided.";
  }

  if (Array.isArray(body.files)) {
    if (body.files.length > MAX_FILES) {
      return "Too many files.";
    }

    let totalInlineBytes = 0;

    for (const file of body.files) {
      if (!file || typeof file !== "object") continue;
      const mimeType = file.geminiFile?.mimeType || file.mimeType;

      if (mimeType && !isAllowedMimeType(mimeType)) {
        return "File type not allowed.";
      }

      if (file.data) {
        totalInlineBytes += estimateBase64Bytes(file.data);
      }
    }

    if (totalInlineBytes > MAX_TOTAL_INLINE_BYTES) {
      return "Total inline attachment size too large. Use uploaded files for large attachments.";
    }
  }

  return null;
}

function readJsonArrayFile<T>(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return [] as T[];
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [] as T[];
  }
}

function writeJsonArrayFile<T>(filePath: string, data: T[]) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeRegistryId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
}

function validatePackageName(packageName: string) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9._-]+)?$/i.test(packageName.trim())) {
    throw new Error("Package name must be a valid npm package identifier.");
  }
  return packageName.trim();
}

function readRegisteredTools() {
  return readJsonArrayFile<RegisteredTool>(TOOL_REGISTRY_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.command === "string",
  );
}

function writeRegisteredTools(tools: RegisteredTool[]) {
  writeJsonArrayFile(TOOL_REGISTRY_PATH, tools);
}

function readHealingRecipes() {
  return readJsonArrayFile<HealingRecipe>(HEALING_RECIPES_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && Array.isArray(entry.steps),
  );
}

function writeHealingRecipes(recipes: HealingRecipe[]) {
  writeJsonArrayFile(HEALING_RECIPES_PATH, recipes);
}

function readApprovals() {
  return readJsonArrayFile<PendingApproval>(APPROVALS_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.type === "string" && typeof entry.status === "string",
  );
}

function writeApprovals(approvals: PendingApproval[]) {
  writeJsonArrayFile(APPROVALS_PATH, approvals);
}

function readBrowserTrace() {
  return readJsonArrayFile<BrowserTraceEntry>(BROWSER_TRACE_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.action === "string" && typeof entry.status === "string",
  );
}

function writeBrowserTrace(entries: BrowserTraceEntry[]) {
  writeJsonArrayFile(BROWSER_TRACE_PATH, entries);
}

function appendBrowserTrace(entry: BrowserTraceEntry) {
  const next = [entry, ...readBrowserTrace()].slice(0, MAX_BROWSER_TRACE_ENTRIES);
  writeBrowserTrace(next);
}

function readScheduledJobs() {
  return readJsonArrayFile<ScheduledJob>(SCHEDULED_JOBS_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.targetType === "string",
  );
}

function writeScheduledJobs(entries: ScheduledJob[]) {
  writeJsonArrayFile(SCHEDULED_JOBS_PATH, entries);
}

function readJobRuns() {
  return readJsonArrayFile<JobRun>(JOB_RUNS_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.status === "string",
  );
}

function writeJobRuns(entries: JobRun[]) {
  writeJsonArrayFile(JOB_RUNS_PATH, entries);
}

function readEstimateScanRuns() {
  return readJsonArrayFile<EstimateScanRun>(ESTIMATE_SCAN_RUNS_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.ranAt === "string",
  );
}

function writeEstimateScanRuns(entries: EstimateScanRun[]) {
  writeJsonArrayFile(ESTIMATE_SCAN_RUNS_PATH, entries);
}

function readRunHistory() {
  return readJsonArrayFile<StoredRunSummary>(RUN_HISTORY_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.agentId === "string" && typeof entry.title === "string",
  );
}

function writeRunHistory(entries: StoredRunSummary[]) {
  writeJsonArrayFile(RUN_HISTORY_PATH, entries);
}

function readRunTemplates() {
  return readJsonArrayFile<StoredRunTemplate>(RUN_TEMPLATES_PATH).filter(
    (entry) => entry && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.prompt === "string",
  );
}

function writeRunTemplates(entries: StoredRunTemplate[]) {
  writeJsonArrayFile(RUN_TEMPLATES_PATH, entries);
}

function readCustomAgents() {
  return readJsonArrayFile<CustomAgent>(CUSTOM_AGENTS_PATH).filter(
    (entry) => entry
      && typeof entry.id === "string"
      && typeof entry.name === "string"
      && typeof entry.systemInstruction === "string",
  );
}

function writeCustomAgents(entries: CustomAgent[]) {
  writeJsonArrayFile(CUSTOM_AGENTS_PATH, entries);
}

function normalizeAgentId(value: string) {
  return normalizeRegistryId(value).slice(0, 64);
}

function normalizeSuggestedPrompts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function saveCustomAgent(input: {
  id?: string;
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
  icon?: string;
  color?: string;
  suggestedPrompts?: unknown;
}) {
  const name = input.name.trim();
  const role = input.role.trim();
  const description = input.description.trim();
  const systemInstruction = input.systemInstruction.trim();
  const id = normalizeAgentId(input.id || name);

  if (!id) throw new Error("Agent id must contain letters, numbers, dashes, or underscores.");
  if (!name) throw new Error("Agent name is required.");
  if (!role) throw new Error("Agent role is required.");
  if (!description) throw new Error("Agent description is required.");
  if (!systemInstruction) throw new Error("Agent system instruction is required.");

  const agents = readCustomAgents();
  const existingIndex = agents.findIndex((agent) => agent.id === id);
  const existing = existingIndex >= 0 ? agents[existingIndex] : undefined;
  const entry: CustomAgent = {
    id,
    name,
    role,
    description,
    systemInstruction,
    autonomous: true,
    icon: input.icon?.trim() || existing?.icon || "Bot",
    color: input.color?.trim() || existing?.color || "bg-cyber-blue",
    suggestedPrompts: normalizeSuggestedPrompts(input.suggestedPrompts),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    agents[existingIndex] = entry;
  } else {
    agents.push(entry);
  }

  writeCustomAgents(agents);
  return entry;
}

function shouldAutoApproveAction(type: ApprovalActionType, requestedByRole?: UserRole) {
  if (AUTO_APPROVE_ACTIONS.size === 0) return false;
  if (!AUTO_APPROVE_ACTIONS.has("all") && !AUTO_APPROVE_ACTIONS.has(type)) return false;
  const policy = APPROVAL_POLICY[type];
  return hasRequiredRole(requestedByRole, policy.approveRole);
}

async function createApprovalRequest(
  type: ApprovalActionType,
  payload: Record<string, unknown>,
  reason?: string,
  requestedBy?: string,
  requestedByRole?: UserRole,
) {
  const approvals = readApprovals();
  let approval: PendingApproval = {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
    requestedBy,
    requestedByRole,
  };
  approvals.unshift(approval);

  if (shouldAutoApproveAction(type, requestedByRole)) {
    try {
      const result = await executeApprovalAction(approval);
      approval = {
        ...approval,
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewedBy: requestedBy || "auto-approver",
        result,
      };
      approvals[0] = approval;
    } catch (error) {
      approval = {
        ...approval,
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: requestedBy || "auto-approver",
        reason: `Auto-approval failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      };
      approvals[0] = approval;
    }
  }

  writeApprovals(approvals);
  return approval;
}

function normalizeScheduleIntervalMinutes(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 24 * 60) {
    throw new Error("Schedule interval must be between 5 and 1440 minutes.");
  }
  return Math.round(minutes);
}

function normalizeScheduleTargetType(value: unknown): ScheduledJobTargetType {
  if (value === "tool" || value === "recipe" || value === "self_heal" || value === "estimate_scan") {
    return value;
  }
  throw new Error("Schedule target type must be tool, recipe, self_heal, or estimate_scan.");
}

function computeNextRunAt(intervalMinutes: number, from = new Date()) {
  return new Date(from.getTime() + intervalMinutes * 60_000).toISOString();
}

function summarizeJobResult(result: unknown) {
  if (!result) return "No output returned.";
  if (typeof result === "string") return result.slice(0, 280);
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.stderr === "string" && record.stderr.trim()) {
      return record.stderr.trim().slice(0, 280);
    }
    if (typeof record.stdout === "string" && record.stdout.trim()) {
      return record.stdout.trim().slice(0, 280);
    }
    if (typeof record.content === "string" && record.content.trim()) {
      return record.content.trim().slice(0, 280);
    }
    return JSON.stringify(record).slice(0, 280);
  }
  return String(result).slice(0, 280);
}

function createJobRunEntry(schedule: ScheduledJob) {
  return {
    id: `job-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scheduleId: schedule.id,
    name: schedule.name,
    targetType: schedule.targetType,
    targetId: schedule.targetId,
    status: "running" as const,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}

function getGmailScannerSetupSteps() {
  return [
    "Create or choose a Google Cloud OAuth client for the Gmail account that receives Carolina Wheel Werkz leads.",
    "Enable the Gmail API in that Google Cloud project.",
    "Generate a refresh token with read-only Gmail scope.",
    "Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in the BizBot server environment.",
    "Restart the BizBot server, then run the scanner from Auxiliary.",
  ];
}

function getGmailScannerStatus() {
  const configured = Boolean(
    process.env.GMAIL_CLIENT_ID
    && process.env.GMAIL_CLIENT_SECRET
    && process.env.GMAIL_REFRESH_TOKEN,
  );
  const recentRuns = readEstimateScanRuns().slice(0, 5);
  return {
    configured,
    authMode: configured ? "oauth-refresh-token" as const : "not-configured" as const,
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    recentRuns,
    setupSteps: configured ? [] : getGmailScannerSetupSteps(),
  };
}

function createGmailClient() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Gmail scanner is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || "http://localhost",
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function getHeaderValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, headerName: string) {
  return headers?.find((header) => header.name?.toLowerCase() === headerName.toLowerCase())?.value || "";
}

function parseSender(value: string) {
  const emailMatch = value.match(/<([^>]+)>/) || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch ? (emailMatch[1] || emailMatch[0]).trim() : "";
  const name = value.replace(/<[^>]+>/g, "").replace(/"/g, "").trim() || email;
  return { name, email };
}

function payloadHasAttachment(payload: any): boolean {
  if (!payload) return false;
  if (payload.filename) return true;
  if (Array.isArray(payload.parts)) {
    return payload.parts.some((part: any) => payloadHasAttachment(part));
  }
  return false;
}

function inferRequestedService(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("powder")) return "Powder coating";
  if (normalized.includes("curb rash") || normalized.includes("scratch") || normalized.includes("scuff")) return "Curb rash / cosmetic wheel repair";
  if (normalized.includes("bent") || normalized.includes("bend") || normalized.includes("vibration")) return "Bent wheel straightening";
  if (normalized.includes("crack")) return "Cracked wheel repair";
  if (normalized.includes("rim") || normalized.includes("wheel")) return "Wheel repair estimate";
  return "Estimate request";
}

function buildEstimateLeadCandidate(input: {
  messageId: string;
  threadId?: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  photosAttached: boolean;
}): EstimateLeadCandidate {
  const text = `${input.subject} ${input.snippet}`.toLowerCase();
  const requestedService = inferRequestedService(text);
  const missingInfo: string[] = [];
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(input.snippet);
  const hasVehicle = /\b(19|20)\d{2}\b/.test(input.snippet) || /\b(honda|toyota|ford|chevy|bmw|mercedes|audi|tesla|lexus|nissan|jeep|dodge|ram|kia|hyundai)\b/i.test(input.snippet);
  if (!hasPhone) missingInfo.push("phone number");
  if (!hasVehicle) missingInfo.push("vehicle year/make/model");
  if (!input.photosAttached && !text.includes("photo") && !text.includes("picture")) missingInfo.push("wheel photos");

  const hotWords = ["estimate", "quote", "price", "cost", "appointment", "schedule", "today", "asap", "urgent"];
  const score = hotWords.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
  const status = score >= 2 ? "hot_estimate_lead" : score === 1 ? "needs_reply" : "low_confidence";
  const urgency = text.includes("asap") || text.includes("urgent") || text.includes("today") ? "high" : status === "hot_estimate_lead" ? "normal" : "low";
  const parsedSender = parseSender(input.sender);
  const recommendedNextAction = missingInfo.length > 0
    ? `Reply and ask for ${missingInfo.join(", ")}.`
    : "Reply with estimate next steps and offer scheduling.";

  return {
    ...input,
    status,
    requestedService,
    missingInfo,
    urgency,
    recommendedNextAction,
    dashboardFields: {
      customerName: parsedSender.name,
      email: parsedSender.email,
      phone: hasPhone ? "Found in email body/snippet" : undefined,
      vehicle: hasVehicle ? "Found in email body/snippet" : undefined,
      wheelIssue: requestedService,
      serviceRequested: requestedService,
      photosAttached: input.photosAttached,
      status: status === "hot_estimate_lead" ? "Needs Estimate" : "Needs Review",
      recommendedFollowUp: recommendedNextAction,
    },
    draftReply: [
      `Hi ${parsedSender.name && parsedSender.name !== parsedSender.email ? parsedSender.name.split(/\s+/)[0] : "there"},`,
      "",
      `Thanks for reaching out to Carolina Wheel Werkz. We can help with ${requestedService.toLowerCase()}.`,
      missingInfo.length > 0
        ? `Can you send ${missingInfo.join(", ")} so we can give you the most accurate estimate?`
        : "Send over any additional photos if you have them, and we can help confirm pricing and scheduling.",
      "",
      "Thank you,",
      "Carolina Wheel Werkz",
    ].join("\n"),
  };
}

async function runEstimateLeadScan(options?: { lookbackDays?: number; maxResults?: number }): Promise<EstimateScanRun> {
  const status = getGmailScannerStatus();
  const lookbackDays = Math.max(1, Math.min(14, Number(options?.lookbackDays || 2)));
  const maxResults = Math.max(1, Math.min(50, Number(options?.maxResults || 20)));
  const query = `newer_than:${lookbackDays}d (estimate OR quote OR pricing OR price OR cost OR repair OR wheel OR rim OR "powder coating" OR "curb rash" OR appointment)`;

  if (!status.configured) {
    const run: EstimateScanRun = {
      id: `estimate-scan-${Date.now()}`,
      ranAt: new Date().toISOString(),
      configured: false,
      authMode: "not-configured",
      query,
      lookbackDays,
      leads: [],
      summary: "Gmail scanner is not connected yet. Add OAuth credentials to enable inbox scanning.",
      setupSteps: status.setupSteps,
    };
    writeEstimateScanRuns([run, ...readEstimateScanRuns()].slice(0, 20));
    return run;
  }

  try {
    const gmail = createGmailClient();
    const list = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });
    const messages = list.data.messages || [];
    const leads: EstimateLeadCandidate[] = [];

    for (const item of messages) {
      if (!item.id) continue;
      const message = await gmail.users.messages.get({
        userId: "me",
        id: item.id,
        format: "full",
      });
      const headers = message.data.payload?.headers || [];
      const subject = getHeaderValue(headers, "Subject") || "(No subject)";
      const sender = getHeaderValue(headers, "From") || "Unknown sender";
      const date = getHeaderValue(headers, "Date") || "";
      const snippet = message.data.snippet || "";
      leads.push(buildEstimateLeadCandidate({
        messageId: item.id,
        threadId: item.threadId || undefined,
        sender,
        subject,
        date,
        snippet,
        photosAttached: payloadHasAttachment(message.data.payload),
      }));
    }

    const hotCount = leads.filter((lead) => lead.status === "hot_estimate_lead").length;
    const needsReplyCount = leads.filter((lead) => lead.status === "needs_reply").length;
    const run: EstimateScanRun = {
      id: `estimate-scan-${Date.now()}`,
      ranAt: new Date().toISOString(),
      configured: true,
      authMode: "oauth-refresh-token",
      query,
      lookbackDays,
      leads,
      summary: `Found ${leads.length} possible estimate emails: ${hotCount} hot lead(s), ${needsReplyCount} needing review.`,
    };
    writeEstimateScanRuns([run, ...readEstimateScanRuns()].slice(0, 20));
    return run;
  } catch (error) {
    const run: EstimateScanRun = {
      id: `estimate-scan-${Date.now()}`,
      ranAt: new Date().toISOString(),
      configured: true,
      authMode: "oauth-refresh-token",
      query,
      lookbackDays,
      leads: [],
      summary: "Gmail scanner failed.",
      error: error instanceof Error ? error.message : "Unknown Gmail scan error.",
    };
    writeEstimateScanRuns([run, ...readEstimateScanRuns()].slice(0, 20));
    throw new Error(run.error);
  }
}

function validateHealingSteps(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Healing recipes need at least one step.");
  }

  if (input.length > MAX_HEALING_STEPS) {
    throw new Error(`Healing recipes are limited to ${MAX_HEALING_STEPS} steps.`);
  }

  return input.map((step) => {
    if (!step || typeof step !== "object") {
      throw new Error("Each healing step must be an object.");
    }

    const candidate = step as Record<string, unknown>;
    const type = candidate.type;
    const value = candidate.value;
    if ((type !== "command" && type !== "tool") || typeof value !== "string" || !value.trim()) {
      throw new Error("Healing steps must use { type: 'command' | 'tool', value: '...' }.");
    }

    return {
      type,
      value: value.trim(),
    } as HealingRecipeStep;
  });
}

async function runCommandInWorkspace(command: string, cwd?: string) {
  const result = await localExecutor.execute({
    kind: "command",
    command,
    workdir: cwd && cwd.trim() ? cwd : process.cwd(),
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: typeof result.exitCode === "number" ? result.exitCode : result.ok ? 0 : 1,
    signal: result.signal || null,
  };
}

async function registerTool(input: {
  id: string;
  description: string;
  command: string;
  cwd?: string;
}) {
  const id = normalizeRegistryId(input.id);
  if (!id) {
    throw new Error("Tool id must contain letters, numbers, dashes, or underscores.");
  }

  const description = input.description.trim();
  if (!description) {
    throw new Error("Tool description is required.");
  }

  const command = input.command.trim();
  if (!command) {
    throw new Error("Tool command is required.");
  }

  validateRelayCommand(command);
  const cwd = input.cwd?.trim() ? resolveRelayPath(input.cwd.trim()) : undefined;

  const tools = readRegisteredTools();
  const existingIndex = tools.findIndex((tool) => tool.id === id);
  const entry: RegisteredTool = {
    id,
    description,
    command,
    cwd,
    createdAt: existingIndex >= 0 ? tools[existingIndex].createdAt : new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    tools[existingIndex] = entry;
  } else {
    tools.push(entry);
  }

  writeRegisteredTools(tools);
  return entry;
}

async function runRegisteredTool(id: string) {
  const normalizedId = normalizeRegistryId(id);
  const tool = readRegisteredTools().find((entry) => entry.id === normalizedId);
  if (!tool) {
    throw new Error(`No registered tool found for "${id}".`);
  }

  const result = await runCommandInWorkspace(tool.command, tool.cwd);
  return {
    id: tool.id,
    description: tool.description,
    command: tool.command,
    cwd: tool.cwd || process.cwd(),
    ...result,
  };
}

async function installNpmPackage(packageName: string, saveDev?: boolean) {
  const validatedName = validatePackageName(packageName);
  const args = ["install"];
  if (saveDev) {
    args.push("--save-dev");
  }
  args.push(validatedName);

  const result = await runCommandInWorkspace(`npm ${args.join(" ")}`, process.cwd());
  return {
    packageName: validatedName,
    saveDev: Boolean(saveDev),
    ...result,
  };
}

async function saveHealingRecipe(input: {
  id: string;
  description: string;
  stepsJson: string;
}) {
  const id = normalizeRegistryId(input.id);
  if (!id) {
    throw new Error("Recipe id must contain letters, numbers, dashes, or underscores.");
  }

  const description = input.description.trim();
  if (!description) {
    throw new Error("Recipe description is required.");
  }

  let parsedSteps: unknown;
  try {
    parsedSteps = JSON.parse(input.stepsJson);
  } catch {
    throw new Error("stepsJson must be valid JSON.");
  }

  const steps = validateHealingSteps(parsedSteps);
  for (const step of steps) {
    if (step.type === "command") {
      validateRelayCommand(step.value);
    } else {
      const toolExists = readRegisteredTools().some((tool) => tool.id === normalizeRegistryId(step.value));
      if (!toolExists) {
        throw new Error(`Healing recipe references missing tool "${step.value}".`);
      }
    }
  }

  const recipes = readHealingRecipes();
  const existingIndex = recipes.findIndex((recipe) => recipe.id === id);
  const entry: HealingRecipe = {
    id,
    description,
    steps,
    createdAt: existingIndex >= 0 ? recipes[existingIndex].createdAt : new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    recipes[existingIndex] = entry;
  } else {
    recipes.push(entry);
  }

  writeHealingRecipes(recipes);
  return entry;
}

async function runHealingRecipe(id: string) {
  const normalizedId = normalizeRegistryId(id);
  const recipe = readHealingRecipes().find((entry) => entry.id === normalizedId);
  if (!recipe) {
    throw new Error(`No healing recipe found for "${id}".`);
  }

  const steps = [] as Array<Record<string, unknown>>;
  let success = true;

  for (const [index, step] of recipe.steps.entries()) {
    try {
      const result = step.type === "command"
        ? await runCommandInWorkspace(step.value, process.cwd())
        : await runRegisteredTool(step.value);

      steps.push({
        index,
        type: step.type,
        value: step.value,
        success: result.exitCode === 0,
        ...result,
      });

      if (result.exitCode !== 0) {
        success = false;
        break;
      }
    } catch (error) {
      success = false;
      steps.push({
        index,
        type: step.type,
        value: step.value,
        success: false,
        error: error instanceof Error ? error.message : "Unknown healing recipe error.",
      });
      break;
    }
  }

  return {
    id: recipe.id,
    description: recipe.description,
    success,
    steps,
  };
}

async function selfHealProject() {
  const steps = [] as Array<Record<string, unknown>>;
  const projectRoot = process.cwd();
  const nodeModulesPath = path.join(projectRoot, "node_modules");

  if (!fs.existsSync(nodeModulesPath)) {
    const installResult = await runCommandInWorkspace("npm install", projectRoot);
    steps.push({
      name: "npm install",
      ...installResult,
      success: installResult.exitCode === 0,
    });
    if (installResult.exitCode !== 0) {
      return { success: false, steps };
    }
  } else {
    steps.push({
      name: "npm install",
      skipped: true,
      reason: "node_modules already present",
      success: true,
    });
  }

  const lintResult = await runCommandInWorkspace("npm run lint", projectRoot);
  steps.push({
    name: "npm run lint",
    ...lintResult,
    success: lintResult.exitCode === 0,
  });
  if (lintResult.exitCode !== 0) {
    return { success: false, steps };
  }

  const buildResult = await runCommandInWorkspace("npm run build", projectRoot);
  steps.push({
    name: "npm run build",
    ...buildResult,
    success: buildResult.exitCode === 0,
  });

  return {
    success: buildResult.exitCode === 0,
    steps,
  };
}

async function executeApprovalAction(approval: PendingApproval) {
  switch (approval.type) {
    case "register_tool":
      return registerTool({
        id: String(approval.payload.id || ""),
        description: String(approval.payload.description || ""),
        command: String(approval.payload.command || ""),
        cwd: typeof approval.payload.cwd === "string" ? approval.payload.cwd : undefined,
      });
    case "install_npm_package":
      return installNpmPackage(
        String(approval.payload.packageName || ""),
        Boolean(approval.payload.saveDev),
      );
    case "save_healing_recipe":
      return saveHealingRecipe({
        id: String(approval.payload.id || ""),
        description: String(approval.payload.description || ""),
        stepsJson: String(approval.payload.stepsJson || "[]"),
      });
    case "run_healing_recipe":
      return runHealingRecipe(String(approval.payload.id || ""));
    case "self_heal_project":
      return selfHealProject();
    default:
      throw new Error(`Unsupported approval action "${(approval as PendingApproval).type}".`);
  }
}

async function executeScheduledTarget(schedule: ScheduledJob) {
  switch (schedule.targetType) {
    case "tool":
      if (!schedule.targetId) {
        throw new Error("Scheduled tool jobs require a target tool id.");
      }
      return runRegisteredTool(schedule.targetId);
    case "recipe":
      if (!schedule.targetId) {
        throw new Error("Scheduled recipe jobs require a target recipe id.");
      }
      return runHealingRecipe(schedule.targetId);
    case "self_heal":
      return selfHealProject();
    case "estimate_scan":
      return runEstimateLeadScan({ lookbackDays: 2, maxResults: 20 });
    default:
      throw new Error(`Unsupported scheduled target "${(schedule as ScheduledJob).targetType}".`);
  }
}

async function runScheduledJobNow(scheduleId: string) {
  const schedules = readScheduledJobs();
  const scheduleIndex = schedules.findIndex((entry) => entry.id === scheduleId);
  if (scheduleIndex < 0) {
    throw new Error("Scheduled job not found.");
  }

  const existingRuns = readJobRuns();
  if (existingRuns.some((entry) => entry.scheduleId === scheduleId && entry.status === "running")) {
    throw new Error("This scheduled job is already running.");
  }

  const schedule = schedules[scheduleIndex];
  const run = createJobRunEntry(schedule);
  writeJobRuns([run, ...existingRuns].slice(0, MAX_JOB_RUN_ENTRIES));

  try {
    const result = await executeScheduledTarget(schedule);
    const completedRun: JobRun = {
      ...run,
      status: "completed",
      completedAt: new Date().toISOString(),
      outputSummary: summarizeJobResult(result),
    };
    const refreshedRuns = readJobRuns().map((entry) => entry.id === run.id ? completedRun : entry);
    writeJobRuns(refreshedRuns.slice(0, MAX_JOB_RUN_ENTRIES));

    schedules[scheduleIndex] = {
      ...schedule,
      lastRunAt: completedRun.completedAt,
      nextRunAt: computeNextRunAt(schedule.intervalMinutes, new Date(completedRun.completedAt)),
      lastResultStatus: "completed",
      lastResultSummary: completedRun.outputSummary,
    };
    writeScheduledJobs(schedules);
    return completedRun;
  } catch (error) {
    const failedRun: JobRun = {
      ...run,
      status: "failed",
      completedAt: new Date().toISOString(),
      outputSummary: error instanceof Error ? error.message : "Unknown scheduled job failure.",
    };
    const refreshedRuns = readJobRuns().map((entry) => entry.id === run.id ? failedRun : entry);
    writeJobRuns(refreshedRuns.slice(0, MAX_JOB_RUN_ENTRIES));

    schedules[scheduleIndex] = {
      ...schedule,
      lastRunAt: failedRun.completedAt,
      nextRunAt: computeNextRunAt(schedule.intervalMinutes, new Date(failedRun.completedAt)),
      lastResultStatus: "failed",
      lastResultSummary: failedRun.outputSummary,
    };
    writeScheduledJobs(schedules);
    throw error;
  }
}

async function runDueSchedules() {
  if (schedulerTickInFlight) return;
  schedulerTickInFlight = true;
  try {
    const now = Date.now();
    const schedules = readScheduledJobs();
    const jobRuns = readJobRuns();
    const dueSchedules = schedules.filter((entry) =>
      entry.status === "active"
      && new Date(entry.nextRunAt).getTime() <= now
      && !jobRuns.some((run) => run.scheduleId === entry.id && run.status === "running")
    );

    for (const schedule of dueSchedules) {
      try {
        await runScheduledJobNow(schedule.id);
      } catch (error) {
        console.error("[scheduler]", schedule.id, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    schedulerTickInFlight = false;
  }
}

function ensureSchedulerLoop() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    void runDueSchedules();
  }, 30_000);
}

function getModelTools(): any[] {
  return [
    {
      functionDeclarations: [
        {
          name: "bash",
          description: "Execute an allowed workspace command on the local system.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The command to execute." },
              workdir: { type: "string", description: "Optional working directory inside the relay workspace." },
            },
            required: ["command"],
          },
        },
        {
          name: "read_file",
          description: "Read a file from the allowed workspace.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file inside the relay workspace." },
            },
            required: ["path"],
          },
        },
        {
          name: "write_file",
          description: "Write a file inside the allowed workspace.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file inside the relay workspace." },
              content: { type: "string", description: "The full content to write." },
            },
            required: ["path", "content"],
          },
        },
        {
          name: "edit_file",
          description: "Replace a specific block of text in a file inside the allowed workspace.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file inside the relay workspace." },
              oldString: { type: "string", description: "The exact text to find." },
              newString: { type: "string", description: "The replacement text." },
            },
            required: ["path", "oldString", "newString"],
          },
        },
        {
          name: "get_neural_memory",
          description: "Retrieve durable business or project facts from neural memory.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Query used to retrieve relevant stored facts." },
            },
            required: ["query"],
          },
        },
        {
          name: "update_neural_memory",
          description: "Save a durable fact, preference, or operating detail to neural memory.",
          parameters: {
            type: "object",
            properties: {
              fact: { type: "string", description: "The fact to remember." },
              category: { type: "string", description: "Optional category like preference, shop_detail, or technical_note." },
            },
            required: ["fact"],
          },
        },
        {
          name: "route_to_agent",
          description: "Hand work off to another BizBot agent so execution can continue with the best specialist.",
          parameters: {
            type: "object",
            properties: {
              agentId: { type: "string", description: "The target BizBot agent id." },
              prompt: { type: "string", description: "The exact prompt or task brief for the target agent." },
              reason: { type: "string", description: "Short explanation for why the handoff is happening." },
            },
            required: ["agentId", "prompt"],
          },
        },
        {
          name: "create_agent",
          description: "Create or update a custom BizBot agent that appears in the Agent Roster and sidebar.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Optional stable id using letters, numbers, dashes, or underscores." },
              name: { type: "string", description: "Display name for the custom agent." },
              role: { type: "string", description: "Short role label shown in the UI." },
              description: { type: "string", description: "One-sentence description of what the agent does." },
              systemInstruction: { type: "string", description: "Durable system instruction defining the agent behavior." },
              icon: { type: "string", description: "Optional icon key such as Bot, Code, Search, ShieldCheck, Database, Terminal, Globe." },
              color: { type: "string", description: "Optional Tailwind background class, e.g. bg-emerald-600." },
              suggestedPrompts: {
                type: "array",
                items: { type: "string" },
                description: "Optional starter prompts for this agent.",
              },
            },
            required: ["name", "role", "description", "systemInstruction"],
          },
        },
        {
          name: "scan_gmail_estimate_leads",
          description: "Scan connected Gmail read-only for Carolina Wheel Werkz customer estimate, quote, wheel repair, powder coating, curb rash, appointment, and voicemail leads. This cannot send, delete, archive, or modify email.",
          parameters: {
            type: "object",
            properties: {
              lookbackDays: {
                type: "number",
                description: "How many recent days to scan, between 1 and 14. Defaults to 2.",
              },
              maxResults: {
                type: "number",
                description: "Maximum Gmail messages to inspect, between 1 and 50. Defaults to 20.",
              },
            },
          },
        },
        {
          name: "open_browser",
          description: "Open a URL in the user's default browser.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The http or https URL to open." },
            },
            required: ["url"],
          },
        },
        {
          name: "fetch_url",
          description: "Fetch and read page content from a URL so the agent can inspect a webpage.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The http or https URL to fetch." },
            },
            required: ["url"],
          },
        },
        {
          name: "browser_navigate",
          description: "Open or navigate the shared browser session to a URL.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The http or https URL to open." },
            },
            required: ["url"],
          },
        },
        {
          name: "browser_click",
          description: "Click an element in the shared browser session using a CSS selector.",
          parameters: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector for the element to click." },
            },
            required: ["selector"],
          },
        },
        {
          name: "browser_type",
          description: "Fill or type text into an element in the shared browser session.",
          parameters: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector for the input or textarea." },
              text: { type: "string", description: "Text to enter into the element." },
            },
            required: ["selector", "text"],
          },
        },
        {
          name: "browser_press",
          description: "Press a keyboard key in the shared browser session.",
          parameters: {
            type: "object",
            properties: {
              key: { type: "string", description: "Keyboard key such as Enter, Tab, ArrowDown, or Escape." },
            },
            required: ["key"],
          },
        },
        {
          name: "browser_wait_for_text",
          description: "Wait for visible text to appear on the current page before continuing.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "Visible text that should appear on the page." },
            },
            required: ["text"],
          },
        },
        {
          name: "browser_read",
          description: "Read the current page title, URL, and trimmed visible text from the shared browser session.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "browser_close",
          description: "Close the shared browser session.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "browser_screenshot",
          description: "Capture a screenshot of the current browser session page.",
          parameters: {
            type: "object",
            properties: {
              fullPage: { type: "boolean", description: "Capture the full page instead of only the viewport." },
            },
          },
        },
        {
          name: "browser_list_interactives",
          description: "List clickable and form elements on the current browser page to help choose selectors.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "browser_replay_trace",
          description: "Replay a recent browser action from the trace log using its trace id.",
          parameters: {
            type: "object",
            properties: {
              traceId: { type: "string", description: "Browser trace entry id to replay." },
            },
            required: ["traceId"],
          },
        },
        {
          name: "seo_audit_url",
          description: "Run a lightweight SEO audit for a single URL.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to audit." },
            },
            required: ["url"],
          },
        },
        {
          name: "crawl_site",
          description: "Crawl a site starting from a URL and return a same-origin page summary for SEO review.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The start URL for crawling." },
              maxPages: { type: "number", description: "Maximum number of pages to crawl, capped by the server." },
            },
            required: ["url"],
          },
        },
        {
          name: "list_registered_tools",
          description: "List custom tools that agents have registered for reuse.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "register_tool",
          description: "Register a reusable workspace tool backed by an allowed command.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique tool id using letters, numbers, dashes, or underscores." },
              description: { type: "string", description: "Short explanation of what the tool does." },
              command: { type: "string", description: "Allowed workspace command to run for this tool." },
              cwd: { type: "string", description: "Optional working directory inside the workspace." },
            },
            required: ["id", "description", "command"],
          },
        },
        {
          name: "run_registered_tool",
          description: "Run a tool previously added to the local registry.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Registered tool id." },
            },
            required: ["id"],
          },
        },
        {
          name: "install_npm_package",
          description: "Install an npm package into the current workspace for new capabilities.",
          parameters: {
            type: "object",
            properties: {
              packageName: { type: "string", description: "npm package name, optionally pinned to an exact version." },
              saveDev: { type: "boolean", description: "Install as a dev dependency instead of a runtime dependency." },
            },
            required: ["packageName"],
          },
        },
        {
          name: "list_healing_recipes",
          description: "List saved self-healing recipes available to the agents.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "save_healing_recipe",
          description: "Save a named self-healing recipe made of commands or registered tools.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Recipe id using letters, numbers, dashes, or underscores." },
              description: { type: "string", description: "What the recipe is for." },
              stepsJson: { type: "string", description: "JSON array of steps like [{\"type\":\"command\",\"value\":\"npm run lint\"}]." },
            },
            required: ["id", "description", "stepsJson"],
          },
        },
        {
          name: "run_healing_recipe",
          description: "Run a saved healing recipe step by step.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Saved healing recipe id." },
            },
            required: ["id"],
          },
        },
        {
          name: "self_heal_project",
          description: "Run a built-in recovery routine that checks install, lint, and build health.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
    },
  ];
}

function parseHttpUrl(input: string) {
  let parsed: URL;
  const trimmed = input.trim();
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("A valid http or https URL is required.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  return parsed;
}

function isSearchEngineResultsUrl(url: URL) {
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return (
    (hostname === "google.com" && (pathname.startsWith("/search") || pathname.startsWith("/sorry")))
    || (hostname === "bing.com" && pathname.startsWith("/search"))
    || (hostname === "duckduckgo.com" && pathname === "/")
  );
}

function assertNotSearchEngineResultsUrl(url: URL) {
  if (!isSearchEngineResultsUrl(url)) return;
  throw new Error(
    "Search engine result pages are blocked because they trigger captcha in automated browser sessions. Use direct competitor URLs, fetch_url, crawl_site, seo_audit_url, or ask the user for the missing URL.",
  );
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureBrowserArtifactsDir() {
  fs.mkdirSync(BROWSER_ARTIFACTS_DIR, { recursive: true });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function captureBrowserArtifact(prefix: string, fullPage = true) {
  ensureBrowserArtifactsDir();
  const page = await ensureBrowserPage();
  const filename = `${prefix}-${Date.now()}.png`;
  const outputPath = path.join(BROWSER_ARTIFACTS_DIR, filename);
  await page.screenshot({
    path: outputPath,
    fullPage,
  });
  return outputPath;
}

async function getBrowserSnapshot() {
  if (!browserPageSession || browserPageSession.isClosed()) {
    return {
      url: "",
      title: "",
    };
  }

  return {
    url: browserPageSession.url(),
    title: await browserPageSession.title().catch(() => ""),
  };
}

async function recordBrowserTrace(entry: Omit<BrowserTraceEntry, "id" | "createdAt">) {
  const snapshot = await getBrowserSnapshot();
  appendBrowserTrace({
    id: `browser-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    url: entry.url ?? snapshot.url,
    title: entry.title ?? snapshot.title,
    ...entry,
  });
}

async function runBrowserAction<T>(
  action: string,
  details: Record<string, unknown>,
  runner: () => Promise<T>,
) {
  try {
    const result = await withTimeout(
      runner(),
      BROWSER_ACTION_TIMEOUT_MS,
      `Browser action timed out after ${Math.round(BROWSER_ACTION_TIMEOUT_MS / 1000)} seconds.`,
    );
    await recordBrowserTrace({
      action,
      status: "success",
      details,
    });
    return result;
  } catch (error) {
    let artifactPath: string | undefined;
    try {
      artifactPath = await captureBrowserArtifact(`browser-error-${action}`);
    } catch {
      artifactPath = undefined;
    }

    const message = error instanceof Error ? error.message : "Unknown browser automation error.";
    await recordBrowserTrace({
      action,
      status: "error",
      details,
      error: message,
      artifactPath,
    });
    throw new Error(artifactPath ? `${message} Artifact: ${artifactPath}` : message);
  }
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function extractMetaContent(html: string, matcher: RegExp) {
  const tagMatch = html.match(matcher);
  return tagMatch?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function extractHeadings(html: string) {
  const matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  return matches.map((match) => htmlToText(match[1] || "")).filter(Boolean);
}

function extractCanonical(html: string) {
  const match = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i);
  return match?.[1] || "";
}

function extractLinks(html: string, baseUrl: URL) {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = match[1]?.trim();
    if (!href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        links.add(resolved.toString());
      }
    } catch {
      // Ignore malformed links.
    }
  }
  return [...links];
}

async function openBrowserUrl(url: string) {
  const parsed = parseHttpUrl(url);
  assertNotSearchEngineResultsUrl(parsed);
  const safeUrl = parsed.toString();

  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", safeUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return `Opened ${safeUrl} in the default browser.`;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [safeUrl], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return `Opened ${safeUrl} in the default browser.`;
  }

  const child = spawn("xdg-open", [safeUrl], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return `Opened ${safeUrl} in the default browser.`;
}

async function fetchUrlContent(url: string) {
  const parsed = parseHttpUrl(url);
  assertNotSearchEngineResultsUrl(parsed);
  const safeUrl = parsed.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(safeUrl, {
      headers: {
        "User-Agent": "BizBot-Agent/1.0",
      },
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "fetch failed";
    throw new Error(`Failed to fetch ${safeUrl}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const normalized = contentType.includes("html") ? htmlToText(raw) : raw.trim();

  return {
    url: safeUrl,
    contentType,
    content: normalized.slice(0, MAX_FETCHED_PAGE_CHARS),
  };
}

async function ensureBrowserPage() {
  if (!browserSession) {
    browserSession = await chromium.launch({
      headless: PLAYWRIGHT_HEADLESS,
    });
  }

  if (!browserPageSession || browserPageSession.isClosed()) {
    const context = await browserSession.newContext({
      viewport: { width: 1440, height: 900 },
    });
    browserPageSession = await context.newPage();
  }

  return browserPageSession;
}

async function browserReadState() {
  return runBrowserAction("browser_read", {}, async () => {
    const page = await ensureBrowserPage();
    const title = await page.title().catch(() => "");
    const url = page.url();
    const textContent = await page.locator("body").innerText().catch(() => "");
    return {
      title,
      url,
      content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
    };
  });
}

async function browserListInteractives() {
  return runBrowserAction("browser_list_interactives", {}, async () => {
    const page = await ensureBrowserPage();
    return page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]'));
      return nodes.slice(0, 100).map((node, index) => {
        const element = node as HTMLElement;
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const classes = element.className && typeof element.className === 'string'
          ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
        const selector = id || `${tag}${classes}`;
        const text = (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
        return {
          index,
          tag,
          selector,
          text: text.slice(0, 120),
        };
      });
    });
  });
}

async function browserScreenshot(fullPage?: boolean) {
  return runBrowserAction("browser_screenshot", { fullPage: Boolean(fullPage) }, async () => {
    const page = await ensureBrowserPage();
    const outputPath = await captureBrowserArtifact("browser-shot", Boolean(fullPage));
    return {
      path: outputPath,
      url: page.url(),
      title: await page.title().catch(() => ""),
    };
  });
}

async function seoAuditUrl(url: string) {
  const safeUrl = parseHttpUrl(url);
  const response = await fetch(safeUrl, {
    headers: { "User-Agent": "BizBot-Agent/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Failed to audit URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const title = extractHtmlTitle(html);
  const description = extractMetaContent(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  ) || extractMetaContent(
    html,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
  );
  const canonical = extractCanonical(html);
  const h1s = extractHeadings(html);
  const robots = extractMetaContent(
    html,
    /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i,
  ) || extractMetaContent(
    html,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i,
  );
  const wordCount = htmlToText(html).split(/\s+/).filter(Boolean).length;

  const findings: string[] = [];
  if (!title) findings.push("Missing <title> tag.");
  if (title && title.length > 65) findings.push("Title tag is longer than 65 characters.");
  if (!description) findings.push("Missing meta description.");
  if (description && description.length > 160) findings.push("Meta description is longer than 160 characters.");
  if (h1s.length === 0) findings.push("Missing H1 heading.");
  if (h1s.length > 1) findings.push("Multiple H1 headings found.");
  if (!canonical) findings.push("Missing canonical URL.");
  if (wordCount < 150) findings.push("Page has thin visible text content.");

  return {
    url: safeUrl.toString(),
    title,
    description,
    canonical,
    robots,
    h1s,
    wordCount,
    findings,
  };
}

async function crawlSite(startUrl: string, requestedMaxPages?: number) {
  const originUrl = parseHttpUrl(startUrl);
  const limit = Math.min(Math.max(Number(requestedMaxPages) || 5, 1), MAX_CRAWL_PAGES);
  const queue = [originUrl.toString()];
  const visited = new Set<string>();
  const pages: Array<{
    url: string;
    title: string;
    description: string;
    h1Count: number;
    canonical: string;
  }> = [];

  while (queue.length > 0 && visited.size < limit) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      const response = await fetch(current, {
        headers: { "User-Agent": "BizBot-Agent/1.0" },
      });
      if (!response.ok) continue;
      const html = await response.text();
      pages.push({
        url: current,
        title: extractHtmlTitle(html),
        description: extractMetaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
          || extractMetaContent(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
        h1Count: extractHeadings(html).length,
        canonical: extractCanonical(html),
      });

      for (const link of extractLinks(html, new URL(current))) {
        const parsed = new URL(link);
        if (parsed.origin === originUrl.origin && !visited.has(parsed.toString()) && queue.length < MAX_CRAWL_PAGES) {
          queue.push(parsed.toString());
        }
      }
    } catch {
      // Skip failed pages during crawl.
    }
  }

  return {
    origin: originUrl.origin,
    crawledPages: pages.length,
    pages,
  };
}

async function browserNavigate(url: string) {
  return runBrowserAction("browser_navigate", { url }, async () => {
    const page = await ensureBrowserPage();
    const parsed = parseHttpUrl(url);
    assertNotSearchEngineResultsUrl(parsed);
    const safeUrl = parsed.toString();
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = await page.title().catch(() => "");
    const textContent = await page.locator("body").innerText().catch(() => "");
    return {
      title,
      url: page.url(),
      content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
    };
  });
}

async function browserClick(selector: string) {
  return runBrowserAction("browser_click", { selector }, async () => {
    const page = await ensureBrowserPage();
    await page.locator(selector).first().click({ timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const title = await page.title().catch(() => "");
    const textContent = await page.locator("body").innerText().catch(() => "");
    return {
      title,
      url: page.url(),
      content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
    };
  });
}

async function browserType(selector: string, text: string) {
  return runBrowserAction("browser_type", { selector, text }, async () => {
    const page = await ensureBrowserPage();
    const locator = page.locator(selector).first();
    await locator.click({ timeout: 15_000 });
    await locator.fill(text, { timeout: 15_000 });
    const title = await page.title().catch(() => "");
    const textContent = await page.locator("body").innerText().catch(() => "");
    return {
      title,
      url: page.url(),
      content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
    };
  });
}

async function browserPress(key: string) {
  return runBrowserAction("browser_press", { key }, async () => {
    const page = await ensureBrowserPage();
    await page.keyboard.press(key);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const title = await page.title().catch(() => "");
    const textContent = await page.locator("body").innerText().catch(() => "");
    return {
      title,
      url: page.url(),
      content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
    };
  });
}

async function browserWaitForText(text: string) {
  return runBrowserAction("browser_wait_for_text", { text }, async () => {
    const page = await ensureBrowserPage();
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 });
    const title = await page.title().catch(() => "");
    const textContent = await page.locator("body").innerText().catch(() => "");
    return {
      title,
      url: page.url(),
      content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
    };
  });
}

async function browserReplayTrace(traceId: string) {
  const target = readBrowserTrace().find((entry) => entry.id === traceId);
  if (!target) {
    throw new Error("Browser trace entry not found.");
  }

  const details = target.details || {};
  switch (target.action) {
    case "browser_navigate":
      return browserNavigate(String(details.url || target.url || ""));
    case "browser_click":
      return browserClick(String(details.selector || ""));
    case "browser_type":
      return browserType(String(details.selector || ""), String(details.textPreview || ""));
    case "browser_press":
      return browserPress(String(details.key || ""));
    case "browser_wait_for_text":
      return browserWaitForText(String(details.text || ""));
    default:
      throw new Error("That browser trace action cannot be replayed.");
  }
}

async function closeBrowserSession() {
  if (browserPageSession && !browserPageSession.isClosed()) {
    await browserPageSession.context().close();
  }
  browserPageSession = null;
  if (browserSession) {
    await browserSession.close();
  }
  browserSession = null;
  await recordBrowserTrace({
    action: "browser_close",
    status: "success",
    details: {},
    url: "",
    title: "",
  });
  return "Browser session closed.";
}

function readLocalMemoryStore() {
  if (!fs.existsSync(MEMORY_STORE_PATH)) {
    return [] as Array<{ fact: string; category: string; timestamp: string }>;
  }

  try {
    const raw = fs.readFileSync(MEMORY_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Array<{ fact?: string; category?: string; timestamp?: string }>;
    return parsed
      .filter((entry) => typeof entry.fact === "string" && entry.fact.trim().length > 0)
      .map((entry) => ({
        fact: entry.fact!.trim(),
        category: entry.category || "general",
        timestamp: entry.timestamp || new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

function writeLocalMemoryStore(entries: Array<{ fact: string; category: string; timestamp: string }>) {
  fs.writeFileSync(MEMORY_STORE_PATH, JSON.stringify(entries, null, 2), "utf8");
}

function getAutonomyOverview() {
  const browserTrace = readBrowserTrace();
  const latestBrowserTrace = browserTrace[0];
  const scheduledJobs = readScheduledJobs();
  const jobRuns = readJobRuns();
  const completedBrowserActions = browserTrace.filter((entry) => entry.status === "success").length;
  const failedBrowserActions = browserTrace.filter((entry) => entry.status === "error").length;
  const approvedCount = readApprovals().filter((entry) => entry.status === "approved").length;
  const rejectedCount = readApprovals().filter((entry) => entry.status === "rejected").length;
  return {
    registeredTools: readRegisteredTools(),
    healingRecipes: readHealingRecipes(),
    approvals: readApprovals(),
    approvalPolicy: APPROVAL_POLICY,
    browser: {
      sessionOpen: Boolean(browserSession && browserPageSession && !browserPageSession.isClosed()),
      headless: PLAYWRIGHT_HEADLESS,
      artifactsDir: BROWSER_ARTIFACTS_DIR,
      recentTrace: browserTrace.slice(0, 12),
      lastActionAt: latestBrowserTrace?.createdAt,
      lastError: latestBrowserTrace?.status === "error" ? latestBrowserTrace.error : undefined,
      currentUrl: browserPageSession && !browserPageSession.isClosed() ? browserPageSession.url() : "",
    },
    schedules: scheduledJobs,
    jobRuns: jobRuns.slice(0, 20),
    telemetry: {
      pendingApprovals: readApprovals().filter((entry) => entry.status === "pending").length,
      approvedApprovals: approvedCount,
      rejectedApprovals: rejectedCount,
      activeSchedules: scheduledJobs.filter((entry) => entry.status === "active").length,
      runningJobs: jobRuns.filter((entry) => entry.status === "running").length,
      completedJobs: jobRuns.filter((entry) => entry.status === "completed").length,
      failedJobs: jobRuns.filter((entry) => entry.status === "failed").length,
      browserSuccesses: completedBrowserActions,
      browserFailures: failedBrowserActions,
    },
    relay: {
      allowedCommands: [...RELAY_ALLOWED_COMMANDS],
      allowedRoots: RELAY_ALLOWED_ROOTS,
      allowShellOperators: RELAY_ALLOW_SHELL_OPERATORS,
    },
    execution: {
      mode: process.env.BIZBOT_PREFER_REMOTE_WORKERS === "true" ? "remote-preferred" : "local-first",
      workerHeartbeatTtlMs: WORKER_HEARTBEAT_TTL_MS,
      cloudSafeTools: ["chat", "upload", "history", "templates", "memory"],
      workerRequiredTools: ["bash", "read_file", "write_file", "edit_file", "browser_*", "registered_tools", "self_heal"],
      autoApproveActions: [...AUTO_APPROVE_ACTIONS],
    },
    workers: workerRegistry.list(),
    limits: {
      maxHealingSteps: MAX_HEALING_STEPS,
      maxFetchedPageChars: MAX_FETCHED_PAGE_CHARS,
      maxCrawlPages: MAX_CRAWL_PAGES,
    },
  };
}

async function readNeuralMemory(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const localEntries = readLocalMemoryStore();
  const filtered = normalizedQuery
    ? localEntries.filter((entry) => {
        const haystack = `${entry.category} ${entry.fact}`.toLowerCase();
        return normalizedQuery.split(/\s+/).every((token) => haystack.includes(token));
      })
    : localEntries;

  const relevant = (filtered.length > 0 ? filtered : localEntries).slice(-12);
  if (relevant.length === 0) {
    return "No prior neural memory found.";
  }

  return relevant
    .map((entry) => `[${entry.category}] ${entry.fact}`)
    .join("\n");
}

async function writeNeuralMemory(fact: string, category?: string) {
  const entry = {
    fact: fact.trim(),
    category: (category || "general").trim() || "general",
    timestamp: new Date().toISOString(),
  };

  const localEntries = readLocalMemoryStore();
  localEntries.push(entry);
  writeLocalMemoryStore(localEntries);
  return "Fact saved to neural memory.";
}

function isPendingApproval(value: unknown): value is PendingApproval {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.type === "string"
    && candidate.status === "pending"
    && typeof candidate.payload === "object"
  );
}

async function resolveServerToolCall(
  call: ToolCall,
  requester?: { email?: string; role?: UserRole },
) {
  if (call.name === "get_neural_memory") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "get_neural_memory",
          response: { content: await readNeuralMemory(String(call.args?.query || "")) },
        },
      },
    };
  }

  if (call.name === "update_neural_memory") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "update_neural_memory",
          response: { content: await writeNeuralMemory(String(call.args?.fact || ""), typeof call.args?.category === "string" ? call.args.category : undefined) },
        },
      },
    };
  }

  if (call.name === "create_agent") {
    const agent = saveCustomAgent({
      id: typeof call.args?.id === "string" ? call.args.id : undefined,
      name: String(call.args?.name || ""),
      role: String(call.args?.role || ""),
      description: String(call.args?.description || ""),
      systemInstruction: String(call.args?.systemInstruction || ""),
      icon: typeof call.args?.icon === "string" ? call.args.icon : undefined,
      color: typeof call.args?.color === "string" ? call.args.color : undefined,
      suggestedPrompts: call.args?.suggestedPrompts,
    });
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "create_agent",
          response: {
            content: `Created custom agent "${agent.name}". It will appear in the sidebar and Agent Roster after the app refreshes its agent list.`,
            agent,
          },
        },
      },
    };
  }

  if (call.name === "scan_gmail_estimate_leads") {
    const result = await runEstimateLeadScan({
      lookbackDays: Number(call.args?.lookbackDays || 2),
      maxResults: Number(call.args?.maxResults || 20),
    });
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "scan_gmail_estimate_leads",
          response: result,
        },
      },
    };
  }

  if (call.name === "open_browser") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "open_browser",
          response: { content: await openBrowserUrl(String(call.args?.url || "")) },
        },
      },
    };
  }

  if (call.name === "fetch_url") {
    const page = await fetchUrlContent(String(call.args?.url || ""));
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "fetch_url",
          response: page,
        },
      },
    };
  }

  if (call.name === "browser_navigate") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_navigate",
          response: await browserNavigate(String(call.args?.url || "")),
        },
      },
    };
  }

  if (call.name === "browser_click") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_click",
          response: await browserClick(String(call.args?.selector || "")),
        },
      },
    };
  }

  if (call.name === "browser_type") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_type",
          response: await browserType(String(call.args?.selector || ""), String(call.args?.text || "")),
        },
      },
    };
  }

  if (call.name === "browser_press") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_press",
          response: await browserPress(String(call.args?.key || "")),
        },
      },
    };
  }

  if (call.name === "browser_wait_for_text") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_wait_for_text",
          response: await browserWaitForText(String(call.args?.text || "")),
        },
      },
    };
  }

  if (call.name === "browser_read") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_read",
          response: await browserReadState(),
        },
      },
    };
  }

  if (call.name === "browser_close") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_close",
          response: { content: await closeBrowserSession() },
        },
      },
    };
  }

  if (call.name === "browser_screenshot") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_screenshot",
          response: await browserScreenshot(Boolean(call.args?.fullPage)),
        },
      },
    };
  }

  if (call.name === "browser_list_interactives") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_list_interactives",
          response: await browserListInteractives(),
        },
      },
    };
  }

  if (call.name === "browser_replay_trace") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "browser_replay_trace",
          response: await browserReplayTrace(String(call.args?.traceId || "")),
        },
      },
    };
  }

  if (call.name === "seo_audit_url") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "seo_audit_url",
          response: await seoAuditUrl(String(call.args?.url || "")),
        },
      },
    };
  }

  if (call.name === "crawl_site") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "crawl_site",
          response: await crawlSite(String(call.args?.url || ""), Number(call.args?.maxPages)),
        },
      },
    };
  }

  if (call.name === "list_registered_tools") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "list_registered_tools",
          response: {
            tools: readRegisteredTools().map((tool) => ({
              id: tool.id,
              description: tool.description,
              command: tool.command,
              cwd: tool.cwd || process.cwd(),
              createdAt: tool.createdAt,
            })),
          },
        },
      },
    };
  }

  if (call.name === "register_tool") {
    const approval = await createApprovalRequest("register_tool", {
      id: String(call.args?.id || ""),
      description: String(call.args?.description || ""),
      command: String(call.args?.command || ""),
      cwd: typeof call.args?.cwd === "string" ? call.args.cwd : undefined,
    }, "Agent requested tool registration.", requester?.email, requester?.role);
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "register_tool",
          response: approval,
        },
      },
      approval,
    };
  }

  if (call.name === "run_registered_tool") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "run_registered_tool",
          response: await runRegisteredTool(String(call.args?.id || "")),
        },
      },
    };
  }

  if (call.name === "install_npm_package") {
    const approval = await createApprovalRequest("install_npm_package", {
      packageName: String(call.args?.packageName || ""),
      saveDev: Boolean(call.args?.saveDev),
    }, "Agent requested package install.", requester?.email, requester?.role);
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "install_npm_package",
          response: approval,
        },
      },
      approval,
    };
  }

  if (call.name === "list_healing_recipes") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "list_healing_recipes",
          response: {
            recipes: readHealingRecipes().map((recipe) => ({
              id: recipe.id,
              description: recipe.description,
              stepCount: recipe.steps.length,
              steps: recipe.steps,
              createdAt: recipe.createdAt,
            })),
          },
        },
      },
    };
  }

  if (call.name === "save_healing_recipe") {
    const approval = await createApprovalRequest("save_healing_recipe", {
      id: String(call.args?.id || ""),
      description: String(call.args?.description || ""),
      stepsJson: String(call.args?.stepsJson || "[]"),
    }, "Agent requested healing recipe save.", requester?.email, requester?.role);
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "save_healing_recipe",
          response: approval,
        },
      },
      approval,
    };
  }

  if (call.name === "run_healing_recipe") {
    const approval = await createApprovalRequest("run_healing_recipe", {
      id: String(call.args?.id || ""),
    }, "Agent requested healing recipe execution.", requester?.email, requester?.role);
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "run_healing_recipe",
          response: approval,
        },
      },
      approval,
    };
  }

  if (call.name === "self_heal_project") {
    const approval = await createApprovalRequest("self_heal_project", {}, "Agent requested project self-heal.", requester?.email, requester?.role);
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "self_heal_project",
          response: approval,
        },
      },
      approval,
    };
  }

  return { handled: false as const };
}

function normalizeRole(role?: string): "user" | "model" | "function" {
  if (role === "model" || role === "function") return role;
  return "user";
}

function createGeminiClients() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  return {
    genAI: new GoogleGenerativeAI(apiKey),
    fileManager: new GoogleAIFileManager(apiKey),
  };
}

function buildUserParts(message: string, files: RequestFile[] = [], toolResults: unknown[] = []): Part[] {
  const parts: Part[] = [];

  if (message?.trim()) {
    parts.push({ text: message.trim() });
  }

  for (const file of files) {
    if (file.geminiFile?.uri) {
      parts.push({
        fileData: {
          fileUri: file.geminiFile.uri,
          mimeType: file.geminiFile.mimeType || file.mimeType,
        },
      });
      continue;
    }

    if (file.data) {
      parts.push({
        inlineData: {
          data: file.data,
          mimeType: file.mimeType,
        },
      });
    }
  }

  for (const toolResult of toolResults) {
    parts.push(toolResult as Part);
  }

  return parts;
}

function normalizeWorkerPlatform(value: unknown): WorkerPlatform {
  if (value === "mac" || value === "macos" || value === "windows" || value === "linux" || value === "cloud") {
    return value;
  }
  return "unknown";
}

function normalizeWorkerStatus(value: unknown): WorkerStatus {
  if (value === "online" || value === "offline" || value === "busy") {
    return value;
  }
  return "online";
}

function normalizeWorkerCapabilities(value: unknown): WorkerCapability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((capability): capability is WorkerCapability =>
    capability === "shell"
    || capability === "filesystem"
    || capability === "git"
    || capability === "npm"
    || capability === "playwright"
    || capability === "browser"
    || capability === "seo_audit"
    || capability === "memory"
    || capability === "scheduler"
    || capability === "tool"
    || capability === "command"
    || capability === "file:read"
    || capability === "file:write"
    || capability === "file:edit"
  );
}

function requireWorkerApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = isWorkerRequestAuthorized(req.headers);
  if (auth.ok) {
    if (auth.devFallback) {
      logWorkerEvent("worker.auth.dev_fallback", { path: req.path, result: "allowed" });
    }
    return next();
  }
  logWorkerEvent("worker.auth.fail", { path: req.path, result: "fail" });
  return res.status(401).json(unauthorizedWorkerResponse());
}

function inferVerifiedCapabilities(input: {
  requested: WorkerCapability[];
  selfCheck?: unknown;
}) {
  const selfCheck = input.selfCheck && typeof input.selfCheck === "object"
    ? input.selfCheck as Record<string, unknown>
    : {};

  return input.requested.filter((capability) => {
    if ((capability === "shell" || capability === "command") && selfCheck.shell === false) return false;
    if ((capability === "filesystem" || capability.startsWith("file:")) && selfCheck.filesystem === false) return false;
    if ((capability === "playwright" || capability === "browser") && selfCheck.playwright === false) return false;
    return true;
  });
}

function getWorkerAuthMode() {
  return process.env.WORKER_API_KEY || process.env.BIZBOT_WORKER_API_KEY ? "api-key" : "dev-fallback";
}

function getWorkerDiagnostics(workerId?: string) {
  const workers = workerRegistry.list()
    .filter((worker) => !workerId || worker.id === workerId)
    .map((worker) => {
      const lastHeartbeatMs = new Date(worker.lastHeartbeatAt || worker.lastHeartbeat).getTime();
      return {
        id: worker.id,
        name: worker.name,
        platform: worker.platform,
        status: worker.status,
        online: worker.status === "online" || worker.status === "busy",
        capabilities: worker.capabilities,
        verifiedCapabilities: worker.verifiedCapabilities || worker.capabilities,
        lastHeartbeat: worker.lastHeartbeat,
        lastHeartbeatAt: worker.lastHeartbeatAt,
        lastHeartbeatAgeMs: Number.isFinite(lastHeartbeatMs) ? Date.now() - lastHeartbeatMs : null,
        failedTaskCount: worker.failedTasksCount || 0,
        currentTask: worker.currentTask,
        currentTaskId: worker.currentTaskId,
        authMode: getWorkerAuthMode(),
        endpoint: worker.endpoint,
        host: worker.host,
        recentExecutionSummary: executionDiagnostics.byWorker(worker.id, 5),
      };
    });

  return workers;
}

function getServerDiagnostics() {
  const workers = getWorkerDiagnostics();
  return {
    storageMode: process.env.BIZBOT_STORAGE_MODE || "local-json",
    workerAuthMode: getWorkerAuthMode(),
    heartbeatTtlMs: WORKER_HEARTBEAT_TTL_MS,
    executionTimeouts: {
      localCommandMs: 60_000,
      remoteWorkerMs: Number(process.env.REMOTE_WORKER_TIMEOUT_MS || 60_000),
      browserActionMs: BROWSER_ACTION_TIMEOUT_MS,
    },
    onlineWorkers: workers.filter((worker) => worker.online),
    pendingApprovals: readApprovals().filter((approval) => approval.status === "pending").length,
    recentExecutionFailures: executionDiagnostics.failures(10),
  };
}

async function startServer() {
  console.log("Starting Aegis Command Center (Node API)...");
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES } });

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));
  app.use("/api", requireAuth);

  // --- Relay Tool Endpoints ---

  /** Execute a shell command. */
  app.post("/api/relay/exec", async (req, res) => {
    const { command, workdir } = req.body;
    try {
      const result = await executionRouter.execute({
        kind: "command",
        command: String(command || ""),
        workdir: typeof workdir === "string" ? workdir : undefined,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown exec error.";
      res.status(400).json(executionError({ error: message, type: "execution", executor: "unavailable" }));
    }
  });

  /** Capability-routed execution entry point for local or remote workers. */
  app.post("/api/relay/execute", async (req, res) => {
    try {
      const result = await executionRouter.execute(req.body as ExecutionRequest);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown execution routing error.";
      res.status(400).json(executionError({ error: message, type: "execution", executor: "unavailable" }));
    }
  });

  /** Read a file. */
  app.get("/api/relay/read", async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json(executionError({ error: "No path provided.", type: "validation", executor: "unavailable" }));
    try {
      const result = await executionRouter.execute({
        kind: "file.read",
        path: filePath,
      });
      res.status(result.ok ? 200 : 500).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown read error.";
      res.status(500).json(executionError({ error: message, type: "execution", executor: "unavailable" }));
    }
  });

  /** Write a file. */
  app.post("/api/relay/write", async (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json(executionError({ error: "Missing path or content.", type: "validation", executor: "unavailable" }));
    try {
      const result = await executionRouter.execute({
        kind: "file.write",
        path: String(filePath),
        content: String(content),
      });
      res.status(result.ok ? 200 : 500).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown write error.";
      res.status(500).json(executionError({ error: message, type: "execution", executor: "unavailable" }));
    }
  });

  /** Edit a file (Search & Replace). */
  app.post("/api/relay/edit", async (req, res) => {
    const { path: filePath, oldString, newString } = req.body;
    if (!filePath || !oldString || newString === undefined) return res.status(400).json(executionError({ error: "Missing required fields.", type: "validation", executor: "unavailable" }));
    try {
      const result = await executionRouter.execute({
        kind: "file.edit",
        path: String(filePath),
        oldString: String(oldString),
        newString: String(newString),
      });
      res.status(result.ok ? 200 : 500).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown edit error.";
      res.status(500).json(executionError({ error: message, type: "execution", executor: "unavailable" }));
    }
  });

  app.get("/api/workers", (_req, res) => {
    res.json({ workers: workerRegistry.list() });
  });

  app.get("/api/workers/:id", (req, res) => {
    const worker = workerRegistry.get(String(req.params.id || ""));
    if (!worker) {
      return res.status(404).json({ error: "Worker not found." });
    }
    res.json(worker);
  });

  app.get("/api/workers/status", (_req, res) => {
    res.json({
      workers: workerRegistry.list().map((worker) => ({
        id: worker.id,
        name: worker.name,
        platform: worker.platform,
        online: worker.status === "online",
        status: worker.status,
        lastHeartbeat: worker.lastHeartbeat,
        lastHeartbeatAt: worker.lastHeartbeatAt,
        capabilities: worker.capabilities,
        currentTask: worker.currentTask,
        currentTaskId: worker.currentTaskId,
        failedTasksCount: worker.failedTasksCount || 0,
      })),
    });
  });

  app.post("/api/workers/register", requireWorkerApiKey, (req, res) => {
    try {
      const requestedCapabilities = normalizeWorkerCapabilities(req.body?.capabilities);
      const worker = workerRegistry.register({
        id: typeof req.body?.id === "string" ? req.body.id : undefined,
        name: String(req.body?.name || ""),
        platform: normalizeWorkerPlatform(req.body?.platform),
        capabilities: requestedCapabilities,
        verifiedCapabilities: inferVerifiedCapabilities({
          requested: requestedCapabilities,
          selfCheck: req.body?.selfCheck,
        }),
        endpoint: typeof req.body?.endpoint === "string" ? req.body.endpoint : undefined,
        host: typeof req.body?.host === "string" ? req.body.host : undefined,
        metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined,
      });
      res.json(worker);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown worker registration error.";
      res.status(400).json(executionError({ error: message, type: "validation", executor: "unavailable" }));
    }
  });

  app.post("/api/workers/heartbeat", requireWorkerApiKey, (req, res) => {
    try {
      const worker = workerRegistry.heartbeat(
        String(req.body?.id || ""),
        normalizeWorkerStatus(req.body?.status),
        typeof req.body?.currentTask === "string" ? req.body.currentTask : undefined,
        typeof req.body?.currentTaskId === "string" ? req.body.currentTaskId : undefined,
      );
      res.json(worker);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown worker heartbeat error.";
      res.status(404).json(executionError({ error: message, type: "validation", executor: "unavailable" }));
    }
  });

  app.post("/api/workers/:id/heartbeat", requireWorkerApiKey, (req, res) => {
    try {
      const worker = workerRegistry.heartbeat(
        String(req.params.id || ""),
        normalizeWorkerStatus(req.body?.status),
        typeof req.body?.currentTask === "string" ? req.body.currentTask : undefined,
        typeof req.body?.currentTaskId === "string" ? req.body.currentTaskId : undefined,
      );
      res.json(worker);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown worker heartbeat error.";
      res.status(404).json(executionError({ error: message, type: "validation", executor: "unavailable" }));
    }
  });

  app.post("/api/workers/:id/run", async (req, res) => {
    try {
      const workerId = String(req.params.id || "");
      const result = await executionRouter.execute({
        ...(req.body as ExecutionRequest),
        preferredWorkerId: workerId,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown worker run error.";
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/agents", (_req, res) => {
    res.json({ agents: readCustomAgents() });
  });

  app.post("/api/agents", (req, res) => {
    try {
      const agent = saveCustomAgent({
        id: typeof req.body?.id === "string" ? req.body.id : undefined,
        name: String(req.body?.name || ""),
        role: String(req.body?.role || ""),
        description: String(req.body?.description || ""),
        systemInstruction: String(req.body?.systemInstruction || ""),
        icon: typeof req.body?.icon === "string" ? req.body.icon : undefined,
        color: typeof req.body?.color === "string" ? req.body.color : undefined,
        suggestedPrompts: req.body?.suggestedPrompts,
      });
      res.json(agent);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown custom agent error.";
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/diagnostics/server", (_req, res) => {
    res.json(getServerDiagnostics());
  });

  app.get("/api/diagnostics/workers", (_req, res) => {
    res.json({
      workers: getWorkerDiagnostics(),
      recentExecutionFailures: executionDiagnostics.failures(10),
    });
  });

  app.get("/api/diagnostics/workers/:id", (req, res) => {
    const [worker] = getWorkerDiagnostics(String(req.params.id || ""));
    if (!worker) {
      return res.status(404).json(executionError({
        error: "Worker not found.",
        type: "validation",
        executor: "unavailable",
      }));
    }
    res.json(worker);
  });

  app.post("/api/diagnostics/test", async (req, res) => {
    const action = String(req.body?.action || "");
    const preferredWorkerId = typeof req.body?.workerId === "string" ? req.body.workerId : undefined;

    try {
      if (action === "ping_worker") {
        const worker = preferredWorkerId ? workerRegistry.get(preferredWorkerId) : workerRegistry.findCompatible([]);
        if (!worker) {
          return res.status(404).json(executionError({
            error: "Worker is offline or unreachable.",
            type: "network",
            executor: "unavailable",
          }));
        }
        const result = {
          ok: worker.status === "online" || worker.status === "busy",
          success: worker.status === "online" || worker.status === "busy",
          executor: "remote" as const,
          workerId: worker.id,
          metadata: { status: worker.status, lastHeartbeatAt: worker.lastHeartbeatAt },
        };
        executionDiagnostics.record({ kind: "tool", toolId: "diagnostics.ping_worker", preferredWorkerId: worker.id }, result);
        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (action === "safe_echo") {
        const result = await executionRouter.execute({
          kind: "command",
          command: "node -e \"console.log('bizbot-worker-ok')\"",
          workdir: process.cwd(),
          preferredWorkerId,
          requiredCapabilities: ["shell"],
        });
        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (action === "safe_read") {
        const result = await executionRouter.execute({
          kind: "file.read",
          path: path.join(process.cwd(), "package.json"),
          preferredWorkerId,
          requiredCapabilities: ["filesystem"],
        });
        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (action === "capability_missing") {
        const result = await executionRouter.execute({
          kind: "browser.action",
          browserAction: "diagnostics.noop",
          preferredWorkerId,
          requiredCapabilities: ["playwright"],
        });
        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (action === "simulate_timeout") {
        const result = executionError({
          error: "Execution timed out",
          type: "timeout",
          executor: "unavailable",
          workerId: preferredWorkerId,
          durationMs: Number(process.env.REMOTE_WORKER_TIMEOUT_MS || 60_000),
        });
        executionDiagnostics.record({ kind: "tool", toolId: "diagnostics.simulate_timeout", preferredWorkerId }, result);
        return res.status(408).json(result);
      }

      return res.status(400).json(executionError({
        error: "Unknown diagnostics test action.",
        type: "validation",
        executor: "unavailable",
        details: { action },
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown diagnostics test error.";
      const result = executionError({ error: message, type: "execution", executor: "unavailable" });
      executionDiagnostics.record({ kind: "tool", toolId: `diagnostics.${action || "unknown"}`, preferredWorkerId }, result);
      res.status(500).json(result);
    }
  });

  app.get("/api/autonomy/overview", (req: AuthenticatedRequest, res) => {
    try {
      res.json({
        ...getAutonomyOverview(),
        currentUserRole: req.userRole || "operator",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown autonomy overview error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/autonomy/schedules", (req, res) => {
    try {
      const schedules = readScheduledJobs();
      if (schedules.length >= MAX_SCHEDULED_JOBS) {
        return res.status(400).json({ error: `Only ${MAX_SCHEDULED_JOBS} scheduled jobs are allowed.` });
      }

      const targetType = normalizeScheduleTargetType(req.body?.targetType);
      const targetId = typeof req.body?.targetId === "string" && req.body.targetId.trim()
        ? req.body.targetId.trim()
        : undefined;
      if ((targetType === "tool" || targetType === "recipe") && !targetId) {
        return res.status(400).json({ error: "Scheduled tool and recipe jobs require a target id." });
      }

      const intervalMinutes = normalizeScheduleIntervalMinutes(req.body?.intervalMinutes);
      const entry: ScheduledJob = {
        id: `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(req.body?.name || `${targetType} schedule`).trim() || `${targetType} schedule`,
        targetType,
        targetId,
        intervalMinutes,
        status: "active",
        createdAt: new Date().toISOString(),
        nextRunAt: computeNextRunAt(intervalMinutes),
      };
      writeScheduledJobs([entry, ...schedules].slice(0, MAX_SCHEDULED_JOBS));
      res.json(entry);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown schedule creation error.";
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/integrations/gmail/estimate-scanner/status", (req, res) => {
    try {
      res.json(getGmailScannerStatus());
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown Gmail scanner status error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/integrations/gmail/estimate-scanner/run", async (req, res) => {
    try {
      const result = await runEstimateLeadScan({
        lookbackDays: req.body?.lookbackDays,
        maxResults: req.body?.maxResults,
      });
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown Gmail scanner run error.";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/autonomy/schedules/:id/toggle", (req, res) => {
    try {
      const active = Boolean(req.body?.active);
      const schedules = readScheduledJobs();
      const targetIndex = schedules.findIndex((entry) => entry.id === String(req.params.id || ""));
      if (targetIndex < 0) {
        return res.status(404).json({ error: "Scheduled job not found." });
      }
      const current = schedules[targetIndex];
      schedules[targetIndex] = {
        ...current,
        status: active ? "active" : "paused",
        nextRunAt: active ? computeNextRunAt(current.intervalMinutes) : current.nextRunAt,
      };
      writeScheduledJobs(schedules);
      res.json(schedules[targetIndex]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown schedule toggle error.";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/autonomy/schedules/:id/run", async (req, res) => {
    try {
      const run = await runScheduledJobNow(String(req.params.id || ""));
      res.json(run);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown scheduled run error.";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/autonomy/browser/replay", async (req, res) => {
    try {
      const result = await browserReplayTrace(String(req.body?.traceId || ""));
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown browser replay error.";
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/history/runs", (_req, res) => {
    try {
      res.json({ runs: readRunHistory() });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown run history read error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/history/runs", (req, res) => {
    try {
      const payload = req.body as Partial<StoredRunSummary>;
      if (!payload?.id || !payload.agentId || !payload.title || !payload.startedAt || !payload.completedAt || !payload.status) {
        return res.status(400).json({ error: "Missing required run summary fields." });
      }

      const history = readRunHistory().filter((entry) => entry.id !== payload.id);
      const nextEntry: StoredRunSummary = {
        id: String(payload.id),
        agentId: String(payload.agentId),
        title: String(payload.title),
        sourcePrompt: String(payload.sourcePrompt || ""),
        startedAt: String(payload.startedAt),
        completedAt: String(payload.completedAt),
        status: payload.status === "failed" ? "failed" : "completed",
        handoffCount: Number(payload.handoffCount || 0),
        approvalCount: Number(payload.approvalCount || 0),
        workflowLaunched: Boolean(payload.workflowLaunched),
        notes: String(payload.notes || ""),
      };
      writeRunHistory([nextEntry, ...history].slice(0, 100));
      res.json(nextEntry);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown run history write error.";
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/history/templates", (_req, res) => {
    try {
      res.json({ templates: readRunTemplates() });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown template read error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/history/templates", (req, res) => {
    try {
      const payload = req.body as Partial<StoredRunTemplate>;
      if (!payload?.id || !payload.name || !payload.agentId || !payload.prompt || !payload.createdAt || !payload.sourceRunId) {
        return res.status(400).json({ error: "Missing required run template fields." });
      }

      const templates = readRunTemplates().filter((entry) => entry.id !== payload.id);
      const nextEntry: StoredRunTemplate = {
        id: String(payload.id),
        name: String(payload.name),
        agentId: String(payload.agentId),
        prompt: String(payload.prompt),
        createdAt: String(payload.createdAt),
        sourceRunId: String(payload.sourceRunId),
        notes: typeof payload.notes === "string" ? payload.notes : undefined,
      };
      writeRunTemplates([nextEntry, ...templates].slice(0, 100));
      res.json(nextEntry);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown template write error.";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/autonomy/tools", async (req: AuthenticatedRequest, res) => {
    try {
      enforceActionRole(req.userRole, "register_tool", "request");
      const approval = await createApprovalRequest("register_tool", {
        id: String(req.body?.id || ""),
        description: String(req.body?.description || ""),
        command: String(req.body?.command || ""),
        cwd: typeof req.body?.cwd === "string" ? req.body.cwd : undefined,
      }, "Operator requested tool registration.", req.userEmail, req.userRole);
      res.json(approval);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown tool registration error.";
      res.status(message.includes("requires") ? 403 : 400).json({ error: message });
    }
  });

  app.post("/api/autonomy/tools/run", async (req, res) => {
    try {
      const result = await runRegisteredTool(String(req.body?.id || ""));
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown tool execution error.";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/autonomy/install-package", async (req: AuthenticatedRequest, res) => {
    try {
      enforceActionRole(req.userRole, "install_npm_package", "request");
      const approval = await createApprovalRequest("install_npm_package", {
        packageName: String(req.body?.packageName || ""),
        saveDev: Boolean(req.body?.saveDev),
      }, "Operator requested package install.", req.userEmail, req.userRole);
      res.json(approval);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown npm install error.";
      res.status(message.includes("requires") ? 403 : 400).json({ error: message });
    }
  });

  app.post("/api/autonomy/healing-recipes", async (req: AuthenticatedRequest, res) => {
    try {
      enforceActionRole(req.userRole, "save_healing_recipe", "request");
      const approval = await createApprovalRequest("save_healing_recipe", {
        id: String(req.body?.id || ""),
        description: String(req.body?.description || ""),
        stepsJson: String(req.body?.stepsJson || "[]"),
      }, "Operator requested healing recipe save.", req.userEmail, req.userRole);
      res.json(approval);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown healing recipe save error.";
      res.status(message.includes("requires") ? 403 : 400).json({ error: message });
    }
  });

  app.post("/api/autonomy/healing-recipes/run", async (req: AuthenticatedRequest, res) => {
    try {
      enforceActionRole(req.userRole, "run_healing_recipe", "request");
      const approval = await createApprovalRequest("run_healing_recipe", {
        id: String(req.body?.id || ""),
      }, "Operator requested healing recipe execution.", req.userEmail, req.userRole);
      res.json(approval);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown healing recipe execution error.";
      res.status(message.includes("requires") ? 403 : 400).json({ error: message });
    }
  });

  app.post("/api/autonomy/self-heal", async (req: AuthenticatedRequest, res) => {
    try {
      enforceActionRole(req.userRole, "self_heal_project", "request");
      const approval = await createApprovalRequest("self_heal_project", {}, "Operator requested project self-heal.", req.userEmail, req.userRole);
      res.json(approval);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown self-heal error.";
      res.status(message.includes("requires") ? 403 : 500).json({ error: message });
    }
  });

  app.post("/api/autonomy/approvals/:id/approve", async (req: AuthenticatedRequest, res) => {
    try {
      const approvals = readApprovals();
      const targetIndex = approvals.findIndex((entry) => entry.id === String(req.params.id || ""));
      if (targetIndex < 0) {
        return res.status(404).json({ error: "Approval request not found." });
      }
      const approval = approvals[targetIndex];
      if (approval.status !== "pending") {
        return res.status(400).json({ error: `Approval is already ${approval.status}.` });
      }
      enforceActionRole(req.userRole, approval.type, "approve");
      if (
        approval.requestedBy
        && req.userEmail
        && approval.requestedBy === req.userEmail
        && (approval.type === "install_npm_package" || approval.type === "self_heal_project")
      ) {
        return res.status(403).json({ error: "A different approver is required for this action." });
      }

      const result = await executeApprovalAction(approval);
      approvals[targetIndex] = {
        ...approval,
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewedBy: req.userEmail || "unknown",
        result,
      };
      writeApprovals(approvals);
      res.json(approvals[targetIndex]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown approval execution error.";
      res.status(message.includes("requires") ? 403 : 400).json({ error: message });
    }
  });

  app.post("/api/autonomy/approvals/:id/reject", (req: AuthenticatedRequest, res) => {
    try {
      const approvals = readApprovals();
      const targetIndex = approvals.findIndex((entry) => entry.id === String(req.params.id || ""));
      if (targetIndex < 0) {
        return res.status(404).json({ error: "Approval request not found." });
      }
      const approval = approvals[targetIndex];
      if (approval.status !== "pending") {
        return res.status(400).json({ error: `Approval is already ${approval.status}.` });
      }
      enforceActionRole(req.userRole, approval.type, "approve");

      approvals[targetIndex] = {
        ...approval,
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: req.userEmail || "unknown",
        reason: typeof req.body?.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim()
          : "Rejected by operator.",
      };
      writeApprovals(approvals);
      res.json(approvals[targetIndex]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown approval rejection error.";
      res.status(message.includes("requires") ? 403 : 400).json({ error: message });
    }
  });

  app.post("/api/chat", async (req: AuthenticatedRequest, res) => {
    try {
      const {
        message = "",
        history = [],
        systemInstruction = "",
        files = [],
        toolResults = [],
      } = req.body as {
        message?: string;
        history?: RequestHistoryEntry[];
        systemInstruction?: string;
        files?: RequestFile[];
        toolResults?: unknown[];
      };

      const validationError = validateChatBody({ message, history, files, toolResults });
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const memoryContext = await readNeuralMemory(String(message || ""));
      const enhancedSystemInstruction = [
        systemInstruction,
        "Neural memory is authoritative business context. If it contains relevant facts about the user, Bobby Sanderlin, Carolina Wheel Werkz, CWW, or BizBot, use those facts directly. Do not claim you have no memory when neural memory context is present.",
        "Web research rule: do not navigate to Google, Bing, or other search result pages in the browser. Search result pages trigger captcha and stall the run. Use known direct URLs from memory, fetch_url, crawl_site, seo_audit_url, browser_read after direct navigation, or ask for the missing URL.",
        "Agent creation rule: if the user asks you to make, add, create, or install a new BizBot agent, use create_agent with a complete name, role, description, systemInstruction, icon, color, and suggestedPrompts. Do not say you cannot add agents to the sidebar; create_agent persists the agent and the UI refreshes the roster.",
        "Gmail estimate scanner rule: you have a read-only tool named scan_gmail_estimate_leads for finding Carolina Wheel Werkz customer estimate leads. Use it when asked to scan Gmail/email for estimates, quotes, wheel repair requests, voicemails, or customer leads. Never claim email scanning is unavailable if this tool is listed. It cannot send, delete, archive, label, or modify emails.",
        memoryContext && memoryContext !== "No prior neural memory found."
          ? `Current neural memory:\n${memoryContext}`
          : "",
      ].filter(Boolean).join("\n\n");

      const { genAI } = createGeminiClients();
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        systemInstruction: enhancedSystemInstruction,
        tools: getModelTools(),
      });

      const userParts = buildUserParts(message, files, toolResults);
      if (userParts.length === 0) {
        return res.status(400).json({ error: "No message, files, or tool results were provided." });
      }

      const contents = [
        ...history.map((entry) => ({
          role: normalizeRole(entry.role),
          parts: entry.parts || [],
        })),
        {
          role: "user" as const,
          parts: userParts,
        },
      ];

      let response = (await model.generateContent({ contents })).response;
      const pendingApprovals: PendingApproval[] = [];
      const conversationContents = [...contents];
      let serverToolRoundCount = 0;

      for (let toolRound = 0; toolRound < 6; toolRound += 1) {
        const functionCalls = typeof response.functionCalls === "function" ? (response.functionCalls() as ToolCall[] | undefined) : undefined;
        if (!functionCalls || functionCalls.length === 0) {
          break;
        }

        const serverToolResponses: Array<{ functionResponse: { name: string; response: unknown } }> = [];
        const clientToolCalls: ToolCall[] = [];

        for (const call of functionCalls) {
          try {
            const resolution = await resolveServerToolCall(call, {
              email: req.userEmail,
              role: req.userRole,
            });
            if (resolution.handled) {
              serverToolResponses.push(resolution.response);
              if (isPendingApproval(resolution.approval)) {
                pendingApprovals.push(resolution.approval);
              }
            } else {
              clientToolCalls.push(call);
            }
          } catch (toolError) {
            serverToolResponses.push({
              functionResponse: {
                name: call.name,
                response: {
                  ok: false,
                  error: toolError instanceof Error ? toolError.message : "Tool execution failed.",
                  guidance: "Continue with the sources that succeeded. If a competitor URL is missing or unreachable, say which URL is needed instead of failing the whole answer.",
                },
              },
            });
          }
        }

        if (clientToolCalls.length > 0) {
          return res.json({
            functionCalls: clientToolCalls,
            pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined,
          });
        }

        if (serverToolResponses.length === 0) {
          break;
        }

        serverToolRoundCount += 1;
        conversationContents.push(
          { role: "model" as const, parts: functionCalls.map((call) => ({ functionCall: call })) as Part[] },
          { role: "function" as const, parts: serverToolResponses as Part[] },
        );
        response = (await model.generateContent({ contents: conversationContents } as any)).response;
      }

      const functionCalls = typeof response.functionCalls === "function" ? (response.functionCalls() as ToolCall[] | undefined) : undefined;
      let finalText = response.text();

      if (!finalText.trim() && serverToolRoundCount > 0 && (!functionCalls || functionCalls.length === 0)) {
        const finalResponse = await model.generateContent({
          contents: [
            ...conversationContents,
            {
              role: "user" as const,
              parts: [{
                text: "Produce a concise final answer for the user using the tool results above. If some URLs failed or were missing, clearly say what was unavailable and continue with the available evidence. Do not return an empty response.",
              }],
            },
          ],
        } as any);
        response = finalResponse.response;
        finalText = response.text();
      }

      res.json({
        text: finalText,
        functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined,
        pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown chat error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    const uploadedBinary = (req as typeof req & { file?: UploadedFile }).file;

    if (!uploadedBinary) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    if (!isAllowedMimeType(uploadedBinary.mimetype)) {
      return res.status(400).json({ error: "File type not allowed." });
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-upload-"));
    const tempPath = path.join(tempDir, uploadedBinary.originalname);

    try {
      const { fileManager } = createGeminiClients();
      fs.writeFileSync(tempPath, uploadedBinary.buffer);

      const uploadResult = await fileManager.uploadFile(tempPath, {
        mimeType: uploadedBinary.mimetype,
        displayName: uploadedBinary.originalname,
      });

      let uploadedFile = uploadResult.file;
      const resourceName = uploadedFile.name;

      if (uploadedFile.state === FileState.PROCESSING && resourceName) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          uploadedFile = await fileManager.getFile(resourceName);
          if (uploadedFile.state !== FileState.PROCESSING) break;
        }
      }

      if (uploadedFile.state !== FileState.ACTIVE) {
        return res.status(500).json({
          error: `Uploaded file did not become active. Current state: ${uploadedFile.state || "unknown"}`,
        });
      }

      res.json({
        uri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType || uploadedBinary.mimetype,
        resourceName: uploadedFile.name,
        displayName: uploadedFile.displayName || uploadedBinary.originalname,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown upload error.";
      res.status(500).json({ error: message });
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware applied.");
    } catch (e) {
      console.warn("Could not start Vite dev middleware (Rollup/Native module issue). Serving dist/ only.");
      process.env.NODE_ENV = "production";
    }
  }

  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    if (!fs.existsSync(distPath)) {
      console.error("[config] dist/ not found. Run `npm run build` or ensure build artifacts are present.");
    }
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  ensureSchedulerLoop();
  void runDueSchedules();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
