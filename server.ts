import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import admin from "firebase-admin";
import { chromium, type Browser, type Page } from "playwright";

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
const RELAY_ALLOWED_COMMANDS = new Set([
  "npm",
  "npx",
  "node",
  "git",
  "tsx",
  "tsc",
  "vite",
]);
const RELAY_ALLOWED_ROOTS = [
  path.resolve(process.env.RELAY_ROOT || process.cwd()),
];
const MEMORY_STORE_PATH = path.join(process.cwd(), ".bizbot-memory.json");
const TOOL_REGISTRY_PATH = path.join(process.cwd(), ".bizbot-tools.json");
const HEALING_RECIPES_PATH = path.join(process.cwd(), ".bizbot-healing-recipes.json");
const APPROVALS_PATH = path.join(process.cwd(), ".bizbot-approvals.json");
const RUN_HISTORY_PATH = path.join(process.cwd(), ".bizbot-run-history.json");
const RUN_TEMPLATES_PATH = path.join(process.cwd(), ".bizbot-run-templates.json");
const MAX_FETCHED_PAGE_CHARS = 12_000;
const MAX_CRAWL_PAGES = 20;
const MAX_HEALING_STEPS = 12;
const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "true";
const BROWSER_ARTIFACTS_DIR = path.join(process.cwd(), ".browser-artifacts");

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

let browserSession: Browser | null = null;
let browserPageSession: Page | null = null;

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

  if (/[|&;><`]/.test(trimmed)) {
    throw new Error("Shell operators are not allowed in relay commands.");
  }

  return trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

function validateRelayCommand(command: string) {
  const parts = tokenizeCommand(command);
  const executable = parts[0]?.toLowerCase();
  if (!executable || !RELAY_ALLOWED_COMMANDS.has(executable)) {
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

function createApprovalRequest(
  type: ApprovalActionType,
  payload: Record<string, unknown>,
  reason?: string,
  requestedBy?: string,
  requestedByRole?: UserRole,
) {
  const approvals = readApprovals();
  const approval: PendingApproval = {
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
  writeApprovals(approvals);
  return approval;
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
  const { executable, args } = validateRelayCommand(command);
  const resolvedCwd = resolveRelayPath(cwd && cwd.trim() ? cwd : process.cwd());

  return new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    signal: string | null;
  }>((resolve, reject) => {
    execFile(executable, args, { cwd: resolvedCwd, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }

      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: typeof error?.code === "number" ? error.code : 0,
        signal: error?.signal || null,
      });
    });
  });
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
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("A valid http or https URL is required.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  return parsed;
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
  const safeUrl = parseHttpUrl(url).toString();

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
  const safeUrl = parseHttpUrl(url).toString();
  const response = await fetch(safeUrl, {
    headers: {
      "User-Agent": "BizBot-Agent/1.0",
    },
  });

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
  const page = await ensureBrowserPage();
  const title = await page.title().catch(() => "");
  const url = page.url();
  const textContent = await page.locator("body").innerText().catch(() => "");
  return {
    title,
    url,
    content: textContent.replace(/\s+/g, " ").trim().slice(0, MAX_FETCHED_PAGE_CHARS),
  };
}

async function browserListInteractives() {
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
}

async function browserScreenshot(fullPage?: boolean) {
  ensureBrowserArtifactsDir();
  const page = await ensureBrowserPage();
  const filename = `browser-shot-${Date.now()}.png`;
  const outputPath = path.join(BROWSER_ARTIFACTS_DIR, filename);
  await page.screenshot({
    path: outputPath,
    fullPage: Boolean(fullPage),
  });
  return {
    path: outputPath,
    url: page.url(),
    title: await page.title().catch(() => ""),
  };
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
  const page = await ensureBrowserPage();
  const safeUrl = parseHttpUrl(url).toString();
  await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return browserReadState();
}

async function browserClick(selector: string) {
  const page = await ensureBrowserPage();
  await page.locator(selector).first().click({ timeout: 15_000 });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  return browserReadState();
}

async function browserType(selector: string, text: string) {
  const page = await ensureBrowserPage();
  const locator = page.locator(selector).first();
  await locator.click({ timeout: 15_000 });
  await locator.fill(text, { timeout: 15_000 });
  return browserReadState();
}

async function browserPress(key: string) {
  const page = await ensureBrowserPage();
  await page.keyboard.press(key);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  return browserReadState();
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
  return {
    registeredTools: readRegisteredTools(),
    healingRecipes: readHealingRecipes(),
    approvals: readApprovals(),
    approvalPolicy: APPROVAL_POLICY,
    relay: {
      allowedCommands: [...RELAY_ALLOWED_COMMANDS],
      allowedRoots: RELAY_ALLOWED_ROOTS,
    },
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
    const approval = createApprovalRequest("register_tool", {
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
    const approval = createApprovalRequest("install_npm_package", {
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
    const approval = createApprovalRequest("save_healing_recipe", {
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
    const approval = createApprovalRequest("run_healing_recipe", {
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
    const approval = createApprovalRequest("self_heal_project", {}, "Agent requested project self-heal.", requester?.email, requester?.role);
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

async function startServer() {
  console.log("Starting Aegis Command Center (Node API)...");
  const app = express();
  const PORT = 3000;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES } });

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));
  app.use("/api", requireAuth);

  // --- Relay Tool Endpoints ---

  /** Execute a shell command. */
  app.post("/api/relay/exec", async (req, res) => {
    const { command, workdir } = req.body;
    try {
      const { executable, args } = validateRelayCommand(String(command || ""));
      const cwd = resolveRelayPath(typeof workdir === "string" && workdir.trim() ? workdir : process.cwd());

      execFile(executable, args, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
        res.json({
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: typeof error?.code === "number" ? error.code : 0,
          signal: error?.signal || null,
        });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown exec error.";
      res.status(400).json({ error: message });
    }
  });

  /** Read a file. */
  app.get("/api/relay/read", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "No path provided." });
    try {
      const content = fs.readFileSync(resolveRelayPath(filePath), "utf8");
      res.json({ content });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown read error.";
      res.status(500).json({ error: message });
    }
  });

  /** Write a file. */
  app.post("/api/relay/write", (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: "Missing path or content." });
    try {
      fs.writeFileSync(resolveRelayPath(String(filePath)), String(content), "utf8");
      res.json({ success: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown write error.";
      res.status(500).json({ error: message });
    }
  });

  /** Edit a file (Search & Replace). */
  app.post("/api/relay/edit", (req, res) => {
    const { path: filePath, oldString, newString } = req.body;
    if (!filePath || !oldString || newString === undefined) return res.status(400).json({ error: "Missing required fields." });
    try {
      const fullPath = resolveRelayPath(String(filePath));
      let content = fs.readFileSync(fullPath, "utf8");
      if (!content.includes(oldString)) {
        return res.status(400).json({ error: "oldString not found in file." });
      }
      content = content.replace(String(oldString), String(newString));
      fs.writeFileSync(fullPath, content, "utf8");
      res.json({ success: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown edit error.";
      res.status(500).json({ error: message });
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
      const approval = createApprovalRequest("register_tool", {
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
      const approval = createApprovalRequest("install_npm_package", {
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
      const approval = createApprovalRequest("save_healing_recipe", {
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
      const approval = createApprovalRequest("run_healing_recipe", {
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
      const approval = createApprovalRequest("self_heal_project", {}, "Operator requested project self-heal.", req.userEmail, req.userRole);
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

      const { genAI } = createGeminiClients();
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        systemInstruction,
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
      const initialFunctionCalls = typeof response.functionCalls === "function" ? (response.functionCalls() as ToolCall[] | undefined) : undefined;
      const pendingApprovals: PendingApproval[] = [];

      if (initialFunctionCalls && initialFunctionCalls.length > 0) {
        const serverToolResponses: Array<{ functionResponse: { name: string; response: unknown } }> = [];
        const clientToolCalls: ToolCall[] = [];

        for (const call of initialFunctionCalls) {
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
        }

        if (clientToolCalls.length > 0) {
          return res.json({
            functionCalls: clientToolCalls,
            pendingApprovals: pendingApprovals.length > 0 ? pendingApprovals : undefined,
          });
        }

        if (serverToolResponses.length > 0) {
          const secondResponse = await model.generateContent({
            contents: [
              ...contents,
              { role: "model", parts: initialFunctionCalls.map((call) => ({ functionCall: call })) },
              { role: "function", parts: serverToolResponses },
            ],
          } as any);
          response = secondResponse.response;
        }
      }

      const functionCalls = typeof response.functionCalls === "function" ? (response.functionCalls() as ToolCall[] | undefined) : undefined;

      res.json({
        text: response.text(),
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
